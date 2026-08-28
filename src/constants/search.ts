/**
 * Search (F-021 architecture.md § I7): the pieces the marketplace search
 * (F-015) and the store search (F-021) share, renamed WITHOUT the
 * `MARKETPLACE_` prefix on purpose — a store's search reading the
 * marketplace's vocabulary would be the wrong dependency (spec.md I9: the
 * two searches do not mix). What is genuinely the marketplace's own —
 * pagination limits, the backfill batch size — stays in
 * `src/constants/marketplace.ts`.
 */

/** The Postgres text search dictionary. Lives here and not as a literal in
 *  two places of SQL: `src/features/search/server/expressions.ts` imports
 *  it, and the hand-written migrations that cannot import a TypeScript
 *  constant repeat the literal — the guards
 *  (`src/features/marketplace/server/boundaries.test.ts`, G3 and G7) compare
 *  the two so they cannot drift apart silently. */
export const SEARCH_TS_CONFIG = "spanish";

/** R9/E11: a term longer than this is not rejected, it is truncated. */
export const SEARCH_TERM_MAX_LENGTH = 120;

/**
 * Separates the three parts of a StoreProduct's search document
 * (`localName · aliases · description`, architecture.md § SQL — W3).
 * Travels LINKED to the SQL, never interpolated from a raw string a person
 * typed, and the hand-written backfill of the F-021 migration repeats this
 * exact literal (guard G7).
 */
export const SEARCH_DOCUMENT_SEPARATOR = " · ";
