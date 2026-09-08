import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-035, C2 and C6 (spec.md; tests.md § Huecos de cobertura, closed here per
 * the coordinator's review). Both criteria name their OWN verification
 * method — "verificado contando las invalidaciones que dispara ese lote" —
 * so a composition of separately-true unit tests does not satisfy them: the
 * count itself is the criterion, not an implementation detail of it.
 *
 * Unlike `processBatch.test.ts` (which mocks `./handlers/misc` and
 * `@/lib/cache` ENTIRELY, so it only proves aggregation), this file keeps
 * the real call chain from `handleCurrency`/`handleExchangeRate`
 * (`./handlers/misc`, real) through `createRenderableBranchLookup`
 * (`./businessBranches`, real, not mocked at all) through
 * `expandBrandRevalidation`/`canonicalSlug` (real) down to `src/lib/cache.ts`
 * (real) — exactly the technique `src/lib/cache.test.ts` already uses for
 * its own "2 stores x 2 tags" arithmetic. Only the two true I/O boundaries
 * are mocked: `@/lib/prisma` (so the business's renderable set is
 * deterministic) and `next/cache` (a spy that COUNTS, per R12 — never a
 * silent passthrough, because the count is the assertion).
 *
 * `handleStore`/`handleProduct`/`./handlers/misc`'s `handleCategory` stay
 * mocked: this file is not re-proving their own logic (that is each
 * handler's own `*.test.ts`), only that mixing them with a REAL
 * `EXCHANGE_RATE` path in the SAME batch does not inflate the count beyond
 * R12's `2 x N`.
 *
 * F-039 (architecture.md § Pruebas, row `processBatch.invalidationCount.test.ts`,
 * C14): `./handlers/business` stays REAL too, for the same reason
 * `handleCurrency`/`handleExchangeRate` do — this is the file that proves
 * the memo (`createRenderableBranchLookup`) is shared ACROSS handler kinds
 * within one batch, and `handleBusiness`'s own logic (the stale guard, R5)
 * is already covered by `handlers/business.test.ts`. `prisma.business.updateMany`
 * is mocked to resolve `{ count: 1 }` — a real write, never `STALE` — so
 * every BUSINESS event here reaches `renderableBranches`.
 */

const storefrontFindMany = vi.fn();
const currencyUpsert = vi.fn();
const exchangeRateCreate = vi.fn();
const businessUpdateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    storefront: { findMany: (...a: unknown[]) => storefrontFindMany(...a) },
    currency: { upsert: (...a: unknown[]) => currencyUpsert(...a) },
    exchangeRate: { create: (...a: unknown[]) => exchangeRateCreate(...a) },
    business: { updateMany: (...a: unknown[]) => businessUpdateMany(...a) },
  },
}));

const revalidateTagSpy = vi.fn();
vi.mock("next/cache", () => ({
  revalidateTag: (...a: unknown[]) => revalidateTagSpy(...a),
  unstable_cache: (fn: unknown) => fn,
}));

const handleStore = vi.fn();
const handleProduct = vi.fn();
const handleCategory = vi.fn();
vi.mock("./handlers/store", () => ({ handleStore: (...a: unknown[]) => handleStore(...a) }));
vi.mock("./handlers/product", () => ({ handleProduct: (...a: unknown[]) => handleProduct(...a) }));
vi.mock("./handlers/misc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./handlers/misc")>();
  // handleCurrency/handleExchangeRate stay REAL — that real chain, plus real
  // `src/lib/cache.ts`, is the whole point of this file. Only handleCategory
  // is replaced, so a CATEGORY event in the C6 mix does not need its own
  // Prisma surface mocked (LocalCategory, StoreProduct, …) — irrelevant to
  // what this file counts.
  return { ...actual, handleCategory: (...a: unknown[]) => handleCategory(...a) };
});

const recordBatch = vi.fn();
const markProcessed = vi.fn();
const markSkipped = vi.fn();
const markFailed = vi.fn();
vi.mock("./inbox", () => ({
  recordBatch: (...a: unknown[]) => recordBatch(...a),
  markProcessed: (...a: unknown[]) => markProcessed(...a),
  markSkipped: (...a: unknown[]) => markSkipped(...a),
  markFailed: (...a: unknown[]) => markFailed(...a),
}));

const removeStoreObjectsUnder = vi.fn();
vi.mock("@/lib/supabase/storage", () => ({
  removeStoreObjectsUnder: (...a: unknown[]) => removeStoreObjectsUnder(...a),
}));

const { processCatalogBatch } = await import("./processBatch");

const CALLER = { businessId: "business-1", externalId: "seed-negocio-1" };

/** Three single-branch brands — `canonicalSlug()` with `brandBranchCount<=1`
 *  (R4) returns each brand's OWN slug, no `Store.slug` needed — so the
 *  business's renderable set is exactly these three canonical slugs,
 *  deterministic and independent of how many EXCHANGE_RATE/CATEGORY/PRODUCT/
 *  STORE events the batch contains. */
const THREE_RENDERABLE_BRANCHES = [
  { slug: "tienda-a", stores: [{ slug: null }] },
  { slug: "tienda-b", stores: [{ slug: null }] },
  { slug: "tienda-c", stores: [{ slug: null }] },
];

function exchangeRateEvent(eventId: string, currency: string, rate: number) {
  return {
    eventId,
    entity: "EXCHANGE_RATE" as const,
    operation: "CREATE" as const,
    occurredAt: "2026-09-06T00:00:00.000Z",
    payload: {
      businessId: "business-1",
      currency,
      rate,
      updatedAt: "2026-09-06T00:00:00.000Z",
    },
  };
}

function categoryEvent(eventId: string) {
  return {
    eventId,
    entity: "CATEGORY" as const,
    operation: "UPDATE" as const,
    occurredAt: "2026-09-06T00:00:00.000Z",
    payload: {
      categoryId: `ext-${eventId}`,
      businessId: "business-1",
      name: "Bebidas",
      color: null,
      updatedAt: "2026-09-06T00:00:00.000Z",
    },
  };
}

function productEvent(eventId: string) {
  return {
    eventId,
    entity: "PRODUCT" as const,
    operation: "UPDATE" as const,
    occurredAt: "2026-09-06T00:00:00.000Z",
    payload: {
      storeProductId: `ext-${eventId}`,
      productId: `canon-${eventId}`,
      businessId: "business-1",
      storeId: "seed-tienda-1",
      localName: "Producto",
      barcodes: [],
      localCategoryId: null,
      price: 10,
      currency: "CUP",
      canonicalProductId: null,
      imageUrl: null,
      publishToStore: true,
      updatedAt: "2026-09-06T00:00:00.000Z",
    },
  };
}

function storeEvent(eventId: string) {
  return {
    eventId,
    entity: "STORE" as const,
    operation: "UPDATE" as const,
    occurredAt: "2026-09-06T00:00:00.000Z",
    payload: {
      storeId: `ext-${eventId}`,
      businessId: "business-1",
      businessName: "Distribuidora La Rampa",
      name: "Bodega Dos",
      publishToStore: true,
      baseCurrency: "CUP",
      updatedAt: "2026-09-06T00:00:00.000Z",
    },
  };
}

/** Only "store:"-prefixed tags count as an invalidation per R12 — never
 *  "slug:" (revalidateSlugs rides the same touched set, accepted by R13)
 *  nor a raw count of `revalidateStores` calls (that one fires once per
 *  batch even with an empty Set, per `processBatch.ts`). */
function storeTagCallCount() {
  return revalidateTagSpy.mock.calls.filter(([tag]) => String(tag).startsWith("store:")).length;
}

function businessEvent(eventId: string, updatedAt: string) {
  return {
    eventId,
    entity: "BUSINESS" as const,
    operation: "UPDATE" as const,
    occurredAt: updatedAt,
    payload: {
      businessId: "seed-negocio-1",
      displayCurrencies: ["CUP", "USD"],
      updatedAt,
    },
  };
}

beforeEach(() => {
  storefrontFindMany.mockReset().mockResolvedValue(THREE_RENDERABLE_BRANCHES);
  currencyUpsert.mockReset().mockResolvedValue({});
  exchangeRateCreate.mockReset().mockResolvedValue({});
  businessUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  revalidateTagSpy.mockReset();
  handleStore.mockReset();
  handleProduct.mockReset();
  handleCategory.mockReset();
  recordBatch.mockReset();
  markProcessed.mockReset().mockResolvedValue(undefined);
  markSkipped.mockReset().mockResolvedValue(undefined);
  markFailed.mockReset().mockResolvedValue(undefined);
  removeStoreObjectsUnder.mockReset().mockResolvedValue({ ok: true, removed: 0 });
});

describe("processCatalogBatch() — R12's exact count, real handleCurrency/handleExchangeRate + real src/lib/cache.ts (F-035 C2)", () => {
  it("four EXCHANGE_RATE of four different currencies invalidate the business's 3 renderable branches EXACTLY ONCE, not four times", async () => {
    const events = [
      exchangeRateEvent("evt-r1", "AAA", 10),
      exchangeRateEvent("evt-r2", "BBB", 20),
      exchangeRateEvent("evt-r3", "CCC", 30),
      exchangeRateEvent("evt-r4", "DDD", 40),
    ];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });

    const summary = await processCatalogBatch(CALLER, events);

    expect(summary.results.every((r) => r.status === "processed")).toBe(true);

    // R7: one query per BATCH, not one per event — the four calls above all
    // await the SAME memoized promise.
    expect(storefrontFindMany).toHaveBeenCalledOnce();

    // R12, first observation point: revalidateStores fires ONCE for the
    // whole batch, with the deduplicated 3-slug set — not once per event
    // (which would still coalesce to the same Set, but is exactly the
    // regression "a handler calls revalidate* itself" (R8) would produce).
    const storeTags = revalidateTagSpy.mock.calls
      .filter(([tag]) => String(tag).startsWith("store:") && !String(tag).endsWith(":catalog"))
      .map(([tag]) => tag);
    expect(new Set(storeTags)).toEqual(
      new Set(["store:tienda-a", "store:tienda-b", "store:tienda-c"]),
    );

    // R12, second observation point: the EXACT count, 2 tags x 3 stores = 6
    // — never 4 x 2 x 3 = 24 (one resolution/invalidation per event) and
    // never anything else. This is the number the criterion names.
    expect(storeTagCallCount()).toBe(6);
  });
});

describe("processCatalogBatch() — 500 events on a 3-branch business invalidate exactly 6 tags, whatever the mix (F-035 C6, I2)", () => {
  it("mixes EXCHANGE_RATE with CATEGORY/PRODUCT/STORE and still counts 6, not more", async () => {
    handleCategory.mockResolvedValue({ status: "processed", touchedStoreSlugs: ["tienda-a"] });
    handleProduct.mockResolvedValue({ status: "processed", touchedStoreSlug: "tienda-b" });
    handleStore.mockResolvedValue({ status: "processed", touchedStoreSlug: "tienda-c" });

    // I2 (spec.md): "un lote de 500 eventos sobre TRES TIENDAS" describes a
    // PRODUCT/STORE/CATEGORY batch well (each event names its own store) and
    // an EXCHANGE_RATE batch badly — a rate names NO store at all. What the
    // criterion actually fixes is the business's RENDERABLE set (here,
    // exactly 3, mocked above via `storefrontFindMany`), never "the stores
    // the lot happens to name" — 125 EXCHANGE_RATE events below all resolve
    // to the SAME 3 branches, whichever currency each one carries.
    const events = [
      ...Array.from({ length: 125 }, (_, i) => exchangeRateEvent(`evt-rate-${i}`, "AAA", 10 + i)),
      ...Array.from({ length: 125 }, (_, i) => categoryEvent(`evt-cat-${i}`)),
      ...Array.from({ length: 125 }, (_, i) => productEvent(`evt-prod-${i}`)),
      ...Array.from({ length: 125 }, (_, i) => storeEvent(`evt-store-${i}`)),
    ];
    expect(events).toHaveLength(500);
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });

    await processCatalogBatch(CALLER, events);

    // One resolution query for the whole 500-event batch — not one per
    // EXCHANGE_RATE event (125) and not one per event overall (500).
    expect(storefrontFindMany).toHaveBeenCalledOnce();

    // The union of everything touched — the real EXCHANGE_RATE path's 3
    // branches, plus the (mocked) CATEGORY/PRODUCT/STORE touches, which are
    // each already a SUBSET of that same 3 — is still exactly 3 branches,
    // so R12's count stays 2 x 3 = 6. Not 6 x 4 entity kinds, and nowhere
    // near "500 events -> more invalidations".
    expect(storeTagCallCount()).toBe(6);
  });
});

describe("processCatalogBatch() — BUSINESS shares the per-batch memo, real handleBusiness (F-039, C14)", () => {
  it("two BUSINESS events of the SAME business, in one batch, make exactly ONE storefront.findMany and fire 2 x 3 revalidateTag, not twice that", async () => {
    const events = [
      businessEvent("evt-biz-1", "2026-09-08T00:00:00.000Z"),
      businessEvent("evt-biz-2", "2026-09-08T00:00:01.000Z"),
    ];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });

    const summary = await processCatalogBatch(CALLER, events);

    expect(summary.results.every((r) => r.status === "processed")).toBe(true);

    // R18/AD7: one query per BATCH, not one per BUSINESS event — both
    // calls above await the SAME memoized promise.
    expect(storefrontFindMany).toHaveBeenCalledOnce();

    // 2 tags x 3 renderable branches = 6, exactly what a single EXCHANGE_RATE
    // batch already fires above — not 12 (once per BUSINESS event).
    expect(storeTagCallCount()).toBe(6);
  });

  it("BUSINESS events of TWO DIFFERENT businesses (two separate batches) each run their own storefront.findMany — the memo never survives across batches", async () => {
    const eventsA = [businessEvent("evt-biz-a", "2026-09-08T00:00:00.000Z")];
    recordBatch.mockResolvedValueOnce({ fresh: eventsA, duplicateIds: [] });
    await processCatalogBatch(CALLER, eventsA);

    expect(storefrontFindMany).toHaveBeenCalledOnce();

    const eventsB = [businessEvent("evt-biz-b", "2026-09-08T00:00:00.000Z")];
    recordBatch.mockResolvedValueOnce({ fresh: eventsB, duplicateIds: [] });
    await processCatalogBatch({ businessId: "business-2", externalId: "seed-negocio-2" }, eventsB);

    expect(storefrontFindMany).toHaveBeenCalledTimes(2);
  });
});
