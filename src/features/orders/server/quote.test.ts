import { beforeEach, describe, expect, it, vi } from "vitest";

const storeFindFirst = vi.fn();
const storeProductFindMany = vi.fn();
const exchangeRateFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findFirst: (...args: unknown[]) => storeFindFirst(...args) },
    storeProduct: { findMany: (...args: unknown[]) => storeProductFindMany(...args) },
    exchangeRate: { findMany: (...args: unknown[]) => exchangeRateFindMany(...args) },
  },
}));

const { loadStoreForOrder, quoteCart, quoteBySlug, toQuoteResponse } = await import("./quote");

beforeEach(() => {
  storeFindFirst.mockReset();
  storeProductFindMany.mockReset();
  exchangeRateFindMany.mockReset().mockResolvedValue([]);
});

const store = {
  id: "store-1",
  businessId: "biz-1",
  slug: "tienda-demo",
  name: "La Rampa",
  currencyCode: "CUP",
  checkoutMode: "WHATSAPP" as const,
  deliveryEnabled: false,
  deliveryFee: null,
  whatsappNumber: "+5350000001",
};

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: "sp-1",
    slug: "cafe-cubita",
    localName: "Café Cubita",
    availability: "AVAILABLE",
    visible: true,
    deletedAt: null,
    syncedPrice: "450.00",
    syncedPriceCurrency: "CUP",
    priceOverride: null,
    priceOverrideCurrency: null,
    ...overrides,
  };
}

describe("loadStoreForOrder()", () => {
  it("returns null when the store does not exist", async () => {
    storeFindFirst.mockResolvedValue(null);
    expect(await loadStoreForOrder("no-existe")).toBeNull();
  });

  it("maps whatsapp ?? phone into whatsappNumber", async () => {
    storeFindFirst.mockResolvedValue({
      id: "store-1",
      slug: "tienda-demo",
      name: "La Rampa",
      checkoutMode: "ONSITE",
      deliveryEnabled: true,
      deliveryFee: { toString: () => "500.00" },
      whatsapp: null,
      phone: "+5350000009",
      business: { id: "biz-1", baseCurrencyCode: "CUP" },
    });
    const result = await loadStoreForOrder("tienda-demo");
    expect(result?.whatsappNumber).toBe("+5350000009");
    expect(result?.deliveryFee).toBe("500.00");
  });
});

describe("quoteCart()", () => {
  it("prices a line with the effective price, override winning (R4)", async () => {
    storeProductFindMany.mockResolvedValue([
      product({ priceOverride: "1150.00", priceOverrideCurrency: "CUP", syncedPrice: "1250.00" }),
    ]);
    const quote = await quoteCart(store, [{ storeProductId: "sp-1", qty: 2 }]);
    const line = quote.lines[0];
    expect(line.orderable).toBe(true);
    if (line.orderable) {
      expect(line.unitPrice.amount).toBe("1150.00");
      expect(line.lineTotal.amount).toBe("2300.00");
    }
    expect(quote.subtotal.amount).toBe("2300.00");
  });

  it("converts a product priced in a foreign currency (R5, R15)", async () => {
    storeProductFindMany.mockResolvedValue([
      product({ syncedPrice: "2", syncedPriceCurrency: "USD" }),
    ]);
    exchangeRateFindMany.mockResolvedValue([
      { currencyCode: "USD", rate: { toString: () => "440.000000" } },
    ]);
    const quote = await quoteCart(store, [{ storeProductId: "sp-1", qty: 1 }]);
    const line = quote.lines[0];
    expect(line.orderable).toBe(true);
    if (line.orderable) {
      expect(line.originalUnitPrice).toEqual({ amount: "2.00", currency: "USD" });
      expect(line.unitPrice.amount).toBe("880.00");
    }
  });

  it("marks an OUT_OF_STOCK product as unorderable", async () => {
    storeProductFindMany.mockResolvedValue([product({ availability: "OUT_OF_STOCK" })]);
    const quote = await quoteCart(store, [{ storeProductId: "sp-1", qty: 1 }]);
    expect(quote.lines[0]).toMatchObject({ orderable: false, reason: "OUT_OF_STOCK" });
  });

  it("marks a hidden or deleted product as REMOVED", async () => {
    storeProductFindMany.mockResolvedValue([product({ visible: false })]);
    const quote = await quoteCart(store, [{ storeProductId: "sp-1", qty: 1 }]);
    expect(quote.lines[0]).toMatchObject({ orderable: false, reason: "REMOVED" });
  });

  it("marks a storeProductId that does not resolve (another store, or gone) as REMOVED", async () => {
    storeProductFindMany.mockResolvedValue([]);
    const quote = await quoteCart(store, [{ storeProductId: "not-here", qty: 1 }]);
    expect(quote.lines[0]).toMatchObject({ orderable: false, reason: "REMOVED" });
  });

  it("marks a line with no exchange rate as NO_PRICE, never throwing", async () => {
    storeProductFindMany.mockResolvedValue([
      product({ syncedPrice: "2", syncedPriceCurrency: "EUR" }),
    ]);
    const quote = await quoteCart(store, [{ storeProductId: "sp-1", qty: 1 }]);
    expect(quote.lines[0]).toMatchObject({ orderable: false, reason: "NO_PRICE" });
  });

  it("subtotal only sums orderable lines (E7)", async () => {
    storeProductFindMany.mockResolvedValue([
      product({ id: "sp-1", syncedPrice: "100.00" }),
      product({ id: "sp-2", availability: "OUT_OF_STOCK" }),
    ]);
    const quote = await quoteCart(store, [
      { storeProductId: "sp-1", qty: 1 },
      { storeProductId: "sp-2", qty: 1 },
    ]);
    expect(quote.subtotal.amount).toBe("100.00");
  });

  it("does not query storeProduct at all for an empty cart", async () => {
    const quote = await quoteCart(store, []);
    expect(quote.lines).toEqual([]);
    expect(quote.subtotal.amount).toBe("0.00");
    expect(storeProductFindMany).not.toHaveBeenCalled();
  });
});

describe("quoteBySlug()", () => {
  it("returns null when the store is not found", async () => {
    storeFindFirst.mockResolvedValue(null);
    expect(await quoteBySlug("no-existe", [])).toBeNull();
  });
});

describe("toQuoteResponse()", () => {
  it("shapes an orderable line with strings, never Decimal-like objects", async () => {
    storeProductFindMany.mockResolvedValue([product()]);
    const quote = await quoteCart(store, [{ storeProductId: "sp-1", qty: 1 }]);
    const response = toQuoteResponse(quote);
    expect(response.lines[0]).toMatchObject({
      storeProductId: "sp-1",
      unitPrice: "450.00",
      currencyCode: "CUP",
      orderable: true,
    });
    expect(response.store).toMatchObject({ slug: "tienda-demo", currencyCode: "CUP" });
  });

  it("shapes an unorderable line with null amounts and a reason", async () => {
    storeProductFindMany.mockResolvedValue([product({ availability: "OUT_OF_STOCK" })]);
    const quote = await quoteCart(store, [{ storeProductId: "sp-1", qty: 1 }]);
    const response = toQuoteResponse(quote);
    expect(response.lines[0]).toMatchObject({
      unitPrice: null,
      lineTotal: null,
      orderable: false,
      reason: "OUT_OF_STOCK",
    });
  });
});
