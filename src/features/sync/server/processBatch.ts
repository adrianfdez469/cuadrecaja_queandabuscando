import {
  revalidateProducts,
  revalidateSlugs,
  revalidateStorefronts,
  revalidateStores,
} from "@/lib/cache";
import type { PublicSlug } from "@/lib/publicSlug";
import {
  summarize,
  type CatalogBatchResponse,
  type EventResult,
  type SyncEventInput,
} from "../schemas";
import { markFailed, markProcessed, markSkipped, recordBatch } from "./inbox";
import { handleProduct } from "./handlers/product";
import { handleStore } from "./handlers/store";
import { handleCategory, handleCurrency, handleExchangeRate } from "./handlers/misc";
import type { InternalCaller } from "./caller";

/**
 * Apply one catalog batch and report per-event outcomes.
 *
 * Cache invalidation happens once per affected store at the end, not per event:
 * a 500-event batch touching three stores should fire six revalidations, not a
 * thousand.
 *
 * F-018: `caller` is the identity the guard already resolved from the token,
 * not the payload. `recordBatch` keeps writing `SyncEvent.businessId` as the
 * POS's own externalId (R7, unchanged shape) — every handler below instead
 * receives `caller.businessId`, the internal id, and none of them resolves a
 * business from the payload anymore (C6).
 */
export async function processCatalogBatch(
  caller: InternalCaller,
  events: SyncEventInput[],
): Promise<CatalogBatchResponse> {
  const { fresh, duplicateIds } = await recordBatch(caller.externalId, events);

  const results: EventResult[] = duplicateIds.map((eventId) => ({
    eventId,
    status: "duplicate" as const,
  }));

  const touchedStores = new Set<PublicSlug>();
  const touchedBrands = new Set<string>();
  const touchedProducts = new Set<string>();
  // F-017 ALTA fix (tests.md § Fallos encontrados #3): raw slug VALUES a
  // handler reported beyond its own touched canonical — the brand's own
  // slug and every sibling's own slug, already expanded by
  // `expandBrandTouch` inside the handler. Merged into the SAME
  // `revalidateSlugs` call below, not a second one, so a 500-event batch
  // still fires one deduplicated invalidation per tag family.
  const touchedSlugValues = new Set<string>();
  const processed: string[] = [];
  const skipped: string[] = [];
  const failed: { eventId: string; error: string }[] = [];

  for (const event of fresh) {
    try {
      const outcome = await applyEvent(event, caller.businessId);

      if (outcome.touchedStoreSlug) touchedStores.add(outcome.touchedStoreSlug);
      if (outcome.touchedBrandSlug) touchedBrands.add(outcome.touchedBrandSlug);
      if (outcome.touchedProductId) touchedProducts.add(outcome.touchedProductId);
      if (outcome.touchedSlugValues) {
        for (const value of outcome.touchedSlugValues) touchedSlugValues.add(value);
      }

      if (outcome.status === "processed") processed.push(event.eventId);
      else skipped.push(event.eventId);

      results.push({ eventId: event.eventId, status: outcome.status });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ eventId: event.eventId, error: message });
      results.push({ eventId: event.eventId, status: "failed", error: message });
    }
  }

  await Promise.all([markProcessed(processed), markSkipped(skipped), markFailed(failed)]);

  revalidateStores(touchedStores);
  // R18/HS2: a brand new brand must be reachable without waiting for the
  // 3600s floor — invalidate the resolver's own tag for the same values.
  // `touchedSlugValues` (the brand's own slug + every sibling's own slug,
  // for any touched branch that belongs to a multi-branch brand) rides in
  // the SAME call: no store's own resolution and no sibling's leftover
  // resolution goes stale from a single sync batch.
  revalidateSlugs(new Set([...touchedStores, ...touchedSlugValues]));
  // Fired from stage 1 on even though its only reader (the selector)
  // arrives in etapa 2 — so the sync is touched once, not twice.
  revalidateStorefronts(touchedBrands);
  revalidateProducts(touchedProducts);

  return summarize(results);
}

function applyEvent(event: SyncEventInput, businessId: string) {
  switch (event.entity) {
    case "STORE":
      return handleStore(event.payload, event.operation, businessId);
    case "PRODUCT":
      return handleProduct(event.payload, event.operation, businessId);
    case "CATEGORY":
      return handleCategory(event.payload, event.operation, businessId);
    case "CURRENCY":
      return handleCurrency(event.payload);
    case "EXCHANGE_RATE":
      return handleExchangeRate(event.payload, businessId);
  }
}
