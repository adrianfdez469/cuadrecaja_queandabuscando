import { Prisma } from "@/generated/prisma/client";
import { Availability, StoreStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { clampSearchLimit, clampSearchOffset, normalizeSearchTerm } from "@/lib/searchTerm";
import { searchQueryOf } from "./searchVector";

/**
 * The marketplace search read (F-015, architecture.md § SQL Q1). Read-only,
 * one round trip: `prisma.$queryRaw`, no `$transaction`
 * (AGENTS.md § Cosas que muerden — the pooler runs in transaction mode).
 *
 * No caller yet (SP-H1): the screen that will use this is a future feature.
 * Nothing here goes through `src/lib/cache.ts` (R12).
 *
 * On a database failure this throws — no `catch` that returns `items: []`.
 * Disguising an unreachable database as "no results" is the antipattern the
 * spec explicitly forbids.
 */

export type MarketplaceSearchInput = {
  term: string;
  /** Defaults to `false` (R5, SP-H2): off, every non-exclusive canonical
   *  shows up, whether or not it has a live offer. */
  onlyWithLiveOffer?: boolean;
  /** Defaults to 20, clamped to [1, 50] (`clampSearchLimit`). */
  limit?: number;
  /** Defaults to 0, clamped to >= 0 (`clampSearchOffset`). */
  offset?: number;
};

export type MarketplaceSearchItem = {
  canonicalProductId: string;
  /** The canonical's own name, never a store's `localName`. */
  name: string;
  imageUrl: string | null;
  /** LIVE offers (R10). `number`, never `bigint` or `string`. */
  storeCount: number;
};

export type MarketplaceSearchResult = {
  items: MarketplaceSearchItem[];
  hasMore: boolean;
};

/** The raw row. `any` is an ESLint error (AGENTS.md § Prohibiciones), and
 *  `count(*)` is `int8`: the driver delivers it as `bigint` or as `string`
 *  depending on the path, so the type admits all three shapes and the
 *  conversion to `MarketplaceSearchItem.storeCount` is explicit. */
type SearchRawRow = {
  canonicalProductId: string;
  name: string;
  imageUrl: string | null;
  rank: number;
  storeCount: bigint | number | string;
};

export async function searchCanonicalProducts(
  input: MarketplaceSearchInput,
): Promise<MarketplaceSearchResult> {
  // R6, E15: no full marketplace listing in F-015 — a term with no letter
  // or digit returns empty without touching the database.
  const term = normalizeSearchTerm(input.term);
  if (term === null) return { items: [], hasMore: false };

  const limit = clampSearchLimit(input.limit);
  const offset = clampSearchOffset(input.offset);
  const onlyWithLiveOffer = input.onlyWithLiveOffer ?? false;

  // The twin expression of `searchVectorOf` (R2): if one changes, the other
  // has to change too. Reused as-is in `ts_rank` and in the `@@`.
  const query = searchQueryOf(term);

  const rows = await prisma.$queryRaw<SearchRawRow[]>(Prisma.sql`
    SELECT m.*
      FROM (
            SELECT c."id"       AS "canonicalProductId",
                   c."name"     AS "name",
                   c."imageUrl" AS "imageUrl",
                   ts_rank(c."searchVector", ${query}) AS "rank",
                   (
                     SELECT count(*)
                       FROM "StoreProduct" sp
                       JOIN "Store" s ON s."id" = sp."storeId"
                      WHERE sp."canonicalProductId" = c."id"
                        AND sp."deletedAt" IS NULL
                        AND sp."visible" = TRUE
                        -- SQL twin of isOrderable (src/lib/availability.ts):
                        -- if one changes, the other has to change too (R5).
                        AND sp."availability" <> ${Availability.OUT_OF_STOCK}::"Availability"
                        AND s."status" = ${StoreStatus.PUBLISHED}::"StoreStatus"
                   ) AS "storeCount"
              FROM "CanonicalProduct" c
             WHERE c."isExclusive" = FALSE
               -- Against the "searchVector" COLUMN, not an expression
               -- recomputed here: that would leave the GIN index unused
               -- (guard G4, C10).
               AND c."searchVector" @@ ${query}
           ) m
     WHERE ${onlyWithLiveOffer}::boolean = FALSE OR m."storeCount" > 0
     -- Total order (R8): rank, availability, name, id — so pagination
     -- never repeats or skips a row (E21).
     ORDER BY m."rank" DESC,
              (m."storeCount" > 0) DESC,
              m."name" ASC,
              m."canonicalProductId" ASC
     LIMIT ${limit + 1}::int OFFSET ${offset}::int
  `);

  // One extra row instead of a separate COUNT(*): hasMore without doubling
  // the cost of the query.
  const hasMore = rows.length > limit;
  const items: MarketplaceSearchItem[] = rows.slice(0, limit).map((row) => ({
    canonicalProductId: row.canonicalProductId,
    name: row.name,
    imageUrl: row.imageUrl,
    storeCount: Number(row.storeCount),
  }));

  return { items, hasMore };
}
