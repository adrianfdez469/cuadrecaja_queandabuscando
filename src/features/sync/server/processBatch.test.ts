import { beforeEach, describe, expect, it, vi } from "vitest";

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
const recordBatch = vi.fn();
const markProcessed = vi.fn();
const markSkipped = vi.fn();
const markFailed = vi.fn();
const revalidateStores = vi.fn();
const revalidateSlugs = vi.fn();
const revalidateStorefronts = vi.fn();
const revalidateProducts = vi.fn();

vi.mock("./handlers/store", () => ({ handleStore: (...a: unknown[]) => handleStore(...a) }));
vi.mock("./handlers/product", () => ({ handleProduct: (...a: unknown[]) => handleProduct(...a) }));
vi.mock("./handlers/misc", () => ({
  handleCategory: (...a: unknown[]) => handleCategory(...a),
  handleCurrency: (...a: unknown[]) => handleCurrency(...a),
  handleExchangeRate: (...a: unknown[]) => handleExchangeRate(...a),
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
  recordBatch.mockReset();
  markProcessed.mockReset().mockResolvedValue(undefined);
  markSkipped.mockReset().mockResolvedValue(undefined);
  markFailed.mockReset().mockResolvedValue(undefined);
  revalidateStores.mockReset();
  revalidateSlugs.mockReset();
  revalidateStorefronts.mockReset();
  revalidateProducts.mockReset();
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
