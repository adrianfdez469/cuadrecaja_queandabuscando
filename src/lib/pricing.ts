import { convert, money, type Money, type MoneyInput, type RateTable } from "./money";
import { applyPromotion, selectPromotion, type AppliedPromotion } from "./promotions";

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

export type ResolvedPrice = {
  /** Charged/shown price, already converted to `targetCurrency`. */
  price: Money;
  /** The SAME money before converting — what `OrderItem.originalUnitPrice` gets. */
  beforeConversion: Money;
  /** List price converted, for the strikethrough. `null` when no promotion applied. */
  listPrice: Money | null;
  isOverridden: boolean;
  promotionId: string | null;
};

/**
 * The ONLY place `effectivePrice()` → promotion → `convert()` are chained
 * (architecture.md § El compositor único). Both `ProductCard` and
 * `quoteLine` go through this, so a product's shown price and its charged
 * price can never diverge over a promotion.
 */
export function resolvePrice(
  product: PriceFields,
  options: {
    targetCurrency: string;
    rates: RateTable;
    /** Already filtered by vigency and scope. Empty = today's plain path. */
    promotions?: readonly AppliedPromotion[];
    /** Currency a `FIXED` promotion's `value` is denominated in (R27). */
    baseCurrency: string;
  },
): ResolvedPrice {
  const base = effectivePrice(product);
  const candidates = options.promotions ?? [];

  // Plain `Money`, not `EffectivePrice` — `isOverridden` is reported
  // separately below, not smuggled into a value a caller might persist or
  // compare structurally (as `OrderItem.originalUnitPrice` does).
  let beforeConversion: Money = money(base.amount, base.currency);
  let listPrice: Money | null = null;
  let promotionId: string | null = null;

  if (candidates.length > 0) {
    const winner = selectPromotion(candidates, base, {
      rates: options.rates,
      baseCurrency: options.baseCurrency,
    });
    if (winner) {
      const applied = applyPromotion(base, winner, {
        rates: options.rates,
        baseCurrency: options.baseCurrency,
      });
      beforeConversion = applied.price;
      listPrice = applied.listPrice;
      promotionId = winner.id;
    }
  }

  const price =
    beforeConversion.currency === options.targetCurrency
      ? beforeConversion
      : convert(beforeConversion, options.targetCurrency, options.rates);
  const listPriceConverted =
    listPrice === null
      ? null
      : listPrice.currency === options.targetCurrency
        ? listPrice
        : convert(listPrice, options.targetCurrency, options.rates);

  return {
    price,
    beforeConversion,
    listPrice: listPriceConverted,
    isOverridden: base.isOverridden,
    promotionId,
  };
}

/**
 * Effective price expressed in the currency the shopper is browsing in.
 * Products in a single store may be priced in different currencies, so a
 * comparable display price always goes through this. Implemented on
 * `resolvePrice` (no `promotions`) — one code path, not two.
 */
export function displayPrice(
  product: PriceFields,
  displayCurrency: string,
  rates: RateTable,
): EffectivePrice {
  const resolved = resolvePrice(product, {
    targetCurrency: displayCurrency,
    rates,
    baseCurrency: displayCurrency,
  });
  return { ...resolved.price, isOverridden: resolved.isOverridden };
}
