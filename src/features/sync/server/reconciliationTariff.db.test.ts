import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createFixtureSession,
  type FixtureSession,
  type FixtureStore,
} from "@/features/marketplace/server/dbFixtures";
import { storeReconciliationHash } from "./reconciliation";
import { extractVectorBlock, readContract } from "@/features/sync/contractVector";
import type { TariffRow } from "@/features/zones/precedence";

// `next/cache` mocked the same passthrough/counting way
// `zoneTariff.db.test.ts` already does it — `revalidateTag` needs a
// request-scoped "static generation store" that only exists inside a
// running Next server (ficha `db-test-revalidatetag-static-generation-store-missing`).
// Declared once, at module scope, for the whole file (both `describe`
// blocks): `vi.mock` is hoisted by Vitest's transform only when it is a
// top-level call, not when nested inside a `describe` callback.
const revalidateTagSpy = vi.fn();
vi.mock("next/cache", () => ({
  revalidateTag: (...args: unknown[]) => revalidateTagSpy(...args),
  unstable_cache: (fn: unknown) => fn,
}));

const { POST } = await import("@/app/api/internal/sync/catalog/route");

/**
 * F-044 (plan.md paso 9; architecture.md § D4; spec.md E2-E10, E13-E15b,
 * E17, E18): a NEW `.db.test.ts` file, not an appendix to
 * `reconciliation.db.test.ts` — that file is R14's guardian and this feature
 * does not touch it. Two `describe` blocks sharing the fixture session, the
 * same partition F-041 already used between `tariffs.db.test.ts` and
 * `zoneTariff.db.test.ts`: one writes rows directly with
 * `prisma.zoneTariff.create` (E2-E4, E9, E10, E13-E15b, E18), the other
 * through the real `POST /api/internal/sync/catalog` (E5-E8, E17).
 *
 * Zone codes are REAL rows of the committed catalog (`21` Pinar del Río and
 * its municipalities `21.01`-`21.11`): using real codes means this file
 * never has to fake a catalog entry, and `ZoneTariff.zoneCode`'s FK against
 * `Zone` would reject a synthetic one anyway.
 */

const EMPTY_HASH = "d41d8cd98f00b204e9800998ecf8427e";

async function createTariffRow(
  storeId: string,
  zoneCode: string,
  rule: "FEE" | "NOT_SERVED" | "INHERIT",
  deliveryFee: string | null,
  sourceUpdatedAt = new Date("2026-09-08T10:00:00.000Z"),
) {
  await prisma.zoneTariff.create({
    data: { storeId, zoneCode, rule, deliveryFee, sourceUpdatedAt },
  });
}

describe("storeReconciliationHash — tariff half, direct writes against real Postgres", () => {
  let session: FixtureSession;

  beforeAll(async () => {
    session = await createFixtureSession();
  });

  afterAll(async () => {
    await session.cleanup();
  });

  it("E9: a store with no ZoneTariff rows at all responds tariffs: 0, tariffHash: EMPTY_HASH", async () => {
    const store = await session.createStore();
    const result = await storeReconciliationHash(session.businessId, store.externalId);
    expect(result).toMatchObject({ tariffs: 0, tariffHash: EMPTY_HASH });
  });

  it("E10: a store whose only rows are INHERIT gives the same result as no rows at all", async () => {
    const store = await session.createStore();
    await createTariffRow(store.id, "21", "INHERIT", null);
    await createTariffRow(store.id, "21.01", "INHERIT", null);

    const result = await storeReconciliationHash(session.businessId, store.externalId);
    expect(result).toMatchObject({ tariffs: 0, tariffHash: EMPTY_HASH });
  });

  it("E2: the same store read twice without any change in between gives the same four fields", async () => {
    const store = await session.createStore();
    await createTariffRow(store.id, "21.01", "FEE", "300.00");

    const first = await storeReconciliationHash(session.businessId, store.externalId);
    const second = await storeReconciliationHash(session.businessId, store.externalId);
    expect(second).toEqual(first);
  });

  it("E3: two stores whose tariff rows differ give different tariffHash", async () => {
    const storeA = await session.createStore();
    const storeB = await session.createStore();
    await createTariffRow(storeA.id, "21.01", "FEE", "300.00");
    await createTariffRow(storeB.id, "21.01", "FEE", "400.00");

    const a = await storeReconciliationHash(session.businessId, storeA.externalId);
    const b = await storeReconciliationHash(session.businessId, storeB.externalId);
    expect(a!.tariffHash).not.toBe(b!.tariffHash);
  });

  it("E4: the same set of rows inserted in opposite orders gives the same tariffs and tariffHash", async () => {
    const storeAscending = await session.createStore();
    const storeDescending = await session.createStore();
    const rows: [string, "FEE" | "NOT_SERVED", string | null][] = [
      ["21", "FEE", "100.00"],
      ["21.01", "FEE", "200.00"],
      ["23.01", "NOT_SERVED", null],
    ];

    for (const [zoneCode, rule, deliveryFee] of rows) {
      await createTariffRow(storeAscending.id, zoneCode, rule, deliveryFee);
    }
    for (const [zoneCode, rule, deliveryFee] of [...rows].reverse()) {
      await createTariffRow(storeDescending.id, zoneCode, rule, deliveryFee);
    }

    const ascending = await storeReconciliationHash(session.businessId, storeAscending.externalId);
    const descending = await storeReconciliationHash(
      session.businessId,
      storeDescending.externalId,
    );
    expect(ascending!.tariffs).toBe(descending!.tariffs);
    expect(ascending!.tariffHash).toBe(descending!.tariffHash);
  });

  it("E18: the tariff hash does not depend on the store's delivery configuration", async () => {
    const flatRateStore = await session.createStore();
    const zoneBasedStore = await session.createStore();
    await prisma.store.update({
      where: { id: flatRateStore.id },
      data: { deliveryEnabled: false, deliveryFeeMode: "FLAT_RATE" },
    });
    await prisma.store.update({
      where: { id: zoneBasedStore.id },
      data: { deliveryEnabled: true, deliveryFeeMode: "ZONE_BASED" },
    });
    await createTariffRow(flatRateStore.id, "21.01", "FEE", "300.00");
    await createTariffRow(zoneBasedStore.id, "21.01", "FEE", "300.00");

    const flatRate = await storeReconciliationHash(session.businessId, flatRateStore.externalId);
    const zoneBased = await storeReconciliationHash(session.businessId, zoneBasedStore.externalId);
    expect(flatRate!.tariffs).toBe(zoneBased!.tariffs);
    expect(flatRate!.tariffHash).toBe(zoneBased!.tariffHash);
  });

  describe("E13/E14: the SQL mirror published in docs/sync-contract.md § ⑤", () => {
    type MirrorRow = { tariffs: bigint | number | string; tariffHash: string };

    /**
     * R11's SQL, written BY HAND against `ZoneTariff` — never composed from
     * `tariffEntry`/`tariffReconciliation`: the whole point of E13/E14 is
     * that two INDEPENDENT implementations agree, and that the two naive
     * shortcuts (no normalization, no INHERIT exclusion) do NOT.
     */
    async function runMirrorSql(
      storeId: string,
      opts: { normalizeAmount: boolean; excludeInherit: boolean },
    ): Promise<{ tariffs: number; tariffHash: string }> {
      const amountExpr = opts.normalizeAmount
        ? Prisma.sql`trim(trailing '.' from trim(trailing '0' from round(t."deliveryFee"::numeric, 2)::text))`
        : Prisma.sql`t."deliveryFee"::text`;
      const whereExtra = opts.excludeInherit ? Prisma.sql`AND t."rule" <> 'INHERIT'` : Prisma.empty;

      const rows = await prisma.$queryRaw<MirrorRow[]>(Prisma.sql`
        SELECT count(*) AS tariffs,
               md5(coalesce(string_agg(
                      t."zoneCode" || ':' ||
                      t."rule"::text || ':' ||
                      coalesce(case when t."rule" = 'FEE'
                                    then ${amountExpr}
                               end, '') || '|',
                      '' ORDER BY t."zoneCode" COLLATE "C"
                    ), '')) AS "tariffHash"
        FROM "ZoneTariff" t
        WHERE t."storeId" = ${storeId}
        ${whereExtra}
      `);
      const row = rows[0]!;
      return { tariffs: Number(row.tariffs), tariffHash: row.tariffHash };
    }

    it("E13: the hand-written SQL mirror matches storeReconciliationHash(), on a store with rows and on an empty one", async () => {
      const store = await session.createStore();
      await createTariffRow(store.id, "21.01", "FEE", "300.00");
      await createTariffRow(store.id, "21.02", "NOT_SERVED", null);
      await createTariffRow(store.id, "21.03", "INHERIT", null);

      const fromFunction = await storeReconciliationHash(session.businessId, store.externalId);
      const fromSql = await runMirrorSql(store.id, { normalizeAmount: true, excludeInherit: true });
      expect(fromSql.tariffs).toBe(fromFunction!.tariffs);
      expect(fromSql.tariffHash).toBe(fromFunction!.tariffHash);

      const emptyStore = await session.createStore();
      const fromFunctionEmpty = await storeReconciliationHash(
        session.businessId,
        emptyStore.externalId,
      );
      const fromSqlEmpty = await runMirrorSql(emptyStore.id, {
        normalizeAmount: true,
        excludeInherit: true,
      });
      expect(fromSqlEmpty).toEqual({
        tariffs: fromFunctionEmpty!.tariffs,
        tariffHash: fromFunctionEmpty!.tariffHash,
      });
    });

    it("E14a: the naive mirror WITHOUT normalizing the amount gives a DIFFERENT hash — the fixture has at least one trailing zero", async () => {
      const store = await session.createStore();
      await createTariffRow(store.id, "21.01", "FEE", "300.00"); // trailing zeroes
      await createTariffRow(store.id, "21.02", "NOT_SERVED", null);

      const fromFunction = await storeReconciliationHash(session.businessId, store.externalId);
      const naive = await runMirrorSql(store.id, { normalizeAmount: false, excludeInherit: true });
      expect(naive.tariffs).toBe(fromFunction!.tariffs);
      expect(naive.tariffHash).not.toBe(fromFunction!.tariffHash);
    });

    it("E14b: the naive mirror WITHOUT excluding INHERIT gives a DIFFERENT hash — the fixture has at least one INHERIT row", async () => {
      const store = await session.createStore();
      await createTariffRow(store.id, "21.01", "FEE", "300.00");
      await createTariffRow(store.id, "21.02", "INHERIT", null);

      const fromFunction = await storeReconciliationHash(session.businessId, store.externalId);
      const naive = await runMirrorSql(store.id, { normalizeAmount: true, excludeInherit: false });
      expect(naive.tariffs).not.toBe(fromFunction!.tariffs);
      expect(naive.tariffHash).not.toBe(fromFunction!.tariffHash);
    });
  });

  describe("E15b: the contract vector's T1 case, inserted verbatim in a real store", () => {
    type TariffVectorRow = {
      zoneCode: string;
      rule: TariffRow["rule"];
      deliveryFee: string | null;
    };
    type TariffVectorCase = {
      id: string;
      rows: TariffVectorRow[];
      expected: { tariffs: number; entries: string[]; tariffHash: string };
    };
    type TariffVector = { version: string; cases: TariffVectorCase[] };

    const HEADING = "#### Vector del hash del tarifario (v13.4)";

    it("tariffs and tariffHash read back through the endpoint's own function are exactly the vector's own", async () => {
      const contract = readContract();
      const { parsed } = extractVectorBlock<TariffVector>(contract, HEADING);
      const t1 = parsed.cases.find((c) => c.id === "T1");
      expect(t1).toBeDefined();

      const store = await session.createStore();
      for (const row of t1!.rows) {
        await createTariffRow(store.id, row.zoneCode, row.rule, row.deliveryFee);
      }

      const result = await storeReconciliationHash(session.businessId, store.externalId);
      expect(result!.tariffs).toBe(t1!.expected.tariffs);
      expect(result!.tariffHash).toBe(t1!.expected.tariffHash);
    });
  });
});

describe("storeReconciliationHash — tariff half, through the real POST /api/internal/sync/catalog", () => {
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

  function zoneTariffEvent(opts: {
    eventId: string;
    storeExternalId: string;
    zoneCode: string;
    rule: "FEE" | "NOT_SERVED" | "INHERIT";
    deliveryFee?: number;
    updatedAt: string;
  }) {
    return {
      eventId: opts.eventId,
      entity: "ZONE_TARIFF",
      operation: "UPDATE",
      occurredAt: opts.updatedAt,
      payload: {
        storeId: opts.storeExternalId,
        zoneCode: opts.zoneCode,
        rule: opts.rule,
        ...(opts.deliveryFee !== undefined ? { deliveryFee: opts.deliveryFee } : {}),
        updatedAt: opts.updatedAt,
      },
    };
  }

  function productEvent(opts: {
    eventId: string;
    session: FixtureSession;
    storeExternalId: string;
    storeProductId: string;
    updatedAt: string;
  }) {
    return {
      eventId: opts.eventId,
      entity: "PRODUCT",
      operation: "UPDATE",
      occurredAt: opts.updatedAt,
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
        updatedAt: opts.updatedAt,
      },
    };
  }

  let session: FixtureSession;
  let storeA: FixtureStore;
  let storeB: FixtureStore;

  beforeEach(async () => {
    session = await createFixtureSession();
    storeA = await session.createStore();
    storeB = await session.createStore();
    revalidateTagSpy.mockClear();
  });

  afterEach(async () => {
    await prisma.syncEvent.deleteMany({ where: { businessId: session.businessExternalId } });
    await session.cleanup();
  });

  it("E5: applying a ZONE_TARIFF moves the hash of ITS OWN store and no other, before/after", async () => {
    const beforeA = await storeReconciliationHash(session.businessId, storeA.externalId);
    const beforeB = await storeReconciliationHash(session.businessId, storeB.externalId);

    const { status } = await post(session, [
      zoneTariffEvent({
        eventId: `${session.token}-e5`,
        storeExternalId: storeA.externalId,
        zoneCode: "21.01",
        rule: "FEE",
        deliveryFee: 300,
        updatedAt: "2026-09-08T10:00:00.000Z",
      }),
    ]);
    expect(status).toBe(207);

    const afterA = await storeReconciliationHash(session.businessId, storeA.externalId);
    const afterB = await storeReconciliationHash(session.businessId, storeB.externalId);

    expect(afterA!.tariffs).toBe(beforeA!.tariffs + 1);
    expect(afterA!.tariffHash).not.toBe(beforeA!.tariffHash);
    expect(afterB).toEqual(beforeB);
  });

  it("E6: a ZONE_TARIFF that responds stale does not move anything", async () => {
    await post(session, [
      zoneTariffEvent({
        eventId: `${session.token}-e6-seed`,
        storeExternalId: storeA.externalId,
        zoneCode: "21.01",
        rule: "FEE",
        deliveryFee: 300,
        updatedAt: "2026-09-08T12:00:00.000Z",
      }),
    ]);
    const before = await storeReconciliationHash(session.businessId, storeA.externalId);

    const { body } = await post(session, [
      zoneTariffEvent({
        eventId: `${session.token}-e6-stale`,
        storeExternalId: storeA.externalId,
        zoneCode: "21.01",
        rule: "FEE",
        deliveryFee: 999,
        updatedAt: "2026-09-08T11:00:00.000Z", // older than the seed
      }),
    ]);
    expect(body.results[0]).toEqual({
      eventId: `${session.token}-e6-stale`,
      status: "stale",
    });

    const after = await storeReconciliationHash(session.businessId, storeA.externalId);
    expect(after).toEqual(before);
  });

  it("E7: an INHERIT with a newer mark retracts a prior FEE, tariffs goes down by one, and converges to the empty hash when it was the last row", async () => {
    await post(session, [
      zoneTariffEvent({
        eventId: `${session.token}-e7-fee`,
        storeExternalId: storeA.externalId,
        zoneCode: "21.01",
        rule: "FEE",
        deliveryFee: 400,
        updatedAt: "2026-09-08T10:00:00.000Z",
      }),
    ]);
    const before = await storeReconciliationHash(session.businessId, storeA.externalId);
    expect(before!.tariffs).toBe(1);

    const { body } = await post(session, [
      zoneTariffEvent({
        eventId: `${session.token}-e7-inherit`,
        storeExternalId: storeA.externalId,
        zoneCode: "21.01",
        rule: "INHERIT",
        updatedAt: "2026-09-08T11:00:00.000Z",
      }),
    ]);
    expect(body.results[0]).toEqual({
      eventId: `${session.token}-e7-inherit`,
      status: "processed",
    });

    const after = await storeReconciliationHash(session.businessId, storeA.externalId);
    expect(after!.tariffs).toBe(before!.tariffs - 1);
    expect(after!.tariffHash).not.toBe(before!.tariffHash);
    expect(after).toMatchObject({ tariffs: 0, tariffHash: EMPTY_HASH });
  });

  it("E8: a NOT_SERVED over a FEE changes tariffHash without changing tariffs", async () => {
    await post(session, [
      zoneTariffEvent({
        eventId: `${session.token}-e8-fee`,
        storeExternalId: storeA.externalId,
        zoneCode: "21.01",
        rule: "FEE",
        deliveryFee: 400,
        updatedAt: "2026-09-08T10:00:00.000Z",
      }),
    ]);
    const before = await storeReconciliationHash(session.businessId, storeA.externalId);

    await post(session, [
      zoneTariffEvent({
        eventId: `${session.token}-e8-notserved`,
        storeExternalId: storeA.externalId,
        zoneCode: "21.01",
        rule: "NOT_SERVED",
        updatedAt: "2026-09-08T11:00:00.000Z",
      }),
    ]);
    const after = await storeReconciliationHash(session.businessId, storeA.externalId);

    expect(after!.tariffs).toBe(before!.tariffs);
    expect(after!.tariffHash).not.toBe(before!.tariffHash);
  });

  it("E17: a batch with ONLY ZONE_TARIFF leaves products/hash untouched, and a batch with ONLY PRODUCT leaves tariffs/tariffHash untouched", async () => {
    const before = await storeReconciliationHash(session.businessId, storeA.externalId);

    await post(session, [
      zoneTariffEvent({
        eventId: `${session.token}-e17-tariff`,
        storeExternalId: storeA.externalId,
        zoneCode: "21.01",
        rule: "FEE",
        deliveryFee: 300,
        updatedAt: "2026-09-08T10:00:00.000Z",
      }),
    ]);
    const afterTariffOnly = await storeReconciliationHash(session.businessId, storeA.externalId);
    expect(afterTariffOnly!.products).toBe(before!.products);
    expect(afterTariffOnly!.hash).toBe(before!.hash);

    await post(session, [
      productEvent({
        eventId: `${session.token}-e17-product`,
        session,
        storeExternalId: storeA.externalId,
        storeProductId: `${session.token}-e17-sp`,
        updatedAt: "2026-09-08T10:00:01.000Z",
      }),
    ]);
    const afterProductToo = await storeReconciliationHash(session.businessId, storeA.externalId);
    expect(afterProductToo!.tariffs).toBe(afterTariffOnly!.tariffs);
    expect(afterProductToo!.tariffHash).toBe(afterTariffOnly!.tariffHash);
  });
});
