import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { Availability, StoreStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { createFixtureSession, type FixtureSession } from "./dbFixtures";
import { searchCanonicalProducts } from "./search";

/**
 * `searchCanonicalProducts` against a real Postgres (F-015, plan.md paso 5;
 * spec.md C2, C3, C7, C8, C9; architecture.md § Pruebas contra Postgres
 * real). No mocks: this is exactly the semantics unit tests cannot see —
 * `tsvector`, `unaccent` and the total order.
 *
 * One fixture session for the whole file, cleaned up in `afterAll`. Every
 * search term below carries the session's own token, so `plainto_tsquery`'s
 * implicit AND can only ever match a row this file itself created — the
 * shared, already-seeded local database never taints an assertion (E12,
 * E21 included).
 */
describe("searchCanonicalProducts against real Postgres", () => {
  let session: FixtureSession;

  beforeAll(async () => {
    session = await createFixtureSession();
  });

  afterAll(async () => {
    await session.cleanup();
  });

  it("sentinel: the fixture this suite searches against really exists, with a real vector (anti-vacuity)", async () => {
    const canonical = await session.createCanonical({ name: `Sentinel product ${session.token}` });

    const [raw] = await prisma.$queryRaw<{ notNull: boolean }[]>(Prisma.sql`
      SELECT "searchVector" IS NOT NULL AS "notNull"
        FROM "CanonicalProduct" WHERE "id" = ${canonical.id}
    `);
    expect(raw?.notNull).toBe(true);

    const result = await searchCanonicalProducts({ term: `sentinel ${session.token}` });
    expect(result.items.map((item) => item.canonicalProductId)).toContain(canonical.id);
  });

  it("finds an accented document with an unaccented term and an unaccented document with an accented term (E5, E6, C2)", async () => {
    const accented = await session.createCanonical({ name: `Café molido 250 g ${session.token}` });
    const unaccented = await session.createCanonical({
      name: `Cafe tostado 500 g ${session.token}`,
    });

    const withUnaccentedTerm = await searchCanonicalProducts({ term: `cafe ${session.token}` });
    const idsA = withUnaccentedTerm.items.map((item) => item.canonicalProductId);
    expect(idsA).toContain(accented.id);
    expect(idsA).toContain(unaccented.id);

    const withAccentedTerm = await searchCanonicalProducts({ term: `café ${session.token}` });
    const idsB = withAccentedTerm.items.map((item) => item.canonicalProductId);
    expect(idsB).toContain(accented.id);
    expect(idsB).toContain(unaccented.id);
  });

  it("excludes isExclusive products from the marketplace, filter on or off (E7, C3, R4)", async () => {
    const term = `pantryitem ${session.token}`;
    const included = await session.createCanonical({
      name: `Pantryitem regular ${session.token}`,
      isExclusive: false,
    });
    const excluded = await session.createCanonical({
      name: `Pantryitem orphan ${session.token}`,
      isExclusive: true,
    });

    const withoutFilter = await searchCanonicalProducts({ term });
    const idsNoFilter = withoutFilter.items.map((item) => item.canonicalProductId);
    expect(idsNoFilter).toContain(included.id);
    expect(idsNoFilter).not.toContain(excluded.id);

    const withFilter = await searchCanonicalProducts({ term, onlyWithLiveOffer: true });
    expect(withFilter.items.map((item) => item.canonicalProductId)).not.toContain(excluded.id);
  });

  describe("the live-offer filter's four conditions (C7)", () => {
    it("no live offer: present without the filter with storeCount 0, absent with it (E8, E9)", async () => {
      const term = `nooffer ${session.token}`;
      const canonical = await session.createCanonical({ name: `Nooffer widget ${session.token}` });
      const store = await session.createStore();
      await session.createOffer(store.id, canonical.id, {
        availability: Availability.OUT_OF_STOCK,
      });

      const withoutFilter = await searchCanonicalProducts({ term });
      const item = withoutFilter.items.find((i) => i.canonicalProductId === canonical.id);
      expect(item?.storeCount).toBe(0);

      const withFilter = await searchCanonicalProducts({ term, onlyWithLiveOffer: true });
      expect(withFilter.items.some((i) => i.canonicalProductId === canonical.id)).toBe(false);
    });

    it("LOW_STOCK counts as live — only OUT_OF_STOCK is excluded (E10, SP-H3)", async () => {
      const term = `lowstock ${session.token}`;
      const canonical = await session.createCanonical({ name: `Lowstock widget ${session.token}` });
      const store = await session.createStore();
      await session.createOffer(store.id, canonical.id, { availability: Availability.LOW_STOCK });

      const result = await searchCanonicalProducts({ term, onlyWithLiveOffer: true });
      const item = result.items.find((i) => i.canonicalProductId === canonical.id);
      expect(item?.storeCount).toBe(1);
    });

    it("visible: false does not count as live (E11)", async () => {
      const term = `notvisible ${session.token}`;
      const canonical = await session.createCanonical({
        name: `Notvisible widget ${session.token}`,
      });
      const store = await session.createStore();
      await session.createOffer(store.id, canonical.id, { visible: false });

      const withoutFilter = await searchCanonicalProducts({ term });
      expect(
        withoutFilter.items.find((i) => i.canonicalProductId === canonical.id)?.storeCount,
      ).toBe(0);
      const withFilter = await searchCanonicalProducts({ term, onlyWithLiveOffer: true });
      expect(withFilter.items.some((i) => i.canonicalProductId === canonical.id)).toBe(false);
    });

    it("a soft-deleted offer (deletedAt not null) does not count as live (E11)", async () => {
      const term = `softdeleted ${session.token}`;
      const canonical = await session.createCanonical({
        name: `Softdeleted widget ${session.token}`,
      });
      const store = await session.createStore();
      await session.createOffer(store.id, canonical.id, { deletedAt: new Date() });

      const withFilter = await searchCanonicalProducts({ term, onlyWithLiveOffer: true });
      expect(withFilter.items.some((i) => i.canonicalProductId === canonical.id)).toBe(false);
    });

    it("an offer in a store that is not PUBLISHED does not count as live (E11)", async () => {
      const term = `notpublished ${session.token}`;
      const canonical = await session.createCanonical({
        name: `Notpublished widget ${session.token}`,
      });
      const store = await session.createStore({ status: StoreStatus.DRAFT });
      await session.createOffer(store.id, canonical.id);

      const withFilter = await searchCanonicalProducts({ term, onlyWithLiveOffer: true });
      expect(withFilter.items.some((i) => i.canonicalProductId === canonical.id)).toBe(false);
    });
  });

  it("with an equal document (equal rank), the one with a live offer sorts first (E12, SP-H4, C8)", async () => {
    const term = `ranktie ${session.token}`;
    const name = `Ranktie widget ${session.token}`;
    const withOffer = await session.createCanonical({ name });
    const withoutOffer = await session.createCanonical({ name });
    const store = await session.createStore();
    await session.createOffer(store.id, withOffer.id);

    const result = await searchCanonicalProducts({ term });
    const ids = result.items
      .map((item) => item.canonicalProductId)
      .filter((id) => id === withOffer.id || id === withoutOffer.id);
    expect(ids).toEqual([withOffer.id, withoutOffer.id]);
  });

  it("multiple words combine with AND, not OR (E13)", async () => {
    const term = `alpha beta ${session.token}`;
    const matching = await session.createCanonical({ name: `Alpha Beta gadget ${session.token}` });
    const nonMatching = await session.createCanonical({
      name: `Alpha Gamma gadget ${session.token}`,
    });

    const result = await searchCanonicalProducts({ term });
    const ids = result.items.map((item) => item.canonicalProductId);
    expect(ids).toContain(matching.id);
    expect(ids).not.toContain(nonMatching.id);
  });

  it("a term matching nothing returns an empty result, never an error (E14)", async () => {
    const result = await searchCanonicalProducts({ term: `xilofono ${session.token}` });
    expect(result).toEqual({ items: [], hasMore: false });
  });

  it.each([
    [`café & | ! ( ) : *`, "tsquery metacharacters (E17)"],
    [`"`, "a bare double quote (E17)"],
    [`'`, "a bare single quote (E17)"],
  ])("a hostile term (%s) never throws — %s", async (hostile) => {
    // No emptiness claim here: once `plainto_tsquery` strips the
    // metacharacters, all that is left is the token, which every fixture in
    // this file's session carries — so a non-empty result is expected, not
    // a leak. The only thing R3/E17 requires is that it never throws a
    // `tsquery` syntax error.
    const result = await searchCanonicalProducts({ term: `${hostile} ${session.token}` });
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("a SQL injection attempt returns an empty result, and the table survives (E18, R11, C9)", async () => {
    const result = await searchCanonicalProducts({
      term: `'; DROP TABLE "CanonicalProduct"; --  ${session.token}`,
    });
    expect(result).toEqual({ items: [], hasMore: false });

    const [row] = await prisma.$queryRaw<{ ok: boolean }[]>(
      Prisma.sql`SELECT to_regclass('"CanonicalProduct"') IS NOT NULL AS ok`,
    );
    expect(row?.ok).toBe(true);
  });

  it("the table still exists after every hostile term above (C9)", async () => {
    const [row] = await prisma.$queryRaw<{ ok: boolean }[]>(
      Prisma.sql`SELECT to_regclass('"CanonicalProduct"') IS NOT NULL AS ok`,
    );
    expect(row?.ok).toBe(true);
  });

  it("pagination is stable and total order holds across repeated calls (E21, R8)", async () => {
    const term = `pageword ${session.token}`;
    const created = [];
    for (const letter of ["a", "b", "c", "d"]) {
      created.push(await session.createCanonical({ name: `Pageword ${letter} ${session.token}` }));
    }

    const page1 = await searchCanonicalProducts({ term, limit: 2, offset: 0 });
    const page2 = await searchCanonicalProducts({ term, limit: 2, offset: 2 });
    const full = await searchCanonicalProducts({ term, limit: 4, offset: 0 });
    const fullAgain = await searchCanonicalProducts({ term, limit: 4, offset: 0 });

    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(2);
    const idsPage1 = page1.items.map((item) => item.canonicalProductId);
    const idsPage2 = page2.items.map((item) => item.canonicalProductId);
    const idsFull = full.items.map((item) => item.canonicalProductId);

    // Disjoint.
    expect(idsPage1.some((id) => idsPage2.includes(id))).toBe(false);
    // Union equals the single-page fetch, same order.
    expect([...idsPage1, ...idsPage2]).toEqual(idsFull);
    // Same rank and storeCount (all 0) for the four, so `name ASC` — the
    // next key in the total order (R8) — is what breaks the tie, and it
    // happens to match creation order (a, b, c, d).
    expect(idsFull).toEqual(created.map((c) => c.id));
    expect(full.hasMore).toBe(false);
    // Two identical calls return the exact same sequence.
    expect(fullAgain.items.map((item) => item.canonicalProductId)).toEqual(idsFull);
  });

  it("a canonical offered by two stores is one row with storeCount 2 (E22)", async () => {
    const term = `twostores ${session.token}`;
    const canonical = await session.createCanonical({ name: `Twostores widget ${session.token}` });
    const storeA = await session.createStore();
    const storeB = await session.createStore();
    await session.createOffer(storeA.id, canonical.id);
    await session.createOffer(storeB.id, canonical.id);

    const result = await searchCanonicalProducts({ term });
    const matches = result.items.filter((item) => item.canonicalProductId === canonical.id);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.storeCount).toBe(2);
  });
});
