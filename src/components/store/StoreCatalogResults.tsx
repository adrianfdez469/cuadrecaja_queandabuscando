import Link from "next/link";
import { ProductCard } from "@/components/store/ProductCard";
import { CATALOG_EAGER_IMAGE_COUNT } from "@/constants/media";
import {
  catalogFilterHref,
  type CatalogFilterResult,
  type CatalogSort,
} from "@/features/catalog/catalogFilters";
import type { PublicSlug } from "@/lib/publicSlug";

/**
 * F-027 (design.md § Componentes de UI, C2 de plan.md): the results line,
 * the grid of `ProductCard` and the pagination footer for the filtered
 * catalogue. Only mounted with `result.items.length > 0` — the caller owns
 * the empty states (E16, "página fuera de rango").
 *
 * C2: the pagination footer is COPIED from `StoreSearchResults`, not
 * extracted into a shared `StorePager` — the orchestrator's resolution in
 * plan.md § Dos choques, kept as-is by the human's approval. Same `<nav
 * aria-label>`, same conteo-a-la-izquierda, same `SECONDARY_LINK_CLASSES`
 * technique, "Productos" instead of "Resultados".
 */
const SECONDARY_LINK_CLASSES =
  "bg-surface-muted text-fg border-border focus-visible:outline-brand inline-flex min-h-11 items-center justify-center rounded-md border px-4 font-medium hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2";

const GRID_CLASSES = "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4";

/** design.md § Textos, "la línea de resultados": one phrase per `sort`,
 *  same voice as the one example design.md spells out for `precio_asc`. */
const SORT_DESCRIPTION: Record<Exclude<CatalogSort, "relevancia">, string> = {
  precio_asc: "ordenados por precio, de menor a mayor",
  precio_desc: "ordenados por precio, de mayor a menor",
  nombre: "ordenados por nombre, de la A a la Z",
  reciente: "ordenados por los últimos añadidos al catálogo",
};

export function StoreCatalogResults({
  result,
  storeSlug,
  storeName,
  displayCurrency,
  rates,
  basePath,
}: {
  result: CatalogFilterResult;
  storeSlug: PublicSlug;
  storeName: string;
  displayCurrency: string;
  rates: Record<string, string>;
  basePath: string;
}) {
  const first = (result.page - 1) * result.pageSize + 1;
  const last = first + result.items.length - 1;
  const hrefFor = (page: number) => catalogFilterHref(basePath, result.applied, { page });

  const plural = result.totalCount === 1 ? "producto" : "productos";
  const resultsLine = result.applied.sort
    ? `${result.totalCount} ${plural}, ${SORT_DESCRIPTION[result.applied.sort]}.`
    : `${result.totalCount} ${plural} en ${storeName}.`;

  return (
    <>
      <p className="text-fg mt-4">{resultsLine}</p>

      <ul className={`mt-4 ${GRID_CLASSES}`}>
        {result.items.map((item, index) => (
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

      {(result.page > 1 || result.hasMore) && (
        <nav
          aria-label="Páginas del catálogo"
          className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-fg-muted text-sm">
            Productos {first} a {last} de {result.totalCount}.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {result.page > 1 && (
              <Link
                href={hrefFor(result.page - 1)}
                prefetch={false}
                className={SECONDARY_LINK_CLASSES}
              >
                Página anterior
              </Link>
            )}
            {result.hasMore && (
              <Link
                href={hrefFor(result.page + 1)}
                prefetch={false}
                className={SECONDARY_LINK_CLASSES}
              >
                Página siguiente
              </Link>
            )}
          </div>
        </nav>
      )}
    </>
  );
}
