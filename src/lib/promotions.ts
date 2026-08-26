import {
  compare,
  convert,
  money,
  percentageOff,
  subtract,
  type Money,
  type RateTable,
} from "./money";

/**
 * Promotions, pure (HD3). No Prisma, no React — `indexPromotions` takes
 * plain rows and builds the lookup once per read; `applyPromotion` and
 * `orderDiscount` are the only two places that touch a promotion's `value`.
 *
 * The discount is computed in the PRODUCT's own currency, before `convert`
 * (architecture.md § El orden de las operaciones): `effectivePrice()` →
 * `applyPromotion()` → `convert()`. Doing it after `convert` would break the
 * fórmula `docs/sync-contract.md` publishes for `originalUnitPrice`.
 */

export type PromotionType = "PERCENTAGE" | "FIXED";
export type PromotionScope = "PRODUCT" | "CATEGORY" | "ORDER";

export type PromotionRow = {
  id: string;
  type: PromotionType;
  scope: PromotionScope;
  /** Percentage as "20" (not "0.20"), or a fixed amount in the business's
   *  base currency — never Decimal, never a currency of its own (I4). */
  value: string;
  conditions: unknown;
  startsAt: Date;
  endsAt: Date | null;
  active: boolean;
};

export type AppliedPromotion = Omit<PromotionRow, "conditions" | "scope"> & {
  scope: "PRODUCT" | "CATEGORY";
};

export type OrderPromotion = Omit<PromotionRow, "conditions" | "scope"> & {
  minSubtotal: string | null;
};

export type PromotionIndex = {
  /** O(1) per call. The product's own promotions plus its category's. */
  forProduct(storeProductId: string, localCategoryId: string | null): readonly AppliedPromotion[];
  readonly order: readonly OrderPromotion[];
};

function isVigente(row: PromotionRow, now: Date): boolean {
  if (!row.active) return false;
  if (row.startsAt.getTime() > now.getTime()) return false;
  if (row.endsAt && row.endsAt.getTime() <= now.getTime()) return false;
  return true;
}

function toApplied(row: PromotionRow, scope: "PRODUCT" | "CATEGORY"): AppliedPromotion {
  return {
    id: row.id,
    type: row.type,
    value: row.value,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    active: row.active,
    scope,
  };
}

/**
 * Builds the O(1) lookup ONCE per read (§ Dónde se indexa el Map). R30: a row
 * whose `conditions` does not validate for its own `scope` is dropped with a
 * warning — the dangerous failure mode would be treating it as "applies to
 * everything".
 */
export function indexPromotions(rows: readonly PromotionRow[], now: Date): PromotionIndex {
  const byProduct = new Map<string, AppliedPromotion[]>();
  const byCategory = new Map<string, AppliedPromotion[]>();
  const order: OrderPromotion[] = [];

  for (const row of rows) {
    if (!isVigente(row, now)) continue;

    if (row.scope === "PRODUCT") {
      const ids = stringArray(
        (row.conditions as { storeProductIds?: unknown } | null)?.storeProductIds,
      );
      if (!ids || ids.length === 0) {
        console.warn(`[promotions] invalid PRODUCT conditions for ${row.id}, skipping`);
        continue;
      }
      const applied = toApplied(row, "PRODUCT");
      for (const id of ids) push(byProduct, id, applied);
    } else if (row.scope === "CATEGORY") {
      const ids = stringArray(
        (row.conditions as { localCategoryIds?: unknown } | null)?.localCategoryIds,
      );
      if (!ids || ids.length === 0) {
        console.warn(`[promotions] invalid CATEGORY conditions for ${row.id}, skipping`);
        continue;
      }
      const applied = toApplied(row, "CATEGORY");
      for (const id of ids) push(byCategory, id, applied);
    } else {
      const conditions = row.conditions as { minSubtotal?: unknown } | null;
      const raw = conditions?.minSubtotal;
      if (raw !== undefined && raw !== null && typeof raw !== "string") {
        console.warn(`[promotions] invalid ORDER conditions for ${row.id}, skipping`);
        continue;
      }
      order.push({
        id: row.id,
        type: row.type,
        value: row.value,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        active: row.active,
        minSubtotal: typeof raw === "string" ? raw : null,
      });
    }
  }

  return {
    forProduct(storeProductId, localCategoryId) {
      const fromProduct = byProduct.get(storeProductId) ?? [];
      const fromCategory = localCategoryId ? (byCategory.get(localCategoryId) ?? []) : [];
      return [...fromProduct, ...fromCategory];
    },
    order,
  };
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.every((v) => typeof v === "string") ? (value as string[]) : null;
}

function push<K>(map: Map<K, AppliedPromotion[]>, key: K, value: AppliedPromotion): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** startsAt asc, then id asc — the tie-break that makes R26 deterministic. */
function isEarlier(a: { startsAt: Date; id: string }, b: { startsAt: Date; id: string }): boolean {
  const diff = a.startsAt.getTime() - b.startsAt.getTime();
  if (diff !== 0) return diff < 0;
  return a.id < b.id;
}

/**
 * R26: several PRODUCT/CATEGORY promotions on the same product do not
 * stack — the one that leaves the LOWEST price wins.
 */
export function selectPromotion(
  candidates: readonly AppliedPromotion[],
  price: Money,
  ctx: { rates: RateTable; baseCurrency: string },
): AppliedPromotion | null {
  let best: { promo: AppliedPromotion; result: Money } | null = null;
  for (const promo of candidates) {
    const { price: discounted } = applyPromotion(price, promo, ctx);
    if (
      !best ||
      compare(discounted, best.result) < 0 ||
      (compare(discounted, best.result) === 0 && isEarlier(promo, best.promo))
    ) {
      best = { promo, result: discounted };
    }
  }
  return best?.promo ?? null;
}

/** R27: PERCENTAGE discounts `price` itself; FIXED is in the business's base
 *  currency and is converted into `price`'s currency before subtracting.
 *  Never below 0. */
export function applyPromotion(
  price: Money,
  promotion: AppliedPromotion,
  ctx: { rates: RateTable; baseCurrency: string },
): { price: Money; listPrice: Money } {
  if (promotion.type === "PERCENTAGE") {
    return { price: percentageOff(price, promotion.value), listPrice: price };
  }

  const fixed = convert(money(promotion.value, ctx.baseCurrency), price.currency, ctx.rates);
  const discounted = subtract(price, fixed);
  const floored =
    compare(discounted, money("0", price.currency)) < 0 ? money("0", price.currency) : discounted;
  return { price: floored, listPrice: price };
}

function orderPromotionDiscount(
  subtotal: Money,
  promo: OrderPromotion,
  ctx: { rates: RateTable; baseCurrency: string },
): Money {
  if (promo.type === "PERCENTAGE") {
    return subtract(subtotal, percentageOff(subtotal, promo.value));
  }
  const fixed = convert(money(promo.value, ctx.baseCurrency), subtotal.currency, ctx.rates);
  // A fixed discount never exceeds the subtotal — the total cannot go negative.
  return compare(fixed, subtotal) > 0 ? subtotal : fixed;
}

/**
 * R30 (`minSubtotal`) + R26 for `ORDER` scope. `promotions` is already
 * vigency-filtered by `indexPromotions` — this only applies the eligibility
 * (minimum) and the tie-break.
 */
export function orderDiscount(
  subtotal: Money,
  promotions: readonly OrderPromotion[],
  ctx: { rates: RateTable; baseCurrency: string },
): { discount: Money; promotionId: string | null } {
  const eligible = promotions.filter((promo) => {
    if (promo.minSubtotal == null) return true;
    const min = convert(money(promo.minSubtotal, ctx.baseCurrency), subtotal.currency, ctx.rates);
    return compare(subtotal, min) >= 0;
  });

  let best: { promo: OrderPromotion; discount: Money } | null = null;
  for (const promo of eligible) {
    const discount = orderPromotionDiscount(subtotal, promo, ctx);
    if (
      !best ||
      compare(discount, best.discount) > 0 ||
      (compare(discount, best.discount) === 0 && isEarlier(promo, best.promo))
    ) {
      best = { promo, discount };
    }
  }

  return best
    ? { discount: best.discount, promotionId: best.promo.id }
    : { discount: money("0", subtotal.currency), promotionId: null };
}
