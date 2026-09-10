// Loaded explicitly, like prisma/seed.ts: `tsx` does not go through
// prisma.config.ts.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { seedZoneCatalog } from "../src/features/zones/server/catalogSeed";

/**
 * F-041 (I8): the PRODUCTION entry point for the zone catalog. `prisma/seed.ts`
 * is development-only data and never runs in production; the zone catalog
 * is reference data every environment needs before a single `ZONE_TARIFF`
 * can be applied (caso límite 15) — so it gets its own script, run by hand
 * once per environment, documented in `docs/despliegue.md` § 1.
 *
 *   npx tsx scripts/seed-zone-catalog.ts   # via `npm run seed:zones`
 *
 * Idempotent (R9, criterio 11): running this twice leaves the same 184 rows
 * and the same version — the CI already proves this by running `npm run
 * seed` (which calls `seedZoneCatalog` too) twice.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set — see .env.example");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

seedZoneCatalog(prisma)
  .then((result) => {
    console.log("Zone catalog seeded:", result);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
