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
    adapter: new PrismaPg({ connectionString }),
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
