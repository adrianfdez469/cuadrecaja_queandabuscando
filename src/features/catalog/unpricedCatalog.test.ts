import { describe, expect, it } from "vitest";
import { PRICES_UNAVAILABLE_REASON_CODE } from "@/constants/storeClosure";
import { isCatalogUnpriced, UNPRICED_CATALOG_CLOSURE } from "./unpricedCatalog";
import type { CatalogProduct } from "./server/queries";
import type { AppliedPromotion } from "@/lib/promotions";

/**
 * F-040 (architecture.md § Componentes, AD1): pure tests over fixed
 * `CatalogProduct[]`, no Prisma, no database — same convention
 * `catalogFilters.test.ts` and `storeCategories.test.ts` already set. Covers
 * R1-R3, E16, E17, E18 and the two edge cases plan.md paso 2 names: tienda
 * vacía → false, alguno con precio → false, ninguno → true, promoción sin
 * tasa → true.
 */

let nextId = 0;

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  nextId += 1;
  return {
    id: `product-${String(nextId).padStart(3, "0")}`,
    slug: `product-${nextId}`,
    name: `Producto ${nextId}`,
    description: null,
    imageUrls: [],
    availability: "AVAILABLE",
    featured: false,
    categoryName: null,
    categorySlug: null,
    syncedPrice: "1.00",
    syncedPriceCurrency: "CUP",
    priceOverride: null,
    priceOverrideCurrency: null,
    promotions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function promo(overrides: Partial<AppliedPromotion> = {}): AppliedPromotion {
  return {
    id: "promo-1",
    type: "FIXED",
    value: "1",
    startsAt: new Date("2026-01-01"),
    endsAt: null,
    active: true,
    scope: "PRODUCT",
    ...overrides,
  };
}

describe("isCatalogUnpriced()", () => {
  it("R3: an empty catalogue is not unpriced", () => {
    expect(isCatalogUnpriced([], { targetCurrency: "CUP", rates: {} })).toBe(false);
  });

  it("resolves false when at least one product has a price (R1, R2)", () => {
    const catalog = [
      product({ syncedPriceCurrency: "CUP" }), // resolves, base currency
      product({ syncedPriceCurrency: "EUR" }), // no rate for EUR
    ];
    expect(isCatalogUnpriced(catalog, { targetCurrency: "CUP", rates: {} })).toBe(false);
  });

  it("R1: resolves true when every product fails to resolve a price", () => {
    const catalog = [
      product({ syncedPriceCurrency: "EUR" }),
      product({ syncedPriceCurrency: "USD" }),
    ];
    expect(isCatalogUnpriced(catalog, { targetCurrency: "CUP", rates: {} })).toBe(true);
  });

  it("E16: the CUP anchor never fails by itself — a base of CUP with every product priced in a rateless currency is still unpriced", () => {
    const catalog = [product({ syncedPriceCurrency: "EUR" })];
    expect(isCatalogUnpriced(catalog, { targetCurrency: "CUP", rates: {} })).toBe(true);
    // And the mirror: the same products resolve fine once the rate exists.
    expect(isCatalogUnpriced(catalog, { targetCurrency: "CUP", rates: { EUR: "1" } })).toBe(false);
  });

  it("E17: availability never enters the condition — an out-of-stock product with a resolvable price keeps the store priced", () => {
    const catalog = [product({ availability: "OUT_OF_STOCK", syncedPriceCurrency: "CUP" })];
    expect(isCatalogUnpriced(catalog, { targetCurrency: "CUP", rates: {} })).toBe(false);
  });

  it("E18: a promotion that cannot be applied makes the product count as unpriced too — R1 defines no second predicate, any exception from resolvePrice counts", () => {
    // The product's own amount resolves fine (same currency as the target,
    // so `convert` never even needs a rate), but the FIXED promotion's own
    // amount is not a valid number, so `resolvePrice` throws while selecting
    // the winning promotion — exactly the class of failure `tryResolvePrice`
    // exists to catch, and the same catch `ProductCard` already relies on.
    const catalog = [
      product({
        syncedPriceCurrency: "CUP",
        promotions: [promo({ type: "FIXED", value: "not-a-number" })],
      }),
    ];
    expect(isCatalogUnpriced(catalog, { targetCurrency: "CUP", rates: {} })).toBe(true);
  });

  it("a lone product with no price is enough — no minimum count", () => {
    const catalog = [product({ syncedPriceCurrency: "EUR" })];
    expect(isCatalogUnpriced(catalog, { targetCurrency: "CUP", rates: {} })).toBe(true);
  });
});

describe("UNPRICED_CATALOG_CLOSURE", () => {
  it("R8: carries the internal code and never a merchant message or instant", () => {
    expect(UNPRICED_CATALOG_CLOSURE).toEqual({
      disabledReasonCode: PRICES_UNAVAILABLE_REASON_CODE,
      disabledMessage: null,
      disabledAt: null,
    });
  });
});
