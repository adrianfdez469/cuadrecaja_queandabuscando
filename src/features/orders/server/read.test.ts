import { beforeEach, describe, expect, it, vi } from "vitest";

const orderFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { order: { findFirst: (...args: unknown[]) => orderFindFirst(...args) } },
}));

const { getOrderByCode, orderWhatsappUrl } = await import("./read");

const STORE_ID = "store-1";

function dbOrder(overrides: Record<string, unknown> = {}) {
  return {
    code: "A7K3M9PQR2",
    status: "PENDING",
    contactName: "Ana Pérez",
    contactPhone: "+5355555555",
    contactEmail: null,
    deliveryAddress: null,
    currencyCode: "CUP",
    subtotal: { toString: () => "900.00" },
    deliveryFee: { toString: () => "0.00" },
    total: { toString: () => "900.00" },
    notes: null,
    createdAt: new Date("2026-08-26T02:00:00.000Z"),
    cancelledBy: null,
    proposedAt: null,
    expiresAt: null,
    proposalMessage: null,
    previousTotal: null,
    proposedSubtotal: null,
    proposedDiscountTotal: null,
    proposedDeliveryFee: null,
    proposedTotal: null,
    proposedItems: null,
    proposalOutcome: null,
    store: {
      slug: null,
      name: "La Rampa",
      checkoutMode: "WHATSAPP",
      whatsapp: "+5350000001",
      phone: null,
      storefront: { slug: "tienda-demo", stores: [{ id: STORE_ID }] },
    },
    items: [
      {
        storeProductId: "sp-1",
        name: "Café Cubita",
        unitPrice: { toString: () => "450.00" },
        currencyCode: "CUP",
        quantity: { toString: () => "2.000" },
        lineTotal: { toString: () => "900.00" },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  orderFindFirst.mockReset();
});

describe("getOrderByCode()", () => {
  it("returns null for a malformed code without querying the database", async () => {
    expect(await getOrderByCode(STORE_ID, "not-a-code")).toBeNull();
    expect(orderFindFirst).not.toHaveBeenCalled();
  });

  it("normalizes a lowercase, hyphenated code before querying, filtered by storeId (never by slug)", async () => {
    orderFindFirst.mockResolvedValue(dbOrder());
    await getOrderByCode(STORE_ID, "a7k3m-9pqr2");
    expect(orderFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: "A7K3M9PQR2", storeId: STORE_ID } }),
    );
  });

  it("returns null when nothing matches (E17: cross-store 404 by construction)", async () => {
    orderFindFirst.mockResolvedValue(null);
    expect(await getOrderByCode(STORE_ID, "A7K3M9PQR2")).toBeNull();
  });

  it("maps Decimal-like fields to plain strings, never leaking a Decimal", async () => {
    orderFindFirst.mockResolvedValue(dbOrder());
    const snapshot = await getOrderByCode(STORE_ID, "A7K3M9PQR2");
    expect(snapshot?.subtotal).toBe("900.00");
    expect(typeof snapshot?.items[0].quantity).toBe("string");
  });

  it("the order URL uses the CANONICAL slug (the brand's, for a single-branch brand)", async () => {
    orderFindFirst.mockResolvedValue(dbOrder());
    const snapshot = await getOrderByCode(STORE_ID, "A7K3M9PQR2");
    expect(snapshot?.storeSlug).toBe("tienda-demo");
  });

  it("derives fulfillment from whether a delivery address is present", async () => {
    orderFindFirst.mockResolvedValue(dbOrder({ deliveryAddress: "Calle 23, Vedado" }));
    const snapshot = await getOrderByCode(STORE_ID, "A7K3M9PQR2");
    expect(snapshot?.fulfillment).toBe("DELIVERY");

    orderFindFirst.mockResolvedValue(dbOrder({ deliveryAddress: null }));
    const pickup = await getOrderByCode(STORE_ID, "A7K3M9PQR2");
    expect(pickup?.fulfillment).toBe("PICKUP");
  });

  it("falls back to Store.phone when there is no whatsapp number (R15: always the branch, never the brand)", async () => {
    orderFindFirst.mockResolvedValue(
      dbOrder({
        store: {
          slug: null,
          name: "x",
          checkoutMode: "WHATSAPP",
          whatsapp: null,
          phone: "+539",
          storefront: { slug: "tienda-demo", stores: [{ id: STORE_ID }] },
        },
      }),
    );
    const snapshot = await getOrderByCode(STORE_ID, "A7K3M9PQR2");
    expect(snapshot?.whatsappNumber).toBe("+539");
  });
});

describe("orderWhatsappUrl()", () => {
  it("returns null for ONSITE (E18)", async () => {
    orderFindFirst.mockResolvedValue(
      dbOrder({ store: { ...dbOrder().store, checkoutMode: "ONSITE" } }),
    );
    const snapshot = await getOrderByCode(STORE_ID, "A7K3M9PQR2");
    expect(orderWhatsappUrl(snapshot!)).toBeNull();
  });

  it("returns null with no number even in WHATSAPP mode", async () => {
    orderFindFirst.mockResolvedValue(
      dbOrder({
        store: {
          slug: null,
          name: "x",
          checkoutMode: "WHATSAPP",
          whatsapp: null,
          phone: null,
          storefront: { slug: "tienda-demo", stores: [{ id: STORE_ID }] },
        },
      }),
    );
    const snapshot = await getOrderByCode(STORE_ID, "A7K3M9PQR2");
    expect(orderWhatsappUrl(snapshot!)).toBeNull();
  });

  it("builds a wa.me link with the order's code and total", async () => {
    orderFindFirst.mockResolvedValue(dbOrder());
    const snapshot = await getOrderByCode(STORE_ID, "A7K3M9PQR2");
    const url = orderWhatsappUrl(snapshot!)!;
    expect(url).toMatch(/^https:\/\/wa\.me\/5350000001\?text=/);
    expect(decodeURIComponent(url)).toContain("Código: A7K3M-9PQR2");
  });
});

describe("getOrderByCode() — F-019 proposal + cancelledBy", () => {
  it("proposal is null when the order never had one", async () => {
    orderFindFirst.mockResolvedValue(dbOrder());
    const snapshot = await getOrderByCode(STORE_ID, "A7K3M9PQR2");
    expect(snapshot?.proposal).toBeNull();
    expect(snapshot?.cancelledBy).toBeNull();
  });

  it("proposal is populated with the PROPOSED amounts while AWAITING_CUSTOMER (E2)", async () => {
    orderFindFirst.mockResolvedValue(
      dbOrder({
        status: "AWAITING_CUSTOMER",
        proposedAt: new Date("2026-08-30T14:19:43.000Z"),
        expiresAt: new Date("2026-08-31T14:19:43.000Z"),
        proposalMessage: "El envío a Playa cuesta 180.",
        previousTotal: { toString: () => "880.00" },
        proposedSubtotal: { toString: () => "1000.00" },
        proposedDiscountTotal: { toString: () => "0" },
        proposedDeliveryFee: { toString: () => "180.00" },
        proposedTotal: { toString: () => "1180.00" },
        proposedItems: [
          {
            storeProductId: "sp-1",
            name: "Café Cubita",
            unitPrice: "500.00",
            currencyCode: "CUP",
            quantity: "2",
            lineTotal: "1000.00",
          },
        ],
        proposalOutcome: null,
      }),
    );
    const snapshot = await getOrderByCode(STORE_ID, "A7K3M9PQR2");
    expect(snapshot?.proposal).toEqual({
      proposedAt: "2026-08-30T14:19:43.000Z",
      expiresAt: "2026-08-31T14:19:43.000Z",
      message: "El envío a Playa cuesta 180.",
      previousTotal: "880.00",
      subtotal: "1000.00",
      discountTotal: "0",
      deliveryFee: "180.00",
      total: "1180.00",
      items: [
        {
          storeProductId: "sp-1",
          name: "Café Cubita",
          unitPrice: "500.00",
          currencyCode: "CUP",
          quantity: "2",
          lineTotal: "1000.00",
        },
      ],
      outcome: null,
    });
  });

  it("proposal STAYS populated after an approval (PP3 — only a SECOND proposal overwrites it)", async () => {
    orderFindFirst.mockResolvedValue(
      dbOrder({
        status: "CONFIRMED",
        proposedAt: new Date("2026-08-30T14:19:43.000Z"),
        expiresAt: new Date("2026-08-31T14:19:43.000Z"),
        previousTotal: { toString: () => "880.00" },
        proposedSubtotal: { toString: () => "1000.00" },
        proposedDiscountTotal: { toString: () => "0" },
        proposedDeliveryFee: { toString: () => "180.00" },
        proposedTotal: { toString: () => "1180.00" },
        proposedItems: [],
        proposalOutcome: "APPROVED",
      }),
    );
    const snapshot = await getOrderByCode(STORE_ID, "A7K3M9PQR2");
    expect(snapshot?.proposal?.outcome).toBe("APPROVED");
    expect(snapshot?.proposal?.previousTotal).toBe("880.00");
  });

  it("cancelledBy carries the three R9 attributions through unchanged", async () => {
    orderFindFirst.mockResolvedValue(dbOrder({ status: "CANCELLED", cancelledBy: "EXPIRY" }));
    const snapshot = await getOrderByCode(STORE_ID, "A7K3M9PQR2");
    expect(snapshot?.cancelledBy).toBe("EXPIRY");
  });

  it("items carry storeProductId (needed to diff proposed vs current, A5)", async () => {
    orderFindFirst.mockResolvedValue(dbOrder());
    const snapshot = await getOrderByCode(STORE_ID, "A7K3M9PQR2");
    expect(snapshot?.items[0].storeProductId).toBe("sp-1");
  });
});
