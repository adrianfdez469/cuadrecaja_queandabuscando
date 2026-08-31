import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { StoreCatalogSort } from "@/components/store/StoreCatalogSort";
import {
  CATALOG_AVAILABILITY_HAY,
  CATALOG_CATEGORY_VISIBLE_ROWS,
  CATALOG_FLAG_ON,
  CATALOG_PARAM_AVAILABILITY,
  CATALOG_PARAM_CATEGORY,
  CATALOG_PARAM_FEATURED,
  CATALOG_PARAM_PRICE_MAX,
  CATALOG_PARAM_PRICE_MIN,
  CATALOG_PARAM_PROMOTION,
} from "@/constants/catalog";
import type { CatalogFilterResult, CatalogFilterContext } from "@/features/catalog/catalogFilters";
import { formatWholeMoney, money } from "@/lib/money";

/** Same visual weight as `Button`'s `secondary` variant, on an `<a>` — the
 *  same technique `StoreClosedNotice`, `StoreSearchResults` and
 *  `/[slug]/buscar` already use. */
const SECONDARY_LINK_CLASSES =
  "bg-surface-muted text-fg border-border focus-visible:outline-brand inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2";

const NUMBER_INPUT_CLASSES =
  "border-border bg-surface text-fg min-h-11 w-full rounded-md border px-3 focus-visible:outline-brand focus-visible:outline-2 focus-visible:outline-offset-2";

const CHECKBOX_ROW_CLASSES = "flex min-h-11 items-center gap-3 text-sm";

/**
 * F-027 (design.md § Decisión 1): the `<details>`/`<form method="get">`
 * pair that IS the filter panel. Server component, zero directive — the
 * `<summary>` opens with `Enter` natively, and a checked box inside a
 * CLOSED `<details>` still submits (measured in design.md, hence "a group
 * with something applied arrives open").
 */
export function StoreFilterPanel({
  result,
  context,
  open,
  removeAllHref,
  catalogHref,
}: {
  result: CatalogFilterResult;
  context: CatalogFilterContext;
  /** design.md § Decisión 1: open with nothing applied, or with zero
   *  results — plegado once something is applied and there ARE results. */
  open: boolean;
  removeAllHref: string;
  /** "Ver todo el catálogo" — always `/[slug]`. */
  catalogHref: string;
}) {
  const { applied, facets } = result;

  const appliedCount =
    applied.categorySlugs.length +
    (applied.inStockOnly ? 1 : 0) +
    (applied.promotedOnly ? 1 : 0) +
    (applied.featuredOnly ? 1 : 0) +
    (applied.priceMin !== null ? 1 : 0) +
    (applied.priceMax !== null ? 1 : 0);
  const hasAnyFilter = appliedCount > 0;
  const onlyOrderApplied = !hasAnyFilter && applied.sort !== null;

  const showPriceFields =
    (facets.price !== null &&
      facets.price.pricedCount >= 2 &&
      facets.price.min !== facets.price.max) ||
    applied.priceMin !== null ||
    applied.priceMax !== null;

  const worthCategories = facets.categories.filter(
    (c) => c.count > 0 || applied.categorySlugs.includes(c.value),
  );
  const showCategories = worthCategories.length >= 2 || applied.categorySlugs.length > 0;
  const visibleCategories = worthCategories.slice(0, CATALOG_CATEGORY_VISIBLE_ROWS);
  const restCategories = worthCategories.slice(CATALOG_CATEGORY_VISIBLE_ROWS);
  const restHasChecked = restCategories.some((c) => applied.categorySlugs.includes(c.value));

  const showInStock = facets.inStock > 0 || applied.inStockOnly;
  const showPromoted = facets.promoted > 0 || applied.promotedOnly;
  const showFeatured = facets.featured > 0 || applied.featuredOnly;
  const showOtherFilters = showInStock || showPromoted || showFeatured;

  return (
    <details open={open} className="border-border bg-surface mt-4 rounded-md border">
      <summary className="focus-visible:outline-brand flex min-h-11 cursor-pointer items-center justify-between px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2">
        {appliedCount > 0 ? `Filtros y orden (${appliedCount})` : "Filtros y orden"}
      </summary>

      <form method="get" action={context.basePath} className="p-3">
        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <fieldset>
            <legend className="text-fg text-sm font-medium">Ordenar por</legend>
            <div className="mt-2">
              <StoreCatalogSort
                state={applied}
                basePath={context.basePath}
                variant="catalogo"
                standalone={false}
              />
            </div>
          </fieldset>

          {showPriceFields && facets.price && (
            <fieldset className="sm:col-span-2 lg:col-span-2">
              <legend className="text-fg text-sm font-medium">Precio</legend>
              <p className="text-fg-muted mt-1 text-xs">
                En esta tienda los precios van de{" "}
                {formatWholeMoney(money(String(facets.price.min), context.displayCurrency))} a{" "}
                {formatWholeMoney(money(String(facets.price.max), context.displayCurrency))}.
              </p>
              <div className="mt-2 flex gap-2">
                <div className="flex-1">
                  <label htmlFor={CATALOG_PARAM_PRICE_MIN} className="text-sm">
                    Desde
                  </label>
                  <input
                    id={CATALOG_PARAM_PRICE_MIN}
                    name={CATALOG_PARAM_PRICE_MIN}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    defaultValue={applied.priceMin ?? undefined}
                    className={`mt-1 ${NUMBER_INPUT_CLASSES}`}
                  />
                </div>
                <div className="flex-1">
                  <label htmlFor={CATALOG_PARAM_PRICE_MAX} className="text-sm">
                    Hasta
                  </label>
                  <input
                    id={CATALOG_PARAM_PRICE_MAX}
                    name={CATALOG_PARAM_PRICE_MAX}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    defaultValue={applied.priceMax ?? undefined}
                    className={`mt-1 ${NUMBER_INPUT_CLASSES}`}
                  />
                </div>
              </div>
              <p className="text-fg-muted mt-1 text-xs">
                En {context.displayCurrency}. Números enteros; déjalo en blanco para no poner
                límite.
              </p>
              {facets.price.brackets && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {facets.price.brackets.map((bracket) => (
                    <Link
                      key={bracket.label}
                      href={bracket.href}
                      prefetch={false}
                      className={SECONDARY_LINK_CLASSES}
                    >
                      {bracket.label} ({bracket.count})
                    </Link>
                  ))}
                </div>
              )}
            </fieldset>
          )}

          {showCategories && (
            <fieldset>
              <legend className="text-fg text-sm font-medium">Categoría</legend>
              <div className="mt-2">
                {visibleCategories.map((category) => (
                  <CategoryRow
                    key={category.value}
                    category={category}
                    checked={applied.categorySlugs.includes(category.value)}
                  />
                ))}
              </div>
              {restCategories.length > 0 && (
                <details open={restHasChecked} className="mt-2">
                  <summary className="focus-visible:outline-brand min-h-11 cursor-pointer text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2">
                    Ver {restCategories.length} categorías más
                  </summary>
                  <div className="mt-1">
                    {restCategories.map((category) => (
                      <CategoryRow
                        key={category.value}
                        category={category}
                        checked={applied.categorySlugs.includes(category.value)}
                      />
                    ))}
                  </div>
                </details>
              )}
            </fieldset>
          )}

          {showOtherFilters && (
            <fieldset>
              <legend className="text-fg text-sm font-medium">Otros filtros</legend>
              <div className="mt-2">
                {showInStock && (
                  <BooleanRow
                    name={CATALOG_PARAM_AVAILABILITY}
                    value={CATALOG_AVAILABILITY_HAY}
                    checked={applied.inStockOnly}
                    label="Solo lo que hay ahora"
                    count={facets.inStock}
                  />
                )}
                {showPromoted && (
                  <BooleanRow
                    name={CATALOG_PARAM_PROMOTION}
                    value={CATALOG_FLAG_ON}
                    checked={applied.promotedOnly}
                    label="Solo con descuento"
                    count={facets.promoted}
                  />
                )}
                {showFeatured && (
                  <BooleanRow
                    name={CATALOG_PARAM_FEATURED}
                    value={CATALOG_FLAG_ON}
                    checked={applied.featuredOnly}
                    label="Solo destacados"
                    count={facets.featured}
                  />
                )}
              </div>
            </fieldset>
          )}
        </div>

        <div className="border-border bg-surface sticky bottom-0 col-span-full mt-4 flex flex-col gap-2 border-t p-3 sm:flex-row lg:static lg:border-0">
          <Button type="submit">Aplicar</Button>
          {hasAnyFilter && (
            <Link href={removeAllHref} prefetch={false} className={SECONDARY_LINK_CLASSES}>
              Quitar todos los filtros
            </Link>
          )}
          {onlyOrderApplied && (
            <Link href={removeAllHref} prefetch={false} className={SECONDARY_LINK_CLASSES}>
              Volver al orden de la tienda
            </Link>
          )}
          <Link href={catalogHref} prefetch={false} className={SECONDARY_LINK_CLASSES}>
            Ver todo el catálogo
          </Link>
        </div>
      </form>
    </details>
  );
}

function CategoryRow({
  category,
  checked,
}: {
  category: { value: string; label: string; count: number };
  checked: boolean;
}) {
  return (
    <label className={CHECKBOX_ROW_CLASSES}>
      <input
        type="checkbox"
        name={CATALOG_PARAM_CATEGORY}
        value={category.value}
        defaultChecked={checked}
      />
      <span>{category.label}</span>
      <span aria-hidden="true">({category.count})</span>
      <span className="sr-only">
        {category.count} {category.count === 1 ? "producto" : "productos"}
      </span>
    </label>
  );
}

function BooleanRow({
  name,
  value,
  checked,
  label,
  count,
}: {
  name: string;
  value: string;
  checked: boolean;
  label: string;
  count: number;
}) {
  return (
    <label className={CHECKBOX_ROW_CLASSES}>
      <input type="checkbox" name={name} value={value} defaultChecked={checked} />
      <span>{label}</span>
      <span aria-hidden="true">({count})</span>
      <span className="sr-only">
        {count} {count === 1 ? "producto" : "productos"}
      </span>
    </label>
  );
}
