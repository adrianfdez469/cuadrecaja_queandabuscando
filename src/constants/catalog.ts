/**
 * F-026: the fallback base `uniqueSlug()` falls back to when a category's
 * `name` slugifies to the empty string (e.g. a name made only of emoji or
 * punctuation). Matches the fallback the migration's higiene step
 * (`prisma/migrations/20260831033437_local_category_slug_unique/migration.sql`)
 * applies to pre-existing rows, so a category created before and after this
 * feature never gets two different empty-name conventions.
 */
export const CATEGORY_SLUG_FALLBACK = "categoria";

/**
 * F-026: the second-level route segment for the category view,
 * `/[slug]/c/[categorySlug]` — the sibling of `p` in
 * `src/app/[slug]/p/[productSlug]/page.tsx`. Not in `RESERVED_SLUGS`: it is
 * a segment one level DOWN from a store's own slug, so it never competes
 * with a first-level value the way `p` doesn't either
 * (architecture.md § Alternativas descartadas).
 */
export const CATEGORY_ROUTE_SEGMENT = "c";

/**
 * F-027 (architecture.md § Dónde vive el módulo, punto 3): the filtered
 * catalogue's own route segment, `/[slug]/catalogo` — the sibling of
 * `CATEGORY_ROUTE_SEGMENT` and of `buscar`.
 */
export const CATALOG_ROUTE_SEGMENT = "catalogo";

/**
 * F-027 (architecture.md § El vocabulario de la URL): ONE vocabulary of
 * querystring parameter names, shared by `/[slug]/catalogo` and
 * `/[slug]/buscar` (R17) — `src/features/catalog/catalogFilters.ts` is the
 * only module that reads or writes these literals. `q` is F-021's own
 * (`src/lib/searchTerm.ts` normalizes its value but does not name the
 * parameter itself); `categorySlug` is F-026's (SP2: never renamed);
 * `precio_min`, `precio_max` and `sort` are the names the frozen acceptance
 * criteria already use.
 */
export const CATALOG_PARAM_TERM = "q";
export const CATALOG_PARAM_CATEGORY = "categorySlug";
export const CATALOG_PARAM_AVAILABILITY = "disponibilidad";
export const CATALOG_PARAM_PROMOTION = "promocion";
export const CATALOG_PARAM_FEATURED = "destacados";
export const CATALOG_PARAM_PRICE_MIN = "precio_min";
export const CATALOG_PARAM_PRICE_MAX = "precio_max";
export const CATALOG_PARAM_SORT = "sort";
export const CATALOG_PARAM_PAGE = "p";

/** The only accepted value of `disponibilidad` — opt-in (R3). */
export const CATALOG_AVAILABILITY_HAY = "hay";
/** The only accepted value of `promocion` and of `destacados` — one token
 *  shared by both booleans (architecture.md § El vocabulario de la URL). */
export const CATALOG_FLAG_ON = "si";

export const CATALOG_SORT_PRECIO_ASC = "precio_asc";
export const CATALOG_SORT_PRECIO_DESC = "precio_desc";
export const CATALOG_SORT_NOMBRE = "nombre";
export const CATALOG_SORT_RECIENTE = "reciente";
/** Exactly equivalent to omitting `sort` (E11): exists only so the
 *  `<select>` of `/[slug]/buscar` can mark "Más relevantes" as a real,
 *  selectable option instead of a blank gap (design.md § Decisión 7). */
export const CATALOG_SORT_RELEVANCIA = "relevancia";

export const CATALOG_SORT_VALUES = [
  CATALOG_SORT_PRECIO_ASC,
  CATALOG_SORT_PRECIO_DESC,
  CATALOG_SORT_NOMBRE,
  CATALOG_SORT_RECIENTE,
  CATALOG_SORT_RELEVANCIA,
] as const;

/** design.md § Decisión 7: the catalogue's own default-order option
 *  (`Destacados primero`) carries no real token — an empty string canonizes
 *  to "no `sort`" exactly like an absent parameter, so E12's "no elegir
 *  nada" path stays reachable from a real, markable `<option>`. */
export const CATALOG_SORT_DEFAULT_VALUE = "";

/** Tope por faceta multivalor (`categorySlug`), aplicado DESPUÉS de
 *  deduplicar y ordenar y ANTES de tocar los datos (architecture.md § El
 *  vocabulario de la URL). */
export const CATALOG_FILTER_VALUES_MAX = 12;

/** RD3: mínimo de productos con precio resoluble para dibujar los tres
 *  atajos de precio (architecture.md § El rango y los tres atajos de
 *  precio). */
export const CATALOG_PRICE_BRACKETS_MIN_PRODUCTS = 12;

/** design.md § Estructura por breakpoint, fila "Grupo «Categoría»": filas
 *  visibles antes de que el resto se pliegue en un `<details>` anidado. */
export const CATALOG_CATEGORY_VISIBLE_ROWS = 8;

/** Cota superior de `precio_min`/`precio_max` en el esquema Zod de
 *  `catalogFilters.ts`. Ningún precio real de la base se le acerca; solo
 *  descarta un entero absurdo antes de que llegue al recorrido (R10) sin
 *  arriesgar overflow en la aritmética de `src/lib/money.ts`. */
export const CATALOG_PRICE_MAX_ABSOLUTE = 100_000_000;
