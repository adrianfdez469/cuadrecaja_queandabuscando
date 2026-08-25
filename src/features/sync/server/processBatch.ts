import { revalidateProducts, revalidateStores } from "@/lib/cache";
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

/**
 * Apply one catalog batch and report per-event outcomes.
 *
 * Cache invalidation happens once per affected store at the end, not per event:
 * a 500-event batch touching three stores should fire six revalidations, not a
 * thousand.
 */
export async function processCatalogBatch(
  businessId: string,
  events: SyncEventInput[],
): Promise<CatalogBatchResponse> {
  const { fresh, duplicateIds } = await recordBatch(businessId, events);

  const results: EventResult[] = duplicateIds.map((eventId) => ({
    eventId,
    status: "duplicate" as const,
  }));

  const touchedStores = new Set<string>();
  const touchedProducts = new Set<string>();
  const processed: string[] = [];
  const skipped: string[] = [];
  const failed: { eventId: string; error: string }[] = [];

  for (const event of fresh) {
    try {
      const outcome = await applyEvent(event);

      if (outcome.touchedStoreSlug) touchedStores.add(outcome.touchedStoreSlug);
      if (outcome.touchedProductId) touchedProducts.add(outcome.touchedProductId);

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
  revalidateProducts(touchedProducts);

  return summarize(results);
}

function applyEvent(event: SyncEventInput) {
  switch (event.entity) {
    case "STORE":
      return handleStore(event.payload, event.operation);
    case "PRODUCT":
      return handleProduct(event.payload, event.operation);
    case "CATEGORY":
      return handleCategory(event.payload, event.operation);
    case "CURRENCY":
      return handleCurrency(event.payload);
    case "EXCHANGE_RATE":
      return handleExchangeRate(event.payload);
  }
}
