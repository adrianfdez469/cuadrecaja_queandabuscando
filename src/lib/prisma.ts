import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Single Prisma instance for the whole process, additionally parked on
 * globalThis outside production so hot reload does not exhaust the pool.
 *
 * Construction is lazy. Importing this module must not throw when DATABASE_URL
 * is absent: `next build` imports every route module to collect metadata, and a
 * build should fail on a real problem, not on the absence of a database it may
 * legitimately not need to reach.
 *
 * Prisma 7 connects through a driver adapter rather than a datasource URL. The
 * runtime uses DATABASE_URL (Supavisor pooler, transaction mode); migrations
 * use DIRECT_URL via prisma.config.ts, because DDL cannot run through a pooler.
 *
 * Transaction mode has a consequence that bites: no query may run on this
 * global client from inside a `$transaction` callback — it deadlocks against
 * the pooled connection. Batch writes into a single round-trip instead.
 *
 * `max: 5` on the underlying `pg.Pool`: `next build`'s static generation
 * spawns several worker processes in parallel, each with its OWN client
 * (and so its own pool), and every pre-rendered page queries. The cap
 * bounds what one worker can hold, so the build stays well under
 * Postgres's `max_connections` (100 by default, both on the dev database
 * and on CI's `postgres:16` service) instead of scaling with page count.
 * Production runs behind Supavisor's own pooler, so this cap is a floor
 * either way, never a bottleneck a single request would notice.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — see .env.example");
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: 5 }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

/**
 * The cache has to live in module scope, not only on globalThis: returning a
 * freshly constructed client in production made EVERY property access below
 * build its own `PrismaClient` — and so its own `pg.Pool`, which opens a
 * connection on first query and never closes it. One leaked connection per
 * query is invisible in a request that runs a handful of them, and fatal in
 * `next build`, where three workers pre-render every product page until
 * Postgres answers `P2037 TooManyConnections` (ficha
 * `prisma-p2037-too-many-connections-build-static-params`).
 */
let cached: PrismaClient | undefined;

function client(): PrismaClient {
  cached ??= globalForPrisma.prisma ?? createClient();
  // Outside production the same instance also goes on globalThis, so the
  // next hot-reloaded copy of this module reuses it instead of adding a pool.
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = cached;
  return cached;
}

/**
 * Proxy so that `prisma.store.findMany(...)` constructs the real client on
 * first property access rather than at import time.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(client(), property, receiver);
  },
});
