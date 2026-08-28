// Loaded explicitly, like prisma/seed.ts: `tsx` does not go through
// prisma.config.ts.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { mintSyncToken } from "../src/lib/syncAuth";
import { isUniqueViolation } from "../src/features/orders/server/prismaErrors";

/**
 * Mints or rotates the per-business bearer token for /api/internal/*
 * (F-018, HD4). Uses the SAME `mintSyncToken` the guard's own module
 * exports (`src/lib/syncAuth.ts`) — not a reimplementation (PP2) — so a
 * token minted here is guaranteed to hash the same way the guard checks it.
 *
 * The plaintext token is printed ONCE, to stdout, and never stored anywhere
 * (R11): only its SHA-256 goes into `Business.syncTokenHash`.
 *
 *   npx tsx scripts/mint-sync-token.ts <externalId>   # via `npm run mint:token -- <externalId>`
 *
 * - `<externalId>` unknown: creates the Business with that externalId (E23).
 * - `<externalId>` known: rotates its token — the old one stops resolving
 *   immediately, and no other business is touched (E24, E25).
 * - A minted hash that collides (P2002 on the `@unique` index) aborts with a
 *   clear message and mints nothing — the business is left exactly as it
 *   was; re-running acuña a different random token.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set — see .env.example");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main(): Promise<void> {
  const externalId = process.argv[2];
  if (!externalId) {
    console.error("Usage: npx tsx scripts/mint-sync-token.ts <externalId>");
    process.exit(1);
  }

  const { token, hash } = mintSyncToken();

  try {
    const business = await prisma.business.upsert({
      where: { externalId },
      create: { externalId, name: externalId, syncTokenHash: hash },
      update: { syncTokenHash: hash },
      select: { id: true, externalId: true },
    });

    console.log(`Business ${business.externalId} (${business.id})`);
    console.log(`Token (save it now — it will not be shown again):`);
    console.log(token);
  } catch (error) {
    if (isUniqueViolation(error, "syncTokenHash")) {
      console.error(
        "The minted token collided with an existing hash. Nothing was changed — run this again.",
      );
      process.exit(1);
    }
    throw error;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
