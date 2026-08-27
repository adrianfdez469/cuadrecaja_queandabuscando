/**
 * Marketplace search (F-015): the dictionary, the term/pagination limits,
 * and the backfill batch size (AGENTS.md § Prohibiciones: no magic numbers or
 * strings).
 */

/** The Postgres text search dictionary. Lives here and not as a literal in
 *  two places of SQL: `src/features/marketplace/server/searchVector.ts`
 *  imports it, and `prisma/migrations/*_backfill_search_vector/migration.sql`
 *  cannot import a TypeScript constant so it repeats the literal — the guard
 *  (`src/features/marketplace/server/boundaries.test.ts`, G3) compares the
 *  two so they cannot drift apart silently. */
export const MARKETPLACE_SEARCH_TS_CONFIG = "spanish";

/** R7: a term longer than this is not a search. It gets truncated, not
 *  rejected. The longest product name in the seed has 25 characters. */
export const MARKETPLACE_SEARCH_TERM_MAX_LENGTH = 120;

export const MARKETPLACE_SEARCH_LIMIT_DEFAULT = 20;
export const MARKETPLACE_SEARCH_LIMIT_MIN = 1;
export const MARKETPLACE_SEARCH_LIMIT_MAX = 50;

/** Rows per statement in the backfill: bounds the lock and the memory of
 *  each UPDATE. */
export const MARKETPLACE_BACKFILL_BATCH_SIZE = 1000;
