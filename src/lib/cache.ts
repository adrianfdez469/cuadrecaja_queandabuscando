import { revalidateTag, unstable_cache } from "next/cache";

/**
 * Cache tags and helpers for the public storefront.
 *
 * Every Prisma read that feeds an ISR page goes through `cached()` so that a
 * sync batch can invalidate precisely what changed. Tags are built here rather
 * than spelled out at call sites, because a typo in a tag string produces a
 * page that silently never updates — the worst kind of bug to notice.
 *
 * Note on Next 16: `"use cache"` and `cacheTag` are stable but require
 * `cacheComponents: true`, which switches the app to PPR semantics. That is a
 * larger commitment than this harness should make up front, so the classic
 * `unstable_cache` + `revalidateTag` + route-level `revalidate` model stays.
 */

/** Everything about one store: its branding, settings and catalogue. */
export const storeTag = (slug: string) => `store:${slug}`;
/** Just the catalogue listing of a store. */
export const storeCatalogTag = (slug: string) => `store:${slug}:catalog`;
/** One product detail page. */
export const productTag = (storeProductId: string) => `product:${storeProductId}`;

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
 * Invalidate every affected store after a sync batch.
 *
 * Deliberately takes the whole set and de-duplicates: calling this once per
 * event would fire hundreds of redundant revalidations for a single batch.
 */
export function revalidateStores(slugs: Iterable<string>): string[] {
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
