/**
 * The public slug canonical to a branch, and nothing else.
 *
 * `architecture.md` § El slug canónico. Two URLs can serve the same branch
 * (its brand's slug, and its own `Store.slug` once a brand groups more than
 * one branch): caching, ISR tags and `data-store` must agree on ONE of the
 * two, or the other goes stale forever — the worst kind of bug, because the
 * page keeps answering 200 with old data. `canonicalSlug()` is the single
 * function that decides which, and `PublicSlug` is the brand that makes
 * every other module compile-error if it tries to invent one without going
 * through here.
 */

declare const publicSlugBrand: unique symbol;
export type PublicSlug = string & { readonly [publicSlugBrand]: true };

export type CanonicalSlugInput = {
  /** `Store.slug` of the branch itself, or `null` when it never got one. */
  storeSlug: string | null;
  /** `Storefront.slug` of the brand that owns the branch. */
  brandSlug: string;
  /** How many of the brand's branches can render (`status !== "DRAFT"`). */
  brandBranchCount: number;
};

/**
 * `canonicalSlug(branch) = brandSlug` when the brand renders exactly one
 * branch; `storeSlug` once the brand groups several (etapa 2 — a brand with
 * one branch never has a `storeSlug` to fall back to in stage 1).
 */
export function canonicalSlug(input: CanonicalSlugInput): PublicSlug {
  if (input.brandBranchCount <= 1) return input.brandSlug as PublicSlug;
  if (!input.storeSlug) {
    throw new Error(
      "canonicalSlug(): a branch of a multi-branch brand must have its own Store.slug",
    );
  }
  return input.storeSlug as PublicSlug;
}

/** Only for callers that already resolved a value through the registry —
 *  never for a slug read straight off a URL param. */
export function asPublicSlug(value: string): PublicSlug {
  return value as PublicSlug;
}
