/**
 * Cart limits and storage shape.
 *
 * Shared by the client (`features/cart/**`, no Zod allowed there) and the
 * server (`features/orders/schemas.ts`, Zod). Importing the same numbers on
 * both sides is what keeps the client guard and the server schema from
 * drifting apart without anyone changing a constant on purpose.
 */

/** Bumped whenever the stored shape changes; a mismatch is discarded (R16). */
export const CART_STORAGE_VERSION = 1;

/** `localStorage` key is this prefix + `Store.id`. Never by slug (R12). */
export const CART_STORAGE_KEY_PREFIX = "qab.cart.v1.";

/** `sessionStorage` key for the per-checkout idempotency key (R26). */
export const CHECKOUT_KEY_STORAGE_PREFIX = "qab.checkout-key.v1.";

/** Quantity 0 removes the line; the schema rejects anything above this. */
export const CART_MIN_QTY_PER_LINE = 1;
export const CART_MAX_QTY_PER_LINE = 99;

/** Distinct product lines allowed per cart. */
export const CART_MAX_LINES = 50;

/** A cart untouched this long is discarded on read: its prices are stale (R15). */
export const CART_EXPIRY_DAYS = 30;

/** Debounce before re-quoting after a quantity change, so "+++" is one request. */
export const CART_QUOTE_DEBOUNCE_MS = 400;

/** After this long a quote in flight is considered "slow" (design.md F1). */
export const CART_QUOTE_SLOW_MS = 3000;
