import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A leaked connection per query only shows up under load, and the load that
 * found it was `next build` — three workers pre-rendering every product page
 * until Postgres answered P2037. What is cheap to assert here is the cause:
 * how many clients the module builds, not how many sockets they open.
 */
const constructed = vi.fn();

vi.mock("@/generated/prisma/client", () => ({
  PrismaClient: class {
    store = { findMany: () => Promise.resolve([]) };
    exchangeRate = { findMany: () => Promise.resolve([]) };
    constructor(options: unknown) {
      constructed(options);
    }
  },
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(readonly options: unknown) {}
  },
}));

const globalForPrisma = globalThis as unknown as { prisma: unknown };

beforeEach(() => {
  vi.resetModules();
  constructed.mockClear();
  globalForPrisma.prisma = undefined;
  vi.stubEnv("DATABASE_URL", "postgresql://user:pw@localhost:5432/db");
});

afterEach(() => {
  vi.unstubAllEnvs();
  globalForPrisma.prisma = undefined;
});

describe("prisma", () => {
  it("builds one client for many accesses in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { prisma } = await import("./prisma");

    await prisma.store.findMany();
    await prisma.exchangeRate.findMany();
    await prisma.store.findMany();

    expect(constructed).toHaveBeenCalledTimes(1);
  });

  it("does not park the client on globalThis in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { prisma } = await import("./prisma");

    await prisma.store.findMany();

    expect(globalForPrisma.prisma).toBeUndefined();
  });

  it("reuses the client a previous module copy left on globalThis in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const first = await import("./prisma");
    await first.prisma.store.findMany();
    expect(globalForPrisma.prisma).toBeDefined();

    // What a hot reload does: a fresh copy of the module, same process.
    vi.resetModules();
    const second = await import("./prisma");
    await second.prisma.store.findMany();

    expect(constructed).toHaveBeenCalledTimes(1);
  });

  it("caps the underlying pool so parallel build workers cannot exhaust Postgres", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { prisma } = await import("./prisma");

    await prisma.store.findMany();

    const { adapter } = constructed.mock.calls[0][0] as { adapter: { options: { max: number } } };
    expect(adapter.options.max).toBe(5);
  });

  it("does not construct anything at import time", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await import("./prisma");

    expect(constructed).not.toHaveBeenCalled();
  });

  it("fails loudly when DATABASE_URL is absent, and only on first use", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { prisma } = await import("./prisma");

    expect(() => prisma.store).toThrow(/DATABASE_URL/);
  });
});
