import Link from "next/link";
import { ProductCard } from "@/components/store/ProductCard";
import { CATALOG_EAGER_IMAGE_COUNT } from "@/constants/media";
import type { StoreSearchResult } from "@/features/catalog/server/search";
import type { PublicSlug } from "@/lib/publicSlug";

/** Same visual weight as `Button`'s `secondary` variant, on an `<a>` — a
 *  `<button>` cannot navigate, and `Button` has no anchor mode. Same
 *  technique `StoreClosedNotice`'s own WhatsApp link already uses. */
const SECONDARY_LINK_CLASSES =
  "bg-surface-muted text-fg border-border focus-visible:outline-brand inline-flex min-h-11 items-center justify-center rounded-md border px-4 font-medium hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2";

const GRID_CLASSES = "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4";

/**
 * F-021 (DP1, design.md § Inventario "Con resultados"): the two blocks —
 * what matched by text (layers 1 and 2, together, undistinguished) and,
 * below, "Otros productos de la misma categoría" (layer 3) — plus the
 * pagination footer. Server component: composes `ProductCard` exactly as
 * the catalogue does, never a new card.
 */
export function StoreSearchResults({
  result,
  storeSlug,
  displayCurrency,
  rates,
}: {
  result: StoreSearchResult;
  storeSlug: PublicSlug;
  displayCurrency: string;
  rates: Record<string, string>;
}) {
  const matched = result.items.filter((item) => item.layer !== 3);
  const related = result.items.filter((item) => item.layer === 3);

  const first = (result.page - 1) * result.pageSize + 1;
  const last = first + result.items.length - 1;
  const hrefFor = (page: number) => {
    const params = new URLSearchParams({ q: result.term });
    if (page > 1) params.set("p", String(page));
    return `/${storeSlug}/buscar?${params.toString()}`;
  };

  return (
    <>
      {matched.length > 0 && (
        <>
          <h2 className="sr-only">Coincidencias con tu búsqueda</h2>
          <ul className={`mt-8 ${GRID_CLASSES}`}>
            {matched.map((item, index) => (
              <li key={item.id}>
                <ProductCard
                  product={item}
                  storeSlug={storeSlug}
                  displayCurrency={displayCurrency}
                  rates={rates}
                  eager={index < CATALOG_EAGER_IMAGE_COUNT}
                  priority={index === 0}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {related.length > 0 && (
        <section
          aria-labelledby="store-search-related-heading"
          className="border-border mt-10 border-t pt-6"
        >
          <h2 id="store-search-related-heading" className="text-lg font-semibold sm:text-xl">
            Otros productos de la misma categoría
          </h2>
          <p className="text-fg-muted mt-1 text-sm">
            No coinciden con lo que escribiste, pero son del mismo tipo.
          </p>
          <ul className={`mt-4 ${GRID_CLASSES}`}>
            {related.map((item) => (
              <li key={item.id}>
                <ProductCard
                  product={item}
                  storeSlug={storeSlug}
                  displayCurrency={displayCurrency}
                  rates={rates}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {(result.page > 1 || result.hasMore) && (
        <nav
          aria-label="Páginas de resultados"
          className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-fg-muted text-sm">
            Resultados {first} a {last} de {result.totalCount}.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {result.page > 1 && (
              <Link href={hrefFor(result.page - 1)} className={SECONDARY_LINK_CLASSES}>
                Página anterior
              </Link>
            )}
            {result.hasMore && (
              <Link href={hrefFor(result.page + 1)} className={SECONDARY_LINK_CLASSES}>
                Página siguiente
              </Link>
            )}
          </div>
        </nav>
      )}
    </>
  );
}
