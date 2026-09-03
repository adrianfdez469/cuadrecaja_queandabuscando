import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createFixtureSession,
  type FixtureSession,
} from "@/features/marketplace/server/dbFixtures";
import { STORE_TIMEZONE_INVALID } from "@/constants/sync";

/**
 * F-022 AC1/spec.md § Criterios de aceptación, AC1: "publicar una tienda sin
 * timezone falla" is not reachable through the app — the column is `NOT
 * NULL DEFAULT 'America/Havana'`, so nobody, neither the panel nor the sync,
 * can produce a row without one. Per plan.md § Riesgos y plan B and spec.md
 * I1, what this file demonstrates instead is that THE GATE EXISTS: forcing
 * the column to a value this runtime cannot read (by raw SQL — the one way
 * to reach that state at all) and confirming both writers of
 * `status: "PUBLISHED"` refuse to publish over it, and refuse SAFELY (a
 * failed event, never `ok` — AGENTS.md § "un evento fallido NO es un
 * duplicado").
 *
 * The third leg of AC1 (both writers call the SAME predicate) is a static
 * check and lives in `src/lib/boundaries.test.ts`, not here.
 *
 * `next/cache`'s `revalidateTag` needs a request-scoped "static generation
 * store" that only exists inside a running Next server (`next dev`/`next
 * start`) — calling the real route handler or `setStoreEnabled` directly
 * from Vitest throws `Invariant: static generation store missing`, an
 * artifact of the test harness, not of the code under test (cache
 * invalidation itself is covered elsewhere, mocked, in
 * `processBatch.test.ts` and `mutations.test.ts`). Stubbed here the same way
 * `src/lib/cache.test.ts` and `src/features/storefront/server/resolve.test.ts`
 * already stub it — a passthrough for `unstable_cache`, a spy for
 * `revalidateTag` — so this file can stay focused on what only Postgres can
 * prove: the gate's real `UPDATE`s and the real row they leave behind.
 */
vi.mock("next/cache", () => ({
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

const { POST } = await import("@/app/api/internal/sync/catalog/route");
const { setStoreEnabled } = await import("@/features/admin/server/mutations");
const { writeResultToResponse } = await import("@/app/api/admin/_lib/respond");
describe("PUBLISHED gate against real Postgres (AC1, E3, E5)", () => {
  let session: FixtureSession;

  beforeAll(async () => {
    session = await createFixtureSession();
  });

  afterAll(async () => {
    await prisma.syncEvent.deleteMany({ where: { businessId: session.businessExternalId } });
    await session.cleanup();
  });

  it("sync path: republishing a SUSPENDED store whose timezone is unreadable fails THAT event only, reports it as failed (never ok), and leaves status untouched — while an unrelated event in the SAME batch still applies", async () => {
    const gated = await session.createStore({ status: "SUSPENDED" });
    const untouched = await session.createStore(); // a second, healthy store in the same batch
    await prisma.$executeRaw(
      Prisma.sql`UPDATE "Store" SET "timezone" = 'Nowhere/Nothing' WHERE id = ${gated.id}`,
    );

    const gatedEventId = `${session.token}-evt-gate`;
    const okEventId = `${session.token}-evt-ok`;
    const now = new Date().toISOString();

    function storePayload(store: { externalId: string }) {
      return {
        storeId: store.externalId,
        businessId: session.businessExternalId,
        businessName: `F-022 fixture ${session.token}`,
        name: `F-022 fixture ${session.token}`,
        publishToStore: true,
        baseCurrency: "CUP",
        updatedAt: now,
      };
    }

    const response = await POST(
      new Request("http://localhost/api/internal/sync/catalog", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.syncToken}`,
        },
        body: JSON.stringify({
          businessId: session.businessExternalId,
          events: [
            {
              eventId: gatedEventId,
              entity: "STORE",
              operation: "UPDATE",
              occurredAt: now,
              payload: storePayload(gated),
            },
            {
              eventId: okEventId,
              entity: "STORE",
              operation: "UPDATE",
              occurredAt: now,
              payload: storePayload(untouched),
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(207);
    const body = await response.json();

    // Reported as FAILED, never as ok — a duplicate-looking "ok" here would
    // make the POS mark its outbox row done and lose the update forever
    // (AGENTS.md § "un evento fallido NO es un duplicado").
    expect(body.ok).not.toContain(gatedEventId);
    expect(body.failed.map((f: { id: string }) => f.id)).toContain(gatedEventId);
    const gatedFailure = body.failed.find((f: { id: string }) => f.id === gatedEventId);
    expect(gatedFailure.error).toBe(STORE_TIMEZONE_INVALID);

    // The rest of the batch is not collateral damage.
    expect(body.ok).toContain(okEventId);
    expect(body.failed.map((f: { id: string }) => f.id)).not.toContain(okEventId);

    const gatedSyncEvent = await prisma.syncEvent.findUnique({ where: { eventId: gatedEventId } });
    expect(gatedSyncEvent?.status).toBe("FAILED");
    expect(gatedSyncEvent?.error).toBe(STORE_TIMEZONE_INVALID);

    const gatedRow = await prisma.store.findUniqueOrThrow({
      where: { id: gated.id },
      select: { status: true, timezone: true },
    });
    expect(gatedRow.status).toBe("SUSPENDED");
    expect(gatedRow.timezone).toBe("Nowhere/Nothing"); // untouched too

    const untouchedRow = await prisma.store.findUniqueOrThrow({
      where: { id: untouched.id },
      select: { status: true },
    });
    expect(untouchedRow.status).toBe("PUBLISHED");
  });

  it("admin path (E5): reopening a store with an unreadable timezone responds 409 INVALID_TIMEZONE and never writes; closing the SAME store still works", async () => {
    const store = await session.createStore({ status: "SUSPENDED" });
    await prisma.$executeRaw(
      Prisma.sql`UPDATE "Store" SET "timezone" = 'Nowhere/Nothing' WHERE id = ${store.id}`,
    );

    const openResult = await setStoreEnabled(store.id as never, { enabled: true });
    expect(openResult).toEqual({ kind: "invalid_timezone" });
    const openResponse = writeResultToResponse(openResult);
    expect(openResponse.status).toBe(409);
    expect(await openResponse.json()).toEqual({ error: "INVALID_TIMEZONE" });

    const stillSuspended = await prisma.store.findUniqueOrThrow({
      where: { id: store.id },
      select: { status: true },
    });
    expect(stillSuspended.status).toBe("SUSPENDED");

    // E5: an unreadable zone can never block CLOSING a store.
    const closeResult = await setStoreEnabled(store.id as never, {
      enabled: false,
      reasonCode: "VACACIONES",
      message: "Cerrado por reformas",
    });
    expect(closeResult.kind).toBe("saved");
    const closeResponse = writeResultToResponse(closeResult);
    expect(closeResponse.status).toBe(200);
  });
});
