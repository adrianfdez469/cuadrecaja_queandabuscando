// Loaded explicitly, like prisma/seed.ts: `tsx` does not go through
// prisma.config.ts.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../src/generated/prisma/client";
import { backfillSearchVectors } from "../src/features/marketplace/server/searchVector";

/**
 * Backfills `CanonicalProduct.searchVector` for rows synced before F-015
 * existed (`searchDocument` filled in, `searchVector` still NULL). Runs the
 * same batched UPDATE (W2, architecture.md § SQL) the data migration
 * (`prisma/migrations/*_backfill_search_vector/migration.sql`) runs once —
 * this is what a developer runs locally instead, per PP2: the migration is
 * NOT applied against the shared local database, only against an empty one
 * (CI's `prisma migrate deploy`).
 *
 * Idempotent (R13): a second run always reports `updated: 0`.
 *
 *   npx tsx scripts/backfill-search-vector.ts           # backfills
 *   npx tsx scripts/backfill-search-vector.ts --check    # counts only, no write
 *
 * `--check` is also how C1, C5 and C6 are verified without `psql`, which is
 * not on this machine's PATH (spec.md § Criterios, note under C1): it prints
 * BOTH counts the spec names — rows with a real document still unindexed
 * (C5's "before"), and every row with a NULL vector regardless of document
 * (C6, which also covers the empty-document case, E19).
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set — see .env.example");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

type CountRow = { count: bigint | number | string };

async function printCheckCounts(): Promise<void> {
  const [withDocument] = await prisma.$queryRaw<CountRow[]>(
    Prisma.sql`SELECT count(*) AS count FROM "CanonicalProduct" WHERE "searchDocument" <> '' AND "searchVector" IS NULL`,
  );
  const [anyMissing] = await prisma.$queryRaw<CountRow[]>(
    Prisma.sql`SELECT count(*) AS count FROM "CanonicalProduct" WHERE "searchVector" IS NULL`,
  );
  console.log(`searchDocument <> '' AND searchVector IS NULL: ${Number(withDocument?.count ?? 0)}`);
  console.log(`searchVector IS NULL: ${Number(anyMissing?.count ?? 0)}`);
}

async function main(): Promise<void> {
  if (process.argv.includes("--check")) {
    await printCheckCounts();
    return;
  }

  const result = await backfillSearchVectors(prisma);
  console.log(`before=${result.before} updated=${result.updated} after=${result.after}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
