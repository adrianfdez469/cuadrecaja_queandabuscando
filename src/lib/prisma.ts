import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Single Prisma instance, cached on globalThis outside production so hot reload
 * does not exhaust the connection pool.
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
 * (and so its own pool) — with no cap, enough concurrent product pages
 * (F-017's `generateStaticParams` resolves a branch, then loads it, per
 * page) exhaust the LOCAL dev Postgres's `max_connections` (100, no
 * pooler in front of it) with `P2037 TooManyConnections` (ficha
 * `prisma-p2037-too-many-connections-build-static-params`). Production
 * runs behind Supavisor's own pooler, so this cap is a floor either way,
 * never a bottleneck a single request would notice.
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

function client(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const created = createClient();
    if (process.env.NODE_ENV === "production") return created;
    globalForPrisma.prisma = created;
  }
  return globalForPrisma.prisma;
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
