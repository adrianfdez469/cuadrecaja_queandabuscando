// Loaded ONLY by the `db` vitest project (vitest.config.mts), never
// globally: `src/lib/prisma.test.ts` stubs `DATABASE_URL` on purpose, and a
// global `dotenv/config` would shadow what that test checks. In CI there is
// no `.env` and dotenv never overrides an already-set variable, so the
// workflow's own env wins there.
import "dotenv/config";
import { Client } from "pg";
import { afterAll, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { sweepStaleFixtures } from "@/features/marketplace/server/dbFixtures";

/**
 * The precondition is noisy, never a skip (F-015 plan.md PP1, architecture.md
 * § Pruebas contra Postgres real, decision 3): `it.skip` or an opt-out flag
 * would let this whole suite disappear from `verify.sh` while it still exits
 * 0 — a green skip is exactly the invisible pass the spec forbids. So this
 * throws, with the exact command to fix it, and every `*.db.test.ts` file in
 * this project fails loudly instead of quietly not running.
 */
const FIX_COMMAND = "docker compose up -d postgres && npm run db:deploy";

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(`DB TEST SETUP: DATABASE_URL is not set — run: ${FIX_COMMAND}`);
  }

  const probe = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await probe.connect();
    await probe.query("SELECT 1");
    const { rows } = await probe.query<{ regclass: string | null }>(
      `SELECT to_regclass('"CanonicalProduct"') AS regclass`,
    );
    if (!rows[0]?.regclass) {
      throw new Error(
        `DB TEST SETUP: schema is not migrated ("CanonicalProduct" does not exist) — run: ${FIX_COMMAND}`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("DB TEST SETUP")) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`DB TEST SETUP: Postgres unreachable (${message}) — run: ${FIX_COMMAND}`);
  } finally {
    await probe.end().catch(() => {});
  }

  // Restos de una ejecución muerta antes de que este archivo cree las suyas.
  await sweepStaleFixtures();
});

afterAll(async () => {
  // Swallowed on purpose: when `beforeAll` already threw (no DATABASE_URL,
  // unreachable Postgres), touching `prisma.$disconnect` here throws AGAIN,
  // and synchronously — `src/lib/prisma.ts`'s Proxy constructs the lazy
  // client on this very property access, before any Promise exists to
  // `.catch()`. That second, unrelated error would bury the real one
  // `beforeAll` already reported. The suite is failing either way.
  try {
    await prisma.$disconnect();
  } catch {
    // See above: only reachable when the DB was never reachable to begin
    // with, in which case there is nothing to disconnect from.
  }
});
