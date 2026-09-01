import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createFixtureSession,
  type FixtureSession,
  type FixtureStore,
} from "@/features/marketplace/server/dbFixtures";
import { reconciliationEntry, storeReconciliationHash } from "./reconciliation";

/**
 * F-014, architecture.md D4: the ONLY `*.db.test.ts` file this feature adds.
 * C3, C4, C8, C9. Budget: ~2s, decenas de filas, nunca miles (D2, R-B, ficha
 * search-db-fixture-20k-agota-su-beforeall-en-ci).
 */

const EMPTY_HASH = "d41d8cd98f00b204e9800998ecf8427e";

/** count(*) arrives as `bigint` or `string` depending on the driver path,
 *  never a plain `number` (architecture.md § "El SQL espejo local", aviso
 *  de tipos 1; same conversion as `searchVector.ts`'s `CountRow`). */
type MirrorRow = { products: bigint | number | string; hash: string };

/**
 * R15's SQL, written BY HAND against `StoreProduct` — never composed from
 * `reconciliationEntry`/`storeReconciliationHash` (architecture.md D3): the
 * whole point of C8 is that two INDEPENDENT implementations agree.
 * `normalizePrice=false` reproduces the naive `"syncedPrice"::text` reading
 * C8 requires to differ.
 */
async function runMirrorSql(
  storeId: string,
  normalizePrice: boolean,
): Promise<{ products: number; hash: string }> {
  const priceExpr = normalizePrice
    ? Prisma.sql`trim(trailing '.' from trim(trailing '0' from round("syncedPrice"::numeric, 2)::text))`
    : Prisma.sql`"syncedPrice"::text`;

  const rows = await prisma.$queryRaw<MirrorRow[]>(Prisma.sql`
    SELECT count(*) AS products,
           md5(coalesce(string_agg(
                  "externalId" || ':' ||
                  ${priceExpr} || ':' ||
                  "syncedPriceCurrency" || ':' || "availability"::text || '|',
                  '' ORDER BY "externalId" COLLATE "C"
                ), '')) AS hash
    FROM "StoreProduct"
    WHERE "storeId" = ${storeId} AND "deletedAt" IS NULL
  `);
  const row = rows[0]!;
  return { products: Number(row.products), hash: row.hash };
}

describe("storeReconciliationHash() — panel/derived fields never move the hash (C3, C4)", () => {
  let session: FixtureSession;
  let store: FixtureStore;
  let offerId: string;

  beforeAll(async () => {
    session = await createFixtureSession();
    store = await session.createStore();
    const canonical = await session.createCanonical({
      name: `Panel fixture ${session.token}`,
    });
    const offer = await session.createOffer(store.id, canonical.id, {
      syncedPrice: "1990.00",
      syncedPriceCurrency: "CUP",
    });
    offerId = offer.id;
  });

  afterAll(async () => {
    await session.cleanup();
  });

  it("writing the eight panel/derived columns leaves products and hash byte-for-byte identical", async () => {
    const before = await storeReconciliationHash(session.businessId, store.externalId);
    expect(before).not.toBeNull();

    // The three features.json names, plus the five I3 adds: NOT three,
    // eight — the spec calls out `visible` as the one an admin touches daily
    // and the one an implementer could feel obliged to filter by.
    await prisma.storeProduct.update({
      where: { id: offerId },
      data: {
        description: "una descripción distinta para el panel",
        imageUrls: ["https://example.com/panel.jpg"],
        priceOverride: "1.23",
        priceOverrideCurrency: "USD",
        visible: false,
        featured: true,
        // Derived columns (ADR 0007/0021): neither side owns these, and the
        // sync's select excludes them (R9, I3) — writing them directly here
        // is fine precisely BECAUSE this is a test file, not the panel or
        // the sync (boundaries.test.ts's G1 only scans production files).
        searchDocument: "documento derivado completamente distinto",
      },
    });
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "StoreProduct"
         SET "searchVector" = to_tsvector('spanish', 'documento derivado completamente distinto')
       WHERE "id" = ${offerId}
    `);

    const after = await storeReconciliationHash(session.businessId, store.externalId);
    expect(after).toEqual(before);
  });
});

describe("SQL mirror (R15) vs storeReconciliationHash() — C8, C9", () => {
  let session: FixtureSession;
  let store: FixtureStore;
  let emptyStore: FixtureStore;
  const offers: Record<string, { id: string; externalId: string }> = {};

  // The four literal price forms R4 fixes, and what each one MUST enter the
  // canonical string as (D3's corollary: literals, never
  // `reconciliationEntry()` called on itself).
  const expectedEntry: Record<string, string> = {
    "1990.00": "1990",
    "1990.50": "1990.5",
    "1990.10": "1990.1",
    "0.00": "0",
  };

  beforeAll(async () => {
    session = await createFixtureSession();
    store = await session.createStore();
    emptyStore = await session.createStore();

    for (const price of Object.keys(expectedEntry)) {
      const canonical = await session.createCanonical({
        name: `Precio ${price} ${session.token}`,
      });
      const offer = await session.createOffer(store.id, canonical.id, {
        syncedPrice: price,
        syncedPriceCurrency: "CUP",
      });
      // Deterministic by construction (dbFixtures.ts's createOffer:
      // `${token}-offer-${storeId}-${canonicalProductId}`) — not read back
      // from the row, so this test does not depend on the fixture's
      // internals matching what it asserts.
      offers[price] = {
        id: offer.id,
        externalId: `${session.token}-offer-${store.id}-${canonical.id}`,
      };
    }
  });

  afterAll(async () => {
    await session.cleanup();
  });

  it("C9: 1990.00/1990.50/1990.10/0.00 enter the canonical string as 1990/1990.5/1990.1/0, against literals", async () => {
    for (const [price, expectedPrice] of Object.entries(expectedEntry)) {
      const offer = offers[price]!;
      const row = await prisma.storeProduct.findUniqueOrThrow({
        where: { id: offer.id },
        select: {
          externalId: true,
          syncedPrice: true,
          syncedPriceCurrency: true,
          availability: true,
        },
      });
      // Compared against a HAND-WRITTEN literal, never against another call
      // to `reconciliationEntry` (D3): a regression that stopped stripping
      // trailing zeroes would fail this exact line.
      expect(reconciliationEntry(row)).toBe(`${offer.externalId}:${expectedPrice}:CUP:AVAILABLE|`);
    }
  });

  it("C8: the hand-written SQL mirror matches storeReconciliationHash(), and the non-normalized variant differs", async () => {
    const fromFunction = await storeReconciliationHash(session.businessId, store.externalId);
    expect(fromFunction).not.toBeNull();

    const normalized = await runMirrorSql(store.id, true);
    expect(normalized.products).toBe(fromFunction!.products);
    expect(normalized.hash).toBe(fromFunction!.hash);

    // The half that matters: a naive `"syncedPrice"::text` reading (no
    // trim/round) has to give a DIFFERENT hash. `1990.00` and `0.00` in this
    // fixture guarantee at least one trailing zero, so this cannot pass by
    // accident (spec.md C8).
    const unnormalized = await runMirrorSql(store.id, false);
    expect(unnormalized.products).toBe(fromFunction!.products);
    expect(unnormalized.hash).not.toBe(fromFunction!.hash);
  });

  it("C8: the SQL mirror agrees with storeReconciliationHash() on an empty store too", async () => {
    const fromFunction = await storeReconciliationHash(session.businessId, emptyStore.externalId);
    expect(fromFunction).toEqual({ products: 0, hash: EMPTY_HASH });

    const fromSql = await runMirrorSql(emptyStore.id, true);
    expect(fromSql).toEqual(fromFunction);
  });
});

// Sanity check that this file's own constant matches the same value the
// contract vector and R2 fix — if `createHash` ever produced something else
// for the empty string on this machine, every assertion above referencing
// EMPTY_HASH would be silently checking the wrong thing.
describe("EMPTY_HASH sanity", () => {
  it("is md5('') in hex, the same literal docs/sync-contract.md § ⑤ and spec.md E7 use", () => {
    expect(createHash("md5").update("", "utf8").digest("hex")).toBe(EMPTY_HASH);
  });
});
