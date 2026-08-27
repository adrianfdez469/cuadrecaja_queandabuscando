import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  MARKETPLACE_BACKFILL_BATCH_SIZE,
  MARKETPLACE_SEARCH_TS_CONFIG,
} from "@/constants/marketplace";

/**
 * The ONE place in the repo that writes `CanonicalProduct.searchVector`
 * (R1, R2) and the one place that composes `to_tsvector(...)` (guard G2,
 * `src/features/marketplace/server/boundaries.test.ts`).
 *
 * `searchVector` is `Unsupported("tsvector")`: Prisma's typed API cannot
 * read or write it, so this is raw SQL, and it is composed only with
 * `Prisma.sql` — never `$queryRawUnsafe`/`$executeRawUnsafe`, never string
 * interpolation of a person's text (R11, AGENTS.md § Prohibiciones).
 */

/** What the writer needs, so both `src/lib/prisma.ts`'s global client and the
 *  standalone `PrismaClient` that `prisma/seed.ts` and
 *  `scripts/backfill-search-vector.ts` construct satisfy it. */
export type SearchIndexWriter = Pick<PrismaClient, "$executeRaw">;

/** THE write expression (R2). Its only caller inside this module is
 *  `writeSearchDocument`; nothing outside this file may repeat it (G2). */
export const searchVectorOf = (document: string): Prisma.Sql =>
  Prisma.sql`to_tsvector(${MARKETPLACE_SEARCH_TS_CONFIG}::regconfig, unaccent(${document}))`;

/** THE query expression (R2, R3). Its twin: if one changes, so must
 *  the other. `plainto_tsquery` never throws on a person's text — that is
 *  what R3/E17/E18 require and `to_tsquery` cannot give. */
export const searchQueryOf = (term: string): Prisma.Sql =>
  Prisma.sql`plainto_tsquery(${MARKETPLACE_SEARCH_TS_CONFIG}::regconfig, unaccent(${term}))`;

/**
 * W1 (architecture.md § SQL): both columns, one round trip, so the pair
 * (document, vector) is never crossed between a document written by this
 * call and a vector left over from a previous one. The `WHERE` is what
 * makes a repeat delivery a 0-row no-op (E3, idempotency) — it does NOT
 * duplicate the stale-write guard, which lives before any call reaches this
 * function, in `src/features/sync/server/handlers/product.ts`'s
 * `return STALE` (E4).
 *
 * Returns the affected row count: 0 means "already exactly this" (E3).
 */
export async function writeSearchDocument(
  db: SearchIndexWriter,
  canonicalProductId: string,
  document: string,
): Promise<number> {
  return db.$executeRaw(Prisma.sql`
    UPDATE "CanonicalProduct"
       SET "searchDocument" = ${document},
           "searchVector"   = ${searchVectorOf(document)},
           "updatedAt"      = now()
     WHERE "id" = ${canonicalProductId}
       AND ("searchDocument" <> ${document} OR "searchVector" IS NULL)
  `);
}

/**
 * W2 (architecture.md § SQL): fills every row with `searchVector IS NULL`
 * from its own `searchDocument`, in batches of
 * `MARKETPLACE_BACKFILL_BATCH_SIZE` so no single statement holds a long
 * lock. `IS NULL`, not `searchDocument <> ''`: a row whose document is the
 * empty string (`@default("")`) still gets an empty, harmless `tsvector`
 * (E19), and R13's idempotency follows by construction — a row with a
 * vector never matches the `WHERE` of the next batch, so a second call
 * updates 0 rows (E20).
 */
export async function backfillSearchVectors(
  db: SearchIndexWriter & Pick<PrismaClient, "$queryRaw">,
): Promise<{ before: number; updated: number; after: number }> {
  const before = await countMissingSearchVector(db);

  let updated = 0;
  for (;;) {
    const affected = await db.$executeRaw(Prisma.sql`
      UPDATE "CanonicalProduct"
         SET "searchVector" = to_tsvector(${MARKETPLACE_SEARCH_TS_CONFIG}::regconfig, unaccent("searchDocument"))
       WHERE "id" IN (
               SELECT "id"
                 FROM "CanonicalProduct"
                WHERE "searchVector" IS NULL
                ORDER BY "id"
                LIMIT ${MARKETPLACE_BACKFILL_BATCH_SIZE}
             )
    `);
    updated += affected;
    if (affected === 0) break;
  }

  const after = await countMissingSearchVector(db);
  return { before, updated, after };
}

/** The row shape of `count(*)`: Postgres's `int8` arrives as `bigint` or as
 *  `string` depending on the driver path, never as a plain `number` — `any`
 *  is an ESLint error (AGENTS.md § Prohibiciones), so the conversion is
 *  explicit here rather than left implicit. */
type CountRow = { count: bigint | number | string };

async function countMissingSearchVector(db: Pick<PrismaClient, "$queryRaw">): Promise<number> {
  const rows = await db.$queryRaw<CountRow[]>(
    Prisma.sql`SELECT count(*) AS count FROM "CanonicalProduct" WHERE "searchVector" IS NULL`,
  );
  return Number(rows[0]?.count ?? 0);
}
