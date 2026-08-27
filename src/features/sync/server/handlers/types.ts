import type { EventStatus } from "../../schemas";
import type { PublicSlug } from "@/lib/publicSlug";

/** What a handler reports back so the batch can build its response. */
export type HandlerOutcome = {
  status: Extract<EventStatus, "processed" | "skipped_not_published" | "stale">;
  /** CANONICAL slug of a branch whose cached pages must be invalidated
   *  (F-017, I5) — never the slug the payload happened to carry. */
  touchedStoreSlug?: PublicSlug;
  /** The branch's brand slug — fires the brand's own tag from stage 1 on,
   *  even though its only reader (the selector) arrives in etapa 2. */
  touchedBrandSlug?: string;
  /** StoreProduct id whose detail page must be invalidated. */
  touchedProductId?: string;
};

export const PROCESSED: HandlerOutcome = { status: "processed" };
export const SKIPPED: HandlerOutcome = { status: "skipped_not_published" };
export const STALE: HandlerOutcome = { status: "stale" };
