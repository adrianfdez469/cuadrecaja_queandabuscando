import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createFixtureSession,
  type FixtureSession,
} from "@/features/marketplace/server/dbFixtures";
import { ZONE_TARIFF_DELETE_NOT_SUPPORTED, ZONE_TARIFF_ZONE_UNKNOWN } from "@/constants/sync";

/**
 * F-041 (plan.md paso 16; spec.md C2, C4, C5, C6, C12; architecture.md §
 * Componentes, fila `zoneTariff.db.test.ts`): the scenarios `zoneTariff.test.ts`
 * (Prisma mocked) cannot prove — what actually lands in `ZoneTariff` through
 * the real `POST`, the two-layer validation of the sobre (`400` before any
 * `SyncEvent`) plus the handler (`207 failed[]`), and the cascade to a real
 * `Store` `DELETE`.
 *
 * `next/cache` mocked the same passthrough/counting way
 * `business.db.test.ts`/`businessInvalidation.db.test.ts` already do it —
 * `revalidateTag` needs a request-scoped "static generation store" that only
 * exists inside a running Next server (ficha
 * `db-test-revalidatetag-static-generation-store-missing`).
 *
 * Zone codes are REAL rows of the committed catalog (`21` Pinar del Río,
 * `21.01` Sandino, `21.02` Guane): using real codes means this file never
 * has to fake a catalog entry, and a regeneration of the artefact that
 * retires or renames one of these three would fail LOUDLY here rather than
 * silently. `99.99` is a code the artefact will never contain (no province
 * numbers past `40`).
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
  const body = (await response.json()) as CatalogResponse & { error?: string; issues?: unknown };
  return { status: response.status, body };
}

function zoneTariffEvent(opts: {
  eventId: string;
  storeExternalId: string;
  zoneCode: string;
  rule: "FEE" | "NOT_SERVED" | "INHERIT";
  deliveryFee?: number;
  updatedAt: string;
  occurredAt?: string;
  operation?: "CREATE" | "UPDATE" | "DELETE";
}) {
  return {
    eventId: opts.eventId,
    entity: "ZONE_TARIFF",
    operation: opts.operation ?? "UPDATE",
    occurredAt: opts.occurredAt ?? opts.updatedAt,
    payload: {
      storeId: opts.storeExternalId,
      zoneCode: opts.zoneCode,
      rule: opts.rule,
      ...(opts.deliveryFee !== undefined ? { deliveryFee: opts.deliveryFee } : {}),
      updatedAt: opts.updatedAt,
    },
  };
}

/** The "innocent bystander" (precedent: `business.db.test.ts`'s `productEvent`) —
 *  present next to a misbehaving ZONE_TARIFF to prove a schema-level `400`
 *  kills the WHOLE batch, and a handler-level `failed[]` does NOT. */
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

function storeEvent(opts: {
  eventId: string;
  session: FixtureSession;
  storeExternalId: string;
  updatedAt: string;
  occurredAt?: string;
  operation?: "CREATE" | "UPDATE" | "DELETE";
  publishToStore?: boolean;
  openingHours?: unknown;
  zoneCode?: string | null;
  phone?: string;
  deliveryEnabled?: boolean;
  deliveryFeeMode?: "FLAT_RATE" | "QUOTED_PER_ORDER" | "ZONE_BASED";
  deliveryFee?: number | null;
}) {
  return {
    eventId: opts.eventId,
    entity: "STORE",
    operation: opts.operation ?? "UPDATE",
    occurredAt: opts.occurredAt ?? opts.updatedAt,
    payload: {
      storeId: opts.storeExternalId,
      businessId: opts.session.businessExternalId,
      businessName: "Negocio",
      name: "Tienda",
      baseCurrency: "CUP",
      publishToStore: opts.publishToStore ?? true,
      updatedAt: opts.updatedAt,
      ...(opts.openingHours !== undefined ? { openingHours: opts.openingHours } : {}),
      ...(opts.zoneCode !== undefined ? { zoneCode: opts.zoneCode } : {}),
      ...(opts.phone !== undefined ? { phone: opts.phone } : {}),
      ...(opts.deliveryEnabled !== undefined ? { deliveryEnabled: opts.deliveryEnabled } : {}),
      ...(opts.deliveryFeeMode !== undefined ? { deliveryFeeMode: opts.deliveryFeeMode } : {}),
      ...(opts.deliveryFee !== undefined ? { deliveryFee: opts.deliveryFee } : {}),
    },
  };
}

async function readStore(storeId: string) {
  return prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { zoneCode: true, phone: true, deliveryFeeMode: true, deliveryEnabled: true },
  });
}

async function readTariffRow(storeId: string, zoneCode: string) {
  return prisma.zoneTariff.findUnique({
    where: { storeId_zoneCode: { storeId, zoneCode } },
  });
}

async function countTariffRows(storeId: string) {
  return prisma.zoneTariff.count({ where: { storeId } });
}

describe("ZONE_TARIFF against real Postgres, through the real POST (paso 16)", () => {
  let session: FixtureSession;

  beforeEach(async () => {
    session = await createFixtureSession();
    revalidateTagSpy.mockClear();
  });

  afterEach(async () => {
    await prisma.syncEvent.deleteMany({ where: { businessId: session.businessExternalId } });
    await session.cleanup();
  });

  it("C2 (E1): a valid ZONE_TARIFF saves — 207 processed, and the row holds the exact rule, importe and mark", async () => {
    const store = await session.createStore();
    const eventId = `${session.token}-c2`;

    const { status, body } = await post(session, [
      zoneTariffEvent({
        eventId,
        storeExternalId: store.externalId,
        zoneCode: "21.01",
        rule: "FEE",
        deliveryFee: 300,
        updatedAt: "2026-09-08T14:03:00.000Z",
      }),
    ]);

    expect(status).toBe(207);
    expect(body.ok).toContain(eventId);
    expect(body.results.find((r) => r.eventId === eventId)).toEqual({
      eventId,
      status: "processed",
    });

    const row = await readTariffRow(store.id, "21.01");
    expect(row).toMatchObject({ rule: "FEE" });
    expect(row?.deliveryFee?.toString()).toBe("300");
    expect(row?.sourceUpdatedAt).toEqual(new Date("2026-09-08T14:03:00.000Z"));
  });

  it("E2: the same pair repeated with a NEWER mark updates in place — still ONE row", async () => {
    const store = await session.createStore();
    await post(session, [
      zoneTariffEvent({
        eventId: `${session.token}-e2-first`,
        storeExternalId: store.externalId,
        zoneCode: "21.01",
        rule: "FEE",
        deliveryFee: 300,
        updatedAt: "2026-09-08T14:00:00.000Z",
      }),
    ]);

    const { body } = await post(session, [
      zoneTariffEvent({
        eventId: `${session.token}-e2-second`,
        storeExternalId: store.externalId,
        zoneCode: "21.01",
        rule: "FEE",
        deliveryFee: 350,
        updatedAt: "2026-09-08T15:00:00.000Z",
      }),
    ]);

    expect(body.results[0]).toEqual({ eventId: `${session.token}-e2-second`, status: "processed" });
    expect(await countTariffRows(store.id)).toBe(1);
    const row = await readTariffRow(store.id, "21.01");
    expect(row?.deliveryFee?.toString()).toBe("350");
  });

  it("C5 (E3): updatedAt < and == the saved mark BOTH respond stale and do not pisar the vigente importe (R21's '>=')", async () => {
    const store = await session.createStore();
    await post(session, [
      zoneTariffEvent({
        eventId: `${session.token}-c5-seed`,
        storeExternalId: store.externalId,
        zoneCode: "21.01",
        rule: "FEE",
        deliveryFee: 350,
        updatedAt: "2026-09-08T15:00:00.000Z",
      }),
    ]);
    const seeded = await readTariffRow(store.id, "21.01");

    // `<`
    const { body: olderBody } = await post(session, [
      zoneTariffEvent({
        eventId: `${session.token}-c5-older`,
        storeExternalId: store.externalId,
        zoneCode: "21.01",
        rule: "FEE",
        deliveryFee: 100,
        updatedAt: "2026-09-08T14:00:00.000Z",
      }),
    ]);
    expect(olderBody.results[0]).toEqual({
      eventId: `${session.token}-c5-older`,
      status: "stale",
    });
    expect(olderBody.ok).toContain(`${session.token}-c5-older`);
    expect(await readTariffRow(store.id, "21.01")).toEqual(seeded);

    // `==` — the half of R21's guard everyone forgets
    const { body: tiedBody } = await post(session, [
      zoneTariffEvent({
        eventId: `${session.token}-c5-tied`,
        storeExternalId: store.externalId,
        zoneCode: "21.01",
        rule: "FEE",
        deliveryFee: 999,
        updatedAt: "2026-09-08T15:00:00.000Z",
      }),
    ]);
    expect(tiedBody.results[0]).toEqual({ eventId: `${session.token}-c5-tied`, status: "stale" });
    expect(await readTariffRow(store.id, "21.01")).toEqual(seeded);
  });

  it("caso límite 1: two ZONE_TARIFF of the same pair in ONE batch apply in occurredAt order — the later wins, the earlier is stale", async () => {
    const store = await session.createStore();

    const laterId = `${session.token}-cl1-later`;
    const earlierId = `${session.token}-cl1-earlier`;
    const { body } = await post(session, [
      // Array order is deliberately REVERSED — inbox.ts sorts by occurredAt,
      // not by array position.
      zoneTariffEvent({
        eventId: earlierId,
        storeExternalId: store.externalId,
        zoneCode: "21.02",
        rule: "FEE",
        deliveryFee: 100,
        updatedAt: "2026-09-08T10:00:00.000Z",
        occurredAt: "2026-09-08T10:00:00.000Z",
      }),
      zoneTariffEvent({
        eventId: laterId,
        storeExternalId: store.externalId,
        zoneCode: "21.02",
        rule: "FEE",
        deliveryFee: 200,
        updatedAt: "2026-09-08T11:00:00.000Z",
        occurredAt: "2026-09-08T11:00:00.000Z",
      }),
    ]);

    expect(body.results.find((r) => r.eventId === laterId)).toEqual({
      eventId: laterId,
      status: "processed",
    });
    const row = await readTariffRow(store.id, "21.02");
    expect(row?.deliveryFee?.toString()).toBe("200");
  });

  it("C4 (E4) + E5: a DELETE is rejected with ZONE_TARIFF_DELETE_NOT_SUPPORTED and touches ZERO rows, even with a NEWER mark and even with an OLDER (rancid) one", async () => {
    const store = await session.createStore();
    await post(session, [
      zoneTariffEvent({
        eventId: `${session.token}-c4-seed`,
        storeExternalId: store.externalId,
        zoneCode: "21.01",
        rule: "FEE",
        deliveryFee: 300,
        updatedAt: "2026-09-08T10:00:00.000Z",
      }),
    ]);
    await post(session, [
      zoneTariffEvent({
        eventId: `${session.token}-c4-seed2`,
        storeExternalId: store.externalId,
        zoneCode: "21.02",
        rule: "NOT_SERVED",
        updatedAt: "2026-09-08T10:00:00.000Z",
      }),
    ]);
    await post(session, [
      zoneTariffEvent({
        eventId: `${session.token}-c4-seed3`,
        storeExternalId: store.externalId,
        zoneCode: "21",
        rule: "FEE",
        deliveryFee: 500,
        updatedAt: "2026-09-08T10:00:00.000Z",
      }),
    ]);
    const before = await countTariffRows(store.id);
    expect(before).toBe(3);
    const beforeRow = await readTariffRow(store.id, "21.01");

    // E4: a DELETE with a NEWER mark still gets rejected.
    const { body: newerBody } = await post(session, [
      zoneTariffEvent({
        eventId: `${session.token}-c4-delete-newer`,
        storeExternalId: store.externalId,
        zoneCode: "21.01",
        rule: "NOT_SERVED",
        updatedAt: "2026-09-08T12:00:00.000Z",
        operation: "DELETE",
      }),
    ]);
    expect(newerBody.failed).toEqual([
      { id: `${session.token}-c4-delete-newer`, error: ZONE_TARIFF_DELETE_NOT_SUPPORTED },
    ]);
    expect(await countTariffRows(store.id)).toBe(3);
    expect(await readTariffRow(store.id, "21.01")).toEqual(beforeRow);

    // E5: a DELETE with an OLDER (rancid) mark responds the SAME error,
    // never "stale" — the rejection runs BEFORE the anti-stale guard.
    const { body: olderBody } = await post(session, [
      zoneTariffEvent({
        eventId: `${session.token}-c4-delete-older`,
        storeExternalId: store.externalId,
        zoneCode: "21.01",
        rule: "NOT_SERVED",
        updatedAt: "2000-01-01T00:00:00.000Z",
        operation: "DELETE",
      }),
    ]);
    expect(olderBody.results[0]).toEqual({
      eventId: `${session.token}-c4-delete-older`,
      status: "failed",
      error: ZONE_TARIFF_DELETE_NOT_SUPPORTED,
    });
    expect(olderBody.results[0].status).not.toBe("stale");
    expect(await countTariffRows(store.id)).toBe(3);
    expect(await readTariffRow(store.id, "21.01")).toEqual(beforeRow);
  });

  it("C1 (F-043, supersedes F-041's criterion 6): a ZONE_TARIFF whose zoneCode is not in the published catalog fails ONLY that event — 207, ZONE_TARIFF_ZONE_UNKNOWN in failed[], the PRODUCT next to it still applies, and it writes NOTHING for the tariff", async () => {
    const store = await session.createStore();
    const zoneEventId = `${session.token}-c1-zone`;
    const productEventId = `${session.token}-c1-product`;
    const storeProductId = `${session.token}-c1-sp`;

    const { status, body } = await post(session, [
      zoneTariffEvent({
        eventId: zoneEventId,
        storeExternalId: store.externalId,
        zoneCode: "99.99",
        rule: "FEE",
        deliveryFee: 300,
        updatedAt: "2026-09-08T10:00:00.000Z",
      }),
      productEvent({
        eventId: productEventId,
        session,
        storeExternalId: store.externalId,
        storeProductId,
        occurredAt: "2026-09-08T10:00:01.000Z",
      }),
    ]);

    expect(status).toBe(207);
    expect(body.failed).toEqual([{ id: zoneEventId, error: ZONE_TARIFF_ZONE_UNKNOWN }]);
    expect(body.ok).toContain(productEventId);
    expect(body.ok).not.toContain(zoneEventId);

    const events = await prisma.syncEvent.findMany({
      where: { eventId: { in: [zoneEventId, productEventId] } },
      select: { eventId: true, status: true },
    });
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.eventId === zoneEventId)?.status).toBe("FAILED");
    expect(events.find((e) => e.eventId === productEventId)?.status).toBe("PROCESSED");

    expect(await countTariffRows(store.id)).toBe(0);
    const productWritten = await prisma.storeProduct.count({
      where: { storeId: store.id, externalId: storeProductId },
    });
    expect(productWritten).toBe(1);
  });

  it.each(["2101", "", " 21.01"].map((zoneCode, i) => ({ zoneCode, i })))(
    "C2 (E2): a malformed zoneCode ($zoneCode) fails ONLY that event with ZONE_TARIFF_ZONE_UNKNOWN — never 400 — the other two events of the same lote still apply",
    async ({ zoneCode, i }) => {
      const store = await session.createStore();
      const zoneEventId = `${session.token}-c2-malformed-${i}`;
      const productEventId = `${session.token}-c2-product-${i}`;
      const goodZoneEventId = `${session.token}-c2-good-${i}`;
      const storeProductId = `${session.token}-c2-sp-${i}`;

      const { status, body } = await post(session, [
        zoneTariffEvent({
          eventId: zoneEventId,
          storeExternalId: store.externalId,
          zoneCode,
          rule: "FEE",
          deliveryFee: 300,
          updatedAt: "2026-09-08T10:00:00.000Z",
        }),
        productEvent({
          eventId: productEventId,
          session,
          storeExternalId: store.externalId,
          storeProductId,
          occurredAt: "2026-09-08T10:00:01.000Z",
        }),
        zoneTariffEvent({
          eventId: goodZoneEventId,
          storeExternalId: store.externalId,
          zoneCode: "21.01",
          rule: "FEE",
          deliveryFee: 400,
          updatedAt: "2026-09-08T10:00:02.000Z",
        }),
      ]);

      expect(status).not.toBe(400);
      expect(status).toBe(207);
      expect(body.failed).toEqual([{ id: zoneEventId, error: ZONE_TARIFF_ZONE_UNKNOWN }]);
      expect(body.ok).toEqual(expect.arrayContaining([productEventId, goodZoneEventId]));
      expect(await countTariffRows(store.id)).toBe(1);
      expect(await readTariffRow(store.id, "21.01")).not.toBeNull();
    },
  );

  it("C7 (E8): a DELETE with an INVALID zoneCode still responds ZONE_TARIFF_DELETE_NOT_SUPPORTED — never ZONE_TARIFF_ZONE_UNKNOWN, the format check is never reached", async () => {
    const eventId = `${session.token}-c7-delete-invalid`;

    const { body } = await post(session, [
      zoneTariffEvent({
        eventId,
        storeExternalId: `${session.token}-c7-delete-store`, // never queried — R20 rejects before any lookup
        zoneCode: "2101", // malformed, on top of being a DELETE
        rule: "NOT_SERVED",
        updatedAt: "2026-09-08T10:00:00.000Z",
        operation: "DELETE",
      }),
    ]);

    expect(body.results[0]).toEqual({
      eventId,
      status: "failed",
      error: ZONE_TARIFF_DELETE_NOT_SUPPORTED,
    });
  });

  it("C7 (E9): a ZONE_TARIFF with an INVALID zoneCode on a storeId that does not exist here is skipped_not_published in ok — never failed[]", async () => {
    const eventId = `${session.token}-c7-skipped-invalid`;

    const { body } = await post(session, [
      zoneTariffEvent({
        eventId,
        storeExternalId: `${session.token}-c7-nonexistent-store`,
        zoneCode: "99.99",
        rule: "FEE",
        deliveryFee: 300,
        updatedAt: "2026-09-08T10:00:00.000Z",
      }),
    ]);

    expect(body.results[0]).toEqual({ eventId, status: "skipped_not_published" });
    expect(body.ok).toContain(eventId);
  });

  it("C7 (E10): a ZONE_TARIFF with an INVALID zoneCode on ANOTHER business's store responds byte for byte like a nonexistent one — skipped_not_published in ok, zero rows written for that business", async () => {
    const otherSession = await createFixtureSession();
    try {
      const otherStore = await otherSession.createStore();
      const eventId = `${session.token}-c7-foreign`;

      const { body } = await post(session, [
        zoneTariffEvent({
          eventId,
          storeExternalId: otherStore.externalId,
          zoneCode: "99.99",
          rule: "FEE",
          deliveryFee: 300,
          updatedAt: "2026-09-08T10:00:00.000Z",
        }),
      ]);

      expect(body.results[0]).toEqual({ eventId, status: "skipped_not_published" });
      expect(body.ok).toContain(eventId);
      expect(await countTariffRows(otherStore.id)).toBe(0);
    } finally {
      await otherSession.cleanup();
    }
  });

  it("C3, the Zod discriminator quirk: a malformed `rule` is STILL 400 INVALID_BATCH, even though the issue Zod produces is its own discriminator message, not ours", async () => {
    const store = await session.createStore();
    const eventId = `${session.token}-c3-bad-rule`;

    const { status, body } = await post(session, [
      {
        eventId,
        entity: "ZONE_TARIFF",
        operation: "UPDATE",
        occurredAt: "2026-09-08T10:00:00.000Z",
        payload: {
          storeId: store.externalId,
          zoneCode: "21.01",
          rule: "SERVED", // not one of FEE | NOT_SERVED | INHERIT
          updatedAt: "2026-09-08T10:00:00.000Z",
        },
      },
    ]);

    expect(status).toBe(400);
    expect(body.error).toBe("INVALID_BATCH");
    expect(Array.isArray(body.issues)).toBe(true);
    expect((body.issues as unknown[]).length).toBeGreaterThan(0);
    const written = await prisma.syncEvent.count({ where: { eventId } });
    expect(written).toBe(0);
  });

  it("E11/R24: a ZONE_TARIFF whose storeId does not exist for this business is skipped_not_published — in `ok`, zero rows written", async () => {
    const eventId = `${session.token}-e11`;
    const { body } = await post(session, [
      zoneTariffEvent({
        eventId,
        storeExternalId: `${session.token}-nonexistent-store`,
        zoneCode: "21.01",
        rule: "FEE",
        deliveryFee: 300,
        updatedAt: "2026-09-08T10:00:00.000Z",
      }),
    ]);

    expect(body.results[0]).toEqual({ eventId, status: "skipped_not_published" });
    expect(body.ok).toContain(eventId);
  });

  it("E12: an INHERIT at province level is accepted and retracts a prior FEE — R20's only mechanism of retraction", async () => {
    const store = await session.createStore();
    await post(session, [
      zoneTariffEvent({
        eventId: `${session.token}-e12-fee`,
        storeExternalId: store.externalId,
        zoneCode: "21",
        rule: "FEE",
        deliveryFee: 400,
        updatedAt: "2026-09-08T10:00:00.000Z",
      }),
    ]);

    const { body } = await post(session, [
      zoneTariffEvent({
        eventId: `${session.token}-e12-inherit`,
        storeExternalId: store.externalId,
        zoneCode: "21",
        rule: "INHERIT",
        updatedAt: "2026-09-08T11:00:00.000Z",
      }),
    ]);

    expect(body.results[0]).toEqual({
      eventId: `${session.token}-e12-inherit`,
      status: "processed",
    });
    const row = await readTariffRow(store.id, "21");
    expect(row?.rule).toBe("INHERIT");
    expect(row?.deliveryFee).toBeNull();
  });

  describe("C8: a STORE DELETE that APPLIES takes its ZoneTariff rows with it (R22)", () => {
    it("via the sync's own DELETE path (handlers/store.ts's explicit deleteMany — I1: the row is SUSPENDED, never actually deleted)", async () => {
      const store = await session.createStore();
      await post(session, [
        zoneTariffEvent({
          eventId: `${session.token}-c8-t1`,
          storeExternalId: store.externalId,
          zoneCode: "21.01",
          rule: "FEE",
          deliveryFee: 100,
          updatedAt: "2026-09-08T10:00:00.000Z",
        }),
        zoneTariffEvent({
          eventId: `${session.token}-c8-t2`,
          storeExternalId: store.externalId,
          zoneCode: "21.02",
          rule: "NOT_SERVED",
          updatedAt: "2026-09-08T10:00:00.000Z",
        }),
        zoneTariffEvent({
          eventId: `${session.token}-c8-t3`,
          storeExternalId: store.externalId,
          zoneCode: "21",
          rule: "FEE",
          deliveryFee: 500,
          updatedAt: "2026-09-08T10:00:00.000Z",
        }),
      ]);
      expect(await countTariffRows(store.id)).toBe(3);

      const { body } = await post(session, [
        storeEvent({
          eventId: `${session.token}-c8-delete`,
          session,
          storeExternalId: store.externalId,
          updatedAt: "2026-09-08T12:00:00.000Z",
          operation: "DELETE",
        }),
      ]);
      expect(body.results[0]).toEqual({
        eventId: `${session.token}-c8-delete`,
        status: "processed",
      });

      expect(await countTariffRows(store.id)).toBe(0);
      // I1: the row is SUSPENDED, not gone — a real DELETE never runs, which
      // is why R22 needs the explicit deleteMany at all.
      const suspended = await prisma.store.findUnique({
        where: { id: store.id },
        select: { status: true },
      });
      expect(suspended?.status).toBe("SUSPENDED");
    });

    it("via the real onDelete: Cascade FK, when a Store row is ACTUALLY deleted (the declared half of R22, for the day a real delete exists)", async () => {
      const store = await session.createStore();
      await prisma.zoneTariff.create({
        data: {
          storeId: store.id,
          zoneCode: "21.01",
          rule: "FEE",
          deliveryFee: "100.00",
          sourceUpdatedAt: new Date("2026-09-08T10:00:00.000Z"),
        },
      });
      expect(await countTariffRows(store.id)).toBe(1);

      await prisma.order.deleteMany({ where: { storeId: store.id } });
      await prisma.storeProduct.deleteMany({ where: { storeId: store.id } });
      await prisma.store.delete({ where: { id: store.id } });

      expect(await countTariffRows(store.id)).toBe(0);
    });
  });

  describe("C12/E18: applying a ZONE_TARIFF invalidates EXACTLY that branch's own tags, once per batch (F-035's machinery, not reimplemented)", () => {
    it("a single-branch brand: canonicalSlug() is the BRAND's own slug — one storeTag + one storeCatalogTag, not two", async () => {
      const store = await session.createStore();
      revalidateTagSpy.mockClear();

      await post(session, [
        zoneTariffEvent({
          eventId: `${session.token}-c12-single`,
          storeExternalId: store.externalId,
          zoneCode: "21.01",
          rule: "FEE",
          deliveryFee: 300,
          updatedAt: "2026-09-08T10:00:00.000Z",
        }),
      ]);

      const storeTagCalls = revalidateTagSpy.mock.calls
        .map(([tag]) => String(tag))
        .filter((tag) => tag.startsWith("store:"));
      const brandSlug = `${session.token}-storefront`;
      expect(new Set(storeTagCalls)).toEqual(
        new Set([`store:${brandSlug}`, `store:${brandSlug}:catalog`]),
      );
    });

    it("twenty tariffs of the SAME branch in one batch invalidate its tags exactly ONCE, not twenty times", async () => {
      const store = await session.createStore();
      revalidateTagSpy.mockClear();

      const events = Array.from({ length: 20 }, (_, i) =>
        zoneTariffEvent({
          eventId: `${session.token}-c12-bulk-${i}`,
          storeExternalId: store.externalId,
          zoneCode: i % 2 === 0 ? "21.01" : "21.02",
          rule: "FEE",
          deliveryFee: 100 + i,
          updatedAt: `2026-09-08T10:${String(i).padStart(2, "0")}:00.000Z`,
        }),
      );
      const { body } = await post(session, events);
      expect(body.ok).toHaveLength(20);

      const storeTagCalls = revalidateTagSpy.mock.calls
        .map(([tag]) => String(tag))
        .filter((tag) => tag.startsWith("store:"));
      expect(storeTagCalls).toHaveLength(2); // storeTag + storeCatalogTag, ONCE
    });

    it("a STALE event fires ZERO revalidateTag (R25: nothing not-just-written is invalidated)", async () => {
      const store = await session.createStore();
      await post(session, [
        zoneTariffEvent({
          eventId: `${session.token}-c12-seed`,
          storeExternalId: store.externalId,
          zoneCode: "21.01",
          rule: "FEE",
          deliveryFee: 300,
          updatedAt: "2026-09-08T12:00:00.000Z",
        }),
      ]);
      revalidateTagSpy.mockClear();

      await post(session, [
        zoneTariffEvent({
          eventId: `${session.token}-c12-stale`,
          storeExternalId: store.externalId,
          zoneCode: "21.01",
          rule: "FEE",
          deliveryFee: 999,
          updatedAt: "2026-09-08T11:00:00.000Z",
        }),
      ]);

      expect(revalidateTagSpy).not.toHaveBeenCalled();
    });

    it("a failed DELETE (ZONE_TARIFF_DELETE_NOT_SUPPORTED) fires ZERO revalidateTag", async () => {
      const store = await session.createStore();
      revalidateTagSpy.mockClear();

      await post(session, [
        zoneTariffEvent({
          eventId: `${session.token}-c12-delete-fail`,
          storeExternalId: store.externalId,
          zoneCode: "21.01",
          rule: "NOT_SERVED",
          updatedAt: "2026-09-08T10:00:00.000Z",
          operation: "DELETE",
        }),
      ]);

      expect(revalidateTagSpy).not.toHaveBeenCalled();
    });

    it("skipped_not_published (an unknown storeId) fires ZERO revalidateTag", async () => {
      revalidateTagSpy.mockClear();

      await post(session, [
        zoneTariffEvent({
          eventId: `${session.token}-c12-skipped`,
          storeExternalId: `${session.token}-nonexistent-store`,
          zoneCode: "21.01",
          rule: "FEE",
          deliveryFee: 300,
          updatedAt: "2026-09-08T10:00:00.000Z",
        }),
      ]);

      expect(revalidateTagSpy).not.toHaveBeenCalled();
    });
  });

  it("E19/R23: a ZONE_TARIFF whose STORE fails in the SAME batch returns DEPENDENCY_FAILED_IN_BATCH, never skipped_not_published", async () => {
    const brandNewStoreExternalId = `${session.token}-e19-store`;
    const storeEventId = `${session.token}-e19-store-event`;
    const zoneEventId = `${session.token}-e19-zone-event`;

    const { body } = await post(session, [
      storeEvent({
        eventId: storeEventId,
        session,
        storeExternalId: brandNewStoreExternalId,
        updatedAt: "2026-09-08T10:00:00.000Z",
        occurredAt: "2026-09-08T10:00:00.000Z",
        // A malformed calendar fails THIS store event (STORE_OPENING_HOURS_INVALID).
        openingHours: "not-a-valid-schedule",
      }),
      zoneTariffEvent({
        eventId: zoneEventId,
        storeExternalId: brandNewStoreExternalId,
        zoneCode: "21.01",
        rule: "FEE",
        deliveryFee: 300,
        updatedAt: "2026-09-08T10:00:01.000Z",
        occurredAt: "2026-09-08T10:00:01.000Z",
      }),
    ]);

    expect(body.results.find((r) => r.eventId === storeEventId)?.status).toBe("failed");
    expect(body.results.find((r) => r.eventId === zoneEventId)).toEqual({
      eventId: zoneEventId,
      status: "failed",
      error: "DEPENDENCY_FAILED_IN_BATCH",
    });
    expect(body.ok).not.toContain(zoneEventId);
  });

  describe("C9: a STORE's zoneCode against the real POST (R18/R29)", () => {
    it("an unknown zoneCode fails THAT event entire — none of its other fields apply, not even a phone that would have landed fine", async () => {
      const store = await session.createStore();

      const { body } = await post(session, [
        storeEvent({
          eventId: `${session.token}-c9-unknown`,
          session,
          storeExternalId: store.externalId,
          updatedAt: "2026-09-08T10:00:00.000Z",
          zoneCode: "99.99",
          phone: "+5355550000",
        }),
      ]);

      expect(body.results[0]).toEqual({
        eventId: `${session.token}-c9-unknown`,
        status: "failed",
        error: "STORE_ZONE_UNKNOWN",
      });

      const row = await readStore(store.id);
      expect(row.zoneCode).toBeNull();
      expect(row.phone).toBeNull(); // never applied — R18's whole point
    });

    it("a zoneCode from the published catalog saves — the column reads back exactly what was sent", async () => {
      const store = await session.createStore();

      const { body } = await post(session, [
        storeEvent({
          eventId: `${session.token}-c9-known`,
          session,
          storeExternalId: store.externalId,
          updatedAt: "2026-09-08T10:00:00.000Z",
          zoneCode: "21.01",
        }),
      ]);

      expect(body.results[0]).toEqual({
        eventId: `${session.token}-c9-known`,
        status: "processed",
      });
      const row = await readStore(store.id);
      expect(row.zoneCode).toBe("21.01");
    });

    it('F-043 (C3, E3/E4): a malformed zoneCode (no dot, "2101") fails THAT event exactly like an unknown one — same error, never 400, none of its other fields apply', async () => {
      const store = await session.createStore();

      const { status, body } = await post(session, [
        storeEvent({
          eventId: `${session.token}-c9-malformed`,
          session,
          storeExternalId: store.externalId,
          updatedAt: "2026-09-08T10:00:00.000Z",
          zoneCode: "2101",
          phone: "+5355550000",
        }),
      ]);

      expect(status).not.toBe(400);
      expect(status).toBe(207);
      expect(body.results[0]).toEqual({
        eventId: `${session.token}-c9-malformed`,
        status: "failed",
        error: "STORE_ZONE_UNKNOWN",
      });

      const row = await readStore(store.id);
      expect(row.zoneCode).toBeNull();
      expect(row.phone).toBeNull(); // never applied — same guard as C9's unknown case
    });

    it("F-043 (C6): zoneCode: null clears an existing column — processed, never checked against the catalog (R9)", async () => {
      const store = await session.createStore();
      await post(session, [
        storeEvent({
          eventId: `${session.token}-c6-null-seed`,
          session,
          storeExternalId: store.externalId,
          updatedAt: "2026-09-08T10:00:00.000Z",
          zoneCode: "21.01",
        }),
      ]);
      expect((await readStore(store.id)).zoneCode).toBe("21.01");

      const { body } = await post(session, [
        storeEvent({
          eventId: `${session.token}-c6-null`,
          session,
          storeExternalId: store.externalId,
          updatedAt: "2026-09-08T11:00:00.000Z",
          zoneCode: null,
        }),
      ]);

      expect(body.results[0]).toEqual({
        eventId: `${session.token}-c6-null`,
        status: "processed",
      });
      expect((await readStore(store.id)).zoneCode).toBeNull();
    });

    it("F-043 (C6): a STORE event WITHOUT the zoneCode key leaves the column intact — 'omitir no es apagar' (R29 of F-041, unchanged)", async () => {
      const store = await session.createStore();
      await post(session, [
        storeEvent({
          eventId: `${session.token}-c6-absent-seed`,
          session,
          storeExternalId: store.externalId,
          updatedAt: "2026-09-08T10:00:00.000Z",
          zoneCode: "21.01",
        }),
      ]);
      expect((await readStore(store.id)).zoneCode).toBe("21.01");

      const { body } = await post(session, [
        storeEvent({
          eventId: `${session.token}-c6-absent`,
          session,
          storeExternalId: store.externalId,
          updatedAt: "2026-09-08T11:00:00.000Z",
          phone: "+5355551111",
          // zoneCode deliberately not passed: storeEvent() only spreads the
          // key when its opt is !== undefined, so the payload omits it
          // entirely — this is "absent", not "null".
        }),
      ]);

      expect(body.results[0]).toEqual({
        eventId: `${session.token}-c6-absent`,
        status: "processed",
      });
      expect((await readStore(store.id)).zoneCode).toBe("21.01");
    });
  });

  it("C10: deliveryFeeMode ZONE_BASED is accepted with NO deliveryFee — saved and read back, never STORE_DELIVERY_CONFIG_INCONSISTENT (R12)", async () => {
    const store = await session.createStore();

    const { body } = await post(session, [
      storeEvent({
        eventId: `${session.token}-c10`,
        session,
        storeExternalId: store.externalId,
        updatedAt: "2026-09-08T10:00:00.000Z",
        deliveryEnabled: true,
        deliveryFeeMode: "ZONE_BASED",
      }),
    ]);

    expect(body.results[0]).toEqual({ eventId: `${session.token}-c10`, status: "processed" });
    const row = await readStore(store.id);
    expect(row.deliveryFeeMode).toBe("ZONE_BASED");
    expect(row.deliveryEnabled).toBe(true);
  });
});
