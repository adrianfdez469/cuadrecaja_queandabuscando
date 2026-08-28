import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createFixtureSession,
  deriveEan,
  type FixtureSession,
} from "@/features/marketplace/server/dbFixtures";
import { searchCanonicalProducts } from "@/features/marketplace/server/search";
import { handleProduct } from "./product";
import { POST } from "@/app/api/internal/sync/catalog/route";
import type { ProductPayload } from "../../schemas";

/**
 * `handleProduct` against a real Postgres (F-015 paso 5; spec.md E1-E4;
 * architecture.md § Pruebas contra Postgres real). `product.test.ts` mocks
 * `writeSearchDocument` and only checks whether/how it was called; this
 * file lets the real `UPDATE` happen against a real `tsvector` column, so
 * the sync's own reindexing path (W1) is exercised end to end.
 *
 * Also covers spec.md C4's CI variant — "two calls to the handler" — since
 * the CI's own `npm test` runs before `npm run seed`
 * (`.github/workflows/ci.yml`) and cannot rely on seeded data.
 */

function payload(overrides: {
  storeProductId: string;
  storeId: string;
  businessId: string;
  localName: string;
  ean: string;
  updatedAt: string;
  canonicalProductId?: string | null;
}): ProductPayload {
  return {
    storeProductId: overrides.storeProductId,
    productId: `${overrides.storeProductId}-product`,
    businessId: overrides.businessId,
    storeId: overrides.storeId,
    localName: overrides.localName,
    barcodes: [overrides.ean],
    localCategoryId: null,
    price: 100,
    currency: "CUP",
    canonicalProductId: overrides.canonicalProductId ?? null,
    imageUrl: null,
    publishToStore: true,
    updatedAt: overrides.updatedAt,
  };
}

/** F-024: the v4 shape, when a test needs the full `barcodes` list rather
 *  than the single-EAN convenience of `payload()` above. */
function multiPayload(overrides: {
  storeProductId: string;
  storeId: string;
  businessId: string;
  localName: string;
  barcodes: readonly string[];
  updatedAt: string;
  canonicalProductId?: string | null;
}): ProductPayload {
  return {
    storeProductId: overrides.storeProductId,
    productId: `${overrides.storeProductId}-product`,
    businessId: overrides.businessId,
    storeId: overrides.storeId,
    localName: overrides.localName,
    barcodes: [...overrides.barcodes],
    localCategoryId: null,
    price: 100,
    currency: "CUP",
    canonicalProductId: overrides.canonicalProductId ?? null,
    imageUrl: null,
    publishToStore: true,
    updatedAt: overrides.updatedAt,
  };
}

describe("handleProduct against real Postgres", () => {
  let session: FixtureSession;

  beforeAll(async () => {
    session = await createFixtureSession();
  });

  afterAll(async () => {
    await session.cleanup();
  });

  it("sentinel: the fixture business/store this suite exercises really exist (anti-vacuity)", async () => {
    const business = await prisma.business.findUniqueOrThrow({ where: { id: session.businessId } });
    expect(business.externalId).toContain(session.token);
  });

  it("a new canonical is born indexed, unaccented (E1)", async () => {
    const store = await session.createStore();
    const ean = deriveEan(session.token, 1);

    const outcome = await handleProduct(
      payload({
        storeProductId: `${session.token}-sp-e1`,
        storeId: store.externalId,
        businessId: session.businessId,
        localName: `Café especial ${session.token}`,
        ean,
        updatedAt: new Date().toISOString(),
      }),
      "CREATE",
      session.businessId,
    );
    expect(outcome.status).toBe("processed");

    const canonical = await prisma.canonicalProduct.findUniqueOrThrow({ where: { ean } });
    session.trackCanonical(canonical.id);

    const [raw] = await prisma.$queryRaw<{ notNull: boolean; noAccent: boolean }[]>(Prisma.sql`
      SELECT "searchVector" IS NOT NULL AS "notNull",
             "searchVector"::text NOT LIKE '%é%' AS "noAccent"
        FROM "CanonicalProduct" WHERE "id" = ${canonical.id}
    `);
    expect(raw?.notNull).toBe(true);
    expect(raw?.noAccent).toBe(true);
  });

  it("a new alias from another business reindexes in the same write, no separate pass (E2, C4)", async () => {
    const otherSession = await createFixtureSession();
    try {
      const ean = deriveEan(session.token, 2);
      const storeA = await session.createStore();
      const storeB = await otherSession.createStore();

      const first = await handleProduct(
        payload({
          storeProductId: `${session.token}-sp-e2-a`,
          storeId: storeA.externalId,
          businessId: session.businessId,
          localName: `Refresco de cola 1.5 L ${session.token}`,
          ean,
          updatedAt: new Date().toISOString(),
        }),
        "CREATE",
        session.businessId,
      );
      expect(first.status).toBe("processed");

      const canonical = await prisma.canonicalProduct.findUniqueOrThrow({ where: { ean } });
      session.trackCanonical(canonical.id);

      const second = await handleProduct(
        payload({
          storeProductId: `${otherSession.token}-sp-e2-b`,
          storeId: storeB.externalId,
          businessId: otherSession.businessId,
          localName: `Coca-Cola 1.5L ${session.token}`,
          ean,
          updatedAt: new Date().toISOString(),
        }),
        "CREATE",
        otherSession.businessId,
      );
      expect(second.status).toBe("processed");

      const reindexed = await prisma.canonicalProduct.findUniqueOrThrow({
        where: { id: canonical.id },
        select: { searchDocument: true },
      });
      expect(reindexed.searchDocument).toContain("Refresco de cola");
      expect(reindexed.searchDocument).toContain("Coca-Cola");

      // Findable through the new alias's own word — proves the vector was
      // recomputed in the SAME write as the alias, not in a later pass
      // (E2, and the "no reprocessing" half of C4/criterio 4).
      const result = await searchCanonicalProducts({ term: `coca ${session.token}` });
      expect(result.items.map((item) => item.canonicalProductId)).toContain(canonical.id);
    } finally {
      await otherSession.cleanup();
    }
  });

  it("a repeated alias only bumps useCount — document and vector stay identical (E3)", async () => {
    const store = await session.createStore();
    const ean = deriveEan(session.token, 3);
    const storeProductId = `${session.token}-sp-e3`;
    const localName = `Repeatable widget ${session.token}`;
    const firstUpdatedAt = new Date();

    const first = await handleProduct(
      payload({
        storeProductId,
        storeId: store.externalId,
        businessId: session.businessId,
        localName,
        ean,
        updatedAt: firstUpdatedAt.toISOString(),
      }),
      "CREATE",
      session.businessId,
    );
    expect(first.status).toBe("processed");

    const canonical = await prisma.canonicalProduct.findUniqueOrThrow({ where: { ean } });
    session.trackCanonical(canonical.id);
    const alias = await prisma.productAlias.findUniqueOrThrow({
      where: {
        canonicalProductId_text_businessId: {
          canonicalProductId: canonical.id,
          text: localName,
          businessId: session.businessId,
        },
      },
      select: { useCount: true },
    });
    expect(alias.useCount).toBe(1);

    const before = await prisma.canonicalProduct.findUniqueOrThrow({
      where: { id: canonical.id },
      select: { searchDocument: true, updatedAt: true },
    });

    // Re-delivery of the SAME event (same storeProductId, same business,
    // same localName): a later `updatedAt` clears the stale-write guard,
    // but the alias already exists, so only useCount changes.
    const second = await handleProduct(
      payload({
        storeProductId,
        storeId: store.externalId,
        businessId: session.businessId,
        localName,
        ean,
        updatedAt: new Date(firstUpdatedAt.getTime() + 60_000).toISOString(),
      }),
      "UPDATE",
      session.businessId,
    );
    expect(second.status).toBe("processed");

    const after = await prisma.canonicalProduct.findUniqueOrThrow({
      where: { id: canonical.id },
      select: { searchDocument: true, updatedAt: true },
    });
    expect(after.searchDocument).toBe(before.searchDocument);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());

    const aliasAfter = await prisma.productAlias.findUniqueOrThrow({
      where: {
        canonicalProductId_text_businessId: {
          canonicalProductId: canonical.id,
          text: localName,
          businessId: session.businessId,
        },
      },
      select: { useCount: true },
    });
    expect(aliasAfter.useCount).toBe(2);
  });

  it("a stale event does not touch the index (E4)", async () => {
    const store = await session.createStore();
    const ean = deriveEan(session.token, 4);
    const storeProductId = `${session.token}-sp-e4`;
    const localName = `Stale-proof widget ${session.token}`;
    const currentUpdatedAt = new Date();

    const first = await handleProduct(
      payload({
        storeProductId,
        storeId: store.externalId,
        businessId: session.businessId,
        localName,
        ean,
        updatedAt: currentUpdatedAt.toISOString(),
      }),
      "CREATE",
      session.businessId,
    );
    expect(first.status).toBe("processed");

    const canonical = await prisma.canonicalProduct.findUniqueOrThrow({ where: { ean } });
    session.trackCanonical(canonical.id);
    const before = await prisma.canonicalProduct.findUniqueOrThrow({
      where: { id: canonical.id },
      select: { searchDocument: true, updatedAt: true },
    });

    // Older `updatedAt` than the StoreProduct's own `sourceUpdatedAt`.
    const stale = await handleProduct(
      payload({
        storeProductId,
        storeId: store.externalId,
        businessId: session.businessId,
        localName: `A completely different name ${session.token}`,
        ean,
        updatedAt: new Date(currentUpdatedAt.getTime() - 60_000).toISOString(),
      }),
      "UPDATE",
      session.businessId,
    );
    expect(stale.status).toBe("stale");

    const after = await prisma.canonicalProduct.findUniqueOrThrow({
      where: { id: canonical.id },
      select: { searchDocument: true, updatedAt: true },
    });
    expect(after.searchDocument).toBe(before.searchDocument);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("two handler calls with the same barcode and a new localName: one row, storeCount 2, no seed needed (C4, E22)", async () => {
    const ean = deriveEan(session.token, 5);
    const storeA = await session.createStore();
    const storeB = await session.createStore();

    const first = await handleProduct(
      payload({
        storeProductId: `${session.token}-sp-c4-a`,
        storeId: storeA.externalId,
        businessId: session.businessId,
        localName: `Refresco de cola 1.5 L ${session.token}`,
        ean,
        updatedAt: new Date().toISOString(),
      }),
      "CREATE",
      session.businessId,
    );
    expect(first.status).toBe("processed");

    const canonical = await prisma.canonicalProduct.findUniqueOrThrow({ where: { ean } });
    session.trackCanonical(canonical.id);

    const second = await handleProduct(
      payload({
        storeProductId: `${session.token}-sp-c4-b`,
        storeId: storeB.externalId,
        businessId: session.businessId,
        localName: `Coca-Cola 1.5L ${session.token}`,
        ean,
        updatedAt: new Date().toISOString(),
      }),
      "CREATE",
      session.businessId,
    );
    expect(second.status).toBe("processed");

    const result = await searchCanonicalProducts({ term: `coca ${session.token}` });
    const matches = result.items.filter((item) => item.canonicalProductId === canonical.id);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.name).toBe(`Refresco de cola 1.5 L ${session.token}`);
    expect(matches[0]?.storeCount).toBe(2);
  });
});

/**
 * F-024: `barcodes` (list) against real Postgres. Notation from spec.md:
 * cod1 < cod2 < cod3 are the ascending-order valid GTINs derived below;
 * `INVALID_CODE` is what `normalizeBarcode` rejects.
 */
describe("handleProduct — F-024 CanonicalBarcode (barcodes list)", () => {
  let session: FixtureSession;
  const INVALID_CODE = "12345";

  beforeAll(async () => {
    session = await createFixtureSession();
  });

  afterAll(async () => {
    await session.cleanup();
  });

  /** Three GTINs unique to this run, returned already sorted ascending —
   *  cods[0] is what R4 says the identity must resolve to. */
  function threeCodes(salt: number): [string, string, string] {
    const codes = [
      deriveEan(session.token, salt),
      deriveEan(session.token, salt + 1),
      deriveEan(session.token, salt + 2),
    ].sort();
    return codes as [string, string, string];
  }

  it("E1: three codes in any order create ONE canonical whose ean is the smallest, with exactly three CanonicalBarcode rows", async () => {
    const [cod1, cod2, cod3] = threeCodes(100);
    const store = await session.createStore();

    const outcome = await handleProduct(
      multiPayload({
        storeProductId: `${session.token}-sp-e1`,
        storeId: store.externalId,
        businessId: session.businessId,
        localName: `Refresco de pomo ${session.token}`,
        barcodes: [cod2, cod3, cod1],
        updatedAt: new Date().toISOString(),
      }),
      "CREATE",
      session.businessId,
    );
    expect(outcome.status).toBe("processed");

    const canonical = await prisma.canonicalProduct.findUniqueOrThrow({ where: { ean: cod1 } });
    session.trackCanonical(canonical.id);
    expect(canonical.isExclusive).toBe(false);

    const rows = await prisma.canonicalBarcode.findMany({
      where: { canonicalProductId: canonical.id },
      select: { ean: true },
    });
    expect(rows.map((r) => r.ean).sort()).toEqual([cod1, cod2, cod3]);
  });

  it("E2: resending the same event (same eventId semantics: same payload) does not duplicate rows", async () => {
    const [cod1, cod2, cod3] = threeCodes(110);
    const store = await session.createStore();
    const storeProductId = `${session.token}-sp-e2`;
    const updatedAt = new Date();

    const first = await handleProduct(
      multiPayload({
        storeProductId,
        storeId: store.externalId,
        businessId: session.businessId,
        localName: `Refresco de pomo ${session.token}`,
        barcodes: [cod1, cod2, cod3],
        updatedAt: updatedAt.toISOString(),
      }),
      "CREATE",
      session.businessId,
    );
    expect(first.status).toBe("processed");
    const canonical = await prisma.canonicalProduct.findUniqueOrThrow({ where: { ean: cod1 } });
    session.trackCanonical(canonical.id);

    // A later updatedAt clears the stale-write guard, exactly like a retry
    // that the POS re-sends with the same barcodes.
    const second = await handleProduct(
      multiPayload({
        storeProductId,
        storeId: store.externalId,
        businessId: session.businessId,
        localName: `Refresco de pomo ${session.token}`,
        barcodes: [cod1, cod2, cod3],
        updatedAt: new Date(updatedAt.getTime() + 60_000).toISOString(),
      }),
      "UPDATE",
      session.businessId,
    );
    expect(second.status).toBe("processed");

    const rows = await prisma.canonicalBarcode.findMany({
      where: { canonicalProductId: canonical.id },
    });
    expect(rows).toHaveLength(3);
  });

  it("E3: the same list in a different order resolves the SAME canonical, no new one created", async () => {
    const [cod1, cod2, cod3] = threeCodes(120);
    const storeA = await session.createStore();
    const storeB = await session.createStore();

    const first = await handleProduct(
      multiPayload({
        storeProductId: `${session.token}-sp-e3-a`,
        storeId: storeA.externalId,
        businessId: session.businessId,
        localName: `Refresco de pomo ${session.token}`,
        barcodes: [cod2, cod3, cod1],
        updatedAt: new Date().toISOString(),
      }),
      "CREATE",
      session.businessId,
    );
    expect(first.status).toBe("processed");
    const canonical = await prisma.canonicalProduct.findUniqueOrThrow({ where: { ean: cod1 } });
    session.trackCanonical(canonical.id);

    const second = await handleProduct(
      multiPayload({
        storeProductId: `${session.token}-sp-e3-b`,
        storeId: storeB.externalId,
        businessId: session.businessId,
        localName: `Refresco de pomo (otra tienda) ${session.token}`,
        barcodes: [cod3, cod1, cod2],
        updatedAt: new Date().toISOString(),
      }),
      "CREATE",
      session.businessId,
    );
    expect(second.status).toBe("processed");

    const count = await prisma.canonicalProduct.count({ where: { ean: cod1 } });
    expect(count).toBe(1);
    const rows = await prisma.canonicalBarcode.findMany({
      where: { canonicalProductId: canonical.id },
    });
    expect(rows).toHaveLength(3);
  });

  it("E5: a code known to another canonical (not its own ean) resolves a NEW canonical — the same code lives in two", async () => {
    const [cod1, cod2] = threeCodes(130);
    const storeA = await session.createStore();
    const storeB = await session.createStore();

    const first = await handleProduct(
      multiPayload({
        storeProductId: `${session.token}-sp-e5-a`,
        storeId: storeA.externalId,
        businessId: session.businessId,
        localName: `Refresco de pomo ${session.token}`,
        barcodes: [cod1, cod2],
        updatedAt: new Date().toISOString(),
      }),
      "CREATE",
      session.businessId,
    );
    expect(first.status).toBe("processed");
    const canonicalX = await prisma.canonicalProduct.findUniqueOrThrow({ where: { ean: cod1 } });
    session.trackCanonical(canonicalX.id);

    const second = await handleProduct(
      multiPayload({
        storeProductId: `${session.token}-sp-e5-b`,
        storeId: storeB.externalId,
        businessId: session.businessId,
        localName: `Sprite 1.5Lt ${session.token}`,
        barcodes: [cod2],
        updatedAt: new Date().toISOString(),
      }),
      "CREATE",
      session.businessId,
    );
    expect(second.status).toBe("processed");
    const canonicalY = await prisma.canonicalProduct.findUniqueOrThrow({ where: { ean: cod2 } });
    session.trackCanonical(canonicalY.id);

    expect(canonicalY.id).not.toBe(canonicalX.id);

    const rowsWithCod2 = await prisma.canonicalBarcode.findMany({ where: { ean: cod2 } });
    const canonicalIds = rowsWithCod2.map((r) => r.canonicalProductId).sort();
    expect(canonicalIds).toEqual([canonicalX.id, canonicalY.id].sort());
  });

  it("E7: every barcode invalid still publishes as an orphan, isExclusive true, zero rows", async () => {
    const store = await session.createStore();

    const outcome = await handleProduct(
      multiPayload({
        storeProductId: `${session.token}-sp-e7`,
        storeId: store.externalId,
        businessId: session.businessId,
        localName: `Producto sin codigo util ${session.token}`,
        barcodes: [INVALID_CODE, "", "abc"],
        updatedAt: new Date().toISOString(),
      }),
      "CREATE",
      session.businessId,
    );
    expect(outcome.status).toBe("processed");

    const storeProduct = await prisma.storeProduct.findUniqueOrThrow({
      where: {
        storeId_externalId: { storeId: store.id, externalId: `${session.token}-sp-e7` },
      },
      select: { canonicalProductId: true },
    });
    session.trackCanonical(storeProduct.canonicalProductId);
    const canonical = await prisma.canonicalProduct.findUniqueOrThrow({
      where: { id: storeProduct.canonicalProductId },
    });
    expect(canonical.isExclusive).toBe(true);
    expect(canonical.ean).toBeNull();

    const rows = await prisma.canonicalBarcode.findMany({
      where: { canonicalProductId: canonical.id },
    });
    expect(rows).toHaveLength(0);
  });

  it("E8: a mix of invalid and valid codes resolves by the smallest valid one, invalid never stored", async () => {
    const [cod1, cod2] = threeCodes(140);
    const store = await session.createStore();

    const outcome = await handleProduct(
      multiPayload({
        storeProductId: `${session.token}-sp-e8`,
        storeId: store.externalId,
        businessId: session.businessId,
        localName: `Refresco de pomo ${session.token}`,
        barcodes: [INVALID_CODE, cod2, cod1],
        updatedAt: new Date().toISOString(),
      }),
      "CREATE",
      session.businessId,
    );
    expect(outcome.status).toBe("processed");

    const canonical = await prisma.canonicalProduct.findUniqueOrThrow({ where: { ean: cod1 } });
    session.trackCanonical(canonical.id);
    const rows = await prisma.canonicalBarcode.findMany({
      where: { canonicalProductId: canonical.id },
      select: { ean: true },
    });
    expect(rows.map((r) => r.ean).sort()).toEqual([cod1, cod2]);
  });

  it("E13: an explicit canonicalProductId wins over the codes, and the codes still get stored against it", async () => {
    const [cod1, cod2] = threeCodes(150);
    const store = await session.createStore();

    const explicitCanonical = await prisma.canonicalProduct.create({
      data: { name: `Explicito ${session.token}`, isExclusive: true },
      select: { id: true, ean: true },
    });
    session.trackCanonical(explicitCanonical.id);

    const outcome = await handleProduct(
      multiPayload({
        storeProductId: `${session.token}-sp-e13`,
        storeId: store.externalId,
        businessId: session.businessId,
        localName: `Producto explicito ${session.token}`,
        barcodes: [cod1, cod2],
        updatedAt: new Date().toISOString(),
        canonicalProductId: explicitCanonical.id,
      }),
      "CREATE",
      session.businessId,
    );
    expect(outcome.status).toBe("processed");

    const canonicalAfter = await prisma.canonicalProduct.findUniqueOrThrow({
      where: { id: explicitCanonical.id },
    });
    // R5: the explicit branch never rewrites `ean` on create.
    expect(canonicalAfter.ean).toBeNull();

    const rows = await prisma.canonicalBarcode.findMany({
      where: { canonicalProductId: explicitCanonical.id },
      select: { ean: true },
    });
    expect(rows.map((r) => r.ean).sort()).toEqual([cod1, cod2]);
  });

  it("E16: delivery order is irrelevant — two overlapping updates converge to the same set (R6, additive)", async () => {
    const [cod1, cod2, cod3] = threeCodes(160);
    const store = await session.createStore();
    const storeProductId = `${session.token}-sp-e16`;
    const t0 = new Date();

    const first = await handleProduct(
      multiPayload({
        storeProductId,
        storeId: store.externalId,
        businessId: session.businessId,
        localName: `Refresco de pomo ${session.token}`,
        barcodes: [cod1, cod2],
        updatedAt: t0.toISOString(),
      }),
      "CREATE",
      session.businessId,
    );
    expect(first.status).toBe("processed");
    const canonical = await prisma.canonicalProduct.findUniqueOrThrow({ where: { ean: cod1 } });
    session.trackCanonical(canonical.id);

    const second = await handleProduct(
      multiPayload({
        storeProductId,
        storeId: store.externalId,
        businessId: session.businessId,
        localName: `Refresco de pomo ${session.token}`,
        barcodes: [cod1, cod3],
        updatedAt: new Date(t0.getTime() + 60_000).toISOString(),
      }),
      "UPDATE",
      session.businessId,
    );
    expect(second.status).toBe("processed");

    const rows = await prisma.canonicalBarcode.findMany({
      where: { canonicalProductId: canonical.id },
      select: { ean: true },
    });
    // Additive (R6): the earlier delivery's cod2 is NOT removed by the later
    // one that did not mention it — the set only grows.
    expect(rows.map((r) => r.ean).sort()).toEqual([cod1, cod2, cod3]);
  });

  it("C1 (E10), through the real POST: a batch with the singular `barcode` key writes NOTHING", async () => {
    const store = await session.createStore();
    const eventsBefore = await prisma.syncEvent.count();
    const barcodesBefore = await prisma.canonicalBarcode.count();

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
              eventId: `${session.token}-evt-c1`,
              entity: "PRODUCT",
              operation: "UPDATE",
              occurredAt: new Date().toISOString(),
              payload: {
                storeProductId: `${session.token}-sp-c1`,
                productId: `${session.token}-sp-c1-product`,
                businessId: session.businessExternalId,
                storeId: store.externalId,
                localName: `Producto v3 rechazado ${session.token}`,
                barcode: "7501031311309",
                localCategoryId: null,
                price: 100,
                currency: "CUP",
                canonicalProductId: null,
                imageUrl: null,
                publishToStore: true,
                updatedAt: new Date().toISOString(),
              },
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_BATCH");
    expect(await prisma.syncEvent.count()).toBe(eventsBefore);
    expect(await prisma.canonicalBarcode.count()).toBe(barcodesBefore);
  });
});
