import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createFixtureSession,
  type FixtureSession,
} from "@/features/marketplace/server/dbFixtures";
import { buildStoreSearchSql, searchStoreProducts } from "./search";
import { recordStoreSearchQuery } from "./searchLog";
import { reindexStoreProduct } from "./searchIndex";
import { STORE_SEARCH_PAGE_SIZE } from "@/constants/storeSearch";

/**
 * `searchStoreProducts` against a real Postgres (F-021, plan.md paso 14;
 * spec.md criterios 1, 2, 3, 4, 5, 7, 8, 12; architecture.md § Pruebas
 * contra Postgres real, § SQL — Q1). No mocks: `tsvector`, `unaccent`,
 * `pg_trgm` and the GIN indexes only exist for real here.
 *
 * Unlike the marketplace's own search (F-015), this read is ALWAYS scoped
 * by `storeId` (R6) — so a fresh `session.createStore()` per test isolates
 * assertions from the shared, already-seeded local database without having
 * to embed the session token inside every search term the way the
 * marketplace's own suite does.
 */
describe("searchStoreProducts against real Postgres", () => {
  let session: FixtureSession;

  beforeAll(async () => {
    session = await createFixtureSession();
  });

  afterAll(async () => {
    await session.cleanup();
  });

  it("sentinel: a fresh offer is born indexed, findable by its own name (anti-vacuity)", async () => {
    const store = await session.createStore();
    const canonical = await session.createCanonical({ name: "Sentinel canonical" });
    const offer = await session.createOffer(store.id, canonical.id, {
      localName: "Sentinel offer",
    });

    const [raw] = await prisma.$queryRaw<{ notNull: boolean }[]>(Prisma.sql`
      SELECT "searchVector" IS NOT NULL AS "notNull"
        FROM "StoreProduct" WHERE "id" = ${offer.id}
    `);
    expect(raw?.notNull).toBe(true);

    const result = await searchStoreProducts({ storeId: store.id, term: "sentinel offer" });
    expect(result.items.map((item) => item.id)).toContain(offer.id);
  });

  it("the exact name of a product is the position-1 result (criterio 1, E1)", async () => {
    const store = await session.createStore();
    const canonical = await session.createCanonical({ name: "Refresco coca-cola canonical" });
    const target = await session.createOffer(store.id, canonical.id, {
      localName: "Refresco coca-cola 1.5 LT",
    });
    // A decoy that must not outrank the exact match.
    const otherCanonical = await session.createCanonical({ name: "Refresco de cola generico" });
    await session.createOffer(store.id, otherCanonical.id, {
      localName: "Refresco de cola generico 2 L",
    });

    const result = await searchStoreProducts({
      storeId: store.id,
      term: "Refresco coca-cola 1.5 LT",
    });

    expect(result.items[0]?.id).toBe(target.id);
    expect(result.items[0]?.layer).toBe(1);
  });

  it("the same query also surfaces a product of the same GLOBAL category, layer 3 (criterio 2, E2)", async () => {
    const store = await session.createStore();
    const globalCategory = await session.createGlobalCategory({ name: "Bebidas de prueba" });

    const targetCanonical = await session.createCanonical({
      name: "Refresco coca-cola canonical dos",
      globalCategoryId: globalCategory.id,
    });
    const target = await session.createOffer(store.id, targetCanonical.id, {
      localName: "Refresco coca-cola 1.5 LT dos",
    });

    // Shares the GLOBAL category, but its name shares no word with the
    // query — the only way it can appear is through the expansion layer.
    const relatedCanonical = await session.createCanonical({
      name: "Agua mineral sin gas",
      globalCategoryId: globalCategory.id,
    });
    const related = await session.createOffer(store.id, relatedCanonical.id, {
      localName: "Agua mineral sin gas 500 ml",
    });

    const result = await searchStoreProducts({
      storeId: store.id,
      term: "Refresco coca-cola 1.5 LT dos",
    });

    expect(result.items[0]?.id).toBe(target.id);
    const relatedItem = result.items.find((item) => item.id === related.id);
    expect(relatedItem).toBeDefined();
    expect(relatedItem?.layer).toBe(3);
    // R1: every layer-1/2 result precedes every layer-3 result.
    const relatedIndex = result.items.findIndex((item) => item.id === related.id);
    expect(result.items.slice(0, relatedIndex).every((item) => item.layer < 3)).toBe(true);
  });

  it("without a global category, the cascade falls back to LocalCategory (E2b, R17)", async () => {
    const store = await session.createStore();
    const localCategory = await session.createLocalCategory({ name: "Bebidas locales" });

    // Both canonicals are WITHOUT a globalCategoryId (R17's second rung).
    const targetCanonical = await session.createCanonical({ name: "Jugo de mango canonical" });
    const target = await session.createOffer(store.id, targetCanonical.id, {
      localName: "Jugo de mango 1 L especial",
      localCategoryId: localCategory.id,
    });

    const relatedCanonical = await session.createCanonical({ name: "Jugo de naranja canonical" });
    const related = await session.createOffer(store.id, relatedCanonical.id, {
      localName: "Jugo de naranja 1 L",
      localCategoryId: localCategory.id,
    });

    const result = await searchStoreProducts({
      storeId: store.id,
      term: "Jugo de mango 1 L especial",
    });

    expect(result.items[0]?.id).toBe(target.id);
    const relatedItem = result.items.find((item) => item.id === related.id);
    expect(relatedItem?.layer).toBe(3);
  });

  it("a product WITH a global category never enters through a matching LocalCategory (R17: never both)", async () => {
    const store = await session.createStore();
    const localCategory = await session.createLocalCategory({ name: "Categoria local compartida" });
    const globalCategory = await session.createGlobalCategory({
      name: "Categoria global distinta",
    });

    const targetCanonical = await session.createCanonical({
      name: "Producto ancla",
      globalCategoryId: globalCategory.id,
    });
    const target = await session.createOffer(store.id, targetCanonical.id, {
      localName: "Producto ancla buscado",
      localCategoryId: localCategory.id,
    });

    // Shares the LOCAL category with the target, but its canonical has ITS
    // OWN global category — different from the target's — so R17 says it
    // must NOT be pulled in by the shared local category.
    const decoyCanonical = await session.createCanonical({
      name: "Producto decoy",
      globalCategoryId: null,
    });
    const decoyGlobal = await session.createGlobalCategory({ name: "Otra categoria global" });
    await prisma.canonicalProduct.update({
      where: { id: decoyCanonical.id },
      data: { globalCategoryId: decoyGlobal.id },
    });
    const decoy = await session.createOffer(store.id, decoyCanonical.id, {
      localName: "Producto decoy sin relacion textual",
      localCategoryId: localCategory.id,
    });

    const result = await searchStoreProducts({ storeId: store.id, term: "Producto ancla buscado" });

    expect(result.items[0]?.id).toBe(target.id);
    expect(result.items.some((item) => item.id === decoy.id)).toBe(false);
  });

  it("accents never change the result set or its order (criterio 3, E3)", async () => {
    const store = await session.createStore();
    const canonical = await session.createCanonical({ name: "Refresco especial canonical" });
    const offer = await session.createOffer(store.id, canonical.id, {
      localName: "Refresco especial de café",
    });

    const unaccented = await searchStoreProducts({ storeId: store.id, term: "refresco especial" });
    const accented = await searchStoreProducts({ storeId: store.id, term: "réfrésco éspécial" });

    expect(unaccented.items.map((i) => i.id)).toContain(offer.id);
    expect(unaccented.items.map((i) => i.id)).toEqual(accented.items.map((i) => i.id));

    // And the other direction: an unaccented term finds an accented document.
    const withUnaccentedTerm = await searchStoreProducts({ storeId: store.id, term: "cafe" });
    expect(withUnaccentedTerm.items.map((i) => i.id)).toContain(offer.id);
  });

  it("a one-character typo still finds the product, through the fuzzy layer (criterio 4, E4)", async () => {
    const store = await session.createStore();
    const canonical = await session.createCanonical({ name: "Coca cola canonical" });
    const offer = await session.createOffer(store.id, canonical.id, {
      localName: "Coca-Cola 1.5 L",
    });

    const result = await searchStoreProducts({ storeId: store.id, term: "cocacola" });

    const item = result.items.find((i) => i.id === offer.id);
    expect(item).toBeDefined();
    expect(item?.layer).toBe(2);
  });

  it("a search in store A never returns a product that only exists in store B (criterio 5, E7)", async () => {
    const storeA = await session.createStore();
    const storeB = await session.createStore();
    const canonical = await session.createCanonical({ name: "Producto compartido canonical" });
    await session.createOffer(storeA.id, canonical.id, { localName: "Producto exclusivo de A" });
    const offerB = await session.createOffer(storeB.id, canonical.id, {
      localName: "Producto exclusivo de A",
    });

    const resultFromA = await searchStoreProducts({
      storeId: storeA.id,
      term: "Producto exclusivo de A",
    });

    expect(resultFromA.items.some((item) => item.id === offerB.id)).toBe(false);
    // Not vacuous, and even through the fuzzy layer.
    const fuzzyFromA = await searchStoreProducts({ storeId: storeA.id, term: "exclusivoA" });
    expect(fuzzyFromA.items.some((item) => item.id === offerB.id)).toBe(false);
  });

  it("visible: false and a soft-deleted offer never appear; OUT_OF_STOCK still does (E6, R7)", async () => {
    const store = await session.createStore();
    const canonical = await session.createCanonical({ name: "Visibilidad canonical" });

    const hidden = await session.createOffer(store.id, canonical.id, {
      localName: "Visibilidad producto oculto",
      visible: false,
    });
    const deletedCanonical = await session.createCanonical({
      name: "Visibilidad canonical borrado",
    });
    const deleted = await session.createOffer(store.id, deletedCanonical.id, {
      localName: "Visibilidad producto borrado",
      deletedAt: new Date(),
    });
    const outOfStockCanonical = await session.createCanonical({
      name: "Visibilidad canonical agotado",
    });
    const outOfStock = await session.createOffer(store.id, outOfStockCanonical.id, {
      localName: "Visibilidad producto agotado",
      availability: "OUT_OF_STOCK" as never,
    });

    const hiddenResult = await searchStoreProducts({
      storeId: store.id,
      term: "Visibilidad producto oculto",
    });
    expect(hiddenResult.items.some((item) => item.id === hidden.id)).toBe(false);

    const deletedResult = await searchStoreProducts({
      storeId: store.id,
      term: "Visibilidad producto borrado",
    });
    expect(deletedResult.items.some((item) => item.id === deleted.id)).toBe(false);

    const outOfStockResult = await searchStoreProducts({
      storeId: store.id,
      term: "Visibilidad producto agotado",
    });
    const item = outOfStockResult.items.find((i) => i.id === outOfStock.id);
    expect(item).toBeDefined();
    expect(item?.availability).toBe("OUT_OF_STOCK");
  });

  it("editing a description finds a brand-new word right away (criterio 6, E8)", async () => {
    const store = await session.createStore();
    const canonical = await session.createCanonical({ name: "Panel edit canonical" });
    const offer = await session.createOffer(store.id, canonical.id, {
      localName: "Panel edit producto",
    });

    const before = await searchStoreProducts({ storeId: store.id, term: "artesanalxyz" });
    expect(before.items.some((item) => item.id === offer.id)).toBe(false);

    // The SAME two steps `saveProduct` performs (mutations.ts): the typed
    // update the panel owns, then the reindexer it calls right after —
    // never a hand-rolled `data: { searchDocument }` (G1).
    await prisma.storeProduct.update({
      where: { id: offer.id },
      data: { description: "Hecho de forma artesanalxyz, en pequeños lotes." },
    });
    await reindexStoreProduct(prisma, offer.id);

    const after = await searchStoreProducts({ storeId: store.id, term: "artesanalxyz" });
    expect(after.items.some((item) => item.id === offer.id)).toBe(true);
  });

  it("a query with no matches leaves exactly one registered row with resultCount 0 (criterio 7, E5)", async () => {
    const store = await session.createStore();
    const before = await prisma.storeSearchQuery.count({ where: { storeId: store.id } });

    const result = await searchStoreProducts({ storeId: store.id, term: "xilofonoinexistente" });
    expect(result.totalCount).toBe(0);
    await recordStoreSearchQuery({
      storeId: store.id,
      term: result.term,
      resultCount: result.totalCount,
    });

    const after = await prisma.storeSearchQuery.count({ where: { storeId: store.id } });
    expect(after).toBe(before + 1);

    const row = await prisma.storeSearchQuery.findFirstOrThrow({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
    });
    expect(row.resultCount).toBe(0);
    expect(row.storeId).toBe(store.id);
  });

  it.each([
    [`producto & | ! ( ) : *`, "tsquery metacharacters (E12)"],
    [`"`, "a bare double quote (E12)"],
    [`'`, "a bare single quote (E12)"],
    [`'; DROP TABLE "StoreProduct"; --`, "a SQL injection attempt (R11, E12)"],
  ])("a hostile term (%s) never throws — %s", async (hostile) => {
    const store = await session.createStore();
    const result = await searchStoreProducts({ storeId: store.id, term: hostile });
    expect(Array.isArray(result.items)).toBe(true);

    const [row] = await prisma.$queryRaw<{ ok: boolean }[]>(
      Prisma.sql`SELECT to_regclass('"StoreProduct"') IS NOT NULL AS ok`,
    );
    expect(row?.ok).toBe(true);
  });

  it("pagination is stable and total order holds across pages (E15, R10)", async () => {
    const store = await session.createStore();
    const total = STORE_SEARCH_PAGE_SIZE + 3;
    const created: string[] = [];
    for (let i = 0; i < total; i++) {
      const label = String(i).padStart(3, "0");
      // A store can only ever hold ONE offer per canonical
      // (`@@unique([storeId, canonicalProductId])`), so `total` distinct
      // rows in the SAME store need `total` distinct canonicals.
      const canonical = await session.createCanonical({ name: `Paginacion canonical ${label}` });
      const offer = await session.createOffer(store.id, canonical.id, {
        localName: `Paginacion producto ${label}`,
      });
      created.push(offer.id);
    }

    const page1 = await searchStoreProducts({ storeId: store.id, term: "Paginacion producto" });
    const page2 = await searchStoreProducts({
      storeId: store.id,
      term: "Paginacion producto",
      page: 2,
    });

    expect(page1.items).toHaveLength(STORE_SEARCH_PAGE_SIZE);
    expect(page2.items.length).toBeGreaterThan(0);
    const idsPage1 = page1.items.map((i) => i.id);
    const idsPage2 = page2.items.map((i) => i.id);
    // Disjoint.
    expect(idsPage1.some((id) => idsPage2.includes(id))).toBe(false);
    // Union covers every created offer exactly once, in `localName` order
    // (same rank tier and score, so R10's next key breaks the tie).
    expect(new Set([...idsPage1, ...idsPage2]).size).toBe(total);
    expect(page1.totalCount).toBe(total);
    expect(page1.hasMore).toBe(true);
    expect(page2.hasMore).toBe(false);
  });

  it("a page beyond the last one keeps the real totalCount — never collapses to 0 (página fuera de rango)", async () => {
    const store = await session.createStore();
    const canonical = await session.createCanonical({ name: "Fuera de rango canonical" });
    await session.createOffer(store.id, canonical.id, { localName: "Fuera de rango producto" });

    // Exactly one match, so page 2 is already beyond the last one — the
    // `page` CTE returns 0 rows while `totals` still knows the real count
    // (architecture.md's `count(*) OVER ()` would have reported 0 here,
    // indistinguishable from a genuine E5 "no results").
    const result = await searchStoreProducts({
      storeId: store.id,
      term: "Fuera de rango producto",
      page: 2,
    });

    expect(result.items).toHaveLength(0);
    expect(result.totalCount).toBe(1);
    expect(result.hasMore).toBe(false);
  });
});

/**
 * Criterio 8: `EXPLAIN` of the EXACT statement `searchStoreProducts` runs
 * (`buildStoreSearchSql`) names the two new indexes and never `Seq Scan`s
 * `StoreProduct` — on a fixture with volume enough for the planner to
 * prefer them (SP4). `enable_seqscan = off` is deliberately never used: it
 * would only prove the index CAN be used, not that the planner prefers it.
 */
describe("searchStoreProducts — el EXPLAIN usa los índices (criterio 8, SP4)", () => {
  let session: FixtureSession;
  let client: Client;
  let storeId: string;
  let term: string;

  beforeAll(async () => {
    session = await createFixtureSession();
    const store = await session.createStore();
    storeId = store.id;
    const canonical = await session.createCanonical({ name: "Explain canonical" });
    await session.createOffer(store.id, canonical.id, {
      localName: "Explain producto objetivo",
    });
    term = "Explain producto objetivo";

    // SP4's volume: measured on this machine, NOT the architecture's 2000
    // starting point — at 2000 (and even at 8000) the lexical layer's GIN
    // already won, but the FUZZY layer's trigram GIN
    // (`StoreProduct_searchDocument_trgm_idx`) still lost to a Seq Scan.
    // 10 000 rows in THIS store (so the GIN beats scanning the store's own
    // slice) plus 10 000 in a filler tenant's store (so `storeId` itself is
    // selective) is the smallest round number where BOTH layers' plans
    // switched, confirmed with `EXPLAIN (ANALYZE, FORMAT JSON)` against this
    // exact statement. `enable_seqscan` is never touched.
    await session.createFillerOffers(10_000, { storeId: store.id, businessId: session.businessId });
    await session.createFillerOffers(10_000);

    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query('ANALYZE "StoreProduct"');
  }, 60_000);

  afterAll(async () => {
    await client.end();
    await session.cleanup();
  }, 60_000);

  it("(a) both indexes exist", async () => {
    const { rows } = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'StoreProduct'
        AND indexname IN ('StoreProduct_searchVector_idx', 'StoreProduct_searchDocument_trgm_idx')`,
    );
    expect(rows.map((r) => r.indexname).sort()).toEqual([
      "StoreProduct_searchDocument_trgm_idx",
      "StoreProduct_searchVector_idx",
    ]);
  });

  it("(b) the plan of the exact Q1 statement never Seq Scans StoreProduct, and names its indexes", async () => {
    const sql = buildStoreSearchSql({ storeId, term, page: 1 });
    // `Prisma.Sql` carries its own text (with `$1`, `$2`, … placeholders)
    // and its own bound values — exactly what `pg`'s `Client.query` takes.
    const { rows } = await client.query<{ "QUERY PLAN": Record<string, unknown>[] }>(
      `EXPLAIN (FORMAT JSON) ${sql.text}`,
      sql.values,
    );
    // `EXPLAIN (FORMAT JSON)` wraps the root node in `{ "Plan": … }`.
    const plan = (rows[0]?.["QUERY PLAN"]?.[0] as { Plan?: unknown } | undefined)?.Plan;
    expect(plan).toBeDefined();

    const planText = JSON.stringify(plan);
    // No `Seq Scan` node whose `Relation Name` is `StoreProduct` — a
    // `Seq Scan` on `LocalCategory` (a handful of rows) is legitimate and
    // NOT what this criterion checks for.
    expect(hasSeqScanOnStoreProduct(plan)).toBe(false);
    expect(planText).toContain("StoreProduct_searchVector_idx");
    expect(planText).toContain("StoreProduct_searchDocument_trgm_idx");
  });
});

/** Walks an `EXPLAIN (FORMAT JSON)` plan tree looking for a `Seq Scan` node
 *  whose `Relation Name` is `StoreProduct` — never a `toContain` on text,
 *  since Q1 has several CTEs and a `Seq Scan` on `LocalCategory` (4 rows in
 *  the fixture data) is legitimate. */
function hasSeqScanOnStoreProduct(node: unknown): boolean {
  if (node === null || typeof node !== "object") return false;
  const record = node as Record<string, unknown>;
  if (record["Node Type"] === "Seq Scan" && record["Relation Name"] === "StoreProduct") {
    return true;
  }
  const plans = record["Plans"];
  if (Array.isArray(plans)) {
    return plans.some((child) => hasSeqScanOnStoreProduct(child));
  }
  return false;
}
