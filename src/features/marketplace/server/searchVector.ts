import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { MARKETPLACE_BACKFILL_BATCH_SIZE } from "@/constants/marketplace";
import { canonicalSearchVectorOf, searchQueryOf } from "@/features/search/server/expressions";

/**
 * The ONE place in the repo that writes `CanonicalProduct.searchVector`
 * (R1, R2). The pair of SQL expressions this used to compose directly moved
 * to `src/features/search/server/expressions.ts` (F-021 architecture.md
 * § I4): this module now IMPORTS them instead of defining them, and is no
 * longer the file guard G2 (`src/features/marketplace/server/
 * boundaries.test.ts`) points at.
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

/** Re-exported so this module's own callers (`search.ts`, this file,
 *  `dbFixtures.ts`) do not have to know the expression moved (F-021 I7: this
 *  file is not one of the ones that had to change its imports). */
export { searchQueryOf };

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
           "searchVector"   = ${canonicalSearchVectorOf(document)},
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
         SET "searchVector" = ${canonicalSearchVectorOf(Prisma.sql`"searchDocument"`)}
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
