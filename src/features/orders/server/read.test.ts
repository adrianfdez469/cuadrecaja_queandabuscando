import { beforeEach, describe, expect, it, vi } from "vitest";

const orderFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { order: { findFirst: (...args: unknown[]) => orderFindFirst(...args) } },
}));

const { getOrderByCode, orderWhatsappUrl } = await import("./read");

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
    store: {
      slug: "tienda-demo",
      name: "La Rampa",
      checkoutMode: "WHATSAPP",
      whatsapp: "+5350000001",
      phone: null,
    },
    items: [
      {
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
    expect(await getOrderByCode("tienda-demo", "not-a-code")).toBeNull();
    expect(orderFindFirst).not.toHaveBeenCalled();
  });

  it("normalizes a lowercase, hyphenated code before querying", async () => {
    orderFindFirst.mockResolvedValue(dbOrder());
    await getOrderByCode("tienda-demo", "a7k3m-9pqr2");
    expect(orderFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: "A7K3M9PQR2", store: { slug: "tienda-demo" } } }),
    );
  });

  it("returns null when nothing matches (E17: cross-store 404 by construction)", async () => {
    orderFindFirst.mockResolvedValue(null);
    expect(await getOrderByCode("tienda-demo", "A7K3M9PQR2")).toBeNull();
  });

  it("maps Decimal-like fields to plain strings, never leaking a Decimal", async () => {
    orderFindFirst.mockResolvedValue(dbOrder());
    const snapshot = await getOrderByCode("tienda-demo", "A7K3M9PQR2");
    expect(snapshot?.subtotal).toBe("900.00");
    expect(typeof snapshot?.items[0].quantity).toBe("string");
  });

  it("derives fulfillment from whether a delivery address is present", async () => {
    orderFindFirst.mockResolvedValue(dbOrder({ deliveryAddress: "Calle 23, Vedado" }));
    const snapshot = await getOrderByCode("tienda-demo", "A7K3M9PQR2");
    expect(snapshot?.fulfillment).toBe("DELIVERY");

    orderFindFirst.mockResolvedValue(dbOrder({ deliveryAddress: null }));
    const pickup = await getOrderByCode("tienda-demo", "A7K3M9PQR2");
    expect(pickup?.fulfillment).toBe("PICKUP");
  });

  it("falls back to Store.phone when there is no whatsapp number", async () => {
    orderFindFirst.mockResolvedValue(
      dbOrder({
        store: {
          slug: "tienda-demo",
          name: "x",
          checkoutMode: "WHATSAPP",
          whatsapp: null,
          phone: "+539",
        },
      }),
    );
    const snapshot = await getOrderByCode("tienda-demo", "A7K3M9PQR2");
    expect(snapshot?.whatsappNumber).toBe("+539");
  });
});

describe("orderWhatsappUrl()", () => {
  it("returns null for ONSITE (E18)", async () => {
    orderFindFirst.mockResolvedValue(
      dbOrder({ store: { ...dbOrder().store, checkoutMode: "ONSITE" } }),
    );
    const snapshot = await getOrderByCode("tienda-demo", "A7K3M9PQR2");
    expect(orderWhatsappUrl(snapshot!)).toBeNull();
  });

  it("returns null with no number even in WHATSAPP mode", async () => {
    orderFindFirst.mockResolvedValue(
      dbOrder({
        store: {
          slug: "tienda-demo",
          name: "x",
          checkoutMode: "WHATSAPP",
          whatsapp: null,
          phone: null,
        },
      }),
    );
    const snapshot = await getOrderByCode("tienda-demo", "A7K3M9PQR2");
    expect(orderWhatsappUrl(snapshot!)).toBeNull();
  });

  it("builds a wa.me link with the order's code and total", async () => {
    orderFindFirst.mockResolvedValue(dbOrder());
    const snapshot = await getOrderByCode("tienda-demo", "A7K3M9PQR2");
    const url = orderWhatsappUrl(snapshot!)!;
    expect(url).toMatch(/^https:\/\/wa\.me\/5350000001\?text=/);
    expect(decodeURIComponent(url)).toContain("Código: A7K3M-9PQR2");
  });
});
