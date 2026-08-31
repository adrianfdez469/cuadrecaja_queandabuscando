import { CATEGORY_ROUTE_SEGMENT } from "@/constants/catalog";
import type { PublicSlug } from "@/lib/publicSlug";
import type { CatalogProduct } from "./server/queries";

/**
 * F-026: pure derivations over `CatalogProduct[]` — the list
 * `getStoreCatalog()` already returns. No Prisma, no React: this is what
 * `docs/adr/0025-recortes-del-catalogo-como-proyeccion.md` calls "a
 * projection, not a query", and it is what makes that true. Both the
 * selector (RD1) and the category view (RD3) are built on these two
 * functions, so the two screens can never disagree about what belongs to a
 * category — there is only one predicate.
 */

export type StoreCategory = {
  slug: string;
  name: string;
  /** RD2: derived for completeness, but the chips never print it. */
  productCount: number;
};

/**
 * Spanish collation, created once at module scope — deterministic between
 * the build and any later request, and "Ñ"/accents fall where a
 * Spanish-speaking shopper looks for them (RD1). `base` ignores case, not
 * accents: two category names that differ only by accent are still
 * distinct entries (they can only collide if they also share a slug, and
 * the slug — not the name — is the grouping key below).
 */
const CATEGORY_NAME_COLLATOR = new Intl.Collator("es", { sensitivity: "base" });

/**
 * Groups `products` by `categorySlug`, skipping the ones with none (E6, R6:
 * no invented "Sin categoría" bucket). Grouped by SLUG, never by name
 * (criterio 11): two categories whose names slugify to the same value keep
 * two separate entries here, because their slugs differ by construction
 * (the unique index in `LocalCategory`).
 *
 * `productCount` is free from the grouping and not shown anywhere today
 * (RD2) — kept on the type because `getStoreCategoryView` reuses this same
 * derivation for the category view's own count line (design.md § Textos).
 */
export function deriveStoreCategories(products: readonly CatalogProduct[]): StoreCategory[] {
  const bySlug = new Map<string, StoreCategory>();

  for (const product of products) {
    if (product.categorySlug === null) continue;
    const existing = bySlug.get(product.categorySlug);
    if (existing) {
      existing.productCount += 1;
      continue;
    }
    bySlug.set(product.categorySlug, {
      slug: product.categorySlug,
      name: product.categoryName ?? "",
      productCount: 1,
    });
  }

  return [...bySlug.values()].sort((a, b) => CATEGORY_NAME_COLLATOR.compare(a.name, b.name));
}

/**
 * Every visible product of one category, in the SAME order `getStoreCatalog`
 * returned them (`featured` desc, then name) — the filter is a no-op on
 * order, so the category view reuses `/[slug]`'s ordering by construction
 * (RD3).
 */
export function productsOfCategory(
  products: readonly CatalogProduct[],
  categorySlug: string,
): CatalogProduct[] {
  return products.filter((product) => product.categorySlug === categorySlug);
}

/** The href for a category's own view, always built from the CANONICAL
 *  slug (RD7) — never the slug the URL happened to be requested by. */
export function storeCategoryPath(storeSlug: PublicSlug, categorySlug: string): string {
  return `/${storeSlug}/${CATEGORY_ROUTE_SEGMENT}/${categorySlug}`;
}
