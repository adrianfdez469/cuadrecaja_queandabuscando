import { beforeEach, describe, expect, it, vi } from "vitest";

const orderFindMany = vi.fn();
const orderUpdateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: {
      findMany: (...args: unknown[]) => orderFindMany(...args),
      updateMany: (...args: unknown[]) => orderUpdateMany(...args),
    },
  },
}));

const { pullOrders } = await import("./pull");

function dbOrder(
  orderOverrides: Record<string, unknown> = {},
  itemOverrides: Record<string, unknown> = {},
) {
  return {
    id: 1n,
    code: "A7K3M9PQR2",
    status: "PENDING",
    contactName: "Ana Pérez",
    contactPhone: "+5355555555",
    contactEmail: null,
    deliveryAddress: null,
    currencyCode: "CUP",
    subtotal: { toString: () => "900.00" },
    discountTotal: { toString: () => "0" },
    deliveryFee: { toString: () => "0.00" },
    total: { toString: () => "900.00" },
    notes: null,
    createdAt: new Date("2026-08-26T02:00:00.000Z"),
    rateSnapshot: {
      base: "CUP",
      capturedAt: "2026-08-26T02:00:00.000Z",
      rates: { USD: "440.000000" },
    },
    store: { externalId: "seed-tienda-1" },
    items: [
      {
        storeProduct: { externalId: "seed-tienda-1-p6" },
        name: "Café Cubita",
        unitPrice: { toString: () => "450.00" },
        currencyCode: "CUP",
        quantity: { toString: () => "2.000" },
        lineTotal: { toString: () => "900.00" },
        originalUnitPrice: { toString: () => "1.02" },
        originalCurrencyCode: "USD",
        ...itemOverrides,
      },
    ],
    ...orderOverrides,
  };
}

beforeEach(() => {
  orderFindMany.mockReset();
  orderUpdateMany.mockReset().mockResolvedValue({ count: 0 });
});

describe("pullOrders() — v2 compatibility (criterio 19)", () => {
  it("keeps every field the current pull already emits, unchanged", async () => {
    orderFindMany.mockResolvedValue([dbOrder()]);
    const { orders } = await pullOrders(0n, 10);
    const order = orders[0];

    expect(order).toMatchObject({
      id: "1",
      code: "A7K3M9PQR2",
      storeExternalId: "seed-tienda-1",
      status: "PENDING",
      contact: { name: "Ana Pérez", phone: "+5355555555", email: null, address: null },
      currencyCode: "CUP",
      subtotal: "900.00",
      discountTotal: "0",
      deliveryFee: "0.00",
      total: "900.00",
      notes: null,
    });
    expect(order.items[0]).toMatchObject({
      storeProductExternalId: "seed-tienda-1-p6",
      name: "Café Cubita",
      unitPrice: "450.00",
      currencyCode: "CUP",
      quantity: "2.000",
      lineTotal: "900.00",
    });
  });

  it("adds rateSnapshot and the three original-price fields per line", async () => {
    orderFindMany.mockResolvedValue([dbOrder()]);
    const { orders } = await pullOrders(0n, 10);
    const order = orders[0];

    expect(order.rateSnapshot).toEqual({
      base: "CUP",
      capturedAt: "2026-08-26T02:00:00.000Z",
      rates: { USD: "440.000000" },
    });
    expect(order.items[0].originalUnitPrice).toBe("1.02");
    expect(order.items[0].originalCurrencyCode).toBe("USD");
    // 1.02 * 2 = 2.04, computed the same way lineTotal itself is (lib/money).
    expect(order.items[0].originalLineTotal).toBe("2.04");
  });

  it("never emits null for a legacy order with no stored original (falls back to the converted value)", async () => {
    orderFindMany.mockResolvedValue([
      dbOrder({}, { originalUnitPrice: null, originalCurrencyCode: null }),
    ]);
    const { orders } = await pullOrders(0n, 10);
    const item = orders[0].items[0];

    expect(item.originalUnitPrice).toBe(item.unitPrice);
    expect(item.originalCurrencyCode).toBe(item.currencyCode);
    expect(item.originalLineTotal).toBe(item.lineTotal);
  });

  it("marks PENDING rows as PULLED and leaves other statuses alone", async () => {
    orderFindMany.mockResolvedValue([
      dbOrder({ id: 1n, status: "PENDING" }),
      dbOrder({ id: 2n, status: "CONFIRMED" }),
    ]);
    await pullOrders(0n, 10);
    expect(orderUpdateMany).toHaveBeenCalledOnce();
    expect(orderUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [1n] } } }),
    );
  });
});
