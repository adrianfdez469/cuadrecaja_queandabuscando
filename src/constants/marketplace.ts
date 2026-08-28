/**
 * Marketplace search (F-015): the pagination limits and the backfill batch
 * size — what is genuinely the marketplace's own (AGENTS.md § Prohibiciones:
 * no magic numbers or strings). The dictionary and the term length cap moved
 * to `src/constants/search.ts` (F-021 architecture.md § I7): they are shared
 * with the store search, and a name with `MARKETPLACE_` on a constant the
 * store search also needs was the wrong dependency to keep.
 */

export const MARKETPLACE_SEARCH_LIMIT_DEFAULT = 20;
export const MARKETPLACE_SEARCH_LIMIT_MIN = 1;
export const MARKETPLACE_SEARCH_LIMIT_MAX = 50;

/** Rows per statement in the backfill: bounds the lock and the memory of
 *  each UPDATE. */
export const MARKETPLACE_BACKFILL_BATCH_SIZE = 1000;
