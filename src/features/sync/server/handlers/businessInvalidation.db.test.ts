import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoreStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  createFixtureSession,
  type FixtureSession,
} from "@/features/marketplace/server/dbFixtures";
import {
  BUSINESS_DELETE_NOT_SUPPORTED,
  BUSINESS_DISPLAY_CURRENCIES_INVALID,
} from "@/constants/sync";

/**
 * F-039 (plan.md paso 7; spec.md R18/R19, C14; architecture.md AD7/AD8, §
 * Pruebas fila `businessInvalidation.db.test.ts`): the invalidation
 * `business.db.test.ts` (F-038) could not prove because that ciclo's
 * `handleBusiness` had no fourth parameter yet — its own mock of
 * `next/cache` is a silent passthrough (§ Pruebas: el reparto entre
 * archivos, decisión 2), and `vi.mock` is per FILE, so turning that
 * passthrough into a counting spy would make its thirteen unrelated
 * scenarios share one contador whose state depends on run order. This file
 * is new for exactly that reason, mirroring
 * `src/features/sync/server/handlers/exchangeRateAllDraft.db.test.ts` (F-035)
 * down to the `next/cache` mock that avoids `Invariant: static generation
 * store missing` (ficha
 * `.agent/playbook/db-test-revalidatetag-static-generation-store-missing.md`).
 *
 * What this file affirms and `business.db.test.ts` does not: the EXACT set
 * of `storeTag`/`storeCatalogTag` values a real `POST` fires for a business
 * with real renderable branches (never a hand-built array — the value comes
 * straight off `revalidateTagSpy`, resolved by the real
 * `createRenderableBranchLookup` -> `expandBrandRevalidation` ->
 * `canonicalSlug` chain, R18/R19), and that the four non-writing paths
 * (`stale`, the two malformed-input rejections, and a business whose every
 * branch is `DRAFT`) fire ZERO — the same shape
 * `exchangeRateAllDraft.db.test.ts` already proved for `EXCHANGE_RATE`.
 *
 * `storeTagCalls()` filters to the "store:" family on purpose: a BUSINESS
 * write never sets `touchedBrandSlug`/`touchedSlugValues` (unlike
 * `handleCategory`), but `processCatalogBatch` still calls `revalidateSlugs`
 * unconditionally on the SAME touched set, which fires its own "slug:" tag
 * per branch — a real, harmless side effect of the shared conduit (AD7) and
 * not what C14 asks this file to count.
 */
const revalidateTagSpy = vi.fn();
vi.mock("next/cache", () => ({
  revalidateTag: (...args: unknown[]) => revalidateTagSpy(...args),
  unstable_cache: (fn: unknown) => fn,
}));

const { POST } = await import("@/app/api/internal/sync/catalog/route");

type CatalogResponse = {
  ok: string[];
  failed: { id: string; error: string }[];
  results: { eventId: string; status: string; error?: string }[];
};

async function post(session: FixtureSession, events: unknown[]) {
  const response = await POST(
    new Request("http://localhost/api/internal/sync/catalog", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.syncToken}`,
      },
      body: JSON.stringify({ businessId: session.businessExternalId, events }),
    }),
  );
  const body = (await response.json()) as CatalogResponse;
  return { status: response.status, body };
}

function businessEvent(opts: {
  eventId: string;
  session: FixtureSession;
  displayCurrencies: string[];
  updatedAt: string;
  operation?: "CREATE" | "UPDATE" | "DELETE";
}) {
  return {
    eventId: opts.eventId,
    entity: "BUSINESS",
    operation: opts.operation ?? "UPDATE",
    occurredAt: opts.updatedAt,
    payload: {
      businessId: opts.session.businessExternalId,
      displayCurrencies: opts.displayCurrencies,
      updatedAt: opts.updatedAt,
    },
  };
}

function storeTagCalls(): string[] {
  return revalidateTagSpy.mock.calls
    .map(([tag]) => String(tag))
    .filter((tag) => tag.startsWith("store:"));
}

const tag = (slug: string) => `store:${slug}`;
const catalogTag = (slug: string) => `store:${slug}:catalog`;

describe("BUSINESS invalidation against real Postgres, through the real POST (C14)", () => {
  let session: FixtureSession;

  beforeEach(async () => {
    session = await createFixtureSession();
  });

  afterEach(async () => {
    await prisma.syncEvent.deleteMany({ where: { businessId: session.businessExternalId } });
    await session.cleanup();
  });

  it("a write invalidates EXACTLY storeTag/storeCatalogTag of each renderable branch, and no other", async () => {
    // Two PUBLISHED stores -> brandBranchCount = 2 -> canonicalSlug()
    // resolves to each STORE's own slug (never the storefront's, R4).
    const storeA = await session.createStore();
    const storeB = await session.createStore();
    revalidateTagSpy.mockClear();

    const eventId = `${session.token}-inv-write`;
    const { status, body } = await post(session, [
      businessEvent({
        eventId,
        session,
        displayCurrencies: ["CUP", "USD"],
        updatedAt: "2026-09-08T10:00:00.000Z",
      }),
    ]);

    expect(status).toBe(207);
    expect(body.results).toEqual([{ eventId, status: "processed" }]);

    const slugA = `${session.token}-store-1`;
    const slugB = `${session.token}-store-2`;
    // Confirms this test's own assumption about how the fixture derives its
    // slugs, so a change to `dbFixtures.ts` fails HERE loudly instead of
    // silently comparing against the wrong value below.
    expect([storeA.externalId, storeB.externalId]).toHaveLength(2);

    const storeTags = storeTagCalls();
    expect(new Set(storeTags)).toEqual(
      new Set([tag(slugA), catalogTag(slugA), tag(slugB), catalogTag(slugB)]),
    );
    expect(storeTags).toHaveLength(4);
  });

  it("a STALE write fires ZERO revalidateTag (R18: nothing not-just-written is invalidated)", async () => {
    await session.createStore();
    const seedEventId = `${session.token}-inv-seed`;
    await post(session, [
      businessEvent({
        eventId: seedEventId,
        session,
        displayCurrencies: ["CUP"],
        updatedAt: "2026-09-08T10:00:00.000Z",
      }),
    ]);
    revalidateTagSpy.mockClear();

    const staleEventId = `${session.token}-inv-stale`;
    const { body } = await post(session, [
      businessEvent({
        eventId: staleEventId,
        session,
        displayCurrencies: ["EUR"],
        updatedAt: "2026-09-08T09:00:00.000Z",
      }),
    ]);

    expect(body.results[0]).toEqual({ eventId: staleEventId, status: "stale" });
    expect(revalidateTagSpy).not.toHaveBeenCalled();
  });

  it("BUSINESS_DELETE_NOT_SUPPORTED fires ZERO revalidateTag", async () => {
    await session.createStore();
    revalidateTagSpy.mockClear();

    const eventId = `${session.token}-inv-delete`;
    const { body } = await post(session, [
      businessEvent({
        eventId,
        session,
        displayCurrencies: ["USD"],
        updatedAt: "2026-09-08T10:00:00.000Z",
        operation: "DELETE",
      }),
    ]);

    expect(body.failed).toEqual([{ id: eventId, error: BUSINESS_DELETE_NOT_SUPPORTED }]);
    expect(revalidateTagSpy).not.toHaveBeenCalled();
  });

  it("BUSINESS_DISPLAY_CURRENCIES_INVALID fires ZERO revalidateTag", async () => {
    await session.createStore();
    revalidateTagSpy.mockClear();

    const eventId = `${session.token}-inv-invalid`;
    const { body } = await post(session, [
      businessEvent({
        eventId,
        session,
        displayCurrencies: ["CUP", "usd"],
        updatedAt: "2026-09-08T10:00:00.000Z",
      }),
    ]);

    expect(body.failed).toEqual([{ id: eventId, error: BUSINESS_DISPLAY_CURRENCIES_INVALID }]);
    expect(revalidateTagSpy).not.toHaveBeenCalled();
  });

  it("a business whose EVERY branch is DRAFT writes the row but fires ZERO revalidateTag", async () => {
    await session.createStore({ status: StoreStatus.DRAFT });
    await session.createStore({ status: StoreStatus.DRAFT });
    revalidateTagSpy.mockClear();

    const eventId = `${session.token}-inv-draft`;
    const { body } = await post(session, [
      businessEvent({
        eventId,
        session,
        displayCurrencies: ["USD"],
        updatedAt: "2026-09-08T10:00:00.000Z",
      }),
    ]);

    expect(body.results[0]).toEqual({ eventId, status: "processed" });
    expect(revalidateTagSpy).not.toHaveBeenCalled();

    const row = await prisma.business.findUniqueOrThrow({
      where: { id: session.businessId },
      select: { displayCurrencies: true },
    });
    expect(row.displayCurrencies).toEqual(["USD"]);
  });
});
