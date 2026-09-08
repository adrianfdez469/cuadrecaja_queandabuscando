/**
 * F-038: pure rules for `BUSINESS.payload.displayCurrencies` — no Prisma, no
 * React, sibling of `./identity.ts` and `./dependencies.ts`. R5 requires the
 * handler's format checks to run BEFORE any round-trip to the database, and
 * this module is what makes that possible: both functions below are testable
 * without mocking Prisma at all.
 */

/**
 * R3 (D3, humano 2026-09-07): exactly three uppercase A-Z letters. Never
 * case-folded, never trimmed — a code that matches no `Currency` row is
 * never painted and nobody notices, and the silent failure is what this
 * entity exists to prevent.
 */
export const DISPLAY_CURRENCY_CODE = /^[A-Z]{3}$/;

/**
 * The FIRST member that is not a valid code, or `null` when every one is.
 * Returns the value (not a boolean) so the caller can name it in its
 * `console.warn` — the wire error carries no detail at all (R14).
 */
export function findInvalidDisplayCurrency(codes: readonly string[]): string | null {
  for (const code of codes) {
    if (!DISPLAY_CURRENCY_CODE.test(code)) return code;
  }
  return null;
}

/**
 * R4: exact string equality, byte for byte; the FIRST occurrence survives
 * and the relative order of the rest is preserved. `Set` IS that rule —
 * SameValueZero, insertion order — so this is the statement of R4, not an
 * implementation of it.
 */
export function dedupeDisplayCurrencies(codes: readonly string[]): string[] {
  return [...new Set(codes)];
}
