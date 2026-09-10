import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createFixtureSession,
  type FixtureSession,
} from "@/features/marketplace/server/dbFixtures";
import { DEPENDENCY_FAILED_IN_BATCH, ZONE_TARIFF_DELETE_NOT_SUPPORTED } from "@/constants/sync";

/**
 * F-037 (spec.md C1-C8, I2, I3; architecture.md § AD6, fila 3; plan.md paso
 * 8): the cascade against a REAL Postgres, through the real `POST` — what
 * `processBatch.test.ts` (paso 7) cannot prove because its `recordBatch` is
 * mocked: which rows do NOT end up written, the `FAILED` row the inbox
 * really leaves, and the other half of E6 — that "posterior" is decided by
 * `occurredAt`, not by array position, because `recordBatch` really sorts.
 *
 * `next/cache` is mocked the same way `storePublishGate.db.test.ts` does
 * it: a passthrough, never asserted on here — `revalidateTag` needs a
 * request-scoped "static generation store" that only exists inside a
 * running Next server, and calling the real route handler from Vitest
 * without this throws `Invariant: static generation store missing`
 * (ficha `.agent/playbook/db-test-revalidatetag-static-generation-store-missing.md`).
 *
 * ## § Fallos encontrados #1 (tests.md): AD6's own palanca (a trailing
 * U+0000 in `payload.name`) does NOT work through the real `POST`, for
 * EITHER entity — verified by running it, not by reading it.
 * `recordBatch` (`src/features/sync/server/inbox.ts:49`) persists the
 * WHOLE `payload` as `Json` in `SyncEvent.payload` in ONE `createMany`
 * call, BEFORE any handler ever runs — and Postgres's `json`/`jsonb` type
 * rejects a U+0000 exactly as hard as its `text` type does (`22P05
 * unsupported Unicode escape sequence`, not the `22021` the architecture
 * doc expected from a `text` column). A single poisoned event's payload
 * therefore fails `recordBatch` itself, for the WHOLE batch — the request
 * answers `500 BATCH_FAILED`, never `207` with that one event in
 * `failed[]`. This is not a per-entity quirk: EVERY `SyncEvent.payload`
 * goes through this same column, so the lever cannot work for CATEGORY OR
 * CURRENCY, contradicting AD6's own claim (verified against a bare `text`
 * column in isolation, never through `recordBatch`). Routed to
 * sdd-architect in `tests.md` § Fallos encontrados; the two replacements
 * below are chosen by `sdd-tester` per spec.md § No decidido a propósito,
 * punto 3 ("cuál de las dos palancas de fallo se usa... del arquitecto y
 * del sdd-tester").
 *
 * ## Replacement lever 1 — CATEGORY: slug exhaustion (AD6's own
 * "alternativa sin exotismos", `src/lib/slug.ts:107-112`). 999 filler
 * `LocalCategory` rows pre-occupy every candidate `uniqueSlug` would try
 * for the name `"Bebidas"` (`bebidas`, `bebidas-2`, …, `bebidas-999`),
 * created ONCE for this file's shared session (`beforeAll`) — cheap (one
 * `createMany`, no round-trip per candidate) and touches no payload
 * content at all, so `recordBatch` never sees anything it cannot store.
 * `createCategory` throws for real, `generateCategorySlug` having found no
 * free candidate — a genuine, undoctored error. A "repair" CATEGORY event
 * in the same family therefore needs a NAME that slugifies to something
 * NOT in that blocked family (this file uses distinct "reparada" names per
 * test) to actually succeed.
 *
 * ## Replacement lever 2 — CURRENCY: the ADR 0018 invariant, broken on
 * purpose (`src/lib/publicSlug.ts::canonicalSlug`, `src/features/sync/
 * server/businessBranches.ts`). `handleCurrency` calls
 * `renderableBranches(businessId)` AFTER its own `Currency` upsert
 * succeeds; if a multi-branch brand of that business has a non-DRAFT
 * branch with NO `Store.slug` of its own, `canonicalSlug()` throws for
 * real, and that throw propagates out of `handleCurrency` uncaught. Built
 * in a THROWAWAY session (own business), never the shared one — the break
 * is business-wide and permanent for as long as that business exists, and
 * nothing else in this file should have to reason about it. The
 * CURRENCY's OWN `Currency` row DOES end up written (its `upsert` ran
 * before the throw) — with the REAL `name`/`symbol` this test supplies,
 * never `code = name = symbol`, so I3's literal ("no row with all three
 * equal") still holds; what changes is that C4 no longer needs the row to
 * be absent, only non-provisional.
 *
 * `Currency` has no `businessId` (I3) — its code for this file is
 * `"FQV"`, checked free by grep against every code already burned by a
 * `*.db.test.ts` or a smoke (architecture.md § AD6: `CUP`, `USD`, `MLC`,
 * `EUR`, `ABC`, `XYZ`, `AAA`, `BBB`, `CCC`, `DDD`, `WVX`, `QAB`, `ZZZ`) —
 * and it is deleted in `afterAll`, the same lesson F-035 left in
 * `src/features/catalog/server/rates.db.test.ts:106`.
 */
vi.mock("next/cache", () => ({
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

const { POST } = await import("@/app/api/internal/sync/catalog/route");

const CURRENCY_CODE = "FQV";
/** The name every SLUG-EXHAUSTED CATEGORY event in this file uses — its
 *  base slug ("bebidas") is the one `beforeAll` pre-occupies 999 times
 *  over. */
const BLOCKED_CATEGORY_NAME = "Bebidas";

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
  const body = (await response.json()) as {
    ok: string[];
    failed: { id: string; error: string }[];
    results: { eventId: string; status: string; error?: string }[];
  };
  return { status: response.status, body };
}

function categoryEvent(opts: {
  eventId: string;
  session: FixtureSession;
  categoryId: string;
  occurredAt: string;
  /** Omit to hit the pre-blocked "Bebidas" family (replacement lever 1);
   *  pass a name outside that family for an event meant to succeed. */
  name?: string;
  operation?: "CREATE" | "UPDATE" | "DELETE";
}) {
  return {
    eventId: opts.eventId,
    entity: "CATEGORY",
    operation: opts.operation ?? "UPDATE",
    occurredAt: opts.occurredAt,
    payload: {
      categoryId: opts.categoryId,
      businessId: opts.session.businessExternalId,
      name: opts.name ?? BLOCKED_CATEGORY_NAME,
      color: null,
      updatedAt: opts.occurredAt,
    },
  };
}

function currencyEvent(opts: {
  eventId: string;
  session: FixtureSession;
  code: string;
  occurredAt: string;
  name: string;
  symbol: string;
}) {
  return {
    eventId: opts.eventId,
    entity: "CURRENCY",
    operation: "UPDATE",
    occurredAt: opts.occurredAt,
    payload: {
      code: opts.code,
      name: opts.name,
      symbol: opts.symbol,
      active: true,
      updatedAt: opts.occurredAt,
    },
  };
}

function productEvent(opts: {
  eventId: string;
  session: FixtureSession;
  storeExternalId: string;
  storeProductId: string;
  localCategoryId?: string | null;
  currency?: string;
  occurredAt: string;
}) {
  return {
    eventId: opts.eventId,
    entity: "PRODUCT",
    operation: "UPDATE",
    occurredAt: opts.occurredAt,
    payload: {
      storeProductId: opts.storeProductId,
      productId: `${opts.storeProductId}-product`,
      businessId: opts.session.businessExternalId,
      storeId: opts.storeExternalId,
      localName: `Producto ${opts.storeProductId}`,
      barcodes: [] as string[],
      localCategoryId: opts.localCategoryId ?? null,
      price: 100,
      currency: opts.currency ?? "CUP",
      canonicalProductId: null,
      imageUrl: null,
      publishToStore: true,
      updatedAt: opts.occurredAt,
    },
  };
}

function exchangeRateEvent(opts: {
  eventId: string;
  session: FixtureSession;
  currency: string;
  occurredAt: string;
}) {
  return {
    eventId: opts.eventId,
    entity: "EXCHANGE_RATE",
    operation: "CREATE",
    occurredAt: opts.occurredAt,
    payload: {
      businessId: opts.session.businessExternalId,
      currency: opts.currency,
      rate: 440,
      updatedAt: opts.occurredAt,
    },
  };
}

describe("F-037 dependency cascade against real Postgres, through the real POST (C1-C8)", () => {
  let session: FixtureSession;

  beforeAll(async () => {
    session = await createFixtureSession();

    // Replacement lever 1's setup: pre-occupy the 999 candidates
    // `uniqueSlug` would try for `slugify("Bebidas") === "bebidas"` — ONE
    // `createMany`, no payload content involved, so `recordBatch` never
    // touches anything it cannot store. `Business.delete` in
    // `session.cleanup()` cascades onto these (`LocalCategory.businessId`,
    // `onDelete: Cascade`) — no separate teardown needed.
    const fillerSlugs = ["bebidas", ...Array.from({ length: 998 }, (_, i) => `bebidas-${i + 2}`)];
    await prisma.localCategory.createMany({
      data: fillerSlugs.map((slug, i) => ({
        businessId: session.businessId,
        externalId: `${session.token}-slug-filler-${i}`,
        name: BLOCKED_CATEGORY_NAME,
        slug,
      })),
    });
  }, 30_000);

  afterAll(async () => {
    await prisma.syncEvent.deleteMany({ where: { businessId: session.businessExternalId } });
    await session.cleanup();
    // I3: Currency has no businessId — session.cleanup() cannot reach it.
    await prisma.currency.deleteMany({ where: { code: CURRENCY_CODE } });
  });

  it("C1/C7/C8: a failed CATEGORY drags the PRODUCT that references it, an unrelated PRODUCT in the same batch still applies, and the drag never wrote a row", async () => {
    const store = await session.createStore();
    const catId = `${session.token}-c1-cat`;
    const draggedExternalId = `${session.token}-c1-sp-dragged`;

    const before = await prisma.storeProduct.count({
      where: { storeId: store.id, externalId: draggedExternalId },
    });

    const events = [
      categoryEvent({
        eventId: `${session.token}-c1-evt-cat`,
        session,
        categoryId: catId,
        occurredAt: "2026-09-05T09:00:00.000Z",
      }),
      productEvent({
        eventId: `${session.token}-c1-evt-dragged`,
        session,
        storeExternalId: store.externalId,
        storeProductId: draggedExternalId,
        localCategoryId: catId,
        occurredAt: "2026-09-05T10:00:00.000Z",
      }),
      productEvent({
        eventId: `${session.token}-c1-evt-other`,
        session,
        storeExternalId: store.externalId,
        storeProductId: `${session.token}-c1-sp-other`,
        localCategoryId: null,
        occurredAt: "2026-09-05T11:00:00.000Z",
      }),
    ];

    const { status, body } = await post(session, events);

    expect(status).toBe(207);

    const failedIds = body.failed.map((f) => f.id);
    // C7: exactly two failed entries, not three — the third event is not
    // collateral damage.
    expect(body.failed).toHaveLength(2);
    expect(failedIds).toContain(events[0].eventId);
    expect(failedIds).toContain(events[1].eventId);

    // The dragged event's error is the exact constant — the ORIGIN
    // category is affirmed only by presence in failed[], never by its
    // .error text (that one is `createCategory`'s own thrown message).
    const draggedFailure = body.failed.find((f) => f.id === events[1].eventId);
    expect(draggedFailure?.error).toBe(DEPENDENCY_FAILED_IN_BATCH);

    expect(body.ok).not.toContain(events[0].eventId);
    expect(body.ok).not.toContain(events[1].eventId);
    expect(body.ok).toContain(events[2].eventId);
    const otherResult = body.results.find((r) => r.eventId === events[2].eventId);
    expect(otherResult?.status).toBe("processed");

    // C1/I2: the dragged product is BRAND NEW — no row at all, in its
    // strong form — and the count scoped to its own externalId is
    // unchanged (I2's general form, for whoever reuses this against an
    // existing row).
    const draggedRow = await prisma.storeProduct.findUnique({
      where: { storeId_externalId: { storeId: store.id, externalId: draggedExternalId } },
    });
    expect(draggedRow).toBeNull();
    const after = await prisma.storeProduct.count({
      where: { storeId: store.id, externalId: draggedExternalId },
    });
    expect(after).toBe(before);

    const otherRow = await prisma.storeProduct.findUnique({
      where: {
        storeId_externalId: { storeId: store.id, externalId: `${session.token}-c1-sp-other` },
      },
    });
    expect(otherRow).not.toBeNull();

    // C8, first half: the dragged event's OWN SyncEvent row is FAILED with
    // the exact constant, which is what makes it re-enter `fresh` (not
    // `duplicateIds`) on the next delivery.
    const draggedSyncEvent = await prisma.syncEvent.findUnique({
      where: { eventId: events[1].eventId },
    });
    expect(draggedSyncEvent?.status).toBe("FAILED");
    expect(draggedSyncEvent?.error).toBe(DEPENDENCY_FAILED_IN_BATCH);

    // C2/C8, second half: resent AS-IS (same eventId, same updatedAt, same
    // payload object) once the CATEGORY enters fine — it applies, never
    // stale, never duplicate, and the row is written with its category.
    // The repair event needs a NAME outside the blocked "Bebidas" family
    // (replacement lever 1) to actually succeed — `existing` is still
    // `null` for this categoryId, so it goes through `createCategory` too.
    // Its `occurredAt` (09:30) sits BEFORE the resent product's own
    // (10:00, unchanged — "tal cual" means the PRODUCT keeps its
    // ORIGINAL timestamp): `recordBatch` sorts this SECOND delivery's two
    // events by occurredAt too, so the repair has to be the one that
    // resolves first for the product to see the category at all (R1).
    const repairEvents = [
      categoryEvent({
        eventId: `${session.token}-c1-evt-cat-repair`,
        session,
        categoryId: catId,
        occurredAt: "2026-09-05T09:30:00.000Z",
        name: "Bebidas Reparadas C1",
      }),
      events[1],
    ];
    const second = await post(session, repairEvents);

    expect(second.status).toBe(207);
    const resentResult = second.body.results.find((r) => r.eventId === events[1].eventId);
    expect(resentResult?.status).toBe("processed");
    expect(second.body.ok).toContain(events[1].eventId);
    expect(second.body.failed.map((f) => f.id)).not.toContain(events[1].eventId);

    const category = await prisma.localCategory.findUniqueOrThrow({
      where: { businessId_externalId: { businessId: session.businessId, externalId: catId } },
    });
    const repairedRow = await prisma.storeProduct.findUniqueOrThrow({
      where: { storeId_externalId: { storeId: store.id, externalId: draggedExternalId } },
    });
    expect(repairedRow.localCategoryId).toBe(category.id);
  });

  it("C3: a PRODUCT whose category is NOT in the batch keeps saving with localCategoryId NULL and responding processed", async () => {
    const store = await session.createStore();
    const externalId = `${session.token}-c3-sp`;

    const events = [
      productEvent({
        eventId: `${session.token}-c3-evt`,
        session,
        storeExternalId: store.externalId,
        storeProductId: externalId,
        localCategoryId: `${session.token}-c3-cat-never-sent`,
        occurredAt: "2026-09-05T09:00:00.000Z",
      }),
    ];

    const { status, body } = await post(session, events);

    expect(status).toBe(207);
    expect(body.results[0]).toEqual({ eventId: events[0].eventId, status: "processed" });

    const row = await prisma.storeProduct.findUniqueOrThrow({
      where: { storeId_externalId: { storeId: store.id, externalId } },
    });
    expect(row.localCategoryId).toBeNull();
  });

  it("C6: the cascade is decided by occurredAt, not by array position — a PRODUCT with an EARLIER occurredAt than the failing CATEGORY applies, even though the CATEGORY is listed FIRST in the POST array", async () => {
    const store = await session.createStore();
    const catId = `${session.token}-c6-cat`;
    const externalId = `${session.token}-c6-sp`;

    // Array order: CATEGORY first. If `recordBatch`'s sort by `occurredAt`
    // were ever removed, the PRODUCT (occurredAt 10:00) would apply AFTER
    // the CATEGORY (occurredAt 11:00) instead of before it, and this test
    // would go red.
    const events = [
      categoryEvent({
        eventId: `${session.token}-c6-evt-cat`,
        session,
        categoryId: catId,
        occurredAt: "2026-09-05T11:00:00.000Z",
      }),
      productEvent({
        eventId: `${session.token}-c6-evt-product`,
        session,
        storeExternalId: store.externalId,
        storeProductId: externalId,
        localCategoryId: catId,
        occurredAt: "2026-09-05T10:00:00.000Z",
      }),
    ];

    const { status, body } = await post(session, events);

    expect(status).toBe(207);
    expect(body.ok).toContain(events[1].eventId);
    const productResult = body.results.find((r) => r.eventId === events[1].eventId);
    expect(productResult?.status).toBe("processed");

    const row = await prisma.storeProduct.findUniqueOrThrow({
      where: { storeId_externalId: { storeId: store.id, externalId } },
    });
    expect(row.localName).toBe(`Producto ${externalId}`);
  });

  it("C4/C5: a failed CURRENCY drags the EXCHANGE_RATE of the same code, leaves no PROVISIONAL Currency row, and does NOT drag a PRODUCT of that currency", async () => {
    // Replacement lever 2's setup: a THROWAWAY session/business whose ADR
    // 0018 invariant is broken on purpose — a two-branch brand where one
    // PUBLISHED branch has no Store.slug of its own. `renderableBranches`
    // throws for real when `handleCurrency` calls it, for THIS business
    // only; the other, properly-slugged branch is what the PRODUCT half
    // of this test writes against, unaffected (its own `canonicalSlug`
    // call never looks at the broken sibling).
    const currencySession = await createFixtureSession();
    try {
      const brokenStore = await currencySession.createStore();
      const goodStore = await currencySession.createStore();
      await prisma.store.update({ where: { id: brokenStore.id }, data: { slug: null } });

      const productExternalId = `${currencySession.token}-c4-sp`;
      const currencyBefore = await prisma.currency.findUnique({
        where: { code: CURRENCY_CODE },
      });
      expect(currencyBefore).toBeNull();

      const events = [
        currencyEvent({
          eventId: `${currencySession.token}-c4-evt-currency`,
          session: currencySession,
          code: CURRENCY_CODE,
          occurredAt: "2026-09-05T09:00:00.000Z",
          name: "Divisa de prueba F-037",
          symbol: "Fq",
        }),
        exchangeRateEvent({
          eventId: `${currencySession.token}-c4-evt-rate`,
          session: currencySession,
          currency: CURRENCY_CODE,
          occurredAt: "2026-09-05T10:00:00.000Z",
        }),
        productEvent({
          eventId: `${currencySession.token}-c4-evt-product`,
          session: currencySession,
          storeExternalId: goodStore.externalId,
          storeProductId: productExternalId,
          currency: CURRENCY_CODE,
          occurredAt: "2026-09-05T11:00:00.000Z",
        }),
      ];

      const { status, body } = await post(currencySession, events);

      expect(status).toBe(207);
      expect(body.failed).toHaveLength(2);
      const failedIds = body.failed.map((f) => f.id);
      expect(failedIds).toContain(events[0].eventId);
      expect(failedIds).toContain(events[1].eventId);
      // The dragged EXCHANGE_RATE's error is the exact constant — the
      // ORIGIN CURRENCY is affirmed only by presence in failed[], never
      // by its .error text (that one is `canonicalSlug`'s own message).
      const rateFailure = body.failed.find((f) => f.id === events[1].eventId);
      expect(rateFailure?.error).toBe(DEPENDENCY_FAILED_IN_BATCH);

      // C5: CURRENCY never drags PRODUCT — it applies and responds processed.
      expect(body.ok).toContain(events[2].eventId);
      const productResult = body.results.find((r) => r.eventId === events[2].eventId);
      expect(productResult?.status).toBe("processed");

      // I3: no PROVISIONAL `code = name = symbol = "FQV"` row.
      // `handleCurrency`'s own `upsert` DID run (it fails AFTER, inside
      // `renderableBranches`), so a row exists — with the REAL name/symbol
      // this test supplied, never all three equal, which is the exact
      // shape only `handleExchangeRate`'s own upsert would have produced
      // had it been allowed to run.
      const currencyAfter = await prisma.currency.findUniqueOrThrow({
        where: { code: CURRENCY_CODE },
      });
      expect(currencyAfter.name).not.toBe(CURRENCY_CODE);
      expect(currencyAfter.symbol).not.toBe(CURRENCY_CODE);

      const rateCount = await prisma.exchangeRate.count({
        where: { currencyCode: CURRENCY_CODE },
      });
      expect(rateCount).toBe(0);

      const productRow = await prisma.storeProduct.findUniqueOrThrow({
        where: { storeId_externalId: { storeId: goodStore.id, externalId: productExternalId } },
      });
      expect(productRow.syncedPriceCurrency).toBe(CURRENCY_CODE);
    } finally {
      await prisma.syncEvent.deleteMany({
        where: { businessId: currencySession.businessExternalId },
      });
      await currencySession.cleanup();
    }
  });

  it("F-043 (architecture.md § AD5, plan.md paso 10): two INDEPENDENTLY failing events with DISTINCT error messages in the same batch each keep their OWN error — markFailed groups the updateMany by message, not by event, and a batch that spans two groups must not mix them up", async () => {
    // Lever 1 (this file's own, replacement lever 1): a CATEGORY inside the
    // blocked "Bebidas" slug family fails for real, with a message this
    // repo never wrote (`generateCategorySlug` exhausting its candidates).
    const catEventId = `${session.token}-ad5-cat`;
    // A ZONE_TARIFF DELETE fails with the exact constant
    // ZONE_TARIFF_DELETE_NOT_SUPPORTED (R20) — a completely unrelated code
    // path, with no dependency on the CATEGORY above: the two events do not
    // reference each other at all, so any mix-up between their two
    // SyncEvent rows can only come from the GROUPING inside markFailed.
    const zoneEventId = `${session.token}-ad5-zone`;

    const events = [
      categoryEvent({
        eventId: catEventId,
        session,
        categoryId: `${session.token}-ad5-cat-id`,
        occurredAt: "2026-09-05T09:00:00.000Z",
      }),
      {
        eventId: zoneEventId,
        entity: "ZONE_TARIFF",
        operation: "DELETE",
        occurredAt: "2026-09-05T09:00:00.000Z",
        payload: {
          storeId: `${session.token}-ad5-store`, // never queried — R20 rejects before any lookup
          zoneCode: "21.01",
          rule: "NOT_SERVED",
          updatedAt: "2026-09-05T09:00:00.000Z",
        },
      },
    ];

    const { status, body } = await post(session, events);

    expect(status).toBe(207);
    expect(body.failed).toHaveLength(2);

    const zoneFailure = body.failed.find((f) => f.id === zoneEventId);
    expect(zoneFailure?.error).toBe(ZONE_TARIFF_DELETE_NOT_SUPPORTED);
    const catFailure = body.failed.find((f) => f.id === catEventId);
    expect(catFailure?.error).toBeDefined();
    expect(catFailure?.error).not.toBe(ZONE_TARIFF_DELETE_NOT_SUPPORTED);

    // The read this file already relies on for C8 (dependencyCascade.db.test.ts,
    // "the dragged event's OWN SyncEvent row is FAILED with the exact
    // constant") — applied here to BOTH rows, each with its OWN message,
    // which is exactly what a grouped updateMany could get wrong.
    const [catRow, zoneRow] = await Promise.all([
      prisma.syncEvent.findUnique({ where: { eventId: catEventId } }),
      prisma.syncEvent.findUnique({ where: { eventId: zoneEventId } }),
    ]);
    expect(catRow?.status).toBe("FAILED");
    expect(zoneRow?.status).toBe("FAILED");
    expect(zoneRow?.error).toBe(ZONE_TARIFF_DELETE_NOT_SUPPORTED);
    expect(catRow?.error).toBe(catFailure?.error);
    expect(catRow?.error).not.toBe(zoneRow?.error);
  });
});
