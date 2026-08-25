import type { EventStatus } from "../../schemas";

/** What a handler reports back so the batch can build its response. */
export type HandlerOutcome = {
  status: Extract<EventStatus, "processed" | "skipped_not_published" | "stale">;
  /** Slug of a store whose cached pages must be invalidated. */
  touchedStoreSlug?: string;
  /** StoreProduct id whose detail page must be invalidated. */
  touchedProductId?: string;
};

export const PROCESSED: HandlerOutcome = { status: "processed" };
export const SKIPPED: HandlerOutcome = { status: "skipped_not_published" };
export const STALE: HandlerOutcome = { status: "stale" };
