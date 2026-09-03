import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-033 architecture.md DA1/DA5: `readOrdersByStatus`/`readOrdersByIds` con
 * `@/lib/prisma` mockeado, mismo patrón que `pull.test.ts`. Cubre el
 * `where`/`orderBy`/`take` exacto, el cálculo de `nextAfter` (R11) y — el
 * aserto que sostiene R7 — que este módulo nunca llama a `updateMany`.
 */

const orderFindMany = vi.fn();
const orderUpdateMany = vi.fn();
const executeRaw = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: {
      findMany: (...args: unknown[]) => orderFindMany(...args),
      updateMany: (...args: unknown[]) => orderUpdateMany(...args),
    },
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));

const { readOrdersByStatus, readOrdersByIds } = await import("./lateralRead");

function dbOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 1n,
    code: "A7K3M9PQR2",
    status: "PULLED",
    contactName: "Ana Pérez",
    contactPhone: "+5355555555",
    contactEmail: null,
    deliveryAddress: null,
    currencyCode: "CUP",
    subtotal: { toString: () => "900" },
    discountTotal: { toString: () => "0" },
    deliveryFee: { toString: () => "0" },
    total: { toString: () => "900" },
    notes: null,
    createdAt: new Date("2026-08-26T02:00:00.000Z"),
    rateSnapshot: { base: "CUP", capturedAt: "2026-08-26T02:00:00.000Z", rates: {} },
    cancelledBy: null,
    proposedAt: null,
    expiresAt: null,
    previousTotal: null,
    proposedSubtotal: null,
    proposedDiscountTotal: null,
    proposedDeliveryFee: null,
    proposedTotal: null,
    proposalMessage: null,
    store: {
      externalId: "seed-tienda-1",
      slug: null,
      name: "La Rampa",
      whatsapp: "+5350000001",
      phone: null,
      storefront: { slug: "la-rampa", stores: [{ id: "store-1" }] },
    },
    items: [],
    ...overrides,
  };
}

beforeEach(() => {
  orderFindMany.mockReset();
  orderUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  executeRaw.mockReset().mockResolvedValue(0);
});

describe("readOrdersByStatus() — el where/orderBy/take (DA5, criterio 11)", () => {
  it("filtra por businessId, status e id > after, ordenado por id ascendente", async () => {
    orderFindMany.mockResolvedValue([]);
    await readOrdersByStatus({
      businessId: "business-a",
      status: "AWAITING_CUSTOMER",
      after: 118n,
      limit: 1,
    });

    expect(orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: "business-a", status: "AWAITING_CUSTOMER", id: { gt: 118n } },
        orderBy: { id: "asc" },
        take: 1,
      }),
    );
  });

  it("nextAfter es el id del último cuando la página vino llena (R11)", async () => {
    orderFindMany.mockResolvedValue([dbOrder({ id: 7n }), dbOrder({ id: 9n })]);
    const { nextAfter } = await readOrdersByStatus({
      businessId: "business-a",
      status: "PULLED",
      after: 0n,
      limit: 2,
    });

    expect(nextAfter).toBe("9");
  });

  it("nextAfter es null cuando la página vino a medias", async () => {
    orderFindMany.mockResolvedValue([dbOrder({ id: 7n })]);
    const { nextAfter } = await readOrdersByStatus({
      businessId: "business-a",
      status: "PULLED",
      after: 0n,
      limit: 2,
    });

    expect(nextAfter).toBeNull();
  });

  it("nextAfter es null y orders vacío con la página vacía (E3)", async () => {
    orderFindMany.mockResolvedValue([]);
    const { orders, nextAfter } = await readOrdersByStatus({
      businessId: "business-a",
      status: "REJECTED_BY_STORE",
      after: 0n,
      limit: 100,
    });

    expect(orders).toEqual([]);
    expect(nextAfter).toBeNull();
  });

  it("corre los dos barridos de vencimiento antes de leer, en la misma transacción (R8)", async () => {
    orderFindMany.mockResolvedValue([]);
    await readOrdersByStatus({
      businessId: "business-a",
      status: "AWAITING_CUSTOMER",
      after: 0n,
      limit: 100,
    });

    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(orderFindMany).toHaveBeenCalledOnce();
  });
});

describe("readOrdersByIds() — el where y la deduplicación (E6-E9)", () => {
  it("filtra por businessId e id in [...], ordenado por id ascendente, sin take", async () => {
    orderFindMany.mockResolvedValue([]);
    await readOrdersByIds({ businessId: "business-a", ids: [5n, 3n] });

    expect(orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: "business-a", id: { in: [5n, 3n] } },
        orderBy: { id: "asc" },
      }),
    );
    const call = orderFindMany.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("take");
  });

  it("un id repetido en la entrada se deduplica antes de consultar (E9)", async () => {
    orderFindMany.mockResolvedValue([]);
    await readOrdersByIds({ businessId: "business-a", ids: [5n, 5n, 3n] });

    expect(orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: "business-a", id: { in: [5n, 3n] } } }),
    );
  });

  it("nextAfter siempre null: esta lectura no pagina (SP7)", async () => {
    orderFindMany.mockResolvedValue([dbOrder({ id: 1n }), dbOrder({ id: 2n })]);
    const { nextAfter } = await readOrdersByIds({ businessId: "business-a", ids: [1n, 2n] });

    expect(nextAfter).toBeNull();
  });

  it("corre los dos barridos de vencimiento antes de leer, en la misma transacción (R8)", async () => {
    orderFindMany.mockResolvedValue([]);
    await readOrdersByIds({ businessId: "business-a", ids: [1n] });

    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(orderFindMany).toHaveBeenCalledOnce();
  });
});

describe("readOrdersByStatus/readOrdersByIds — R7: nunca marcan PULLED", () => {
  it("un PENDING leído lateralmente no dispara ningún updateMany", async () => {
    orderFindMany.mockResolvedValue([dbOrder({ id: 1n, status: "PENDING" })]);

    await readOrdersByStatus({
      businessId: "business-a",
      status: "PENDING",
      after: 0n,
      limit: 100,
    });
    await readOrdersByIds({ businessId: "business-a", ids: [1n] });

    expect(orderUpdateMany).not.toHaveBeenCalled();
  });

  it("el módulo no importa la palabra que nombra esa llamada de Prisma (verificación estática, paso 5)", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(new URL("./lateralRead.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/updateMany/);
  });
});

describe("readOrdersByStatus/readOrdersByIds — el mismo mapeo del pull (R2)", () => {
  it("un pedido servido lateralmente trae los mismos campos que produce toPulledOrder", async () => {
    orderFindMany.mockResolvedValue([dbOrder({ id: 1n, status: "PULLED" })]);
    const { orders } = await readOrdersByStatus({
      businessId: "business-a",
      status: "PULLED",
      after: 0n,
      limit: 10,
    });

    expect(orders[0]).toMatchObject({
      id: "1",
      code: "A7K3M9PQR2",
      status: "PULLED",
      subtotal: "900.00",
      total: "900.00",
    });
  });
});
