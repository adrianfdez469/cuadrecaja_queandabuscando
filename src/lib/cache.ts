import { revalidateTag, unstable_cache } from "next/cache";
import type { PublicSlug } from "./publicSlug";

/**
 * Cache tags and helpers for the public storefront.
 *
 * Every Prisma read that feeds an ISR page goes through `cached()` so that a
 * sync batch can invalidate precisely what changed. Tags are built here rather
 * than spelled out at call sites, because a typo in a tag string produces a
 * page that silently never updates — the worst kind of bug to notice.
 *
 * F-017 (I5): `storeTag`/`storeCatalogTag` now take a `PublicSlug`, never a
 * bare `string`. A branch can be reached by two live URLs (its brand's slug
 * and, once a brand groups more than one, its own); tagging by "whatever the
 * URL asked for" would leave one of the two rancid forever. Passing the
 * requested URL slug straight through is a compile error — it has to be
 * resolved to its canonical slug first (`features/storefront/server/resolve.ts`).
 *
 * Note on Next 16: `"use cache"` and `cacheTag` are stable but require
 * `cacheComponents: true`, which switches the app to PPR semantics. That is a
 * larger commitment than this harness should make up front, so the classic
 * `unstable_cache` + `revalidateTag` + route-level `revalidate` model stays.
 */

/** Everything about one branch: its settings and catalogue reads, keyed by
 *  its CANONICAL slug (never the slug the URL happened to be requested by). */
export const storeTag = (slug: PublicSlug) => `store:${slug}`;
/** Just the catalogue listing of a branch, canonical slug. */
export const storeCatalogTag = (slug: PublicSlug) => `store:${slug}:catalog`;
/** One product detail page. */
export const productTag = (storeProductId: string) => `product:${storeProductId}`;
/**
 * A brand's own tag (F-017, HS7/etapa 2). Every writer that touches a branch
 * fires this from stage 1 on, even though its only reader — the selector —
 * arrives in etapa 2: that way the sync and the panel are touched once, not
 * twice, when the selector lands.
 */
export const storefrontTag = (brandSlug: string) => `storefront:${brandSlug}`;
/**
 * The `slug → resolution` lookup's own tag (R18). Invalidated whenever a
 * `Slug` row is created or changes owner — a fresh brand from the sync must
 * be reachable without waiting for the 3600s floor.
 */
export const slugTag = (value: string) => `slug:${value}`;

/**
 * Next 16's revalidateTag takes a cacheLife profile as its second argument.
 * A sync batch means the data behind the tag is already known to be wrong, so
 * there is no staleness worth tolerating.
 */
const EXPIRE_NOW = { expire: 0 } as const;

/** Default revalidation floor for storefront pages, in seconds. */
export const STOREFRONT_REVALIDATE = 3600;

type CachedOptions = {
  /** Stable, unique key parts. Arguments are appended automatically. */
  keyParts: string[];
  tags: string[];
  revalidate?: number | false;
};

/**
 * Wrap a data-loading function in the Next data cache.
 *
 * The returned function keeps the original signature, so call sites read the
 * same as an uncached one.
 */
export function cached<Args extends unknown[], Result>(
  loader: (...args: Args) => Promise<Result>,
  options: CachedOptions,
): (...args: Args) => Promise<Result> {
  return unstable_cache(loader, options.keyParts, {
    tags: options.tags,
    revalidate: options.revalidate ?? STOREFRONT_REVALIDATE,
  });
}

/**
 * Invalidate every affected branch after a sync batch, panel write, or
 * registry change. Takes CANONICAL slugs only (F-017, I5).
 *
 * Deliberately takes the whole set and de-duplicates: calling this once per
 * event would fire hundreds of redundant revalidations for a single batch.
 */
export function revalidateStores(slugs: Iterable<PublicSlug>): string[] {
  const unique = [...new Set(slugs)].filter(Boolean);
  for (const slug of unique) {
    revalidateTag(storeTag(slug), EXPIRE_NOW);
    revalidateTag(storeCatalogTag(slug), EXPIRE_NOW);
  }
  return unique;
}

export function revalidateProducts(storeProductIds: Iterable<string>): string[] {
  const unique = [...new Set(storeProductIds)].filter(Boolean);
  for (const id of unique) {
    revalidateTag(productTag(id), EXPIRE_NOW);
  }
  return unique;
}

/**
 * Invalidate a brand's own tag. R19: a branding write invalidates ALL of a
 * brand's branches — the caller resolves that set with one query and passes
 * only brand slugs here.
 */
export function revalidateStorefronts(brandSlugs: Iterable<string>): string[] {
  const unique = [...new Set(brandSlugs)].filter(Boolean);
  for (const slug of unique) {
    revalidateTag(storefrontTag(slug), EXPIRE_NOW);
  }
  return unique;
}

/** R18: invalidate the `slug → resolution` cache for one or more registry
 *  values (any kind — brand, branch, or a value that just got retired). */
export function revalidateSlugs(values: Iterable<string>): string[] {
  const unique = [...new Set(values)].filter(Boolean);
  for (const value of unique) {
    revalidateTag(slugTag(value), EXPIRE_NOW);
  }
  return unique;
}
