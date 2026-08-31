---
feature: F-027
agente: sdd-implementer
actualizado: 2026-08-31T19:24:01Z
estado: listo
---

Los 13 pasos de `plan.md`, en un solo ciclo. `bash .agent/verify.sh F-027 --full`
pasó en el intento 2 (harness · typecheck · lint · format · test · prisma ·
build · theme · bundle, las nueve etapas en 0).

## Qué se construyó

| Archivo                                                                               | Qué hace                                                                                                                                                                                                                                                      | Paso(s) |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `src/constants/catalog.ts` (crece)                                                    | Los nueve parámetros, `hay`/`si`, los cinco `sort`, `CATALOG_FILTER_VALUES_MAX = 12`, `CATALOG_PRICE_BRACKETS_MIN_PRODUCTS = 12`, `CATALOG_PRICE_MAX_ABSOLUTE`, `CATALOG_CATEGORY_VISIBLE_ROWS = 8`, `CATALOG_ROUTE_SEGMENT = "catalogo"`                     | 1       |
| `src/constants/storeSearch.ts` (crece)                                                | Comentario: `STORE_SEARCH_PAGE_SIZE`/`STORE_SEARCH_MAX_PAGE` ya no son solo del buscador                                                                                                                                                                      | 1       |
| `src/lib/money.ts` (crece)                                                            | `formatWholeMoney` compartiendo `formatWithIntl` con `formatMoney` (mismo `Intl.NumberFormat` y su rama de respaldo)                                                                                                                                          | 2       |
| `src/lib/money.test.ts` (crece)                                                       | Tres pruebas: sin `.00`, mismo símbolo que `formatMoney`, la rama de respaldo tampoco imprime fracción                                                                                                                                                        | 2       |
| `src/features/catalog/server/queries.ts` (crece)                                      | `CatalogProduct.createdAt` (ISO) en `loadCatalog`; `getFilteredStoreCatalog` (envoltorio `cache()` sobre `getStoreCatalog` + `applyCatalogFilters`, cero consulta nueva)                                                                                      | 3, 6    |
| `src/features/catalog/server/search.ts` (crece)                                       | `createdAt` en `SearchRawRow`/`SearchProductRow` y en el `SELECT` de la CTE `page`; `StoreSearchInput.mode: "page" \| "all"`, `ALL_CANDIDATES_LIMIT`, `buildStoreSearchSql`/`searchStoreProducts` lo respetan                                                 | 3, 7    |
| `src/features/catalog/catalogFilters.ts` (nuevo)                                      | `parseCatalogFilters` (Zod, `.catch()` por campo), `catalogFilterHref`, `applyCatalogFilters` (un recorrido: cinco facetas, RD3, orden total, paginación), `describeCatalogFilters`, `catalogEntryHref`, `shouldOfferCatalogEntryLink`, `hasAnyCatalogFilter` | 4, 5    |
| `src/features/catalog/catalogFilters.test.ts` (nuevo, 31 tests)                       | Unión/intersección, override 900→300, promo 600→300, sin tasa al final en las dos direcciones, «ácido/Agua/azúcar», parámetros basura, RD3 con los precios reales de `tienda-demo` (5/5/5) y `tienda-dos` (n<12, sin atajos), chips, `catalogFilterHref`      | 4, 5    |
| `src/features/catalog/storeCategories.test.ts` (crece)                                | El fixture `product()` gana `createdAt` (el tipo lo exige ahora)                                                                                                                                                                                              | 3       |
| `src/features/storefront/trail.ts` (crece)                                            | `filterTrail(store)`, gemelo de `searchTrail`; `TRAIL_LABEL.filter`                                                                                                                                                                                           | 10      |
| `src/features/storefront/trail.test.ts` (crece)                                       | Un caso para `filterTrail`                                                                                                                                                                                                                                    | 10      |
| `src/components/store/StoreFilterPanel.tsx` (nuevo)                                   | `<details>`/`<form method="get">`: orden embebido, precio (campos + atajos + línea de rango), categoría (con sub-`<details>` a partir de 8), otros filtros, fila de acciones pegajosa                                                                         | 8       |
| `src/components/store/StoreFilterChips.tsx` (nuevo)                                   | Un `<a>` por filtro aplicado (R18), «Quitar todos los filtros» con 2+                                                                                                                                                                                         | 8       |
| `src/components/store/StoreCatalogSort.tsx` (nuevo)                                   | `<select>` + «Ordenar»; `standalone` (con su propio `<form>`, `/[slug]/buscar`) vs. embebido (dentro del panel, `/[slug]/catalogo`, C1)                                                                                                                       | 8       |
| `src/components/store/StoreCatalogResults.tsx` (nuevo)                                | Línea de resultados, rejilla y pie de paginación **copiado** de `StoreSearchResults` (C2) — «Productos a a b de n»                                                                                                                                            | 8       |
| `src/app/[slug]/catalogo/page.tsx` (nuevo)                                            | Resolución, cerrada sin consulta (E18), sin productos sin panel (E17), `parseCatalogFilters` + `applyCatalogFilters`, los cuatro estados, `force-dynamic`/`revalidate=0` literales, `noindex`+canónica siempre                                                | 9       |
| `src/app/[slug]/catalogo/not-found.tsx` (nuevo)                                       | 404 del slug en modo selector (E19), dentro del layout de la tienda. Sin `loading.tsx` en el segmento                                                                                                                                                         | 9       |
| `src/app/[slug]/page.tsx` (crece)                                                     | Enlace «Filtrar y ordenar» en la fila del `<h1>`, con `shouldOfferCatalogEntryLink(products.length)`                                                                                                                                                          | 11      |
| `src/app/[slug]/c/[categorySlug]/page.tsx` (crece)                                    | El mismo enlace, pre-filtrado a la categoría (`catalogEntryHref(basePath, category.slug)`, I-A3)                                                                                                                                                              | 11      |
| `src/app/[slug]/buscar/page.tsx` (crece)                                              | `StoreCatalogSort` siempre visible con resultados; modo "all" + `applyCatalogFilters` cuando hay filtro u orden; chips (R17/R18); canónica a `/[slug]` solo con filtro u orden                                                                                | 12      |
| `.agent/playbook/boundaries-test-map-slug-falso-positivo-fuera-de-dominio.md` (nuevo) | La lección de esta sección, abajo                                                                                                                                                                                                                             | 13      |

## Desviaciones

Ninguna cambia el alcance del plan firmado; son detalles de implementación
que el plan dejaba abiertos o dos puntos donde `architecture.md` y
`design.md` (los dos en `estado: listo`) se contradicen entre sí sin que
ninguno de los dos lo marque como pendiente.

- **Orden de los chips: seguí `design.md` § Decisión 5, no el orden de
  parámetros de `architecture.md` § El vocabulario de la URL (R11).**
  `architecture.md` fija el orden de la QUERYSTRING como `categorySlug,
disponibilidad, promocion, destacados, precio_min, precio_max` (los tres
  booleanos antes que el precio). `design.md` § Decisión 5 dice, en la misma
  frase que afirma citar "el mismo orden fijo (R11)": «categorías por
  nombre, «Desde», «Hasta», «Solo lo que hay ahora», «Solo con descuento»,
  «Solo destacados»» — el precio ANTES que los tres booleanos. Los dos
  órdenes no son el mismo pese a lo que dice esa frase. `catalogFilterHref`
  (la URL) usa el orden de `architecture.md` al pie de la letra;
  `describeCatalogFilters` (los chips) usa el orden textual de `design.md`.
  Ninguno de los 16 criterios verifica el orden de los chips, así que no
  bloquea nada, pero queda anotado por si `sdd-tester` lo mira con lupa.
- **La visibilidad de cada faceta («¿se dibuja o no?», design.md §
  Decisión 4) se aproxima con `count > 0`, no con la condición literal «al
  menos un verdadero Y al menos un falso».** El contrato firmado
  (`CatalogFilterResult.facets`) solo transporta cuántos productos
  **ganaría** marcar cada casilla — nunca cuántos quedan fuera —, así que la
  condición exacta de `design.md` no es derivable sin ensanchar un contrato
  ya cerrado. `count > 0` reproduce exactamente los ejemplos que
  `design.md` da (V10: "Solo con descuento" no aparece con 0 promociones;
  aparece sola en cuanto exista una), así que no hay ningún caso conocido
  donde discrepe.
- **El enlace de entrada (`shouldOfferCatalogEntryLink`) solo comprueba
  `productos visibles >= 2`,** no las cinco condiciones de facetas de
  `design.md` § Decisión 4 una por una. Como "Ordenar por" se dibuja con 2+
  productos sin ninguna otra condición, ya satisface por sí solo el "al
  menos una faceta que dibujar" que exige la regla del enlace — así que las
  dos formas de calcularlo coinciden en cada tienda de la base (comprobado:
  `tienda-demo`, `tienda-dos`, las cuatro de dos productos, y la de un solo
  producto). Documentado en el propio código para que quien lo lea no tenga
  que rehacer el argumento.
- **`generateMetadata` de `/[slug]/catalogo` recalcula el filtrado una
  segunda vez** en vez de compartir la lectura con la del cuerpo de la
  página vía `React.cache()` con argumentos estables (como hace `loadSearch`
  en `/[slug]/buscar`). `getFilteredStoreCatalog` SÍ está envuelto en
  `cache()`, pero como `generateMetadata` y la página reciben cada uno su
  propia copia deserializada de `resolution`/`store` (identidad de objeto
  distinta), la memoización de React no dedupe entre las dos llamadas. El
  costo extra es una pasada pura sobre el catálogo ya en memoria (~11 ms a
  4.000 productos, medido en `architecture.md`), nunca una consulta nueva.
  No toca ningún criterio.
- **`StoreCatalogResults.tsx` absorbe también «la línea de resultados»**
  que `design.md` § Componentes de UI lista como una pieza aparte
  ("La línea de resultados (por crear)"). El plan (paso 8) solo nombra
  cuatro archivos —`StoreFilterPanel.tsx`, `StoreFilterChips.tsx`,
  `StoreCatalogSort.tsx`, `StoreCatalogResults.tsx`— así que la línea de
  resultados entra en el cuarto en vez de abrir un quinto archivo que el
  plan firmado no pidió.

## Comandos ejecutados

- `npx vitest run src/features/catalog/catalogFilters.test.ts` (durante el
  desarrollo, hasta que las 31 pruebas pasaron).
- `npm run typecheck` (con `next typegen` de `pretypecheck`, necesario para
  que `PageProps<"/[slug]/catalogo">` exista).
- `npm run lint`, `npm run format` (0 archivos que reformatear en el código
  final; el único warning de ESLint —`ProfileForm.tsx`— es preexistente, de
  otro feature).
- `npx vitest run` completo: 103 archivos, 978 pruebas, 0 fallos.
- `npm run build`: confirmado con `grep` que `/[slug]`, `/[slug]/c/[categorySlug]`
  y `/[slug]/p/[productSlug]` siguen `●` y `/[slug]/catalogo` es `ƒ`.
- `bash .agent/verify.sh F-027` → **PASA** (intento 1, las cuatro etapas
  rápidas: typecheck, lint, format y test).
- `bash .agent/verify.sh F-027 --full` → **PASA** (intento 2, las nueve
  etapas: harness, typecheck, lint, format, test, prisma, build, theme y
  bundle).
- Humo manual con `next dev -p 3211` (puerto propio, comprobado que no había
  otro proceso escuchando ahí) y `curl`: `/tienda-demo/catalogo` sin
  parámetros (200, `noindex`, canónica a `/tienda-demo`), con
  `categorySlug=bebidas&precio_max=500&sort=precio_asc` (200), los tres
  atajos de precio de `tienda-demo` con las etiquetas y conteos exactos de
  V11 (`Hasta $350 (5)`, `De $350 a $540 (5)`, `Más de $540 (5)`, hrefs
  `precio_max=350` / `precio_min=351&precio_max=540` / `precio_min=541`),
  `tienda-dos` sin atajos (n=5 < 12), `categorySlug=marca-ajena` sin chip
  (I-A1), `p=5` con el aviso de página fuera de rango, `precio_min=99999`
  con el vacío «con estos filtros no queda ningún producto», el slug de una
  marca en modo selector con 404, `/tienda-demo/buscar?q=pan` sin canónica y
  `?q=pan&sort=precio_asc` con canónica a `/tienda-demo`. Servidor detenido
  al terminar.

## Una lección de playbook

`.agent/playbook/boundaries-test-map-slug-falso-positivo-fuera-de-dominio.md`:
`src/features/storefront/server/boundaries.test.ts` tiene un grep parcial
(`SIBLING_SLUG_PROJECTION`) que pesca CUALQUIER `.map((x) => x.slug)` fuera
de `registry.ts`, sin mirar sobre qué colección se llama. Una línea de
`catalogFilters.ts` (`new Set(context.categories.map((c) => c.slug))`, una
faceta de categorías, cero relación con marcas ni con `Slug`) cayó en la
misma red que el test tiende para el defecto real de
`revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md`. Se
arregló reescribiendo la proyección como un `for`/`.add()` explícito, sin
tocar el test ni ensanchar `REVALIDATION_ALLOWED_FILES`.
