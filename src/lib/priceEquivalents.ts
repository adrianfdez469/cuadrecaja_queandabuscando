/**
 * F-039 (architecture.md AD1): the one place that computes what a price is
 * worth in the currencies a business declares (`Business.displayCurrencies`,
 * `docs/sync-contract.md` § BUSINESS). New module, not inside
 * `src/lib/pricing.ts`: that file imports `./promotions`, and the cart and
 * checkout — client tree — would drag that machinery into the bundle if the
 * bundler failed to shake it. This module imports ONLY from `./money`, which
 * is already in that tree.
 *
 * Three exports, three conjuntos distintos (R7, R23/DH5):
 * - `equivalentCurrencies`: the declared list minus the base (R2). NOT
 *   pruned by rate — what every product tries to paint.
 * - `priceEquivalents`: what actually paints for ONE resolved amount, with
 *   the incalculable ones omitted (R5).
 * - `selectableCurrencies`: what the selector OFFERS, per business, not per
 *   product (DH5/R23) — the same predicate `priceEquivalents` uses to omit,
 *   applied to a nominal probe amount, so what is offered and what is
 *   painted can never disagree.
 */

import { convert, money, MoneyError, type Money, type RateTable } from "./money";

/**
 * R2: the declared list minus the base, comparing the code as an exact
 * string, never case-folded. NOT pruned by rate — that is
 * `selectableCurrencies`, and the declared list itself is never pruned
 * anywhere (R1).
 */
export function equivalentCurrencies(
  declaredCurrencies: readonly string[],
  baseCurrency: string,
): readonly string[] {
  return declaredCurrencies.filter((code) => code !== baseCurrency);
}

/**
 * The equivalents of an already-resolved amount, in the order of the
 * declared list, with the ones that cannot be calculated already omitted
 * (R5, R7, R8). `price` is ALWAYS in the base currency: it is
 * `resolvePrice(...).price`, the amount that gets charged, never
 * `beforeConversion` (R8).
 */
export function priceEquivalents(
  price: Money,
  declaredCurrencies: readonly string[],
  baseCurrency: string,
  rates: RateTable,
): readonly Money[] {
  const out: Money[] = [];
  for (const code of equivalentCurrencies(declaredCurrencies, baseCurrency)) {
    try {
      out.push(convert(price, code, rates));
    } catch (error) {
      // R5: ONLY MoneyError is omitted. Any other error is a defect in the
      // code and has to bubble up — unlike the two bare `catch` blocks that
      // already exist (ProductCard.tsx:103, catalogFilters.ts:264), which
      // this feature does NOT touch.
      if (!(error instanceof MoneyError)) throw error;
    }
  }
  return out;
}

/**
 * DH5 (humano, 2026-09-08): the members of `equivalentCurrencies` whose
 * equivalent can be CALCULATED with these rates, in the same order. What the
 * selector offers, what travels in `data-ref-choices`, and what generates
 * the CSS rules. Its FIRST element is SP1(a), so the initial currency is
 * offered by construction and nobody has to check that anywhere.
 *
 * The predicate is `convert` on a nominal amount, not `code in rates`: a
 * zero or negative rate makes `convert` throw exactly like its absence
 * (`src/lib/money.ts:151`), and writing a second condition here would be
 * reimplementing a rule `convert` already has (R10).
 */
export function selectableCurrencies(
  declaredCurrencies: readonly string[],
  baseCurrency: string,
  rates: RateTable,
): readonly string[] {
  // A nominal amount in the base: only whether it converts matters, not how
  // much.
  const probe = money(1, baseCurrency);
  return priceEquivalents(probe, declaredCurrencies, baseCurrency, rates).map((m) => m.currency);
}
