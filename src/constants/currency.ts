/**
 * F-039 (architecture.md AD2, AD6, AD9): every literal shared by the writer
 * of `Business.displayCurrencies` (`src/features/sync/`) and the reader that
 * shows it in the storefront (`src/lib/priceEquivalents.ts`,
 * `src/features/currency/`) lives here — a magic string duplicated in two
 * files is exactly what AGENTS.md § Prohibiciones forbids.
 */

/**
 * AD2: the pattern a `displayCurrencies` member must match — exactly three
 * uppercase A-Z letters, never case-folded, never trimmed (R3, D3 humano
 * 2026-09-07). Moved here from `src/features/sync/displayCurrencies.ts` so
 * the storefront reader never writes a second copy of the same regex.
 */
export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

/**
 * AD9: the `localStorage` key that holds the shopper's reference-currency
 * preference. Of the SHOPPER, not the store — no `Store.id` suffix, unlike
 * the cart's `CART_STORAGE_KEY_PREFIX` (`src/constants/cart.ts:14`). Value
 * is a bare string: a three-letter code, or `REFERENCE_CURRENCY_NONE`. Never
 * JSON — there is nothing to wrap, and the version already lives in the key,
 * same convention as the cart.
 */
export const REFERENCE_CURRENCY_STORAGE_KEY = "qab.reference-currency.v1";

/**
 * AD9, SP1(a): the explicit "only the base currency" choice. Lowercase on
 * purpose — it can never collide with a code, since `CURRENCY_CODE_PATTERN`
 * forces those to uppercase.
 */
export const REFERENCE_CURRENCY_NONE = "none";

/** AD4/AD9: the four attribute names the boot script, the CSS generator and
 *  the selector island all have to agree on. */

/** Written by the CLIENT ONLY, on `<html>` (R12/R13). A code, or
 *  `REFERENCE_CURRENCY_NONE`. */
export const REFERENCE_CURRENCY_ATTR = "data-ref-currency";

/** Written by the SERVER, on the element that must disappear ENTIRE with its
 *  equivalent (R15, restricción 1 del diseñador). Value: the three-letter
 *  code of that equivalent. */
export const EQUIVALENT_CURRENCY_ATTR = "data-equiv";

/** Written by the SERVER, on the store's `div`, only when
 *  `selectableCurrencies` is non-empty: the OFFERED codes (DH5), space
 *  separated. What the boot script validates membership against. */
export const REFERENCE_CURRENCY_CHOICES_ATTR = "data-ref-choices";

/** Written by the SERVER, on the store's `div`, only when
 *  `selectableCurrencies` is non-empty: its first element (SP1(a)). */
export const REFERENCE_CURRENCY_DEFAULT_ATTR = "data-ref-default";

/**
 * AD6: the memo of `Intl.NumberFormat` instances in `src/lib/money.ts` is
 * capped at this many entries. Codes arrive through the sync validated only
 * as three uppercase letters (17,576 possible), so an unbounded map is
 * memory that grows with whatever the POS decides to send in a long-lived
 * process. 64 covers any real store with room to spare.
 */
export const CURRENCY_FORMATTER_CACHE_MAX = 64;
