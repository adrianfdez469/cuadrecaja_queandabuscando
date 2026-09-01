import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { REALTIME_BELL_WINDOW_MS } from "@/constants/realtime";
import {
  createFixtureSession,
  type FixtureSession,
} from "@/features/marketplace/server/dbFixtures";
import { claimBell, closeBellWindow, ringOrderBell } from "./bell";

/**
 * `claimBell`/`closeBellWindow` against a real Postgres (architecture.md
 * DA3, § "Cómo se verifica que NO es memoria de proceso"). This is the ONLY
 * test that can catch I5: a `Map` at module scope would return `ring` for
 * case 1 below (its memory starts empty every time the module is imported
 * fresh), because it never sees a window opened by a write this SAME
 * process never made. `bell.test.ts`'s static guardian is the cheap
 * complement, not a substitute — it only proves the shortcut was never
 * typed, not that the SQL is correct.
 */
describe("claimBell/closeBellWindow — Postgres real, coalescence measured from outside the process", () => {
  let session: FixtureSession;

  beforeAll(async () => {
    session = await createFixtureSession();
  });

  afterAll(async () => {
    await session.cleanup();
  });

  it("case 1 — a window opened with raw SQL (never through this process) is seen as first_defer, not ring", async () => {
    // Writes the row directly, bypassing claimBell entirely — this is what a
    // module-scope Map could never see.
    await prisma.$executeRaw`
      INSERT INTO "OrderBellWindow" ("businessId", "windowStartedAt", "pendingSince")
      VALUES (${session.businessId}, now(), NULL)
    `;

    const claim = await claimBell(session.businessId);

    // A `Map` implementation, with an empty in-memory cache, would return
    // "ring" here — that is exactly the regression this case exists to catch.
    expect(claim.kind).toBe("first_defer");
  });

  it("case 2 — a close reclaimed with raw SQL fires once, then never again for the same window", async () => {
    const businessId = session.businessId;
    await prisma.$executeRaw`
      INSERT INTO "OrderBellWindow" ("businessId", "windowStartedAt", "pendingSince")
      VALUES (${businessId}, now() - interval '6 seconds', now())
      ON CONFLICT ("businessId") DO UPDATE
         SET "windowStartedAt" = now() - interval '6 seconds',
             "pendingSince"    = now()
    `;

    const first = await closeBellWindow(businessId);
    expect(first).toBe(true);

    const second = await closeBellWindow(businessId);
    expect(second).toBe(false);
  });

  it("case 2b — E8: closing renews windowStartedAt, opening the next window at that same instant", async () => {
    const businessId = session.businessId;
    await prisma.$executeRaw`
      INSERT INTO "OrderBellWindow" ("businessId", "windowStartedAt", "pendingSince")
      VALUES (${businessId}, now() - interval '6 seconds', now())
      ON CONFLICT ("businessId") DO UPDATE
         SET "windowStartedAt" = now() - interval '6 seconds',
             "pendingSince"    = now()
    `;
    const before = await prisma.orderBellWindow.findUniqueOrThrow({
      where: { businessId },
      select: { windowStartedAt: true },
    });

    await closeBellWindow(businessId);

    const row = await prisma.orderBellWindow.findUniqueOrThrow({
      where: { businessId },
      select: { windowStartedAt: true, pendingSince: true },
    });
    expect(row.pendingSince).toBeNull();
    // Compared against Postgres's OWN prior value, never the test process's
    // `Date.now()` (a cross-process wall-clock comparison is what made this
    // flaky — the container's clock can trail the host's by tens of ms).
    expect(row.windowStartedAt.getTime()).toBeGreaterThan(before.windowStartedAt.getTime());
  });

  describe("case 3 — real concurrency across two independent PrismaClients (two connections, like two instances)", () => {
    let clientA: PrismaClient;
    let clientB: PrismaClient;

    beforeAll(() => {
      const connectionString = process.env.DATABASE_URL as string;
      clientA = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
      clientB = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    });

    afterAll(async () => {
      await clientA.$disconnect();
      await clientB.$disconnect();
    });

    it("ten claimBell in Promise.all, split over two clients, yield exactly one ring and one first_defer", async () => {
      const businessId = session.businessId;
      // A fresh window: nothing pending from a previous case in this file.
      await prisma.$executeRaw`
        INSERT INTO "OrderBellWindow" ("businessId", "windowStartedAt", "pendingSince")
        VALUES (${businessId}, now() - interval '1 hour', NULL)
        ON CONFLICT ("businessId") DO UPDATE
           SET "windowStartedAt" = now() - interval '1 hour',
               "pendingSince"    = NULL
      `;

      const calls = Array.from({ length: 10 }, (_, i) =>
        claimBell(businessId, i % 2 === 0 ? clientA : clientB),
      );
      const results = await Promise.all(calls);

      const rings = results.filter((r) => r.kind === "ring").length;
      const firstDefers = results.filter((r) => r.kind === "first_defer").length;
      const defers = results.filter((r) => r.kind === "defer").length;

      expect(rings).toBe(1);
      expect(firstDefers).toBe(1);
      expect(defers).toBe(8);
    });
  });

  describe("E9 — an event at 4.9s of an open window is not lost: it is covered by the close bell", () => {
    it("closeBellWindow only fires once windowStartedAt + REALTIME_BELL_WINDOW_MS has actually elapsed", async () => {
      const businessId = session.businessId;
      // A window that opened just under the threshold — closing must NOT
      // fire yet (there are still a few ms left in the 5s window).
      await prisma.$executeRaw`
        INSERT INTO "OrderBellWindow" ("businessId", "windowStartedAt", "pendingSince")
        VALUES (${businessId}, now() - (${REALTIME_BELL_WINDOW_MS - 500}::numeric * interval '1 millisecond'), now())
        ON CONFLICT ("businessId") DO UPDATE
           SET "windowStartedAt" = now() - (${REALTIME_BELL_WINDOW_MS - 500}::numeric * interval '1 millisecond'),
               "pendingSince"    = now()
      `;

      const tooEarly = await closeBellWindow(businessId);
      expect(tooEarly).toBe(false);

      // Advance the window fully past the threshold, then close for real.
      await prisma.$executeRaw`
        UPDATE "OrderBellWindow"
           SET "windowStartedAt" = now() - (${REALTIME_BELL_WINDOW_MS + 100}::numeric * interval '1 millisecond')
         WHERE "businessId" = ${businessId}
      `;
      const onTime = await closeBellWindow(businessId);
      expect(onTime).toBe(true);
    });
  });

  describe("ringOrderBell — el camino real end-to-end (ficha realtime-bell-close-clock-skew)", () => {
    // Real wall-clock time: the second call below actually sleeps through
    // REALTIME_BELL_WINDOW_MS before this resolves. Comfortably inside the
    // `db` project's 20s testTimeout (vitest.config.mts).
    it("el segundo evento de una ventana viva cierra solo, sin ayuda de SQL manual", async () => {
      const businessId = session.businessId;
      await prisma.$executeRaw`DELETE FROM "OrderBellWindow" WHERE "businessId" = ${businessId}`;

      // First call: no window yet -> "ring". Resolves almost instantly.
      await ringOrderBell(businessId);

      // Second call, still inside the window -> "first_defer". This is the
      // call that sleeps against Node's clock and then asks Postgres,
      // whose clock decides for real (architecture.md DA3) — the exact
      // path REALTIME_BELL_CLOSE_MARGIN_MS exists to make land safely.
      await ringOrderBell(businessId);

      const row = await prisma.orderBellWindow.findUniqueOrThrow({
        where: { businessId },
        select: { pendingSince: true },
      });
      // Without the margin this stayed non-null forever — the row itself
      // is the assertion that the close actually reached Postgres, not
      // just that the promise resolved.
      expect(row.pendingSince).toBeNull();
    });
  });
});
