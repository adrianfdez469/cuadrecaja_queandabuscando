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
  barcode: string;
  updatedAt: string;
}): ProductPayload {
  return {
    storeProductId: overrides.storeProductId,
    productId: `${overrides.storeProductId}-product`,
    businessId: overrides.businessId,
    storeId: overrides.storeId,
    localName: overrides.localName,
    barcode: overrides.barcode,
    localCategoryId: null,
    price: 100,
    currency: "CUP",
    canonicalProductId: null,
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
        barcode: ean,
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
          barcode: ean,
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
          barcode: ean,
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
        barcode: ean,
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
        barcode: ean,
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
        barcode: ean,
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
        barcode: ean,
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
        barcode: ean,
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
        barcode: ean,
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
