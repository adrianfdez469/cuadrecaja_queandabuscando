import type { EventStatus } from "../../schemas";
import type { PublicSlug } from "@/lib/publicSlug";
import type { SlugTouchSet } from "@/features/storefront/server/registry";

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
  /**
   * F-026 (R7, E13, E14): CANONICAL slugs of every branch whose catalog cache
   * must be invalidated because a `CATEGORY` event changed a category that
   * has (or, on a `DELETE`, had) at least one visible product in that
   * branch. Plural — unlike `touchedStoreSlug` above, a category belongs to
   * the BUSINESS and its products can live in N branches (I10). Only
   * `handleCategory` sets this today; `processBatch.ts` folds it into the
   * SAME `Set` that already feeds `revalidateStores`, so this never adds a
   * new invalidation call.
   */
  touchedStoreSlugs?: readonly PublicSlug[];
  /**
   * F-017 ALTA fix (tests.md § Fallos encontrados #3): additional raw slug
   * VALUES — the brand's own slug and every sibling's own slug — whose
   * cached RESOLUTION (`slugTag`) may have just changed meaning even though
   * this handler wrote no row of THEIRS. Only present when the touched
   * branch belongs to a brand with more than one renderable store. Always
   * computed by `features/storefront/server/registry.ts::expandBrandTouch`
   * — typed as `SlugTouchSet`, its own exported brand, so a hand-rolled
   * replacement fails to COMPILE here, in any syntactic shape, rather than
   * depending on `boundaries.test.ts`'s (partial) grep to notice.
   */
  touchedSlugValues?: SlugTouchSet;
  /**
   * F-023 R9/R10/R14: the bucket prefix of every object of this product,
   * present ONLY on a terminal `DELETE` (never on `publishToStore: false`,
   * which is reversible and keeps its photos). The handler never calls
   * Storage itself — `processBatch.ts` drains this, deduplicated, AFTER
   * `revalidateStores`/`revalidateSlugs`/`revalidateStorefronts`, which is
   * what R14 ("borrar después de escribir y revalidar") and R13 (a Storage
   * failure can never flip an already-reported `processed` into `failed`)
   * both require.
   */
  purgeObjectPrefix?: string;
};

export const PROCESSED: HandlerOutcome = { status: "processed" };
export const SKIPPED: HandlerOutcome = { status: "skipped_not_published" };
export const STALE: HandlerOutcome = { status: "stale" };
