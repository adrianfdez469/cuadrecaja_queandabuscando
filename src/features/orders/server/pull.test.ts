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
    const { orders } = await pullOrders("business-a", 0n, 10);
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
    const { orders } = await pullOrders("business-a", 0n, 10);
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
    const { orders } = await pullOrders("business-a", 0n, 10);
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
    await pullOrders("business-a", 0n, 10);
    expect(orderUpdateMany).toHaveBeenCalledOnce();
    expect(orderUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: "business-a", id: { in: [1n] } } }),
    );
  });
});

// El cursor es el corazón del criterio 1 de F-007 y hasta aquí no tenía
// NINGUNA prueba: las cuatro de arriba se escribieron durante F-010 y solo
// miran la forma de los campos v2. Lo que sigue cubre `R1` y `R2` de
// spec.md — que el cursor sea el `id` y no una fecha, y cuándo vale `null`.
describe("pullOrders() — el cursor (criterio 1)", () => {
  it("traslada `since` al where y `limit` al take, ordenando por id ascendente", async () => {
    orderFindMany.mockResolvedValue([]);
    await pullOrders("business-a", 42n, 7);

    expect(orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: "business-a", id: { gt: 42n } },
        orderBy: { id: "asc" },
        take: 7,
      }),
    );
  });

  it("devuelve el id del último pedido como nextCursor cuando la página vino llena", async () => {
    orderFindMany.mockResolvedValue([dbOrder({ id: 7n }), dbOrder({ id: 9n })]);
    const { nextCursor } = await pullOrders("business-a", 0n, 2);

    // Llena significa "puede que haya más detrás": el POS tiene que volver.
    expect(nextCursor).toBe("9");
  });

  it("devuelve null cuando la página vino a medias, porque ya prueba que no queda nada (R2)", async () => {
    orderFindMany.mockResolvedValue([dbOrder({ id: 7n })]);
    const { nextCursor } = await pullOrders("business-a", 0n, 2);

    // Este es el aserto que se rompe si alguien "arregla" nextCursor para que
    // devuelva siempre el último id: el POS entraría en un pull infinito.
    expect(nextCursor).toBeNull();
  });

  it("con la página vacía devuelve nextCursor null y no escribe nada", async () => {
    orderFindMany.mockResolvedValue([]);
    const { orders, nextCursor } = await pullOrders("business-a", 0n, 100);

    expect(orders).toEqual([]);
    expect(nextCursor).toBeNull();
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });

  it("recorre cada pedido exactamente una vez paginando de uno en uno (E2)", async () => {
    // Ids no consecutivos a propósito: lo que garantiza no saltarse nada es que
    // el cursor sea el id del último visto, no `since + limit`.
    type FindManyArgs = { where: { id: { gt: bigint } }; take: number };
    const all = [dbOrder({ id: 1n }), dbOrder({ id: 5n }), dbOrder({ id: 9n })];
    orderFindMany.mockImplementation((args: unknown) => {
      const { where, take } = args as FindManyArgs;
      return Promise.resolve(all.filter((row) => row.id > where.id.gt).slice(0, take));
    });

    const seen: string[] = [];
    let cursor = 0n;
    // El tope corta un pull infinito en vez de colgar la suite: si el cursor
    // dejara de avanzar, el fallo es "esperaba 3, obtuve 10", no un timeout.
    for (let guard = 0; guard < 10; guard += 1) {
      const { orders, nextCursor } = await pullOrders("business-a", cursor, 1);
      seen.push(...orders.map((order) => order.id));
      if (nextCursor === null) break;
      cursor = BigInt(nextCursor);
    }

    expect(seen).toEqual(["1", "5", "9"]);
  });
});
