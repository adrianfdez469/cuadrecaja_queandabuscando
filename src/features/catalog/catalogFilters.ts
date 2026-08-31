import { z } from "zod";
import {
  CATALOG_AVAILABILITY_HAY,
  CATALOG_FILTER_VALUES_MAX,
  CATALOG_FLAG_ON,
  CATALOG_PARAM_AVAILABILITY,
  CATALOG_PARAM_CATEGORY,
  CATALOG_PARAM_FEATURED,
  CATALOG_PARAM_PAGE,
  CATALOG_PARAM_PRICE_MAX,
  CATALOG_PARAM_PRICE_MIN,
  CATALOG_PARAM_PROMOTION,
  CATALOG_PARAM_SORT,
  CATALOG_PARAM_TERM,
  CATALOG_PRICE_BRACKETS_MIN_PRODUCTS,
  CATALOG_PRICE_MAX_ABSOLUTE,
  CATALOG_SORT_RELEVANCIA,
  CATALOG_SORT_VALUES,
} from "@/constants/catalog";
import { STORE_SEARCH_PAGE_SIZE } from "@/constants/storeSearch";
import { clampSearchPage, normalizeSearchTerm } from "@/lib/searchTerm";
import { compare, formatWholeMoney, money, type Money, type RateTable } from "@/lib/money";
import { resolvePrice } from "@/lib/pricing";
import type { StoreCategory } from "@/features/catalog/storeCategories";
import type { CatalogProduct } from "@/features/catalog/server/queries";

/**
 * F-027: THE module that interprets, canonizes, applies and describes the
 * catalogue's querystring vocabulary — the one `/[slug]/catalogo` and the
 * filtered path of `/[slug]/buscar` both call (R17). Pure: no Prisma, no
 * React, never imported from a `"use client"` file (architecture.md § Dónde
 * vive el módulo). Lives next to `storeCategories.ts`, the F-026 precedent
 * of a pure derivation over `CatalogProduct[]`.
 */

export type CatalogSort = "precio_asc" | "precio_desc" | "nombre" | "reciente" | "relevancia";

/** Lo que la URL dice, ya canonizado. Nunca lo que se aplicó de verdad: eso
 *  es `CatalogFilterResult.applied` (R18). */
export type CatalogFilterState = {
  term: string | null;
  categorySlugs: readonly string[];
  inStockOnly: boolean;
  promotedOnly: boolean;
  featuredOnly: boolean;
  priceMin: number | null;
  priceMax: number | null;
  /** `null` = el orden por defecto de la superficie. `"relevancia"` se
   *  normaliza a `null` al parsear. */
  sort: Exclude<CatalogSort, "relevancia"> | null;
  page: number;
};

export type CatalogFacetCount = { value: string; label: string; count: number };

export type CatalogPriceBracket = {
  /** Ya listos para la URL: enteros inclusivos, `null` = sin límite por ese
   *  lado. Los tres tramos son disjuntos por construcción. */
  min: number | null;
  max: number | null;
  /** Exactamente lo que se ve al pulsar el atajo, nunca la página actual. */
  count: number;
  /** «Hasta $350» · «De $350 a $540» · «Más de $540». */
  label: string;
  href: string;
};

/** RD3: el rango de precios del conjunto y, cuando se puede, los tres
 *  atajos. `null` significa que no queda ni un producto con precio
 *  resoluble: la faceta de precio no se dibuja. */
export type CatalogPriceFacet = {
  min: number;
  max: number;
  pricedCount: number;
  brackets: readonly [CatalogPriceBracket, CatalogPriceBracket, CatalogPriceBracket] | null;
};

export type CatalogFilterResult = {
  /** R18: lo aplicado de verdad, ya sin los valores que esta tienda no
   *  conoce. Los chips y todos los hrefs se construyen SOBRE ESTO. */
  applied: CatalogFilterState;
  items: readonly CatalogProduct[];
  /** Después de filtrar y antes de paginar. Sobrevive a una página vacía
   *  (.agent/playbook/conteo-total-paginado-se-pierde-en-pagina-vacia.md). */
  totalCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  facets: {
    categories: readonly CatalogFacetCount[];
    inStock: number;
    promoted: number;
    featured: number;
    price: CatalogPriceFacet | null;
  };
};

export type CatalogFilterContext = {
  displayCurrency: string;
  rates: RateTable;
  /** De `deriveStoreCategories`: lo que decide qué `categorySlug` existe en
   *  esta tienda y con qué nombre se pinta el chip (E3, I-A1). */
  categories: readonly StoreCategory[];
  /** La ruta sobre la que se construyen TODOS los enlaces de este resultado
   *  (R11): `/tienda-demo/catalogo` o `/tienda-demo/buscar`. */
  basePath: string;
};

// ---------------------------------------------------------------------------
// Parsing (§ El esquema Zod, en su forma)
// ---------------------------------------------------------------------------

/** The gemelo of the search page's own `firstParam`: a repeated single-value
 *  parameter keeps its FIRST appearance (R10). */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function asArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

const oneOf = <T extends string>(values: readonly T[]) =>
  z.preprocess(
    first,
    z
      .enum(values as [T, ...T[]])
      .nullable()
      .catch(null),
  );

/** `Number("")` is `0`, not `NaN` — an empty string (what a plain
 *  `<form method="get">` writes for an untouched numeric field, design.md §
 *  Decisión 7) has to fall to `undefined` BEFORE `z.coerce.number()` sees
 *  it, or it would parse as a real, applied "0". */
function firstNonEmpty(value: string | string[] | undefined): string | undefined {
  const value0 = first(value);
  return value0 === "" ? undefined : value0;
}

const nonNegativeInt = z.preprocess(
  firstNonEmpty,
  z.coerce.number().int().min(0).max(CATALOG_PRICE_MAX_ABSOLUTE).nullable().catch(null),
);

const availabilitySchema = oneOf([CATALOG_AVAILABILITY_HAY] as const);
const onFlagSchema = oneOf([CATALOG_FLAG_ON] as const);
const sortSchema = oneOf(CATALOG_SORT_VALUES);

/** Deduplicated, ascending, capped at `CATALOG_FILTER_VALUES_MAX` — in that
 *  order (architecture.md § El vocabulario de la URL: "aplicado DESPUÉS de
 *  deduplicar y ordenar, y ANTES de tocar los datos"). */
function dedupeSortedCategorySlugs(values: readonly string[]): string[] {
  const unique = [...new Set(values.filter((v) => v.length > 0))];
  unique.sort();
  return unique.slice(0, CATALOG_FILTER_VALUES_MAX);
}

/**
 * Parses the raw `searchParams` record into a `CatalogFilterState`. Every
 * field has its own `.catch()` (or an equivalent that cannot throw): a
 * malformed, unknown or out-of-range value falls back to "not set" instead
 * of rejecting the request (R10) — this function structurally cannot throw.
 */
export function parseCatalogFilters(
  raw: Record<string, string | string[] | undefined>,
): CatalogFilterState {
  const term = normalizeSearchTerm(first(raw[CATALOG_PARAM_TERM]) ?? "");
  const categorySlugs = dedupeSortedCategorySlugs(asArray(raw[CATALOG_PARAM_CATEGORY]));

  const inStockOnly =
    availabilitySchema.parse(raw[CATALOG_PARAM_AVAILABILITY]) === CATALOG_AVAILABILITY_HAY;
  const promotedOnly = onFlagSchema.parse(raw[CATALOG_PARAM_PROMOTION]) === CATALOG_FLAG_ON;
  const featuredOnly = onFlagSchema.parse(raw[CATALOG_PARAM_FEATURED]) === CATALOG_FLAG_ON;

  let priceMin = nonNegativeInt.parse(raw[CATALOG_PARAM_PRICE_MIN]);
  let priceMax = nonNegativeInt.parse(raw[CATALOG_PARAM_PRICE_MAX]);
  // "precio_min > precio_max" is a business rule, resolved HERE (after the
  // schema), not a validation of shape (architecture.md § El esquema Zod).
  if (priceMin !== null && priceMax !== null && priceMin > priceMax) {
    priceMin = null;
    priceMax = null;
  }

  const rawSort = sortSchema.parse(raw[CATALOG_PARAM_SORT]);
  const sort = rawSort === null || rawSort === CATALOG_SORT_RELEVANCIA ? null : rawSort;

  const page = clampSearchPage(Number(first(raw[CATALOG_PARAM_PAGE])) || undefined);

  return {
    term,
    categorySlugs,
    inStockOnly,
    promotedOnly,
    featuredOnly,
    priceMin,
    priceMax,
    sort,
    page,
  };
}

// ---------------------------------------------------------------------------
// URL construction (R11)
// ---------------------------------------------------------------------------

/**
 * La URL canónica de un estado, con un parche encima. Cambiar cualquier
 * cosa que no sea `page` reinicia a la página 1 (R9, E13): un `patch` sin
 * la clave `page` siempre produce página 1; un `patch` que SÍ trae `page`
 * (los enlaces de paginación) respeta ese valor. Único constructor de estas
 * direcciones — chips, tramos y paginación pasan por aquí (R11).
 */
export function catalogFilterHref(
  basePath: string,
  state: CatalogFilterState,
  patch: Partial<CatalogFilterState> = {},
): string {
  const changesPage = Object.prototype.hasOwnProperty.call(patch, "page");
  const merged: CatalogFilterState = {
    ...state,
    ...patch,
    page: changesPage ? (patch.page ?? 1) : 1,
  };

  const params = new URLSearchParams();
  if (merged.term) params.set(CATALOG_PARAM_TERM, merged.term);
  for (const slug of dedupeSortedCategorySlugs(merged.categorySlugs)) {
    params.append(CATALOG_PARAM_CATEGORY, slug);
  }
  if (merged.inStockOnly) params.set(CATALOG_PARAM_AVAILABILITY, CATALOG_AVAILABILITY_HAY);
  if (merged.promotedOnly) params.set(CATALOG_PARAM_PROMOTION, CATALOG_FLAG_ON);
  if (merged.featuredOnly) params.set(CATALOG_PARAM_FEATURED, CATALOG_FLAG_ON);
  if (merged.priceMin !== null) params.set(CATALOG_PARAM_PRICE_MIN, String(merged.priceMin));
  if (merged.priceMax !== null) params.set(CATALOG_PARAM_PRICE_MAX, String(merged.priceMax));
  if (merged.sort) params.set(CATALOG_PARAM_SORT, merged.sort);
  if (merged.page > 1) params.set(CATALOG_PARAM_PAGE, String(merged.page));

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

// ---------------------------------------------------------------------------
// Applying (§ El recorrido, en una pasada)
// ---------------------------------------------------------------------------

type KeptItem = { product: CatalogProduct; price: Money | null };

/**
 * Same treatment as `ProductCard`'s own `safeResolve` (which this comment
 * cites, and which cites this one back): a product priced in a currency
 * with no vigent rate must not take the filtered catalogue down either.
 */
function resolveProductPrice(product: CatalogProduct, context: CatalogFilterContext): Money | null {
  try {
    return resolvePrice(product, {
      targetCurrency: context.displayCurrency,
      rates: context.rates,
      baseCurrency: context.displayCurrency,
      promotions: product.promotions,
    }).price;
  } catch {
    return null;
  }
}

function passesPriceRange(price: Money | null, min: number | null, max: number | null): boolean {
  if (min === null && max === null) return true;
  // R5/E7: a product with no resolvable price cannot be shown to be inside
  // ANY range — it is left out, never included by default.
  if (price === null) return false;
  const value = Number(price.amount);
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

const NAME_COLLATOR = new Intl.Collator("es", { sensitivity: "base" });

function compareNameId(a: KeptItem, b: KeptItem): number {
  const byName = NAME_COLLATOR.compare(a.product.name, b.product.name);
  if (byName !== 0) return byName;
  return a.product.id < b.product.id ? -1 : a.product.id > b.product.id ? 1 : 0;
}

/** `direction` 1 = ascending, -1 = descending. A product with no resolvable
 *  price sorts LAST in both directions (R5, criterio 6: "último en las dos
 *  direcciones" is literal). */
function comparePrice(a: KeptItem, b: KeptItem, direction: 1 | -1): number {
  if (a.price === null && b.price === null) return 0;
  if (a.price === null) return 1;
  if (b.price === null) return -1;
  return compare(a.price, b.price) * direction;
}

function compareByFn(
  sort: Exclude<CatalogSort, "relevancia">,
): (a: KeptItem, b: KeptItem) => number {
  return (a, b) => {
    switch (sort) {
      case "precio_asc":
        return comparePrice(a, b, 1) || compareNameId(a, b);
      case "precio_desc":
        return comparePrice(a, b, -1) || compareNameId(a, b);
      case "nombre":
        return compareNameId(a, b);
      case "reciente": {
        if (a.product.createdAt !== b.product.createdAt) {
          return a.product.createdAt > b.product.createdAt ? -1 : 1;
        }
        return compareNameId(a, b);
      }
    }
  };
}

/** Standard "round to N significant digits", used only by RD3's price cuts
 *  (never on money that gets charged — § Nota de unidades). */
function roundToSignificantDigits(value: number, digits: number): number {
  if (value === 0) return 0;
  const magnitude = Math.ceil(Math.log10(Math.abs(value)));
  const factor = Math.pow(10, digits - magnitude);
  return Math.round(value * factor) / factor;
}

/** RD3's cut points: two significant figures, AND an integer (architecture.md
 *  § El rango y los tres atajos de precio, step 2). */
function roundPriceCut(value: number): number {
  return Math.round(roundToSignificantDigits(value, 2));
}

function priceBracket(
  min: number | null,
  max: number | null,
  count: number,
  label: string,
  applied: CatalogFilterState,
  context: CatalogFilterContext,
): CatalogPriceBracket {
  return {
    min,
    max,
    count,
    label,
    href: catalogFilterHref(context.basePath, applied, { priceMin: min, priceMax: max }),
  };
}

/**
 * RD3: computed over `prices` — the resolved prices (already `Number()`-ed,
 * a statistic, never money that gets charged) of every product that passes
 * every OTHER facet, the same set the other four facet counts are built
 * from. `null` when nothing has a resolvable price at all.
 */
function buildPriceFacet(
  prices: readonly number[],
  applied: CatalogFilterState,
  context: CatalogFilterContext,
): CatalogPriceFacet | null {
  if (prices.length === 0) return null;

  const sortedPrices = [...prices].sort((a, b) => a - b);
  const n = sortedPrices.length;
  const min = Math.floor(sortedPrices[0] as number);
  const max = Math.ceil(sortedPrices[n - 1] as number);
  const pricedCount = n;

  const c1 = roundPriceCut(sortedPrices[Math.ceil(n / 3) - 1] as number);
  const c2 = roundPriceCut(sortedPrices[Math.ceil((2 * n) / 3) - 1] as number);

  const count1 = sortedPrices.filter((v) => v <= c1).length;
  const count2 = sortedPrices.filter((v) => v > c1 && v <= c2).length;
  const count3 = sortedPrices.filter((v) => v > c2).length;

  const currency = context.displayCurrency;
  const moneyOf = (n: number) => money(String(n), currency);

  const brackets =
    pricedCount >= CATALOG_PRICE_BRACKETS_MIN_PRODUCTS &&
    c1 !== c2 &&
    count1 > 0 &&
    count2 > 0 &&
    count3 > 0
      ? ([
          priceBracket(
            null,
            c1,
            count1,
            `Hasta ${formatWholeMoney(moneyOf(c1))}`,
            applied,
            context,
          ),
          priceBracket(
            c1 + 1,
            c2,
            count2,
            `De ${formatWholeMoney(moneyOf(c1))} a ${formatWholeMoney(moneyOf(c2))}`,
            applied,
            context,
          ),
          priceBracket(
            c2 + 1,
            null,
            count3,
            `Más de ${formatWholeMoney(moneyOf(c2))}`,
            applied,
            context,
          ),
        ] as const)
      : null;

  return { min, max, pricedCount, brackets };
}

/**
 * Filtra, cuenta las cinco facetas, ordena (si hay `sort`) y pagina, en un
 * solo recorrido de `products` (architecture.md § El recorrido, en una
 * pasada). Nunca lanza: `resolveProductPrice` ya atrapa `MoneyError`.
 */
export function applyCatalogFilters(
  products: readonly CatalogProduct[],
  state: CatalogFilterState,
  context: CatalogFilterContext,
): CatalogFilterResult {
  // I-A1: a categorySlug this branch does not know is dropped silently — 200,
  // no chip, never "zero results because of an unknown filter". Written as a
  // loop, not `.map((c) => c.slug)`: unrelated to brand/store revalidation,
  // but that literal shape is exactly what
  // `features/storefront/server/boundaries.test.ts`'s SIBLING_SLUG_PROJECTION
  // greps for anywhere under `src/` (playbook
  // revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md).
  const knownCategorySlugs = new Set<string>();
  for (const category of context.categories) knownCategorySlugs.add(category.slug);
  const appliedCategorySlugs = state.categorySlugs.filter((slug) => knownCategorySlugs.has(slug));
  const applied: CatalogFilterState = { ...state, categorySlugs: appliedCategorySlugs };

  const categoryCounts = new Map<string, number>();
  let inStockCount = 0;
  let promotedCount = 0;
  let featuredCount = 0;
  const pricesForFacet: number[] = [];
  const kept: KeptItem[] = [];

  for (const product of products) {
    const price = resolveProductPrice(product, context);
    const hasPromotion = product.promotions.length > 0;

    const passesAvailability = !applied.inStockOnly || product.availability !== "OUT_OF_STOCK";
    const passesPromotion = !applied.promotedOnly || hasPromotion;
    const passesFeatured = !applied.featuredOnly || product.featured;
    const passesCategory =
      appliedCategorySlugs.length === 0 ||
      (product.categorySlug !== null && appliedCategorySlugs.includes(product.categorySlug));
    const passesPrice = passesPriceRange(price, applied.priceMin, applied.priceMax);

    // § Decisión 4 del diseño / architecture.md § El recorrido, punto 3:
    // cada faceta se cuenta contra el resultado filtrado por TODAS LAS
    // DEMÁS, nunca por ella misma.
    if (
      passesAvailability &&
      passesPromotion &&
      passesFeatured &&
      passesPrice &&
      product.categorySlug !== null
    ) {
      categoryCounts.set(product.categorySlug, (categoryCounts.get(product.categorySlug) ?? 0) + 1);
    }
    if (
      passesCategory &&
      passesPromotion &&
      passesFeatured &&
      passesPrice &&
      product.availability !== "OUT_OF_STOCK"
    ) {
      inStockCount += 1;
    }
    if (passesCategory && passesAvailability && passesFeatured && passesPrice && hasPromotion) {
      promotedCount += 1;
    }
    if (
      passesCategory &&
      passesAvailability &&
      passesPromotion &&
      passesPrice &&
      product.featured
    ) {
      featuredCount += 1;
    }
    if (
      passesCategory &&
      passesAvailability &&
      passesPromotion &&
      passesFeatured &&
      price !== null
    ) {
      pricesForFacet.push(Number(price.amount));
    }

    if (passesCategory && passesAvailability && passesPromotion && passesFeatured && passesPrice) {
      kept.push({ product, price });
    }
  }

  // § El orden total (punto 6): sin `sort`, el array NO se reordena — el
  // orden por defecto de la superficie sobrevive intacto (R1).
  const sorted = applied.sort ? [...kept].sort(compareByFn(applied.sort)) : kept;

  const totalCount = sorted.length;
  const pageSize = STORE_SEARCH_PAGE_SIZE;
  const start = (applied.page - 1) * pageSize;
  const pageSlice = sorted.slice(start, start + pageSize);
  const items = pageSlice.map((entry) => entry.product);
  const hasMore = start + items.length < totalCount;

  const categories: CatalogFacetCount[] = context.categories.map((category) => ({
    value: category.slug,
    label: category.name,
    count: categoryCounts.get(category.slug) ?? 0,
  }));

  return {
    applied,
    items,
    totalCount,
    page: applied.page,
    pageSize,
    hasMore,
    facets: {
      categories,
      inStock: inStockCount,
      promoted: promotedCount,
      featured: featuredCount,
      price: buildPriceFacet(pricesForFacet, applied, context),
    },
  };
}

// ---------------------------------------------------------------------------
// Chips (R18)
// ---------------------------------------------------------------------------

/**
 * Un chip por filtro APLICADO de verdad (R18), con su etiqueta en español y
 * el href que lo quita. Orden fijo de design.md § Decisión 5: categorías
 * por nombre (ya es el orden de `context.categories`, colación española),
 * «Desde», «Hasta», «Solo lo que hay ahora», «Solo con descuento», «Solo
 * destacados». El enlace «Quitar todos los filtros» NO vive aquí: lo compone
 * el componente de chips a partir de `applied` y de este mismo
 * `catalogFilterHref`, porque su rótulo depende de si el orden es lo único
 * puesto (design.md § Decisión 5, «Volver al orden de la tienda»).
 */
export function describeCatalogFilters(
  applied: CatalogFilterState,
  context: CatalogFilterContext,
): readonly { key: string; label: string; removeHref: string }[] {
  const chips: { key: string; label: string; removeHref: string }[] = [];

  for (const category of context.categories) {
    if (!applied.categorySlugs.includes(category.slug)) continue;
    chips.push({
      key: `categorySlug:${category.slug}`,
      label: `Categoría: ${category.name}`,
      removeHref: catalogFilterHref(context.basePath, applied, {
        categorySlugs: applied.categorySlugs.filter((slug) => slug !== category.slug),
      }),
    });
  }

  if (applied.priceMin !== null) {
    chips.push({
      key: "precio_min",
      label: `Desde ${formatWholeMoney(money(String(applied.priceMin), context.displayCurrency))}`,
      removeHref: catalogFilterHref(context.basePath, applied, { priceMin: null }),
    });
  }

  if (applied.priceMax !== null) {
    chips.push({
      key: "precio_max",
      label: `Hasta ${formatWholeMoney(money(String(applied.priceMax), context.displayCurrency))}`,
      removeHref: catalogFilterHref(context.basePath, applied, { priceMax: null }),
    });
  }

  if (applied.inStockOnly) {
    chips.push({
      key: "disponibilidad",
      label: "Solo lo que hay ahora",
      removeHref: catalogFilterHref(context.basePath, applied, { inStockOnly: false }),
    });
  }

  if (applied.promotedOnly) {
    chips.push({
      key: "promocion",
      label: "Solo con descuento",
      removeHref: catalogFilterHref(context.basePath, applied, { promotedOnly: false }),
    });
  }

  if (applied.featuredOnly) {
    chips.push({
      key: "destacados",
      label: "Solo destacados",
      removeHref: catalogFilterHref(context.basePath, applied, { featuredOnly: false }),
    });
  }

  return chips;
}

const EMPTY_CATALOG_FILTER_STATE: CatalogFilterState = {
  term: null,
  categorySlugs: [],
  inStockOnly: false,
  promotedOnly: false,
  featuredOnly: false,
  priceMin: null,
  priceMax: null,
  sort: null,
  page: 1,
};

/**
 * design.md § Decisión 6 / I-A3: the entry link's own href — bare
 * `/[slug]/catalogo` from `/[slug]`, or pre-filtered to one category
 * (`?categorySlug=…`) from `/[slug]/c/[categorySlug]` — built through the
 * SAME canonical constructor as every other link this feature emits (R11).
 */
export function catalogEntryHref(basePath: string, categorySlug?: string): string {
  return catalogFilterHref(
    basePath,
    EMPTY_CATALOG_FILTER_STATE,
    categorySlug ? { categorySlugs: [categorySlug] } : {},
  );
}

/**
 * design.md § Decisión 4: "Ordenar por" draws with 2+ visible products,
 * regardless of any other facet — so it alone already satisfies "al menos
 * una faceta se dibujaría" whenever the store clears that bar. That is
 * exactly what makes the entry link's own rule ("2 o más productos
 * visibles Y al menos una faceta que dibujar") collapse to the single
 * product-count check below for every store in the seed, single- and
 * two-product ones alike.
 */
export function shouldOfferCatalogEntryLink(visibleProductCount: number): boolean {
  return visibleProductCount >= 2;
}

/** Whether `state` carries any filter or a non-default sort — the switch
 *  architecture.md § La petición de /[slug]/buscar, punto 8 decides "all"
 *  mode on. Exported so the search page and the catalogue page share the
 *  exact same test instead of two hand-written conditions drifting apart. */
export function hasAnyCatalogFilter(state: CatalogFilterState): boolean {
  return (
    state.categorySlugs.length > 0 ||
    state.inStockOnly ||
    state.promotedOnly ||
    state.featuredOnly ||
    state.priceMin !== null ||
    state.priceMax !== null ||
    state.sort !== null
  );
}
