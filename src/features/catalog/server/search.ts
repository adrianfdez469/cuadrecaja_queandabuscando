import { Prisma } from "@/generated/prisma/client";
import { StoreStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { clampSearchPage } from "@/lib/searchTerm";
import { searchQueryOf } from "@/features/search/server/expressions";
import {
  STORE_SEARCH_EXPANSION_MAX,
  STORE_SEARCH_LAYER_MAX,
  STORE_SEARCH_PAGE_SIZE,
  STORE_SEARCH_RANK_WEIGHTS,
} from "@/constants/storeSearch";
import { indexPromotions, type AppliedPromotion, type PromotionRow } from "@/lib/promotions";
import type { CatalogProduct } from "./queries";

/**
 * The store search read (F-021, architecture.md § SQL — Q1). Read-only, ONE
 * round trip for the three-layer query (`prisma.$queryRaw`), run in
 * parallel with the store's active promotions — never a `$transaction`
 * (AGENTS.md § Cosas que muerden: the pooler runs in transaction mode).
 *
 * `input.term` is assumed ALREADY normalized (`normalizeSearchTerm`) and
 * non-null: the caller (the page) is the one that decides E10 — a term that
 * normalizes to `null` never reaches this function, and never touches the
 * database (R6, R9).
 *
 * On a database failure this throws — no `catch` that returns `items: []`.
 * Disguising an unreachable database as "no results" is exactly what E17/R16
 * forbid.
 */

/** R1: 1 = lexical, 2 = fuzzy, 3 = category expansion. The order of
 *  `items` already respects this; the number is for the view to group and
 *  title, never to re-sort. */
export type StoreSearchLayer = 1 | 2 | 3;

/** EXACTLY what `ProductCard` already knows how to paint, plus the layer.
 *  Never a parallel interface (AGENTS.md § Prohibiciones). */
export type StoreSearchItem = CatalogProduct & { layer: StoreSearchLayer };

export type StoreSearchInput = {
  /** R6: mandatory, not a filter a caller could forget — a query without it
   *  does not compile. */
  storeId: string;
  /** Already normalized by `normalizeSearchTerm` (R9). */
  term: string;
  /** 1-based. Absent or out of range is clamped to `[1, STORE_SEARCH_MAX_PAGE]`
   *  by `clampSearchPage`, so a raw `p` never reaches SQL. Ignored when
   *  `mode` is `"all"`. */
  page?: number;
  /**
   * F-027 (architecture.md § La petición de /[slug]/buscar, punto 8).
   * `"page"` (the default): today's three-layer SQL `LIMIT`/`OFFSET`,
   * untouched — criterio 9 re-runs F-021's own criteria 1 and 2 down this
   * exact path. `"all"` pulls every candidate, bounded by construction to
   * `STORE_SEARCH_LAYER_MAX * 2 + STORE_SEARCH_EXPANSION_MAX` rows, and
   * never paginates in SQL: the caller (`applyCatalogFilters`) is the one
   * that filters, orders end-to-end and slices the page in memory.
   */
  mode?: "page" | "all";
};

export type StoreSearchResult = {
  /** The term this actually searched with — identical to `input.term`,
   *  returned so the caller has one value to show and to register (R9). */
  term: string;
  /** Already ordered by layer, score, name and id (R10). */
  items: StoreSearchItem[];
  /** Total of the three layers BEFORE paginating (R4: what gets registered). */
  totalCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

/**
 * The raw row of Q1. `totalCount` is cast `::int` in SQL, so it always
 * arrives a plain `number` — no `bigint`/`string` uncertainty to convert.
 *
 * Every OTHER column is nullable here on purpose: `totals LEFT JOIN page ON
 * TRUE` (see `buildStoreSearchSql`) guarantees `totalCount` even when the
 * requested page's own slice is empty (a page beyond the last one), and
 * that is exactly the row where every `page.*` column comes back `NULL`.
 * `isProductRow` below is the one place that tells the two shapes apart.
 */
type SearchRawRow = {
  id: string | null;
  slug: string | null;
  localName: string | null;
  description: string | null;
  imageUrls: string[] | null;
  availability: "OUT_OF_STOCK" | "LOW_STOCK" | "AVAILABLE" | null;
  featured: boolean | null;
  localCategoryId: string | null;
  syncedPrice: Prisma.Decimal | null;
  syncedPriceCurrency: string | null;
  priceOverride: Prisma.Decimal | null;
  priceOverrideCurrency: string | null;
  categoryName: string | null;
  /** F-026 (PP1): projected alongside `categoryName` from the SAME
   *  `LocalCategory` JOIN this CTE already had — no new join, no ranking
   *  change, no change to the three layers or the pagination. Only here so
   *  `CatalogProduct` (which `StoreSearchItem` extends) keeps one shape
   *  across its two readers (AGENTS.md § Prohibiciones: no duplicar
   *  interfaces). */
  categorySlug: string | null;
  /** F-027 (ADR 0025): the twin projection of `CatalogProduct.createdAt` in
   *  `src/features/catalog/server/queries.ts` — the mechanism that makes a
   *  recorte's new predicate a compile error in the OTHER reader if it is
   *  forgotten here. */
  createdAt: Date | null;
  canonicalDescription: string | null;
  canonicalImageUrl: string | null;
  layer: number | null;
  totalCount: number;
};

/** A row that really carries an offer, as opposed to the single
 *  placeholder row `totals LEFT JOIN page ON TRUE` returns when the page's
 *  own slice is empty. `any` is never used to get there (AGENTS.md §
 *  Prohibiciones): this is a real type guard, checked at runtime. */
type SearchProductRow = SearchRawRow & {
  id: string;
  slug: string;
  localName: string;
  imageUrls: string[];
  availability: "OUT_OF_STOCK" | "LOW_STOCK" | "AVAILABLE";
  featured: boolean;
  syncedPrice: Prisma.Decimal;
  syncedPriceCurrency: string;
  createdAt: Date;
  layer: number;
};

function isProductRow(row: SearchRawRow): row is SearchProductRow {
  return row.id !== null;
}

/**
 * Builds Q1 — the exact statement `searchStoreProducts` runs — WITHOUT
 * executing it. Exported ONLY so criterion 8's test
 * (`search.db.test.ts`) can wrap the SAME `Prisma.Sql` in
 * `EXPLAIN (FORMAT JSON)` instead of keeping a second, hand-copied SQL
 * string that could silently drift from what the code actually runs.
 */
/** F-027: the bound on how many candidates "all" mode can ever pull —
 *  `STORE_SEARCH_LAYER_MAX` twice (lexical + fuzzy) plus the category
 *  expansion, exactly the ceiling architecture.md § Decisión point 8
 *  measures against (424 today). Built from the SAME constants the three
 *  CTEs below already `LIMIT` by, never a number of its own. */
const ALL_CANDIDATES_LIMIT = STORE_SEARCH_LAYER_MAX * 2 + STORE_SEARCH_EXPANSION_MAX;

export function buildStoreSearchSql(input: {
  storeId: string;
  term: string;
  page: number;
  mode?: "page" | "all";
}): Prisma.Sql {
  const pageSize = input.mode === "all" ? ALL_CANDIDATES_LIMIT : STORE_SEARCH_PAGE_SIZE;
  const offset = input.mode === "all" ? 0 : (input.page - 1) * pageSize;

  // The twin expression of `storeProductSearchVectorOf` (R2): if one
  // changes, the other has to change too. Reused in `ts_rank` and in the
  // `@@` predicate, same pattern as the marketplace's own read.
  const query = searchQueryOf(input.term);
  const rankWeights = [...STORE_SEARCH_RANK_WEIGHTS];

  return Prisma.sql`
      WITH lex AS (
            SELECT sp."id",
                   1::int AS "layer",
                   ts_rank(${rankWeights}::float4[], sp."searchVector", ${query}) AS "score"
              FROM "StoreProduct" sp
              JOIN "Store" s ON s."id" = sp."storeId"
             WHERE sp."storeId"  = ${input.storeId}
               AND sp."deletedAt" IS NULL
               AND sp."visible"   = TRUE
               AND s."status"     = ${StoreStatus.PUBLISHED}::"StoreStatus"
               AND sp."searchVector" @@ ${query}
             ORDER BY "score" DESC, sp."localName" ASC, sp."id" ASC
             LIMIT ${STORE_SEARCH_LAYER_MAX}::int
      ),
      fuz AS (
            SELECT sp."id",
                   2::int AS "layer",
                   word_similarity(unaccent(${input.term}), sp."searchDocument") AS "score"
              FROM "StoreProduct" sp
              JOIN "Store" s ON s."id" = sp."storeId"
             WHERE sp."storeId"  = ${input.storeId}
               AND sp."deletedAt" IS NULL
               AND sp."visible"   = TRUE
               AND s."status"     = ${StoreStatus.PUBLISHED}::"StoreStatus"
               AND sp."searchDocument" %> unaccent(${input.term})
               AND sp."id" NOT IN (SELECT "id" FROM lex)
             ORDER BY "score" DESC, sp."localName" ASC, sp."id" ASC
             LIMIT ${STORE_SEARCH_LAYER_MAX}::int
      ),
      core AS (SELECT * FROM lex UNION ALL SELECT * FROM fuz),
      keys AS (
            SELECT DISTINCT
                   cp."globalCategoryId" AS "gid",
                   CASE WHEN cp."globalCategoryId" IS NULL THEN sp."localCategoryId" END AS "lid"
              FROM core c
              JOIN "StoreProduct" sp     ON sp."id" = c."id"
              JOIN "CanonicalProduct" cp ON cp."id" = sp."canonicalProductId"
      ),
      exp AS (
            SELECT sp."id", 3::int AS "layer", 0::float4 AS "score"
              FROM "StoreProduct" sp
              JOIN "Store" s             ON s."id"  = sp."storeId"
              JOIN "CanonicalProduct" cp ON cp."id" = sp."canonicalProductId"
             WHERE sp."storeId"  = ${input.storeId}
               AND sp."deletedAt" IS NULL
               AND sp."visible"   = TRUE
               AND s."status"     = ${StoreStatus.PUBLISHED}::"StoreStatus"
               AND sp."id" NOT IN (SELECT "id" FROM core)
               AND (
                    (cp."globalCategoryId" IS NOT NULL
                     AND cp."globalCategoryId" IN (SELECT "gid" FROM keys WHERE "gid" IS NOT NULL))
                 OR (cp."globalCategoryId" IS NULL
                     AND sp."localCategoryId" IN (SELECT "lid" FROM keys WHERE "lid" IS NOT NULL))
               )
             ORDER BY sp."featured" DESC, sp."localName" ASC, sp."id" ASC
             LIMIT ${STORE_SEARCH_EXPANSION_MAX}::int
      ),
      hits AS (SELECT * FROM core UNION ALL SELECT * FROM exp),
      -- The total BEFORE paginating (R4), computed once over \`hits\` —
      -- deliberately NOT \`count(*) OVER ()\` on the paginated rows below:
      -- that window function only ever appears on a row the LIMIT/OFFSET
      -- actually returns, so a page beyond the last one (0 rows) would
      -- report a total of 0 too, indistinguishable from "no matches at
      -- all" (E5 vs the "página fuera de rango" state, design.md §
      -- Inventario). \`totals\` always has exactly one row.
      totals AS (SELECT count(*)::int AS "totalCount" FROM hits),
      page AS (
            SELECT sp."id", sp."slug", sp."localName", sp."description", sp."imageUrls",
                   sp."availability", sp."featured", sp."localCategoryId",
                   sp."syncedPrice", sp."syncedPriceCurrency",
                   sp."priceOverride", sp."priceOverrideCurrency",
                   sp."createdAt",
                   lc."name"        AS "categoryName",
                   lc."slug"        AS "categorySlug",
                   cp."description" AS "canonicalDescription",
                   cp."imageUrl"    AS "canonicalImageUrl",
                   h."layer"
              FROM hits h
              JOIN "StoreProduct" sp     ON sp."id" = h."id"
              JOIN "CanonicalProduct" cp ON cp."id" = sp."canonicalProductId"
              LEFT JOIN "LocalCategory" lc ON lc."id" = sp."localCategoryId"
             ORDER BY h."layer" ASC, h."score" DESC, sp."localName" ASC, sp."id" ASC
             LIMIT ${pageSize}::int OFFSET ${offset}::int
      )
      -- \`totals\` LEFT JOIN \`page\`, never the other way round: \`totals\`
      -- always has its one row, so the total survives even when \`page\`
      -- returns none — the application layer tells the two apart by
      -- whether \`page."id"\` is null.
      SELECT page.*, totals."totalCount"
        FROM totals
        LEFT JOIN page ON TRUE
    `;
}

export async function searchStoreProducts(input: StoreSearchInput): Promise<StoreSearchResult> {
  const mode = input.mode ?? "page";
  const page = clampSearchPage(input.page);
  const pageSize = mode === "all" ? ALL_CANDIDATES_LIMIT : STORE_SEARCH_PAGE_SIZE;
  const offset = mode === "all" ? 0 : (page - 1) * pageSize;

  const [rows, promotionRows] = await Promise.all([
    prisma.$queryRaw<SearchRawRow[]>(buildStoreSearchSql({ ...input, page, mode })),
    // R28-style precedence (same as `loadCatalog`): read inside the SAME
    // parallel pass as the search, never a second, separately-cached lookup.
    prisma.promotion.findMany({
      where: { storeId: input.storeId, active: true },
      select: {
        id: true,
        type: true,
        scope: true,
        value: true,
        conditions: true,
        startsAt: true,
        endsAt: true,
        active: true,
      },
    }),
  ]);

  const promotionIndex = indexPromotions(
    promotionRows.map((row): PromotionRow => ({
      id: row.id,
      type: row.type,
      scope: row.scope,
      value: row.value.toString(),
      conditions: row.conditions,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      active: row.active,
    })),
    new Date(),
  );

  // `totals`' one row survives even when `page` (the paginated slice) is
  // empty — see `buildStoreSearchSql`. `rows[0]` always exists: `totals
  // LEFT JOIN page ON TRUE` never returns zero rows.
  const totalCount = rows[0]?.totalCount ?? 0;

  const items: StoreSearchItem[] = rows.filter(isProductRow).map((row) => {
    const promotions: readonly AppliedPromotion[] = promotionIndex.forProduct(
      row.id,
      row.localCategoryId,
    );
    return {
      id: row.id,
      slug: row.slug,
      name: row.localName,
      // The store's own copy wins; the canonical description is the
      // fallback — identical precedence to `loadCatalog` (R7's twin).
      description: row.description ?? row.canonicalDescription,
      imageUrls:
        row.imageUrls.length > 0
          ? row.imageUrls
          : row.canonicalImageUrl
            ? [row.canonicalImageUrl]
            : [],
      availability: row.availability,
      featured: row.featured,
      categoryName: row.categoryName,
      categorySlug: row.categorySlug,
      syncedPrice: row.syncedPrice.toString(),
      syncedPriceCurrency: row.syncedPriceCurrency,
      priceOverride: row.priceOverride?.toString() ?? null,
      priceOverrideCurrency: row.priceOverrideCurrency,
      createdAt: row.createdAt.toISOString(),
      promotions,
      layer: row.layer as StoreSearchLayer,
    };
  });

  return {
    term: input.term,
    items,
    totalCount,
    page,
    pageSize,
    hasMore: offset + items.length < totalCount,
  };
}
