import { describe, expect, it } from "vitest";
import { displayPrice, effectivePrice } from "./pricing";

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
