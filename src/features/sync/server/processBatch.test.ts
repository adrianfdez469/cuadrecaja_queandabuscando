import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEPENDENCY_FAILED_IN_BATCH } from "@/constants/sync";

/**
 * F-017 ALTA #3 (tests.md § Fallos encontrados #3): the batch used to
 * revalidate `revalidateSlugs(touchedStores)` — only the canonical of each
 * branch a handler actually wrote a row for. A handler's `touchedSlugValues`
 * (the brand's own slug and every sibling's own slug, expanded by
 * `expandBrandTouch`) now rides in the SAME call, merged across the whole
 * batch — never a second `revalidateTag` round per event (the doc comment
 * on `processCatalogBatch` promises exactly that).
 *
 * Every handler module is mocked so this file tests the AGGREGATION only,
 * not any handler's own logic (that is `handlers/store.test.ts`'s job).
 */

const handleStore = vi.fn();
const handleProduct = vi.fn();
const handleCategory = vi.fn();
const handleCurrency = vi.fn();
const handleExchangeRate = vi.fn();
const handleBusiness = vi.fn();
const recordBatch = vi.fn();
const markProcessed = vi.fn();
const markSkipped = vi.fn();
const markFailed = vi.fn();
const revalidateStores = vi.fn();
const revalidateSlugs = vi.fn();
const revalidateStorefronts = vi.fn();
const revalidateProducts = vi.fn();
const removeStoreObjectsUnder = vi.fn();

vi.mock("./handlers/store", () => ({ handleStore: (...a: unknown[]) => handleStore(...a) }));
vi.mock("./handlers/product", () => ({ handleProduct: (...a: unknown[]) => handleProduct(...a) }));
vi.mock("./handlers/misc", () => ({
  handleCategory: (...a: unknown[]) => handleCategory(...a),
  handleCurrency: (...a: unknown[]) => handleCurrency(...a),
  handleExchangeRate: (...a: unknown[]) => handleExchangeRate(...a),
}));
// F-038 AD6(3): if this stays unmocked, the twelve pre-existing cases below
// load the REAL module and with it `@/lib/prisma`.
vi.mock("./handlers/business", () => ({
  handleBusiness: (...a: unknown[]) => handleBusiness(...a),
}));
vi.mock("./inbox", () => ({
  recordBatch: (...a: unknown[]) => recordBatch(...a),
  markProcessed: (...a: unknown[]) => markProcessed(...a),
  markSkipped: (...a: unknown[]) => markSkipped(...a),
  markFailed: (...a: unknown[]) => markFailed(...a),
}));
vi.mock("@/lib/cache", () => ({
  revalidateStores: (...a: unknown[]) => revalidateStores(...a),
  revalidateSlugs: (...a: unknown[]) => revalidateSlugs(...a),
  revalidateStorefronts: (...a: unknown[]) => revalidateStorefronts(...a),
  revalidateProducts: (...a: unknown[]) => revalidateProducts(...a),
}));
vi.mock("@/lib/supabase/storage", () => ({
  removeStoreObjectsUnder: (...a: unknown[]) => removeStoreObjectsUnder(...a),
}));

const { processCatalogBatch } = await import("./processBatch");

const CALLER = { businessId: "business-1", externalId: "seed-negocio-1" };

function storeEvent(eventId: string) {
  return {
    eventId,
    entity: "STORE" as const,
    operation: "UPDATE" as const,
    occurredAt: "2026-08-27T00:00:00.000Z",
    payload: {
      storeId: `ext-${eventId}`,
      businessId: "business-1",
      businessName: "Distribuidora La Rampa",
      name: "Bodega Dos",
      publishToStore: true,
      baseCurrency: "CUP",
      updatedAt: "2026-08-27T00:00:00.000Z",
    },
  };
}

beforeEach(() => {
  handleStore.mockReset();
  // F-037: not reset by the pre-existing 12 cases (none of them exercise
  // PRODUCT), so it never needed clearing before this file's new describe
  // block below started calling it.
  handleProduct.mockReset();
  handleCategory.mockReset();
  handleCurrency.mockReset();
  handleExchangeRate.mockReset();
  handleBusiness.mockReset();
  recordBatch.mockReset();
  markProcessed.mockReset().mockResolvedValue(undefined);
  markSkipped.mockReset().mockResolvedValue(undefined);
  markFailed.mockReset().mockResolvedValue(undefined);
  revalidateStores.mockReset();
  revalidateSlugs.mockReset();
  revalidateStorefronts.mockReset();
  revalidateProducts.mockReset();
  removeStoreObjectsUnder.mockReset().mockResolvedValue({ ok: true, removed: 0 });
});

describe("processCatalogBatch() — merges a handler's touchedSlugValues into the SAME revalidateSlugs call", () => {
  it("a routine STORE update in a two-branch brand revalidates the touched branch, the brand, AND the sibling", async () => {
    const events = [storeEvent("evt-b")];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleStore.mockResolvedValue({
      status: "processed",
      touchedStoreSlug: "bodega-dos",
      touchedBrandSlug: "bodega-uno",
      // What `handlers/store.ts::siblingTouch` reports once F-017's fix is
      // in place — the brand's own slug plus every sibling's own slug.
      touchedSlugValues: ["bodega-uno", "bodega-uno-2", "bodega-dos"],
    });

    await processCatalogBatch(CALLER, events);

    expect([...revalidateStores.mock.calls[0][0]]).toEqual(["bodega-dos"]);
    const slugArg = [...revalidateSlugs.mock.calls[0][0]].sort();
    expect(slugArg).toEqual(["bodega-dos", "bodega-uno", "bodega-uno-2"]);
    // ONE call per tag family for the whole batch, never one per event.
    expect(revalidateSlugs).toHaveBeenCalledOnce();
  });

  it("a single-branch brand's routine update never adds anything beyond its own touched canonical", async () => {
    const events = [storeEvent("evt-solo")];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleStore.mockResolvedValue({
      status: "processed",
      touchedStoreSlug: "tienda-sola",
      touchedBrandSlug: "tienda-sola",
    });

    await processCatalogBatch(CALLER, events);

    expect([...revalidateSlugs.mock.calls[0][0]]).toEqual(["tienda-sola"]);
  });

  it("merges touchedSlugValues from TWO events in the same batch into one deduplicated call", async () => {
    const events = [storeEvent("evt-b"), storeEvent("evt-a")];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleStore
      .mockResolvedValueOnce({
        status: "processed",
        touchedStoreSlug: "bodega-dos",
        touchedBrandSlug: "bodega-uno",
        touchedSlugValues: ["bodega-uno", "bodega-uno-2", "bodega-dos"],
      })
      .mockResolvedValueOnce({
        status: "processed",
        touchedStoreSlug: "bodega-uno-2",
        touchedBrandSlug: "bodega-uno",
        touchedSlugValues: ["bodega-uno", "bodega-uno-2", "bodega-dos"],
      });

    await processCatalogBatch(CALLER, events);

    expect(revalidateSlugs).toHaveBeenCalledOnce();
    const slugArg = [...revalidateSlugs.mock.calls[0][0]].sort();
    expect(slugArg).toEqual(["bodega-dos", "bodega-uno", "bodega-uno-2"]);
  });
});

describe("processCatalogBatch() — drains purgeObjectPrefix AFTER revalidating (F-023 R9/R13/R14)", () => {
  it("purges the prefix a handler reported, after revalidateStores/Slugs/Storefronts", async () => {
    const events = [storeEvent("evt-a")];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleStore.mockResolvedValue({
      status: "processed",
      touchedStoreSlug: "tienda-sola",
      touchedBrandSlug: "tienda-sola",
      purgeObjectPrefix: "stores/store-1/products/product-1/",
    });

    const callOrder: string[] = [];
    revalidateStores.mockImplementation(() => callOrder.push("revalidateStores"));
    revalidateSlugs.mockImplementation(() => callOrder.push("revalidateSlugs"));
    revalidateStorefronts.mockImplementation(() => callOrder.push("revalidateStorefronts"));
    removeStoreObjectsUnder.mockImplementation(async () => {
      callOrder.push("removeStoreObjectsUnder");
      return { ok: true, removed: 5 };
    });

    await processCatalogBatch(CALLER, events);

    expect(removeStoreObjectsUnder).toHaveBeenCalledExactlyOnceWith(
      "stores/store-1/products/product-1/",
    );
    expect(callOrder).toEqual([
      "revalidateStores",
      "revalidateSlugs",
      "revalidateStorefronts",
      "removeStoreObjectsUnder",
    ]);
  });

  it("deduplicates the same prefix reported by two events into ONE removal call", async () => {
    const events = [storeEvent("evt-a"), storeEvent("evt-b")];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleStore.mockResolvedValue({
      status: "processed",
      touchedStoreSlug: "tienda-sola",
      touchedBrandSlug: "tienda-sola",
      purgeObjectPrefix: "stores/store-1/products/product-1/",
    });

    await processCatalogBatch(CALLER, events);

    expect(removeStoreObjectsUnder).toHaveBeenCalledOnce();
  });

  it("never calls removeStoreObjectsUnder when nothing reported a prefix", async () => {
    const events = [storeEvent("evt-a")];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleStore.mockResolvedValue({
      status: "processed",
      touchedStoreSlug: "tienda-sola",
      touchedBrandSlug: "tienda-sola",
    });

    await processCatalogBatch(CALLER, events);

    expect(removeStoreObjectsUnder).not.toHaveBeenCalled();
  });

  it("a Storage failure during the drain does not change any event's already-built result (R13)", async () => {
    const events = [storeEvent("evt-a")];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleStore.mockResolvedValue({
      status: "processed",
      touchedStoreSlug: "tienda-sola",
      touchedBrandSlug: "tienda-sola",
      purgeObjectPrefix: "stores/store-1/products/product-1/",
    });
    removeStoreObjectsUnder.mockResolvedValue({ ok: false, reason: "unreachable" });

    const summary = await processCatalogBatch(CALLER, events);

    expect(summary.results[0]).toEqual({ eventId: "evt-a", status: "processed" });
  });
});

/**
 * F-026 paso 3: `handleCategory` reports `touchedStoreSlugs` (plural — a
 * category is of the BUSINESS, its products live in N branches), and it
 * rides in the SAME `revalidateStores` call as every other handler's
 * `touchedStoreSlug` — no new invalidation call, no second `Set`.
 */
function categoryEvent(eventId: string, operation: "CREATE" | "UPDATE" | "DELETE") {
  return {
    eventId,
    entity: "CATEGORY" as const,
    operation,
    occurredAt: "2026-08-31T00:00:00.000Z",
    payload: {
      categoryId: `ext-${eventId}`,
      businessId: "business-1",
      name: "Bebidas",
      color: null,
      updatedAt: "2026-08-31T00:00:00.000Z",
    },
  };
}

describe("processCatalogBatch() — folds a CATEGORY handler's touchedStoreSlugs into revalidateStores (F-026)", () => {
  it("a CATEGORY/DELETE that affected two branches fires ONE deduplicated invalidation", async () => {
    const events = [categoryEvent("evt-del", "DELETE")];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleCategory.mockResolvedValue({
      status: "processed",
      touchedStoreSlugs: ["tienda-uno", "tienda-dos"],
    });

    await processCatalogBatch(CALLER, events);

    const slugArg = [...revalidateStores.mock.calls[0][0]].sort();
    expect(slugArg).toEqual(["tienda-dos", "tienda-uno"]);
    expect(revalidateStores).toHaveBeenCalledOnce();
  });

  it("merges touchedStoreSlugs from a CATEGORY event with another handler's touchedStoreSlug in the SAME call", async () => {
    const events = [storeEvent("evt-store"), categoryEvent("evt-cat", "UPDATE")];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleStore.mockResolvedValue({
      status: "processed",
      touchedStoreSlug: "bodega-dos",
      touchedBrandSlug: "bodega-uno",
    });
    handleCategory.mockResolvedValue({
      status: "processed",
      touchedStoreSlugs: ["tienda-uno"],
    });

    await processCatalogBatch(CALLER, events);

    expect(revalidateStores).toHaveBeenCalledOnce();
    const slugArg = [...revalidateStores.mock.calls[0][0]].sort();
    expect(slugArg).toEqual(["bodega-dos", "tienda-uno"]);
  });

  it("a CATEGORY/CREATE with no product yet triggers no invalidation at all", async () => {
    const events = [categoryEvent("evt-create", "CREATE")];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleCategory.mockResolvedValue({ status: "processed" });

    await processCatalogBatch(CALLER, events);

    expect([...revalidateStores.mock.calls[0][0]]).toEqual([]);
    expect([...revalidateSlugs.mock.calls[0][0]]).toEqual([]);
  });
});

/**
 * F-035 (architecture.md § AD1, § Flujo de datos): `processCatalogBatch`
 * creates the per-batch renderable-branch lookup ONCE and `applyEvent` hands
 * the SAME closure to both `CURRENCY` and `EXCHANGE_RATE` — this file mocks
 * `handlers/misc` entirely, so it only proves WHAT gets passed down, never
 * how the lookup itself resolves branches (`businessBranches.test.ts`'s job)
 * nor what a handler does with what it returns (`handlers/misc.test.ts`'s).
 */
function currencyEvent(eventId: string) {
  return {
    eventId,
    entity: "CURRENCY" as const,
    operation: "UPDATE" as const,
    occurredAt: "2026-09-01T00:00:00.000Z",
    payload: {
      code: "USD",
      name: "Dólar",
      symbol: "$",
      active: true,
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
  };
}

function exchangeRateEvent(eventId: string) {
  return {
    eventId,
    entity: "EXCHANGE_RATE" as const,
    operation: "CREATE" as const,
    occurredAt: "2026-09-01T00:00:00.000Z",
    payload: {
      businessId: "business-1",
      currency: "USD",
      rate: 440,
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
  };
}

describe("processCatalogBatch() — the per-batch renderable-branch lookup (F-035, AD1)", () => {
  it("passes a THIRD argument to handleCurrency and handleExchangeRate, the SAME function for both", async () => {
    const events = [currencyEvent("evt-cur"), exchangeRateEvent("evt-rate")];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleCurrency.mockResolvedValue({ status: "processed" });
    handleExchangeRate.mockResolvedValue({ status: "processed" });

    await processCatalogBatch(CALLER, events);

    expect(handleCurrency).toHaveBeenCalledExactlyOnceWith(
      events[0].payload,
      "business-1",
      expect.any(Function),
    );
    expect(handleExchangeRate).toHaveBeenCalledExactlyOnceWith(
      events[1].payload,
      "business-1",
      expect.any(Function),
    );
    const currencyArg = handleCurrency.mock.calls[0][2];
    const exchangeRateArg = handleExchangeRate.mock.calls[0][2];
    expect(currencyArg).toBe(exchangeRateArg);
  });

  it("still creates the lookup (and reaches summarize) on a batch with no CURRENCY/EXCHANGE_RATE event", async () => {
    const events = [storeEvent("evt-store")];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleStore.mockResolvedValue({ status: "processed" });

    const summary = await processCatalogBatch(CALLER, events);

    expect(summary.results).toEqual([{ eventId: "evt-store", status: "processed" }]);
    expect(handleCurrency).not.toHaveBeenCalled();
    expect(handleExchangeRate).not.toHaveBeenCalled();
  });
});

/**
 * F-037 (spec.md R1-R20, E1-E19; architecture.md § AD6, fila 2; plan.md
 * paso 7): the cascade guard INSIDE the loop, with every handler still
 * mocked — this file only proves who gets diverted before its handler
 * runs, and in what order the mocked `fresh` array is walked. Two things
 * this file CANNOT prove, on purpose, and that live in
 * `src/features/sync/server/dependencyCascade.db.test.ts` (paso 8)
 * instead: that the order is decided by `occurredAt` and not by array
 * position — `recordBatch` is mocked here, so `fresh` is whatever the test
 * hands it — and what row does or does not end up in Postgres.
 *
 * New helper functions (`dep*Event`), never the file's existing
 * `storeEvent`/`categoryEvent`/`currencyEvent`/`exchangeRateEvent`: this
 * keeps every line of the 12 pre-existing cases untouched (R18/E18 is
 * exactly "the 12 stay green without editing them").
 */
function depCategoryEvent(
  eventId: string,
  categoryId: string,
  operation: "CREATE" | "UPDATE" | "DELETE" = "UPDATE",
) {
  return {
    eventId,
    entity: "CATEGORY" as const,
    operation,
    occurredAt: "2026-09-05T00:00:00.000Z",
    payload: {
      categoryId,
      businessId: "business-1",
      name: "Bebidas",
      color: null,
      updatedAt: "2026-09-05T00:00:00.000Z",
    },
  };
}

function depProductEvent(eventId: string, localCategoryId: string | null) {
  return {
    eventId,
    entity: "PRODUCT" as const,
    operation: "UPDATE" as const,
    occurredAt: "2026-09-05T00:00:00.000Z",
    payload: {
      storeProductId: `ext-${eventId}`,
      productId: `${eventId}-product`,
      businessId: "business-1",
      storeId: "ext-store-1",
      localName: "Producto de prueba",
      barcodes: [] as string[],
      localCategoryId,
      price: 100,
      currency: "CUP",
      canonicalProductId: null,
      imageUrl: null,
      publishToStore: true,
      updatedAt: "2026-09-05T00:00:00.000Z",
    },
  };
}

function depCurrencyEvent(
  eventId: string,
  code: string,
  operation: "CREATE" | "UPDATE" | "DELETE" = "UPDATE",
) {
  return {
    eventId,
    entity: "CURRENCY" as const,
    operation,
    occurredAt: "2026-09-05T00:00:00.000Z",
    payload: {
      code,
      name: code,
      symbol: code,
      active: true,
      updatedAt: "2026-09-05T00:00:00.000Z",
    },
  };
}

function depExchangeRateEvent(eventId: string, currency: string) {
  return {
    eventId,
    entity: "EXCHANGE_RATE" as const,
    operation: "CREATE" as const,
    occurredAt: "2026-09-05T00:00:00.000Z",
    payload: {
      businessId: "business-1",
      currency,
      rate: 440,
      updatedAt: "2026-09-05T00:00:00.000Z",
    },
  };
}

/** A forced handler failure. Never asserted on by its `.message` (AD6's
 *  own rule for the andamio): the ORIGIN event is affirmed only by its
 *  presence in `failed[]`. */
const DEP_ERROR = new Error("forced failure for this test, message never asserted on");

describe("processCatalogBatch() — F-037 dependency cascade (unit, handlers mocked)", () => {
  it("R8/E1 (unit half)/E7: a failed CATEGORY diverts its dependent PRODUCT to failed[] with the constant, BEFORE handleProduct runs, and an unrelated PRODUCT in the same batch still applies", async () => {
    const events = [
      depCategoryEvent("evt-cat", "cat-1"),
      depProductEvent("p-dragged", "cat-1"),
      depProductEvent("p-other", "cat-9"),
    ];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleCategory.mockRejectedValue(DEP_ERROR);
    handleProduct.mockResolvedValue({ status: "processed" });

    const summary = await processCatalogBatch(CALLER, events);

    // R8: handleProduct is called EXACTLY once, and only for the event that
    // did NOT depend on the failed category — never with p-dragged's payload.
    expect(handleProduct).toHaveBeenCalledExactlyOnceWith(
      events[2].payload,
      "UPDATE",
      "business-1",
    );

    expect(summary.failed.map((f) => f.id).sort()).toEqual(["evt-cat", "p-dragged"].sort());
    const dragged = summary.failed.find((f) => f.id === "p-dragged");
    expect(dragged?.error).toBe(DEPENDENCY_FAILED_IN_BATCH);
    expect(summary.ok).not.toContain("evt-cat");
    expect(summary.ok).not.toContain("p-dragged");
    expect(summary.ok).toContain("p-other");
  });

  it("E15: one failed CATEGORY drags ALL three of its subsequent PRODUCTs, not just the first", async () => {
    const events = [
      depCategoryEvent("evt-cat", "cat-1"),
      depProductEvent("p1", "cat-1"),
      depProductEvent("p2", "cat-1"),
      depProductEvent("p3", "cat-1"),
    ];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleCategory.mockRejectedValue(DEP_ERROR);

    const summary = await processCatalogBatch(CALLER, events);

    expect(handleProduct).not.toHaveBeenCalled();
    expect(summary.failed.map((f) => f.id).sort()).toEqual(["evt-cat", "p1", "p2", "p3"].sort());
    for (const id of ["p1", "p2", "p3"]) {
      expect(summary.failed.find((f) => f.id === id)?.error).toBe(DEPENDENCY_FAILED_IN_BATCH);
    }
  });

  it("E6 (unit half, R1): the cascade only runs forward in the order `fresh` was received — a PRODUCT listed BEFORE the failing CATEGORY is untouched", async () => {
    const events = [depProductEvent("p-before", "cat-1"), depCategoryEvent("evt-cat", "cat-1")];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleProduct.mockResolvedValue({ status: "processed" });
    handleCategory.mockRejectedValue(DEP_ERROR);

    const summary = await processCatalogBatch(CALLER, events);

    expect(handleProduct).toHaveBeenCalledExactlyOnceWith(
      events[0].payload,
      "UPDATE",
      "business-1",
    );
    expect(summary.ok).toContain("p-before");
    expect(summary.failed.map((f) => f.id)).toEqual(["evt-cat"]);
  });

  it("E9/R2: a CATEGORY that responds stale does not block the PRODUCT behind it", async () => {
    const events = [depCategoryEvent("evt-cat", "cat-1"), depProductEvent("p1", "cat-1")];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleCategory.mockResolvedValue({ status: "stale" });
    handleProduct.mockResolvedValue({ status: "processed" });

    const summary = await processCatalogBatch(CALLER, events);

    expect(handleProduct).toHaveBeenCalledExactlyOnceWith(
      events[1].payload,
      "UPDATE",
      "business-1",
    );
    expect(summary.failed).toEqual([]);
    expect(summary.ok.sort()).toEqual(["evt-cat", "p1"].sort());
  });

  it("E10/R2: a CURRENCY that responds skipped_not_published does not block the EXCHANGE_RATE behind it", async () => {
    const events = [depCurrencyEvent("evt-cur", "ZQX"), depExchangeRateEvent("evt-rate", "ZQX")];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleCurrency.mockResolvedValue({ status: "skipped_not_published" });
    handleExchangeRate.mockResolvedValue({ status: "processed" });

    const summary = await processCatalogBatch(CALLER, events);

    expect(handleExchangeRate).toHaveBeenCalledExactlyOnceWith(
      events[1].payload,
      "business-1",
      expect.any(Function),
    );
    expect(summary.failed).toEqual([]);
    expect(summary.ok.sort()).toEqual(["evt-cur", "evt-rate"].sort());
  });

  it("E13/R11: the dragged PRODUCT does not itself drag anything — a later EXCHANGE_RATE and a later unrelated PRODUCT both apply", async () => {
    const events = [
      depCategoryEvent("evt-cat", "cat-1"),
      depProductEvent("p-dragged", "cat-1"),
      depExchangeRateEvent("evt-rate", "USD"),
      depProductEvent("p-other", null),
    ];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleCategory.mockRejectedValue(DEP_ERROR);
    handleExchangeRate.mockResolvedValue({ status: "processed" });
    handleProduct.mockResolvedValue({ status: "processed" });

    const summary = await processCatalogBatch(CALLER, events);

    expect(handleExchangeRate).toHaveBeenCalledExactlyOnceWith(
      events[2].payload,
      "business-1",
      expect.any(Function),
    );
    expect(handleProduct).toHaveBeenCalledExactlyOnceWith(
      events[3].payload,
      "UPDATE",
      "business-1",
    );
    expect(summary.failed.map((f) => f.id).sort()).toEqual(["evt-cat", "p-dragged"].sort());
    expect(summary.ok.sort()).toEqual(["evt-rate", "p-other"].sort());
  });

  it("E17/R13: a CATEGORY that fails, repaired by a later UPDATE of the SAME key in the same batch, stops blocking the PRODUCT behind it", async () => {
    const events = [
      depCategoryEvent("evt-cat-1", "cat-1", "UPDATE"),
      depCategoryEvent("evt-cat-2", "cat-1", "UPDATE"),
      depProductEvent("p1", "cat-1"),
    ];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleCategory.mockRejectedValueOnce(DEP_ERROR).mockResolvedValueOnce({ status: "processed" });
    handleProduct.mockResolvedValue({ status: "processed" });

    const summary = await processCatalogBatch(CALLER, events);

    expect(handleProduct).toHaveBeenCalledExactlyOnceWith(
      events[2].payload,
      "UPDATE",
      "business-1",
    );
    expect(summary.failed.map((f) => f.id)).toEqual(["evt-cat-1"]);
    expect(summary.ok).toContain("p1");
    expect(summary.ok).toContain("evt-cat-2");
  });

  it("E17/R13's exception (paso 4b, impl.md § Desviaciones): a CATEGORY DELETE that follows a failed CATEGORY of the SAME key does NOT repair it — the PRODUCT behind it stays blocked", async () => {
    const events = [
      depCategoryEvent("evt-cat-1", "cat-1", "UPDATE"),
      depCategoryEvent("evt-cat-2", "cat-1", "DELETE"),
      depProductEvent("p1", "cat-1"),
    ];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    // handleCategory's DELETE branch answers "processed" WITHOUT writing
    // anything when it found no row (misc.ts, `if (!existing) return
    // PROCESSED;`) — exactly the shape that made R13 need the exception.
    handleCategory.mockRejectedValueOnce(DEP_ERROR).mockResolvedValueOnce({ status: "processed" });

    const summary = await processCatalogBatch(CALLER, events);

    expect(handleProduct).not.toHaveBeenCalled();
    expect(summary.failed.map((f) => f.id).sort()).toEqual(["evt-cat-1", "p1"].sort());
    expect(summary.failed.find((f) => f.id === "p1")?.error).toBe(DEPENDENCY_FAILED_IN_BATCH);
    expect(summary.ok).toContain("evt-cat-2");
    expect(summary.ok).not.toContain("p1");
  });

  it("E18/R18: a batch with no failures at all behaves exactly as it did before this feature — nothing diverted, everything in ok", async () => {
    const events = [
      storeEvent("evt-store"),
      depCategoryEvent("evt-cat", "cat-3", "UPDATE"),
      depProductEvent("p-ok", "cat-3"),
      depCurrencyEvent("evt-cur", "XYZ"),
      depExchangeRateEvent("evt-rate", "XYZ"),
    ];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleStore.mockResolvedValue({ status: "processed" });
    handleCategory.mockResolvedValue({ status: "processed" });
    handleProduct.mockResolvedValue({ status: "processed" });
    handleCurrency.mockResolvedValue({ status: "processed" });
    handleExchangeRate.mockResolvedValue({ status: "processed" });

    const summary = await processCatalogBatch(CALLER, events);

    expect(summary.failed).toEqual([]);
    expect(summary.ok.sort()).toEqual(
      ["evt-store", "evt-cat", "p-ok", "evt-cur", "evt-rate"].sort(),
    );
    expect(revalidateStores).toHaveBeenCalledOnce();
    expect(revalidateSlugs).toHaveBeenCalledOnce();
    expect(revalidateStorefronts).toHaveBeenCalledOnce();
    expect(revalidateProducts).toHaveBeenCalledOnce();
  });

  it("E14/R12: the four revalidate* calls receive exactly the same sets whether or not the dragged PRODUCT event is present in the batch", async () => {
    const withDragged = [
      depCategoryEvent("evt-cat", "cat-1"),
      depProductEvent("p-dragged", "cat-1"),
      depProductEvent("p-other", null),
    ];
    const withoutDragged = [depCategoryEvent("evt-cat", "cat-1"), depProductEvent("p-other", null)];

    handleCategory.mockRejectedValue(DEP_ERROR);
    handleProduct.mockResolvedValue({
      status: "processed",
      touchedStoreSlug: "tienda-x",
      touchedBrandSlug: "marca-x",
      touchedProductId: "prod-x",
    });

    recordBatch.mockResolvedValue({ fresh: withDragged, duplicateIds: [] });
    await processCatalogBatch(CALLER, withDragged);
    const withDraggedCalls = {
      stores: [...revalidateStores.mock.calls[0][0]].sort(),
      slugs: [...revalidateSlugs.mock.calls[0][0]].sort(),
      storefronts: [...revalidateStorefronts.mock.calls[0][0]].sort(),
      products: [...revalidateProducts.mock.calls[0][0]].sort(),
      storesCalls: revalidateStores.mock.calls.length,
      slugsCalls: revalidateSlugs.mock.calls.length,
      storefrontsCalls: revalidateStorefronts.mock.calls.length,
      productsCalls: revalidateProducts.mock.calls.length,
    };

    revalidateStores.mockClear();
    revalidateSlugs.mockClear();
    revalidateStorefronts.mockClear();
    revalidateProducts.mockClear();
    handleProduct.mockClear();
    handleProduct.mockResolvedValue({
      status: "processed",
      touchedStoreSlug: "tienda-x",
      touchedBrandSlug: "marca-x",
      touchedProductId: "prod-x",
    });

    recordBatch.mockResolvedValue({ fresh: withoutDragged, duplicateIds: [] });
    await processCatalogBatch(CALLER, withoutDragged);
    const withoutDraggedCalls = {
      stores: [...revalidateStores.mock.calls[0][0]].sort(),
      slugs: [...revalidateSlugs.mock.calls[0][0]].sort(),
      storefronts: [...revalidateStorefronts.mock.calls[0][0]].sort(),
      products: [...revalidateProducts.mock.calls[0][0]].sort(),
      storesCalls: revalidateStores.mock.calls.length,
      slugsCalls: revalidateSlugs.mock.calls.length,
      storefrontsCalls: revalidateStorefronts.mock.calls.length,
      productsCalls: revalidateProducts.mock.calls.length,
    };

    // handleProduct is called exactly once in EACH run — only for p-other,
    // never for p-dragged, which is exactly what makes the two runs' touched
    // sets identical: the dragged event never contributed anything.
    expect(withDraggedCalls).toEqual(withoutDraggedCalls);
  });
});

function businessEvent(eventId: string, businessId = "seed-negocio-1") {
  return {
    eventId,
    entity: "BUSINESS" as const,
    operation: "UPDATE" as const,
    occurredAt: "2026-09-06T00:00:00.000Z",
    payload: {
      businessId,
      displayCurrencies: ["CUP", "USD", "EUR"],
      updatedAt: "2026-09-06T00:00:00.000Z",
    },
  };
}

describe("processCatalogBatch() — routes BUSINESS to handleBusiness and to nobody else (paso 8)", () => {
  it("calls handleBusiness(payload, operation, caller.businessId) for a BUSINESS event, and no other handler", async () => {
    const events = [businessEvent("evt-biz")];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleBusiness.mockResolvedValue({ status: "processed" });

    const summary = await processCatalogBatch(CALLER, events);

    expect(handleBusiness).toHaveBeenCalledExactlyOnceWith(
      events[0].payload,
      "UPDATE",
      "business-1",
    );
    expect(handleStore).not.toHaveBeenCalled();
    expect(handleProduct).not.toHaveBeenCalled();
    expect(handleCategory).not.toHaveBeenCalled();
    expect(handleCurrency).not.toHaveBeenCalled();
    expect(handleExchangeRate).not.toHaveBeenCalled();
    expect(summary.ok).toContain("evt-biz");
  });

  // F-038 E14/R12 (unit half): BUSINESS neither drags nor is dragged — it
  // has no entry in dependencyRoleOf's table, so createBatchDependencies
  // never blocks it and it never blocks anything after it.
  it("a failed CATEGORY does not drag a later BUSINESS (E14)", async () => {
    const events = [depCategoryEvent("evt-cat", "cat-1"), businessEvent("evt-biz")];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleCategory.mockRejectedValue(DEP_ERROR);
    handleBusiness.mockResolvedValue({ status: "processed" });

    const summary = await processCatalogBatch(CALLER, events);

    expect(handleBusiness).toHaveBeenCalledExactlyOnceWith(
      events[1].payload,
      "UPDATE",
      "business-1",
    );
    expect(summary.ok).toContain("evt-biz");
    expect(summary.failed.map((f) => f.id)).toEqual(["evt-cat"]);
  });

  it("a failed BUSINESS does not drag a later PRODUCT/EXCHANGE_RATE (E14)", async () => {
    const events = [
      businessEvent("evt-biz"),
      depProductEvent("p-after", null),
      depExchangeRateEvent("er-after", "USD"),
    ];
    recordBatch.mockResolvedValue({ fresh: events, duplicateIds: [] });
    handleBusiness.mockRejectedValue(DEP_ERROR);
    handleProduct.mockResolvedValue({ status: "processed" });
    handleExchangeRate.mockResolvedValue({ status: "processed" });

    const summary = await processCatalogBatch(CALLER, events);

    expect(summary.failed.map((f) => f.id)).toEqual(["evt-biz"]);
    expect(summary.ok).toContain("p-after");
    expect(summary.ok).toContain("er-after");
  });
});
