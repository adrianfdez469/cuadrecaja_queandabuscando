import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();
const orderFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    order: { findUnique: (...args: unknown[]) => orderFindUnique(...args) },
  },
}));

const getOrderByCode = vi.fn();
vi.mock("./read", () => ({ getOrderByCode: (...args: unknown[]) => getOrderByCode(...args) }));

const { proposeOrderChange } = await import("./proposal");

/**
 * F-019 architecture.md DA2: one UPDATE…RETURNING, no read before it.
 * `$queryRaw` is mocked to return the RETURNING rows this module already
 * expects — the SQL itself is exercised for real by the smoke script
 * (etapa 8) and was hand-verified against Postgres by sdd-architect
 * (architecture.md's own preamble). What these tests own is the wrapper:
 * the wa.me build and the 0-rows classification (E4).
 */

const baseInput = {
  businessId: "biz-1",
  orderId: 42n,
  currencyCode: "CUP",
  subtotal: "1000.00",
  discountTotal: "0.00",
  deliveryFee: "180.00",
  total: "1180.00",
  message: "El envío a Playa cuesta 180.",
  items: [
    {
      storeProductId: "sp-1",
      name: "Café Cubita",
      unitPrice: "450.00",
      currencyCode: "CUP",
      quantity: "2",
      lineTotal: "1000.00",
    },
  ],
};

beforeEach(() => {
  queryRaw.mockReset();
  orderFindUnique.mockReset();
  getOrderByCode.mockReset();
});

describe("proposeOrderChange() — the happy path (E1)", () => {
  it("returns 'proposed' with the wa.me toward the CUSTOMER built from the persisted snapshot", async () => {
    queryRaw.mockResolvedValue([
      {
        code: "A7K3M9PQR2",
        storeId: "store-1",
        expiresAt: new Date("2026-08-31T14:19:43.000Z"),
        previousTotal: "880.00",
        proposedTotal: "1180.00",
        currencyCode: "CUP",
      },
    ]);
    getOrderByCode.mockResolvedValue({
      code: "A7K3M9PQR2",
      storeSlug: "tienda-demo",
      storeName: "La Rampa",
      contact: { name: "Ana Pérez", phone: "+5355555555", email: null },
    });

    const result = await proposeOrderChange(baseInput);

    expect(result.kind).toBe("proposed");
    if (result.kind !== "proposed") throw new Error("expected proposed");
    expect(result.previousTotal).toBe("880.00");
    expect(result.proposedTotal).toBe("1180.00");
    expect(result.orderUrl).toContain("/tienda-demo/pedido/A7K3M9PQR2");
    expect(result.customerWhatsappUrl).toMatch(/^https:\/\/wa\.me\/5355555555\?text=/);
    expect(result.customerWhatsappReason).toBeNull();
    expect(getOrderByCode).toHaveBeenCalledWith("store-1", "A7K3M9PQR2");
  });

  it("R13: no snapshot / no usable phone → customerWhatsappUrl null with a reason, still 'proposed'", async () => {
    queryRaw.mockResolvedValue([
      {
        code: "A7K3M9PQR2",
        storeId: "store-1",
        expiresAt: new Date("2026-08-31T14:19:43.000Z"),
        previousTotal: "880.00",
        proposedTotal: "1180.00",
        currencyCode: "CUP",
      },
    ]);
    getOrderByCode.mockResolvedValue(null);

    const result = await proposeOrderChange(baseInput);

    expect(result.kind).toBe("proposed");
    if (result.kind !== "proposed") throw new Error("expected proposed");
    expect(result.customerWhatsappUrl).toBeNull();
    expect(result.customerWhatsappReason).toBe("NO_PHONE_DIGITS");
  });
});

describe("proposeOrderChange() — 0 rows affected (E4)", () => {
  it("classifies 'unknown_order' when the order does not exist", async () => {
    queryRaw.mockResolvedValue([]);
    orderFindUnique.mockResolvedValue(null);

    const result = await proposeOrderChange(baseInput);
    expect(result).toEqual({ kind: "unknown_order" });
    expect(getOrderByCode).not.toHaveBeenCalled();
  });

  it("classifies 'unknown_order' when the order belongs to another business (R6-style, no leak)", async () => {
    queryRaw.mockResolvedValue([]);
    orderFindUnique.mockResolvedValue({
      businessId: "someone-else",
      currencyCode: "CUP",
      status: "PULLED",
    });

    const result = await proposeOrderChange(baseInput);
    expect(result).toEqual({ kind: "unknown_order" });
  });

  it("classifies 'currency_mismatch' when the order's currency differs", async () => {
    queryRaw.mockResolvedValue([]);
    orderFindUnique.mockResolvedValue({
      businessId: "biz-1",
      currencyCode: "USD",
      status: "PULLED",
    });

    const result = await proposeOrderChange(baseInput);
    expect(result).toEqual({ kind: "currency_mismatch" });
  });

  it("classifies 'not_proposable' with the current status (E4)", async () => {
    queryRaw.mockResolvedValue([]);
    orderFindUnique.mockResolvedValue({
      businessId: "biz-1",
      currencyCode: "CUP",
      status: "DELIVERED",
    });

    const result = await proposeOrderChange(baseInput);
    expect(result).toEqual({ kind: "not_proposable", status: "DELIVERED" });
  });

  it("falls back to 'failed' when the classifying read no longer explains the miss (lost a race)", async () => {
    queryRaw.mockResolvedValue([]);
    orderFindUnique.mockResolvedValue({
      businessId: "biz-1",
      currencyCode: "CUP",
      status: "PULLED",
    });

    const result = await proposeOrderChange(baseInput);
    expect(result).toEqual({ kind: "failed" });
  });
});
