import { convert, money, type Money, type MoneyInput, type RateTable } from "./money";

/**
 * Price resolution.
 *
 * Two sources define a price and exactly one wins: the sync owns
 * `syncedPrice`, the admin panel owns `priceOverride`, and while an override
 * exists the sync never touches it. Encapsulated here so no view ever
 * reimplements the precedence and gets it subtly wrong.
 */

export type PriceFields = {
  syncedPrice: MoneyInput;
  syncedPriceCurrency: string;
  priceOverride?: MoneyInput | null;
  priceOverrideCurrency?: string | null;
};

export type EffectivePrice = Money & {
  /** True when an admin override is in effect, for badging in the UI. */
  readonly isOverridden: boolean;
};

export function effectivePrice(product: PriceFields): EffectivePrice {
  const hasOverride =
    product.priceOverride !== null &&
    product.priceOverride !== undefined &&
    String(product.priceOverride).trim() !== "";

  if (hasOverride) {
    return {
      ...money(
        product.priceOverride as MoneyInput,
        // An override without its own currency inherits the synced one.
        product.priceOverrideCurrency || product.syncedPriceCurrency,
      ),
      isOverridden: true,
    };
  }

  return {
    ...money(product.syncedPrice, product.syncedPriceCurrency),
    isOverridden: false,
  };
}

/**
 * Effective price expressed in the currency the shopper is browsing in.
 * Products in a single store may be priced in different currencies, so a
 * comparable display price always goes through this.
 */
export function displayPrice(
  product: PriceFields,
  displayCurrency: string,
  rates: RateTable,
): EffectivePrice {
  const price = effectivePrice(product);
  if (price.currency === displayCurrency) return price;
  return { ...convert(price, displayCurrency, rates), isOverridden: price.isOverridden };
}
