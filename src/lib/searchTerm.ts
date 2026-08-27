import {
  MARKETPLACE_SEARCH_LIMIT_DEFAULT,
  MARKETPLACE_SEARCH_LIMIT_MAX,
  MARKETPLACE_SEARCH_LIMIT_MIN,
  MARKETPLACE_SEARCH_TERM_MAX_LENGTH,
} from "@/constants/marketplace";

/**
 * Pure marketplace-search helpers (F-015 architecture.md § Contratos):
 * trimming, truncation and pagination clamping. No Prisma, no SQL — the two
 * SQL expressions that share a dictionary with these limits live in
 * `src/features/marketplace/server/searchVector.ts`, one layer down.
 */

/**
 * Trims, collapses every run of whitespace to one space, truncates to
 * `MARKETPLACE_SEARCH_TERM_MAX_LENGTH` (R7) and returns `null` when what is
 * left contains no letter and no digit (`/[\p{L}\p{N}]/u`) — the empty
 * string, a run of spaces, or pure punctuation (R6, E15).
 */
export function normalizeSearchTerm(raw: string): string | null {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  const truncated = collapsed.slice(0, MARKETPLACE_SEARCH_TERM_MAX_LENGTH);
  if (!/[\p{L}\p{N}]/u.test(truncated)) return null;
  return truncated;
}

/** Clamps `limit` to an integer in [MIN, MAX]; absent or invalid → the
 *  default. Never raw into SQL. */
export function clampSearchLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return MARKETPLACE_SEARCH_LIMIT_DEFAULT;
  }
  const truncated = Math.trunc(limit);
  return Math.min(MARKETPLACE_SEARCH_LIMIT_MAX, Math.max(MARKETPLACE_SEARCH_LIMIT_MIN, truncated));
}

/** Clamps `offset` to an integer >= 0; absent or invalid → 0. */
export function clampSearchOffset(offset?: number): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.trunc(offset));
}
