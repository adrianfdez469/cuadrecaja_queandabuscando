import { beforeEach, describe, expect, it, vi } from "vitest";
import { money } from "@/lib/money";

const orderFindMany = vi.fn();
const orderFindFirst = vi.fn();
const orderCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: {
      findMany: (...args: unknown[]) => orderFindMany(...args),
      findFirst: (...args: unknown[]) => orderFindFirst(...args),
      create: (...args: unknown[]) => orderCreate(...args),
    },
  },
}));

const loadStoreForOrder = vi.fn();
const quoteCart = vi.fn();

vi.mock("./quote", () => ({
  loadStoreForOrder: (...args: unknown[]) => loadStoreForOrder(...args),
  quoteCart: (...args: unknown[]) => quoteCart(...args),
}));

const getOrderByCode = vi.fn();

vi.mock("./read", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./read")>();
  return {
    ...actual,
    getOrderByCode: (...args: unknown[]) => getOrderByCode(...args),
  };
});

const { createOrder } = await import("./createOrder");

const store = {
  id: "store-1",
  businessId: "biz-1",
  slug: "tienda-demo",
  name: "La Rampa",
  currencyCode: "CUP",
  checkoutMode: "WHATSAPP" as const,
  deliveryEnabled: false,
  deliveryFee: null as string | null,
  whatsappNumber: "+5350000001",
  status: "PUBLISHED" as const,
  disabledReasonCode: null,
  disabledMessage: null,
  disabledAt: null,
};

function orderableLine(overrides: Record<string, unknown> = {}) {
  return {
    storeProductId: "sp-1",
    slug: "cafe-cubita",
    name: "Café Cubita",
    qty: 2,
    orderable: true as const,
    unitPrice: money("450.00", "CUP"),
    originalUnitPrice: money("450.00", "CUP"),
    lineTotal: money("900.00", "CUP"),
    ...overrides,
  };
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    storeSlug: "tienda-demo",
    items: [{ storeProductId: "sp-1", qty: 2 }],
    contact: { name: "Ana Pérez", phone: "+5355555555" },
    fulfillment: "PICKUP" as const,
    expectedTotal: "900.00",
    ...overrides,
  };
}

beforeEach(() => {
  orderFindMany.mockReset().mockResolvedValue([]);
  orderFindFirst.mockReset();
  orderCreate.mockReset();
  loadStoreForOrder.mockReset().mockResolvedValue(store);
  quoteCart.mockReset().mockResolvedValue({
    store,
    lines: [orderableLine()],
    subtotal: money("900.00", "CUP"),
    discountTotal: money("0", "CUP"),
    rates: {},
    capturedAt: "2026-08-26T02:00:00.000Z",
  });
  getOrderByCode.mockReset().mockResolvedValue(null);
});

describe("createOrder() — routing", () => {
  it("returns store_not_found without calling quoteCart", async () => {
    loadStoreForOrder.mockResolvedValue(null);
    const result = await createOrder(baseBody());
    expect(result).toEqual({ kind: "store_not_found" });
    expect(quoteCart).not.toHaveBeenCalled();
  });

  it("returns empty_cart for an empty items array", async () => {
    const result = await createOrder(baseBody({ items: [] }));
    expect(result).toEqual({ kind: "empty_cart" });
    expect(quoteCart).not.toHaveBeenCalled();
  });

  it("returns store_closed BEFORE quoting or the abuse guard (HD10-HD15)", async () => {
    loadStoreForOrder.mockResolvedValue({
      ...store,
      status: "SUSPENDED",
      disabledReasonCode: "VACACIONES",
      disabledMessage: null,
      disabledAt: new Date("2026-08-01T00:00:00Z"),
    });
    const result = await createOrder(baseBody());
    expect(result).toEqual({
      kind: "store_closed",
      reasonCode: "VACACIONES",
      message: null,
      disabledAt: new Date("2026-08-01T00:00:00Z"),
    });
    expect(quoteCart).not.toHaveBeenCalled();
    expect(orderFindMany).not.toHaveBeenCalled();
  });

  it("returns items_unavailable with every unorderable line's reason", async () => {
    quoteCart.mockResolvedValue({
      store,
      lines: [
        orderableLine(),
        {
          storeProductId: "sp-2",
          slug: "x",
          name: "x",
          qty: 1,
          orderable: false,
          reason: "OUT_OF_STOCK",
        },
      ],
      subtotal: money("900.00", "CUP"),
      rates: {},
      capturedAt: "now",
    });
    const result = await createOrder(baseBody());
    expect(result).toEqual({
      kind: "items_unavailable",
      lines: [{ storeProductId: "sp-2", reason: "OUT_OF_STOCK" }],
    });
    expect(orderCreate).not.toHaveBeenCalled();
  });
});

describe("createOrder() — price check (R7)", () => {
  it("returns price_changed with was:null for ALL lines when no expectedUnitPrice was sent", async () => {
    const result = await createOrder(baseBody({ expectedTotal: "999.00" }));
    expect(result).toEqual({
      kind: "price_changed",
      lines: [{ storeProductId: "sp-1", was: null, now: "450.00" }],
      total: "900.00",
    });
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it("returns price_changed with only the changed line when expectedUnitPrice was sent (AP1)", async () => {
    const result = await createOrder(
      baseBody({
        items: [{ storeProductId: "sp-1", qty: 2, expectedUnitPrice: "400.00" }],
        expectedTotal: "999.00",
      }),
    );
    expect(result).toEqual({
      kind: "price_changed",
      lines: [{ storeProductId: "sp-1", was: "400.00", now: "450.00" }],
      total: "900.00",
    });
  });

  it("does not spend a rate-limit slot on a stale total (checked before the guard query)", async () => {
    await createOrder(baseBody({ expectedTotal: "999.00" }));
    expect(orderFindMany).not.toHaveBeenCalled();
  });
});

describe("createOrder() — idempotency and rate limit (R26-R31)", () => {
  it("returns idempotent with the existing order when the key already has a row", async () => {
    orderFindMany.mockResolvedValue([
      {
        id: 1n,
        code: "A7K3M9PQR2",
        idempotencyKey: "key-1",
        status: "PENDING",
        createdAt: new Date(),
      },
    ]);
    getOrderByCode.mockResolvedValue(null); // ONSITE-equivalent: no whatsapp built
    const result = await createOrder(baseBody({ idempotencyKey: "key-1" }));
    expect(result).toMatchObject({ kind: "idempotent", code: "A7K3M9PQR2" });
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it("idempotency wins over an exhausted rate limit (R31)", async () => {
    const now = new Date();
    orderFindMany.mockResolvedValue([
      { id: 1n, code: "A7K3M9PQR2", idempotencyKey: "key-1", status: "PENDING", createdAt: now },
      { id: 2n, code: "B", idempotencyKey: null, status: "PENDING", createdAt: now },
      { id: 3n, code: "C", idempotencyKey: null, status: "PENDING", createdAt: now },
      { id: 4n, code: "D", idempotencyKey: null, status: "PENDING", createdAt: now },
      { id: 5n, code: "E", idempotencyKey: null, status: "PENDING", createdAt: now },
    ]);
    const result = await createOrder(baseBody({ idempotencyKey: "key-1" }));
    expect(result).toMatchObject({ kind: "idempotent", code: "A7K3M9PQR2" });
  });

  it("returns too_many_orders at the 5th PENDING order in the window, with no key", async () => {
    const now = new Date();
    orderFindMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: BigInt(i),
        code: `CODE${i}`,
        idempotencyKey: null,
        status: "PENDING",
        createdAt: now,
      })),
    );
    const result = await createOrder(baseBody());
    expect(result.kind).toBe("too_many_orders");
    if (result.kind === "too_many_orders") {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    }
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it("does not count a PULLED order towards the rate limit", async () => {
    const now = new Date();
    orderFindMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: BigInt(i),
        code: `CODE${i}`,
        idempotencyKey: null,
        status: i === 0 ? "PULLED" : "PENDING",
        createdAt: now,
      })),
    );
    orderCreate.mockResolvedValue({ code: "NEWCODE0001" });
    const result = await createOrder(baseBody());
    expect(result.kind).not.toBe("too_many_orders");
  });
});

describe("createOrder() — writing the order", () => {
  it("creates the order with subtotal/deliveryFee/total and a rateSnapshot", async () => {
    orderCreate.mockImplementation(async ({ data }: { data: { code: string } }) => ({
      code: data.code,
    }));
    const result = await createOrder(baseBody());

    expect(result.kind).toBe("created");
    if (result.kind === "created") expect(result.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(orderCreate).toHaveBeenCalledOnce();
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.subtotal).toBe("900.00");
    expect(data.deliveryFee).toBe("0.00");
    expect(data.total).toBe("900.00");
    expect(data.discountTotal).toBe("0.00");
    expect(data.rateSnapshot).toEqual({
      base: "CUP",
      capturedAt: "2026-08-26T02:00:00.000Z",
      rates: {},
    });
    expect(data.items.create).toEqual([
      {
        storeProductId: "sp-1",
        name: "Café Cubita",
        unitPrice: "450.00",
        currencyCode: "CUP",
        quantity: 2,
        lineTotal: "900.00",
        originalUnitPrice: "450.00",
        originalCurrencyCode: "CUP",
      },
    ]);
  });

  it("adds delivery fee to the total when DELIVERY is offered and chosen", async () => {
    const deliveryStore = { ...store, deliveryEnabled: true, deliveryFee: "500.00" };
    loadStoreForOrder.mockResolvedValue(deliveryStore);
    quoteCart.mockResolvedValue({
      store: deliveryStore,
      lines: [orderableLine()],
      subtotal: money("900.00", "CUP"),
      discountTotal: money("0", "CUP"),
      rates: {},
      capturedAt: "now",
    });
    orderCreate.mockResolvedValue({ code: "A7K3M9PQR2" });

    const result = await createOrder(
      baseBody({
        fulfillment: "DELIVERY",
        deliveryAddress: "Calle 23, Vedado",
        expectedTotal: "1400.00",
      }),
    );

    expect(result).toMatchObject({ kind: "created" });
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.deliveryFee).toBe("500.00");
    expect(data.total).toBe("1400.00");
    expect(data.deliveryAddress).toBe("Calle 23, Vedado");
  });

  it("treats DELIVERY as PICKUP when the store does not offer it", async () => {
    orderCreate.mockResolvedValue({ code: "A7K3M9PQR2" });
    const result = await createOrder(
      baseBody({ fulfillment: "DELIVERY", deliveryAddress: "x", expectedTotal: "900.00" }),
    );
    expect(result).toMatchObject({ kind: "created" });
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.deliveryFee).toBe("0.00");
    expect(data.deliveryAddress).toBeNull();
  });

  describe("F-031 — QUOTED_PER_ORDER (E2, R3, R9, DA6)", () => {
    it("writes deliveryFee: null and a PARTIAL total for a DELIVERY order (criterio 2)", async () => {
      const quotedStore = {
        ...store,
        deliveryEnabled: true,
        deliveryFeeMode: "QUOTED_PER_ORDER" as const,
        deliveryFee: null as string | null,
      };
      loadStoreForOrder.mockResolvedValue(quotedStore);
      quoteCart.mockResolvedValue({
        store: quotedStore,
        lines: [orderableLine()],
        subtotal: money("900.00", "CUP"),
        discountTotal: money("0", "CUP"),
        rates: {},
        capturedAt: "now",
      });
      orderCreate.mockResolvedValue({ code: "A7K3M9PQR2" });

      const result = await createOrder(
        baseBody({
          fulfillment: "DELIVERY",
          deliveryAddress: "Calle 23, Vedado",
          // R9: while unquoted, the comparable total is subtotal - discountTotal only.
          expectedTotal: "900.00",
        }),
      );

      expect(result).toMatchObject({ kind: "created" });
      const data = orderCreate.mock.calls[0][0].data;
      expect(data.deliveryFee).toBeNull();
      expect(data.total).toBe("900.00");
      expect(data.deliveryAddress).toBe("Calle 23, Vedado");
    });

    it("ignores a residual Store.deliveryFee — the mode decides, not a stale fee (§ Casos límite)", async () => {
      const quotedStore = {
        ...store,
        deliveryEnabled: true,
        deliveryFeeMode: "QUOTED_PER_ORDER" as const,
        deliveryFee: "999.00" as string | null,
      };
      loadStoreForOrder.mockResolvedValue(quotedStore);
      quoteCart.mockResolvedValue({
        store: quotedStore,
        lines: [orderableLine()],
        subtotal: money("900.00", "CUP"),
        discountTotal: money("0", "CUP"),
        rates: {},
        capturedAt: "now",
      });
      orderCreate.mockResolvedValue({ code: "A7K3M9PQR2" });

      await createOrder(
        baseBody({ fulfillment: "DELIVERY", deliveryAddress: "x", expectedTotal: "900.00" }),
      );

      expect(orderCreate.mock.calls[0][0].data.deliveryFee).toBeNull();
    });

    it("PICKUP at a QUOTED_PER_ORDER store still quotes 0.00 — the order is not uncertain (E8)", async () => {
      const quotedStore = {
        ...store,
        deliveryEnabled: true,
        deliveryFeeMode: "QUOTED_PER_ORDER" as const,
        deliveryFee: null as string | null,
      };
      loadStoreForOrder.mockResolvedValue(quotedStore);
      orderCreate.mockResolvedValue({ code: "A7K3M9PQR2" });

      const result = await createOrder(baseBody({ fulfillment: "PICKUP" }));

      expect(result).toMatchObject({ kind: "created" });
      const data = orderCreate.mock.calls[0][0].data;
      expect(data.deliveryFee).toBe("0.00");
    });
  });

  it("merges duplicate storeProductId lines, summing quantities, before quoting", async () => {
    orderCreate.mockResolvedValue({ code: "A7K3M9PQR2" });
    await createOrder(
      baseBody({
        items: [
          { storeProductId: "sp-1", qty: 60 },
          { storeProductId: "sp-1", qty: 60 },
        ],
      }),
    );
    expect(quoteCart).toHaveBeenCalledWith(store, [{ storeProductId: "sp-1", qty: 99 }]);
  });

  it("retries with a new code on a P2002 collision on code, up to the limit", async () => {
    orderCreate
      .mockRejectedValueOnce({ code: "P2002", meta: { target: ["code"] } })
      .mockImplementationOnce(async ({ data }: { data: { code: string } }) => ({
        code: data.code,
      }));
    const result = await createOrder(baseBody());
    expect(result.kind).toBe("created");
    expect(orderCreate).toHaveBeenCalledTimes(2);
    if (result.kind === "created") {
      expect(result.code).toBe(orderCreate.mock.calls[1][0].data.code);
    }
  });

  it("returns failed after exhausting all code retries", async () => {
    orderCreate.mockRejectedValue({ code: "P2002", meta: { target: ["code"] } });
    const result = await createOrder(baseBody());
    expect(result).toEqual({ kind: "failed" });
  });

  it("resolves a P2002 on idempotencyKey by rereading the row that won the race", async () => {
    orderCreate.mockRejectedValue({ code: "P2002", meta: { target: ["idempotencyKey"] } });
    orderFindFirst.mockResolvedValue({ code: "WINNERCODE" });
    const result = await createOrder(baseBody({ idempotencyKey: "key-1" }));
    expect(result).toMatchObject({ kind: "idempotent", code: "WINNERCODE" });
  });

  it("fails closed if the colliding idempotencyKey belongs to another store", async () => {
    orderCreate.mockRejectedValue({ code: "P2002", meta: { target: ["idempotencyKey"] } });
    orderFindFirst.mockResolvedValue(null);
    const result = await createOrder(baseBody({ idempotencyKey: "key-1" }));
    expect(result).toEqual({ kind: "failed" });
  });

  it("re-throws an unexpected database error instead of swallowing it", async () => {
    orderCreate.mockRejectedValue(new Error("connection reset"));
    await expect(createOrder(baseBody())).rejects.toThrow("connection reset");
  });
});

describe("createOrder() — customerLink (D6, R14, architecture.md § DA2)", () => {
  it("defaults customerId to null when no second argument is given (every F-010 call site is unaffected)", async () => {
    orderCreate.mockImplementation(async ({ data }: { data: { code: string } }) => ({
      code: data.code,
    }));
    await createOrder(baseBody());

    const data = orderCreate.mock.calls[0][0].data;
    expect(data.customerId).toBeNull();
  });

  it("writes the id the customerLink promise resolves to (E28)", async () => {
    orderCreate.mockImplementation(async ({ data }: { data: { code: string } }) => ({
      code: data.code,
    }));
    await createOrder(baseBody(), Promise.resolve("customer-1"));

    const data = orderCreate.mock.calls[0][0].data;
    expect(data.customerId).toBe("customer-1");
  });

  it("a customerLink resolving to null (guest, or an unresolved identity, E16/E17) writes null", async () => {
    orderCreate.mockImplementation(async ({ data }: { data: { code: string } }) => ({
      code: data.code,
    }));
    await createOrder(baseBody(), Promise.resolve(null));

    const data = orderCreate.mock.calls[0][0].data;
    expect(data.customerId).toBeNull();
  });

  it("awaits customerLink only ONCE, after the store/quote/guard work is already done", async () => {
    orderCreate.mockImplementation(async ({ data }: { data: { code: string } }) => ({
      code: data.code,
    }));
    let resolveCount = 0;
    const customerLink = Promise.resolve("customer-1").then((id) => {
      resolveCount += 1;
      return id;
    });

    await createOrder(baseBody(), customerLink);
    // await it again in this test: still only resolved once by the promise chain.
    await customerLink;

    expect(resolveCount).toBe(1);
    expect(orderCreate.mock.calls[0][0].data.customerId).toBe("customer-1");
  });
});

describe("createOrder() — whatsappUrl", () => {
  it("is null for ONSITE regardless of the store's number", async () => {
    const onsiteStore = { ...store, checkoutMode: "ONSITE" as const };
    loadStoreForOrder.mockResolvedValue(onsiteStore);
    quoteCart.mockResolvedValue({
      store: onsiteStore,
      lines: [orderableLine()],
      subtotal: money("900.00", "CUP"),
      discountTotal: money("0", "CUP"),
      rates: {},
      capturedAt: "now",
    });
    orderCreate.mockResolvedValue({ code: "A7K3M9PQR2" });
    const result = await createOrder(baseBody());
    expect(result).toMatchObject({ whatsappUrl: null });
    expect(getOrderByCode).not.toHaveBeenCalled();
  });

  it("is built from the persisted snapshot for WHATSAPP", async () => {
    orderCreate.mockImplementation(async ({ data }: { data: { code: string } }) => ({
      code: data.code,
    }));
    getOrderByCode.mockResolvedValue({
      code: "A7K3M9PQR2",
      status: "PENDING",
      storeSlug: "tienda-demo",
      storeName: "La Rampa",
      checkoutMode: "WHATSAPP",
      whatsappNumber: "+5350000001",
      contact: { name: "Ana Pérez", phone: "+5355555555", email: null },
      fulfillment: "PICKUP",
      deliveryAddress: null,
      currencyCode: "CUP",
      subtotal: "900.00",
      deliveryFee: "0.00",
      total: "900.00",
      notes: null,
      createdAt: "2026-08-26T02:00:00.000Z",
      items: [
        {
          name: "Café Cubita",
          unitPrice: "450.00",
          currencyCode: "CUP",
          quantity: "2",
          lineTotal: "900.00",
        },
      ],
    });
    const result = await createOrder(baseBody());
    expect(result).toMatchObject({ kind: "created" });
    if (result.kind === "created") {
      expect(result.whatsappUrl).toMatch(/^https:\/\/wa\.me\/5350000001\?text=/);
    }
    const usedCode = orderCreate.mock.calls[0][0].data.code;
    // F-019 SP6: getOrderByCode(storeId, rawCode) is the signature (read.ts),
    // and the query filters by `{ code, storeId }`. Passing store.slug here
    // was I2 — createOrder.ts:87 called getOrderByCode(store.slug, code), a
    // slug where an id was expected, so the WHERE never matched and
    // whatsappUrl came back null always. The OLD version of this assertion
    // only checked getOrderByCode was called with SOME arguments (or matched
    // store.slug, which happens to equal "tienda-demo" too), so it never
    // caught the bug. Asserting the actual argument is the fix.
    expect(getOrderByCode).toHaveBeenCalledWith(store.id, usedCode);
  });
});
