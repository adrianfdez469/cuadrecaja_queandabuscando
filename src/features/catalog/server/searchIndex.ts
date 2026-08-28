import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { SEARCH_DOCUMENT_SEPARATOR } from "@/constants/search";
import { storeProductSearchVectorOf } from "@/features/search/server/expressions";

/**
 * The derived search index of a `StoreProduct` (F-021 architecture.md §
 * Decisión, point 1): a THIRD kind of column ownership, next to "owned by
 * the sync" and "owned by the admin panel" in `prisma/schema.prisma`.
 * Neither side writes `searchDocument`/`searchVector` in its own typed
 * `data: { … }` — both call one of the two functions below AFTER their own
 * write, and this module recomputes the columns by READING the row's
 * current state, never by receiving text. That is what makes it impossible
 * for the sync to overwrite `description` (it never touches it — it reads
 * it) or for the panel to overwrite `localName` (same reasoning), closing
 * R3 by construction rather than by discipline (docs/adr/0007,
 * docs/adr/0017, extended by docs/adr/0021).
 *
 * `Prisma.sql` only, one round trip, both columns in the SAME `UPDATE` so
 * the pair (document, vector) is never left crossed between calls — the
 * same property ADR 0019 (b) established for the canonical's own writer
 * (`src/features/marketplace/server/searchVector.ts`). The `WHERE` on the
 * outer `UPDATE` (`IS DISTINCT FROM` / `IS NULL`) is what makes a repeat
 * call a 0-row no-op (idempotency) — it does NOT duplicate the stale-write
 * guard, which lives before any call reaches this module, in
 * `src/features/sync/server/handlers/product.ts`'s `return STALE`.
 */

/** What the writer needs, so both `src/lib/prisma.ts`'s global client and
 *  the standalone `PrismaClient` `prisma/seed.ts` constructs satisfy it. */
export type SearchIndexWriter = Pick<PrismaClient, "$executeRaw">;

/** W3 (architecture.md § SQL): recomputes documento + vector for every
 *  `StoreProduct` row matched by `selector`, in one statement. Shared by
 *  the two exported functions below — `selector` is the only thing that
 *  differs between "one row" and "every offer of a canonical for a
 *  business". */
async function reindex(db: SearchIndexWriter, selector: Prisma.Sql): Promise<number> {
  return db.$executeRaw(Prisma.sql`
    UPDATE "StoreProduct" sp
       SET "searchDocument" = d."doc",
           "searchVector"   = ${storeProductSearchVectorOf({
             namePart: Prisma.sql`d."namePart"`,
             aliasPart: Prisma.sql`d."aliasPart"`,
             descPart: Prisma.sql`d."descPart"`,
           })}
      FROM (
            SELECT x."id",
                   x."localName"                  AS "namePart",
                   coalesce(a."texts", '')        AS "aliasPart",
                   coalesce(x."description", '')  AS "descPart",
                   unaccent(concat_ws(${SEARCH_DOCUMENT_SEPARATOR},
                              x."localName",
                              coalesce(a."texts", ''),
                              coalesce(x."description", ''))) AS "doc"
              FROM "StoreProduct" x
              JOIN "Store" s ON s."id" = x."storeId"
              LEFT JOIN LATERAL (
                     SELECT string_agg(DISTINCT al."text", ${SEARCH_DOCUMENT_SEPARATOR} ORDER BY al."text") AS "texts"
                       FROM "ProductAlias" al
                      WHERE al."canonicalProductId" = x."canonicalProductId"
                        AND al."businessId"         = s."businessId"
                   ) a ON TRUE
             WHERE ${selector}
           ) d
     WHERE sp."id" = d."id"
       AND (sp."searchDocument" IS DISTINCT FROM d."doc" OR sp."searchVector" IS NULL)
  `);
}

/**
 * Recomputes documento + vector of ONE offer from its current state (R2,
 * R3). Called by the admin panel's `saveProduct`, after its own typed
 * update, and by `prisma/seed.ts` right after seeding an offer. Returns the
 * affected row count: 0 means "already exactly this" (idempotency).
 */
export function reindexStoreProduct(
  db: SearchIndexWriter,
  storeProductId: string,
): Promise<number> {
  return reindex(db, Prisma.sql`x."id" = ${storeProductId}`);
}

/**
 * Recomputes documento + vector of EVERY offer of `canonicalProductId`
 * belonging to `businessId` — the fan-out a new alias opens (R2): every
 * sibling offer of that business just inherited the alias, so every one of
 * them needs its document recomputed, not just the one the sync happened
 * to be processing. Called from the sync's `handleProduct`, after
 * `recordAlias`, never on the `STALE`/soft-delete paths (both return
 * earlier in the handler).
 */
export function reindexStoreProductsOfCanonical(
  db: SearchIndexWriter,
  canonicalProductId: string,
  businessId: string,
): Promise<number> {
  return reindex(
    db,
    Prisma.sql`x."canonicalProductId" = ${canonicalProductId} AND s."businessId" = ${businessId}`,
  );
}

/**
 * Recomputes documento + vector of EVERY offer of ONE store, in a single
 * round trip — used by `createFillerOffers`
 * (`src/features/marketplace/server/dbFixtures.ts`, SP4) to reindex a bulk
 * `createMany` batch of filler rows that each carry their OWN throwaway
 * canonical: `StoreProduct`'s `@@unique([storeId, canonicalProductId])`
 * means a single store can never hold two offers of the same canonical, so
 * a volume fixture confined to one store cannot share one canonical the way
 * `reindexStoreProductsOfCanonical`'s fan-out assumes. Idempotent like its
 * siblings: re-running it over offers that are already indexed affects 0
 * rows.
 */
export function reindexStoreProductsOfStore(
  db: SearchIndexWriter,
  storeId: string,
): Promise<number> {
  return reindex(db, Prisma.sql`x."storeId" = ${storeId}`);
}
