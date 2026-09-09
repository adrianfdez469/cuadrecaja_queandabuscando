import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
 * F-038 (plan.md paso 10; spec.md C1-C10, E13, E16, E17; architecture.md §
 * AD6, fila `business.db.test.ts`): the thirteen scenarios that need a real
 * Postgres row through the real `POST` — everything `business.test.ts`
 * (Prisma mocked) cannot prove: what actually lands in `Business` and what
 * doesn't, and the two-layer validation of C2/C9 that only exists once the
 * envelope, the identity check and the handler run together.
 *
 * `next/cache` is mocked the same passthrough way
 * `dependencyCascade.db.test.ts` and `storePublishGate.db.test.ts` do it:
 * `revalidateTag` needs a request-scoped "static generation store" that only
 * exists inside a running Next server, and calling the real route handler
 * from Vitest without this throws `Invariant: static generation store
 * missing` (ficha
 * `.agent/playbook/db-test-revalidatetag-static-generation-store-missing.md`).
 *
 * A fresh `FixtureSession` per test (`beforeEach`/`afterEach`), never one
 * shared across the file: the guard this handler enforces
 * (`displayCurrenciesSourceUpdatedAt >=`) lives on a SINGLE row, so a test
 * that leaves a mark behind would silently change what "stale" means for the
 * next one — and E16 specifically needs a business whose mark is still
 * `NULL`, which only a never-touched fixture business has.
 *
 * `ZONE_TARIFF` (C2) is not assignable to `SyncEventInput` — sent through the
 * `post(session, events: unknown[])` helper `dependencyCascade.db.test.ts`
 * already uses, `unknown[]` and never `any` (ESLint forbids it as an error).
 *
 * C7's currency code is `"XTS"` — literally spec.md E9's own example, and an
 * ISO 4217 code reserved for testing, which reads honestly here. Checked
 * free against every code architecture.md § AD6 lists as already burned by a
 * `*.db.test.ts` or a smoke script (`CUP`, `USD`, `MLC`, `EUR`, `ABC`, `XYZ`,
 * `AAA`, `BBB`, `CCC`, `DDD`, `WVX`, `QAB`, `ZZZ`, `FQV`, `KZR`, `MXR`) and
 * confirmed absent from `Currency` before writing this file. No `afterAll`
 * cleans it up — this handler never writes `Currency`/`ExchangeRate` (R9),
 * so there is nothing to clean, and that absence is exactly what C7
 * demonstrates.
 */
vi.mock("next/cache", () => ({
  revalidateTag: () => {},
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
  const body = (await response.json()) as CatalogResponse | { error: string; issues?: unknown };
  return { status: response.status, body: body as CatalogResponse & { error?: string } };
}

function businessEvent(opts: {
  eventId: string;
  session: FixtureSession;
  displayCurrencies: string[];
  updatedAt: string;
  occurredAt?: string;
  operation?: "CREATE" | "UPDATE" | "DELETE";
  businessId?: string;
}) {
  return {
    eventId: opts.eventId,
    entity: "BUSINESS",
    operation: opts.operation ?? "UPDATE",
    occurredAt: opts.occurredAt ?? opts.updatedAt,
    payload: {
      businessId: opts.businessId ?? opts.session.businessExternalId,
      displayCurrencies: opts.displayCurrencies,
      updatedAt: opts.updatedAt,
    },
  };
}

/** A structurally valid PRODUCT event, the "innocent bystander" of C2/C3:
 *  present in the same batch as a BUSINESS event that misbehaves, to prove
 *  the rest of the batch is unaffected (or, for C2, that it is NOT applied
 *  either, because the envelope rejected the whole batch). */
function productEvent(opts: {
  eventId: string;
  session: FixtureSession;
  storeExternalId: string;
  storeProductId: string;
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
      localCategoryId: null,
      price: 100,
      currency: "CUP",
      canonicalProductId: null,
      imageUrl: null,
      publishToStore: true,
      updatedAt: opts.occurredAt,
    },
  };
}

/** C10/E12: 40 distinct, valid three-letter codes generated from letters —
 *  `AAA`, `AAB`, … — never real ISO currencies, so nobody reading this test
 *  mistakes the count for a curated list (spec.md § Casos límite). */
function nCodes(n: number): string[] {
  const codes: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const c0 = String.fromCharCode(65 + (Math.floor(i / 676) % 26));
    const c1 = String.fromCharCode(65 + (Math.floor(i / 26) % 26));
    const c2 = String.fromCharCode(65 + (i % 26));
    codes.push(`${c0}${c1}${c2}`);
  }
  return codes;
}

async function readBusiness(businessId: string) {
  return prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { displayCurrencies: true, displayCurrenciesSourceUpdatedAt: true },
  });
}

describe("BUSINESS against real Postgres, through the real POST (paso 10)", () => {
  let session: FixtureSession;

  beforeEach(async () => {
    session = await createFixtureSession();
  });

  afterEach(async () => {
    await prisma.syncEvent.deleteMany({ where: { businessId: session.businessExternalId } });
    await session.cleanup();
  });

  it("C1 (E1): a valid list saves — 207, ok, status processed, and the row holds the exact array in order plus the mark", async () => {
    const eventId = `${session.token}-c1`;
    const { status, body } = await post(session, [
      businessEvent({
        eventId,
        session,
        displayCurrencies: ["CUP", "USD", "EUR"],
        updatedAt: "2026-09-06T14:03:00.000Z",
      }),
    ]);

    expect(status).toBe(207);
    expect(body.ok).toContain(eventId);
    expect(body.results.find((r) => r.eventId === eventId)).toEqual({
      eventId,
      status: "processed",
    });

    const row = await readBusiness(session.businessId);
    expect(row.displayCurrencies).toEqual(["CUP", "USD", "EUR"]);
    expect(row.displayCurrenciesSourceUpdatedAt).toEqual(new Date("2026-09-06T14:03:00.000Z"));
  });

  it("C2 (mitad POST, E2): an entity the contract does not define (ORDER, I13 — ZONE_TARIFF was this example until F-041 defined it) still kills the WHOLE batch — no SyncEvent row for either event, the PRODUCT next to it never applies", async () => {
    const store = await session.createStore();
    const zoneEventId = `${session.token}-c2-zone`;
    const productEventId = `${session.token}-c2-product`;
    const storeProductId = `${session.token}-c2-sp`;

    const events: unknown[] = [
      {
        eventId: zoneEventId,
        entity: "ORDER",
        operation: "UPDATE",
        occurredAt: "2026-09-06T09:00:00.000Z",
        payload: {
          orderId: "o1",
          status: "CONFIRMED",
          updatedAt: "2026-09-06T09:00:00.000Z",
        },
      },
      productEvent({
        eventId: productEventId,
        session,
        storeExternalId: store.externalId,
        storeProductId,
        occurredAt: "2026-09-06T09:00:01.000Z",
      }),
    ];

    const { status, body } = await post(session, events);

    expect(status).toBe(400);
    expect(body.error).toBe("INVALID_BATCH");

    const written = await prisma.syncEvent.count({
      where: { eventId: { in: [zoneEventId, productEventId] } },
    });
    expect(written).toBe(0);

    const productWritten = await prisma.storeProduct.count({
      where: { storeId: store.id, externalId: storeProductId },
    });
    expect(productWritten).toBe(0);
  });

  it.each(["usd", "US1", "€€€", "USDD", ""])(
    "C3 (E3): a malformed member (%s) fails ONLY that event with BUSINESS_DISPLAY_CURRENCIES_INVALID, the rest of the batch applies, and the saved list stays exactly as it was",
    async (badCode) => {
      const store = await session.createStore();
      const seedEventId = `${session.token}-c3-seed`;
      await post(session, [
        businessEvent({
          eventId: seedEventId,
          session,
          displayCurrencies: ["CUP", "USD"],
          updatedAt: "2026-09-06T10:00:00.000Z",
        }),
      ]);
      const before = await readBusiness(session.businessId);

      const businessEventId = `${session.token}-c3-bad`;
      const productEventId = `${session.token}-c3-product`;
      const storeProductId = `${session.token}-c3-sp`;

      const { status, body } = await post(session, [
        businessEvent({
          eventId: businessEventId,
          session,
          displayCurrencies: ["CUP", badCode],
          updatedAt: "2026-09-06T11:00:00.000Z",
        }),
        productEvent({
          eventId: productEventId,
          session,
          storeExternalId: store.externalId,
          storeProductId,
          occurredAt: "2026-09-06T11:00:01.000Z",
        }),
      ]);

      expect(status).toBe(207);
      expect(body.failed).toHaveLength(1);
      expect(body.failed[0]).toEqual({
        id: businessEventId,
        error: BUSINESS_DISPLAY_CURRENCIES_INVALID,
      });
      expect(body.ok).toContain(productEventId);
      expect(body.ok).not.toContain(businessEventId);

      const after = await readBusiness(session.businessId);
      expect(after).toEqual(before);
    },
  );

  it("C4 (E4) + E6: a DELETE is rejected with BUSINESS_DELETE_NOT_SUPPORTED and writes nothing, even when it also arrives rancid — never stale (R5 order)", async () => {
    const seedEventId = `${session.token}-c4-seed`;
    await post(session, [
      businessEvent({
        eventId: seedEventId,
        session,
        displayCurrencies: ["CUP", "USD"],
        updatedAt: "2026-09-06T10:00:00.000Z",
      }),
    ]);
    const before = await readBusiness(session.businessId);

    // E4: a DELETE with a NEWER mark still gets rejected, not applied.
    const deleteEventId = `${session.token}-c4-delete`;
    const { status: s1, body: b1 } = await post(session, [
      businessEvent({
        eventId: deleteEventId,
        session,
        displayCurrencies: ["EUR"],
        updatedAt: "2026-09-06T12:00:00.000Z",
        operation: "DELETE",
      }),
    ]);
    expect(s1).toBe(207);
    expect(b1.failed).toEqual([{ id: deleteEventId, error: BUSINESS_DELETE_NOT_SUPPORTED }]);
    expect(await readBusiness(session.businessId)).toEqual(before);

    // E6: a DELETE with a RANCID mark (<=) responds the SAME delete error,
    // never "stale" — the rejection of the format error runs before the
    // stale-write guard (R5).
    const staleDeleteEventId = `${session.token}-c4-delete-stale`;
    const { status: s2, body: b2 } = await post(session, [
      businessEvent({
        eventId: staleDeleteEventId,
        session,
        displayCurrencies: ["EUR"],
        updatedAt: "2026-09-06T09:00:00.000Z",
        operation: "DELETE",
      }),
    ]);
    expect(s2).toBe(207);
    expect(b2.results[0]).toEqual({
      eventId: staleDeleteEventId,
      status: "failed",
      error: BUSINESS_DELETE_NOT_SUPPORTED,
    });
    expect(b2.results[0].status).not.toBe("stale");
    expect(await readBusiness(session.businessId)).toEqual(before);
  });

  it("C5 (E5) + R7's retirada: updatedAt < and == the saved mark both respond stale without pisar la lista, and a retreat with a GROWING mark DOES apply", async () => {
    const seedEventId = `${session.token}-c5-seed`;
    await post(session, [
      businessEvent({
        eventId: seedEventId,
        session,
        displayCurrencies: ["CUP", "USD"],
        updatedAt: "2026-09-06T12:00:00.000Z",
      }),
    ]);
    const seeded = await readBusiness(session.businessId);

    // `<`
    const olderEventId = `${session.token}-c5-older`;
    const { body: olderBody } = await post(session, [
      businessEvent({
        eventId: olderEventId,
        session,
        displayCurrencies: ["CUP"],
        updatedAt: "2026-09-06T11:00:00.000Z",
      }),
    ]);
    expect(olderBody.results[0]).toEqual({ eventId: olderEventId, status: "stale" });
    expect(olderBody.ok).toContain(olderEventId);
    expect(olderBody.failed).toEqual([]);
    expect(await readBusiness(session.businessId)).toEqual(seeded);

    // `==`
    const tiedEventId = `${session.token}-c5-tied`;
    const { body: tiedBody } = await post(session, [
      businessEvent({
        eventId: tiedEventId,
        session,
        displayCurrencies: ["CUP"],
        updatedAt: "2026-09-06T12:00:00.000Z",
      }),
    ]);
    expect(tiedBody.results[0]).toEqual({ eventId: tiedEventId, status: "stale" });
    expect(tiedBody.ok).toContain(tiedEventId);
    expect(await readBusiness(session.businessId)).toEqual(seeded);

    // R7: retiring a currency (a SMALLER list) with a GROWING mark still
    // applies — the trap the v12.1 warns about is treating `updatedAt` as
    // "the max of the rows' marks", which would make a retreat look older
    // than what's saved. This handler never computes that max: it only
    // stores and compares the mark it is given.
    const retreatEventId = `${session.token}-c5-retreat`;
    const { body: retreatBody } = await post(session, [
      businessEvent({
        eventId: retreatEventId,
        session,
        displayCurrencies: ["CUP"],
        updatedAt: "2026-09-06T13:00:00.000Z",
      }),
    ]);
    expect(retreatBody.results[0]).toEqual({ eventId: retreatEventId, status: "processed" });
    const afterRetreat = await readBusiness(session.businessId);
    expect(afterRetreat.displayCurrencies).toEqual(["CUP"]);
    expect(afterRetreat.displayCurrenciesSourceUpdatedAt).toEqual(
      new Date("2026-09-06T13:00:00.000Z"),
    );
  });

  it("C6 (E8): a list with repeated codes saves deduplicated, first occurrence and relative order preserved, no error", async () => {
    const eventId = `${session.token}-c6`;
    const { body } = await post(session, [
      businessEvent({
        eventId,
        session,
        displayCurrencies: ["CUP", "USD", "CUP", "EUR", "USD"],
        updatedAt: "2026-09-06T14:00:00.000Z",
      }),
    ]);

    expect(body.failed).toEqual([]);
    expect(body.results[0]).toEqual({ eventId, status: "processed" });
    const row = await readBusiness(session.businessId);
    expect(row.displayCurrencies).toEqual(["CUP", "USD", "EUR"]);
  });

  it("C7 (E9): a currency with no Currency row and no ExchangeRate responds processed — no provisional row is ever created", async () => {
    const SYNTHETIC_CODE = "XTS";
    const before = await prisma.currency.findUnique({ where: { code: SYNTHETIC_CODE } });
    expect(before).toBeNull();

    const eventId = `${session.token}-c7`;
    const { body } = await post(session, [
      businessEvent({
        eventId,
        session,
        displayCurrencies: ["CUP", SYNTHETIC_CODE],
        updatedAt: "2026-09-06T15:00:00.000Z",
      }),
    ]);

    expect(body.results[0]).toEqual({ eventId, status: "processed" });
    const row = await readBusiness(session.businessId);
    expect(row.displayCurrencies).toEqual(["CUP", SYNTHETIC_CODE]);

    const after = await prisma.currency.findUnique({ where: { code: SYNTHETIC_CODE } });
    expect(after).toBeNull();
    const rateCount = await prisma.exchangeRate.count({
      where: { currencyCode: SYNTHETIC_CODE },
    });
    expect(rateCount).toBe(0);
  });

  it("C8 (E10): an empty list is accepted and clears the row to empty — 'solo la moneda base', not an error and not a DELETE", async () => {
    const seedEventId = `${session.token}-c8-seed`;
    await post(session, [
      businessEvent({
        eventId: seedEventId,
        session,
        displayCurrencies: ["CUP", "USD"],
        updatedAt: "2026-09-06T16:00:00.000Z",
      }),
    ]);

    const emptyEventId = `${session.token}-c8-empty`;
    const { body } = await post(session, [
      businessEvent({
        eventId: emptyEventId,
        session,
        displayCurrencies: [],
        updatedAt: "2026-09-06T17:00:00.000Z",
      }),
    ]);

    expect(body.failed).toEqual([]);
    expect(body.results[0]).toEqual({ eventId: emptyEventId, status: "processed" });
    const row = await readBusiness(session.businessId);
    expect(row.displayCurrencies).toEqual([]);
  });

  it("C9 (mitad POST, E11): a payload.businessId that is not the token's externalId aborts the WHOLE batch with 403, nothing written", async () => {
    const eventId = `${session.token}-c9`;
    const { status, body } = await post(session, [
      businessEvent({
        eventId,
        session,
        displayCurrencies: ["CUP"],
        updatedAt: "2026-09-06T18:00:00.000Z",
        businessId: `${session.token}-someone-elses-external-id`,
      }),
    ]);

    expect(status).toBe(403);
    expect(body.error).toBe("BUSINESS_MISMATCH");
    const written = await prisma.syncEvent.count({ where: { eventId } });
    expect(written).toBe(0);
  });

  it("C10 (E12): forty valid codes in the same list enter — no length cap in any layer", async () => {
    const codes = nCodes(40);
    const eventId = `${session.token}-c10`;
    const { body } = await post(session, [
      businessEvent({
        eventId,
        session,
        displayCurrencies: codes,
        updatedAt: "2026-09-06T19:00:00.000Z",
      }),
    ]);

    expect(body.results[0]).toEqual({ eventId, status: "processed" });
    const row = await readBusiness(session.businessId);
    expect(row.displayCurrencies).toHaveLength(40);
    expect(row.displayCurrencies).toEqual(codes);
  });

  it("E13: resending the same eventId responds duplicate and the handler is never called again — but a FAILED BUSINESS is not a duplicate and IS reprocessed", async () => {
    // A settled (PROCESSED) event: resending it with a DIFFERENT payload must
    // not change the row — the only way to prove the handler was not
    // called again is to see the FIRST list survive, not the second.
    const settledEventId = `${session.token}-e13-settled`;
    await post(session, [
      businessEvent({
        eventId: settledEventId,
        session,
        displayCurrencies: ["CUP", "USD"],
        updatedAt: "2026-09-06T20:00:00.000Z",
      }),
    ]);
    const afterFirst = await readBusiness(session.businessId);

    const { body: dupBody } = await post(session, [
      businessEvent({
        eventId: settledEventId,
        session,
        displayCurrencies: ["EUR", "MLC"],
        updatedAt: "2026-09-07T00:00:00.000Z",
      }),
    ]);
    expect(dupBody.results[0]).toEqual({ eventId: settledEventId, status: "duplicate" });
    expect(dupBody.ok).toContain(settledEventId);
    expect(await readBusiness(session.businessId)).toEqual(afterFirst);

    // A FAILED event (DELETE, R5(1)) is a different story: it stays FAILED
    // in the inbox and a retry with a corrected payload reprocesses for
    // real, never reporting `duplicate` (AGENTS.md § «Un evento fallido NO
    // es un duplicado»).
    const failedEventId = `${session.token}-e13-failed`;
    const { body: failedBody } = await post(session, [
      businessEvent({
        eventId: failedEventId,
        session,
        displayCurrencies: ["CUP"],
        updatedAt: "2026-09-06T21:00:00.000Z",
        operation: "DELETE",
      }),
    ]);
    expect(failedBody.results[0].status).toBe("failed");

    const { body: retryBody } = await post(session, [
      businessEvent({
        eventId: failedEventId,
        session,
        displayCurrencies: ["CUP", "EUR"],
        updatedAt: "2026-09-06T22:00:00.000Z",
        operation: "UPDATE",
      }),
    ]);
    expect(retryBody.results[0]).toEqual({ eventId: failedEventId, status: "processed" });
    const row = await readBusiness(session.businessId);
    expect(row.displayCurrencies).toEqual(["CUP", "EUR"]);
  });

  it("E16: the first event over a business whose mark is still NULL enters, no matter how old its updatedAt is", async () => {
    const before = await readBusiness(session.businessId);
    expect(before.displayCurrenciesSourceUpdatedAt).toBeNull();
    expect(before.displayCurrencies).toEqual([]);

    const eventId = `${session.token}-e16`;
    const { body } = await post(session, [
      businessEvent({
        eventId,
        session,
        displayCurrencies: ["CUP", "USD", "MLC"],
        updatedAt: "2000-01-01T00:00:00.000Z",
      }),
    ]);

    expect(body.results[0]).toEqual({ eventId, status: "processed" });
    const row = await readBusiness(session.businessId);
    expect(row.displayCurrencies).toEqual(["CUP", "USD", "MLC"]);
    expect(row.displayCurrenciesSourceUpdatedAt).toEqual(new Date("2000-01-01T00:00:00.000Z"));
  });

  it("E17: two BUSINESS events for the same business in the same batch — both respond processed, and the SECOND's list wins", async () => {
    const firstEventId = `${session.token}-e17-first`;
    const secondEventId = `${session.token}-e17-second`;

    const { body } = await post(session, [
      businessEvent({
        eventId: firstEventId,
        session,
        displayCurrencies: ["CUP"],
        updatedAt: "2026-09-06T08:00:00.000Z",
        occurredAt: "2026-09-06T08:00:00.000Z",
      }),
      businessEvent({
        eventId: secondEventId,
        session,
        displayCurrencies: ["CUP", "USD", "EUR"],
        updatedAt: "2026-09-06T09:00:00.000Z",
        occurredAt: "2026-09-06T09:00:00.000Z",
      }),
    ]);

    expect(body.results.find((r) => r.eventId === firstEventId)).toEqual({
      eventId: firstEventId,
      status: "processed",
    });
    expect(body.results.find((r) => r.eventId === secondEventId)).toEqual({
      eventId: secondEventId,
      status: "processed",
    });

    const row = await readBusiness(session.businessId);
    expect(row.displayCurrencies).toEqual(["CUP", "USD", "EUR"]);
  });
});
