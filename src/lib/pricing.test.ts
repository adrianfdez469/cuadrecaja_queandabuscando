import { describe, expect, it } from "vitest";
import { displayPrice, effectivePrice, resolvePrice } from "./pricing";
import type { AppliedPromotion } from "./promotions";

const base = { syncedPrice: "100.00", syncedPriceCurrency: "CUP" };

describe("effectivePrice()", () => {
  it("uses the synced price when there is no override", () => {
    const price = effectivePrice(base);
    expect(price.amount).toBe("100.00");
    expect(price.currency).toBe("CUP");
    expect(price.isOverridden).toBe(false);
  });

  it("lets the override win", () => {
    const price = effectivePrice({ ...base, priceOverride: "80", priceOverrideCurrency: "CUP" });
    expect(price.amount).toBe("80.00");
    expect(price.isOverridden).toBe(true);
  });

  it("treats null and empty override as absent", () => {
    expect(effectivePrice({ ...base, priceOverride: null }).isOverridden).toBe(false);
    expect(effectivePrice({ ...base, priceOverride: "  " }).isOverridden).toBe(false);
  });

  it("honours an override of zero — a giveaway is a real price", () => {
    const price = effectivePrice({ ...base, priceOverride: "0" });
    expect(price.amount).toBe("0.00");
    expect(price.isOverridden).toBe(true);
  });

  it("inherits the synced currency when the override has none", () => {
    const price = effectivePrice({ ...base, priceOverride: "80", priceOverrideCurrency: null });
    expect(price.currency).toBe("CUP");
  });

  it("respects an override in a different currency", () => {
    const price = effectivePrice({ ...base, priceOverride: "2", priceOverrideCurrency: "USD" });
    expect(price).toMatchObject({ amount: "2.00", currency: "USD", isOverridden: true });
  });

  it("accepts Prisma Decimal-like values", () => {
    const price = effectivePrice({
      syncedPrice: { toString: () => "12.30" },
      syncedPriceCurrency: "CUP",
    });
    expect(price.amount).toBe("12.30");
  });
});

describe("displayPrice()", () => {
  const rates = { USD: "440" };

  it("passes through when already in the display currency", () => {
    expect(displayPrice(base, "CUP", rates).amount).toBe("100.00");
  });

  it("converts a USD-priced product for a CUP shopper", () => {
    const product = { syncedPrice: "2", syncedPriceCurrency: "USD" };
    expect(displayPrice(product, "CUP", rates).amount).toBe("880.00");
  });

  it("keeps the override flag through conversion", () => {
    const product = { ...base, priceOverride: "1", priceOverrideCurrency: "USD" };
    const price = displayPrice(product, "CUP", rates);
    expect(price).toMatchObject({ amount: "440.00", isOverridden: true });
  });
});

describe("resolvePrice()", () => {
  const rates = { USD: "440" };

  function promo(overrides: Partial<AppliedPromotion> = {}): AppliedPromotion {
    return {
      id: "promo-1",
      type: "PERCENTAGE",
      value: "20",
      startsAt: new Date("2026-01-01"),
      endsAt: null,
      active: true,
      scope: "PRODUCT",
      ...overrides,
    };
  }

  it("with no promotions, matches displayPrice exactly", () => {
    const resolved = resolvePrice(base, { targetCurrency: "CUP", rates, baseCurrency: "CUP" });
    const display = displayPrice(base, "CUP", rates);
    expect(resolved.price).toEqual({ amount: display.amount, currency: display.currency });
    expect(resolved.isOverridden).toBe(display.isOverridden);
    expect(resolved.listPrice).toBeNull();
    expect(resolved.promotionId).toBeNull();
  });

  it("applies a PERCENTAGE promotion and fills listPrice with the original", () => {
    const resolved = resolvePrice(base, {
      targetCurrency: "CUP",
      rates,
      baseCurrency: "CUP",
      promotions: [promo({ value: "20" })],
    });
    expect(resolved.price.amount).toBe("80.00");
    expect(resolved.listPrice?.amount).toBe("100.00");
    expect(resolved.promotionId).toBe("promo-1");
  });

  it("E30: discounts the OVERRIDE, never the synced price", () => {
    const withOverride = { ...base, priceOverride: "50", priceOverrideCurrency: "CUP" };
    const resolved = resolvePrice(withOverride, {
      targetCurrency: "CUP",
      rates,
      baseCurrency: "CUP",
      promotions: [promo({ value: "20" })],
    });
    expect(resolved.price.amount).toBe("40.00"); // 20% off 50, not off 100
    expect(resolved.listPrice?.amount).toBe("50.00");
  });

  it("beforeConversion satisfies unitPrice = convert(beforeConversion, ...) (contract fórmula)", () => {
    const product = { syncedPrice: "2", syncedPriceCurrency: "USD" };
    const resolved = resolvePrice(product, {
      targetCurrency: "CUP",
      rates,
      baseCurrency: "USD",
      promotions: [promo({ value: "50" })],
    });
    // 50% off 2 USD = 1 USD, converted at 440 = 440 CUP.
    expect(resolved.beforeConversion).toEqual({ amount: "1.00", currency: "USD" });
    expect(resolved.price.amount).toBe("440.00");
  });
});
