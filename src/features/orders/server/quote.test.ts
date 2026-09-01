import { beforeEach, describe, expect, it, vi } from "vitest";
import { asPublicSlug } from "@/lib/publicSlug";

const storeFindUnique = vi.fn();
const storeProductFindMany = vi.fn();
const exchangeRateFindMany = vi.fn();
const promotionFindMany = vi.fn();
const resolvePublicSlug = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findUnique: (...args: unknown[]) => storeFindUnique(...args) },
    storeProduct: { findMany: (...args: unknown[]) => storeProductFindMany(...args) },
    exchangeRate: { findMany: (...args: unknown[]) => exchangeRateFindMany(...args) },
    promotion: { findMany: (...args: unknown[]) => promotionFindMany(...args) },
  },
}));
vi.mock("@/features/storefront/server/resolve", () => ({
  resolvePublicSlug: (...args: unknown[]) => resolvePublicSlug(...args),
}));

const { loadStoreForOrder, quoteCart, quoteBySlug, toQuoteResponse } = await import("./quote");

/** A resolved "branch" the way `resolve.ts` would produce it for `tienda-demo`. */
function branchResolution(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: "branch" as const,
    storeId: "store-1",
    canonicalSlug: asPublicSlug("tienda-demo"),
    storefrontId: "storefront-1",
    brandSlug: asPublicSlug("tienda-demo"),
    brandName: "La Rampa",
    branchCount: 1,
    isAlias: false,
    ...overrides,
  };
}

beforeEach(() => {
  storeFindUnique.mockReset();
  storeProductFindMany.mockReset();
  exchangeRateFindMany.mockReset().mockResolvedValue([]);
  promotionFindMany.mockReset().mockResolvedValue([]);
  resolvePublicSlug.mockReset().mockResolvedValue(branchResolution());
});

const store = {
  id: "store-1",
  businessId: "biz-1",
  slug: asPublicSlug("tienda-demo"),
  name: "La Rampa",
  currencyCode: "CUP",
  checkoutMode: "WHATSAPP" as const,
  deliveryEnabled: false,
  deliveryFee: null,
  deliveryFeeMode: "FLAT_RATE" as const,
  whatsappNumber: "+5350000001",
  status: "PUBLISHED" as const,
  disabledReasonCode: null,
  disabledMessage: null,
  disabledAt: null,
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
  it("returns null when the slug is not in the registry", async () => {
    resolvePublicSlug.mockResolvedValue(null);
    expect(await loadStoreForOrder("no-existe")).toBeNull();
    expect(storeFindUnique).not.toHaveBeenCalled();
  });

  it("returns null for a brand slug that resolves to a selector (etapa 2, no single branch to charge)", async () => {
    resolvePublicSlug.mockResolvedValue({ kind: "selector", branches: [] });
    expect(await loadStoreForOrder("la-rampa")).toBeNull();
    expect(storeFindUnique).not.toHaveBeenCalled();
  });

  it("resolves the requested slug and queries by storeId, never by slug", async () => {
    storeFindUnique.mockResolvedValue({
      id: "store-1",
      name: "La Rampa",
      checkoutMode: "ONSITE",
      deliveryEnabled: true,
      deliveryFee: { toString: () => "500.00" },
      deliveryFeeMode: "FLAT_RATE",
      whatsapp: null,
      phone: "+5350000009",
      status: "PUBLISHED",
      disabledReasonCode: null,
      disabledMessage: null,
      disabledAt: null,
      business: { id: "biz-1", baseCurrencyCode: "CUP" },
    });
    const result = await loadStoreForOrder("bodega-central-vedado");
    expect(resolvePublicSlug).toHaveBeenCalledWith("bodega-central-vedado");
    expect(storeFindUnique.mock.calls[0][0]).toMatchObject({ where: { id: "store-1" } });
    // R15/routingWhatsappNumber: falls back to phone when whatsapp is null.
    expect(result?.whatsappNumber).toBe("+5350000009");
    // The response slug is always the CANONICAL one, not the requested URL.
    expect(result?.slug).toBe("tienda-demo");
    expect(result?.deliveryFee).toBe("500.00");
  });

  it("F-031 DA2: carries deliveryFeeMode through, explicit (R20)", async () => {
    storeFindUnique.mockResolvedValue({
      id: "store-1",
      name: "La Rampa",
      checkoutMode: "WHATSAPP",
      deliveryEnabled: true,
      deliveryFee: null,
      deliveryFeeMode: "QUOTED_PER_ORDER",
      whatsapp: "+5350000001",
      phone: null,
      status: "PUBLISHED",
      disabledReasonCode: null,
      disabledMessage: null,
      disabledAt: null,
      business: { id: "biz-1", baseCurrencyCode: "CUP" },
    });
    const result = await loadStoreForOrder("tienda-demo");
    expect(result?.deliveryFeeMode).toBe("QUOTED_PER_ORDER");
  });

  it("returns null when the resolved store does not exist or is DRAFT", async () => {
    storeFindUnique.mockResolvedValue(null);
    expect(await loadStoreForOrder("tienda-demo")).toBeNull();
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
  it("returns not_found when the store does not exist", async () => {
    resolvePublicSlug.mockResolvedValue(null);
    expect(await quoteBySlug("no-existe", [])).toEqual({ kind: "not_found" });
  });

  it("returns closed, not not_found, for a SUSPENDED store (HD11)", async () => {
    storeFindUnique.mockResolvedValue({
      id: "store-1",
      name: "La Rampa",
      checkoutMode: "WHATSAPP",
      deliveryEnabled: false,
      deliveryFee: null,
      whatsapp: "+5350000001",
      phone: null,
      status: "SUSPENDED",
      disabledReasonCode: "VACACIONES",
      disabledMessage: null,
      disabledAt: new Date("2026-08-01T00:00:00Z"),
      business: { id: "biz-1", baseCurrencyCode: "CUP" },
    });
    const result = await quoteBySlug("tienda-demo", []);
    expect(result).toEqual({
      kind: "closed",
      reasonCode: "VACACIONES",
      message: null,
      disabledAt: new Date("2026-08-01T00:00:00Z"),
    });
  });

  it("returns ok with a real quote for a PUBLISHED store", async () => {
    storeFindUnique.mockResolvedValue({
      id: "store-1",
      name: "La Rampa",
      checkoutMode: "WHATSAPP",
      deliveryEnabled: false,
      deliveryFee: null,
      whatsapp: "+5350000001",
      phone: null,
      status: "PUBLISHED",
      disabledReasonCode: null,
      disabledMessage: null,
      disabledAt: null,
      business: { id: "biz-1", baseCurrencyCode: "CUP" },
    });
    storeProductFindMany.mockResolvedValue([]);
    const result = await quoteBySlug("tienda-demo", []);
    expect(result.kind).toBe("ok");
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
    expect(response.store).toMatchObject({
      slug: "tienda-demo",
      currencyCode: "CUP",
      deliveryFeeMode: "FLAT_RATE",
    });
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
