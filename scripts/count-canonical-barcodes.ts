// Loaded explicitly, like prisma/seed.ts: `tsx` does not go through
// prisma.config.ts.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  countCanonicalBarcodeStats,
  formatCanonicalBarcodeStats,
} from "../src/features/sync/server/canonicalBarcodes";

/**
 * F-024, criterio 6: how many canonicals carry more than one barcode, and
 * how many carry barcodes and live offers from more than one business — the
 * number that decides, in a future feature, whether the "concentrator
 * nodes" graph (`.agent/specs/propuestas/canonico-fusionado-por-ean-sucio.md`)
 * gets built or archived.
 *
 * Calcado de scripts/backfill-search-vector.ts: its own `PrismaClient` (not
 * `src/lib/prisma.ts`, which assumes a Next.js runtime), explicit dotenv,
 * `process.exit(1)` only if the query itself blows up, `$disconnect()` in
 * `finally`.
 *
 *   npx tsx scripts/count-canonical-barcodes.ts
 *
 * SP2 (spec.md, resolved by the human 2026-08-28): with no live integration
 * yet (HD5), this runs against the seed/fixtures — the fourth and fifth
 * figures being `0` there is expected, not a failure. The literal output is
 * pasted into `.agent/specs/F-024/tests.md` by hand; this script does not
 * write that file.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set — see .env.example");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main(): Promise<void> {
  const stats = await countCanonicalBarcodeStats(prisma);
  console.log(formatCanonicalBarcodeStats(stats));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
