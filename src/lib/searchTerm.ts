import {
  MARKETPLACE_SEARCH_LIMIT_DEFAULT,
  MARKETPLACE_SEARCH_LIMIT_MAX,
  MARKETPLACE_SEARCH_LIMIT_MIN,
} from "@/constants/marketplace";
import { SEARCH_TERM_MAX_LENGTH } from "@/constants/search";
import { STORE_SEARCH_MAX_PAGE } from "@/constants/storeSearch";

/**
 * Pure search helpers shared by the marketplace search (F-015) and the
 * store search (F-021, architecture.md § I7): trimming, truncation and
 * pagination clamping. No Prisma, no SQL — the SQL expressions that share a
 * dictionary with these limits live in
 * `src/features/search/server/expressions.ts`, one layer down.
 */

/**
 * Trims, collapses every run of whitespace to one space, truncates to
 * `SEARCH_TERM_MAX_LENGTH` (R9/E11) and returns `null` when what is left
 * contains no letter and no digit (`/[\p{L}\p{N}]/u`) — the empty string, a
 * run of spaces, or pure punctuation (R6, E10).
 */
export function normalizeSearchTerm(raw: string): string | null {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  const truncated = collapsed.slice(0, SEARCH_TERM_MAX_LENGTH);
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

/**
 * F-021 (design.md A5, architecture.md § I7): clamps a 1-based page number
 * to `[1, STORE_SEARCH_MAX_PAGE]`. Absent, non-finite, zero or negative all
 * become 1 — never a raw value reaching SQL as an `OFFSET`.
 * `clampSearchLimit` is deliberately NOT reused/generalized here: F-021
 * fixes its own page size (`STORE_SEARCH_PAGE_SIZE`) and does not accept one
 * from the URL, so the two searches cannot drift into sharing a pagination
 * shape they were never meant to share.
 */
export function clampSearchPage(raw?: number): number {
  if (raw === undefined || !Number.isFinite(raw)) return 1;
  const truncated = Math.trunc(raw);
  return Math.min(STORE_SEARCH_MAX_PAGE, Math.max(1, truncated));
}
