---
feature: F-027
agente: sdd-architect
actualizado: 2026-08-31T19:02:11Z
estado: listo
---

> Diseño sobre `.agent/specs/F-027/spec.md`, en `estado: listo`. SP1–SP5 las
> cerró el humano el 2026-08-29 y aquí no se reabren: se escriben.
>
> Este documento cierra los **nueve** puntos que la spec deja en § No decidido a
> propósito para arquitectura: los nombres y la forma de los parámetros, dónde
> vive el módulo que los interpreta, la ruta de la superficie filtrable, los
> índices, el volumen a partir del cual filtrar en memoria deja de valer, el
> contrato del orden total, el sitio del producto sin precio resoluble, la
> convivencia con el orden por capas de F-021, y `noindex` + canónica.
>
> **Cero preguntas al humano.** Las tres cifras que la spec pedía «medidas, no
> supuestas» se midieron hoy y están en § El umbral, medido y § El plan de la
> lectura, medido, con los comandos que las produjeron.
>
> **Adición del 31 de agosto, tarde:** `.agent/specs/F-027/design.md` llegó a
> `listo` en paralelo con dos peticiones dirigidas a este documento, y las dos
> quedan cerradas aquí sin reabrir nada de lo anterior. **RD3** —el mínimo, el
> máximo y los dos terciles del catálogo— en § El rango y los tres atajos de
> precio; **RD4** —un formateador de importes enteros— en § El importe entero de
> la UI. Las dos tocan solo el contrato: ni una decisión de las nueve cambia.

## Estado actual relevante

| Pieza                                         | Qué aporta a F-027                                                                                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/catalog/server/queries.ts`      | `loadCatalog` (el ÚNICO `WHERE` de visibilidad, líneas 203-210), `getStoreCatalog` cacheado por `storeCatalogTag`, `CatalogProduct`, `getStoreRates`, `requireStore`    |
| `src/features/catalog/server/queries.ts`      | `getStoreCategories` y `getStoreCategoryView`: el molde EXACTO de esta feature — `cache()` de React sobre `getStoreCatalog`, cero consultas, cero tags (ADR 0025)       |
| `src/features/catalog/storeCategories.ts`     | Derivaciones puras sobre `CatalogProduct[]` fuera de `server/`. El precedente de dónde va el módulo de filtros, y `deriveStoreCategories` para las facetas de categoría |
| `src/features/catalog/server/search.ts`       | `searchStoreProducts`, `StoreSearchResult`, y `buildStoreSearchSql` con el `LIMIT/OFFSET` que hay que poder ensanchar (I8)                                              |
| `src/lib/pricing.ts`                          | `resolvePrice` — el compositor único: override → promoción → conversión (R4). Lanza `MoneyError` cuando falta la tasa                                                   |
| `src/lib/money.ts`                            | `money()`, `compare()`, `convert()`. `compare` es la comparación de dinero que el orden por precio reutiliza en vez de reimplementar                                    |
| `src/lib/promotions.ts`                       | `indexPromotions` ya filtra vigencia dentro de `loadCatalog`: E22 sale gratis, sin regla nueva                                                                          |
| `src/lib/cache.ts`                            | `cached()` (añade los argumentos a la clave — I7), `storeCatalogTag`, `STOREFRONT_REVALIDATE = 3600`                                                                    |
| `src/lib/searchTerm.ts`                       | `normalizeSearchTerm` y `clampSearchPage`: el `q` y el `p` del vocabulario ya están escritos y probados                                                                 |
| `src/constants/storeSearch.ts`                | `STORE_SEARCH_PAGE_SIZE = 24`, `STORE_SEARCH_MAX_PAGE = 50`, `STORE_SEARCH_LAYER_MAX = 200`, `STORE_SEARCH_EXPANSION_MAX = 24`                                          |
| `src/constants/catalog.ts`                    | Donde F-026 dejó `CATEGORY_ROUTE_SEGMENT`; aquí crecen los tokens del vocabulario                                                                                       |
| `src/app/[slug]/buscar/page.tsx`              | El molde completo de una ruta dinámica de tienda: `force-dynamic` + `revalidate = 0` literales, selector→404, SUSPENDED→aviso ANTES de cualquier consulta               |
| `src/app/[slug]/page.tsx`                     | El catálogo `●` (SSG) que **no se toca** salvo por un enlace, y su `generateStaticParams`                                                                               |
| `src/app/[slug]/c/[categorySlug]/page.tsx`    | La vista por categoría de F-026, estática. **No** gana `searchParams` en este feature                                                                                   |
| `src/components/store/ProductCard.tsx`        | La tarjeta y su `safeResolve` (líneas 85-106): el tratamiento «Consultar» del producto sin tasa vigente                                                                 |
| `src/components/store/StoreSearchResults.tsx` | La rejilla y el pie de paginación de F-021, del que se extrae el paginador compartido                                                                                   |
| `src/features/storefront/server/resolve.ts`   | `requireResolution` → `branch`/`selector`/404: E18, E19 y E21 salen de aquí sin escribir nada                                                                           |
| `src/features/storefront/trail.ts`            | `catalogTrail`, `categoryTrail`, `searchTrail`: el molde del breadcrumb de la superficie nueva                                                                          |
| `src/proxy.ts`                                | Su `matcher` enumera `/admin`, `/cuenta` y `/auth`. **No se toca** (`.agent/playbook/proxy-matcher-anula-isr.md`)                                                       |

Lo que **no** existe: ninguna ruta que lea `searchParams` del catálogo, ningún
módulo que interprete filtros, ningún campo `createdAt` en `CatalogProduct`, y
ningún componente de panel, chip o selector de orden.

### Las cifras de la base de desarrollo, consultadas, no supuestas

Contra el Postgres de desarrollo
(`docker exec queandabuscando-postgres psql -U postgres -d queandabuscando`):

| Pregunta                                         | Respuesta                                        |
| ------------------------------------------------ | ------------------------------------------------ |
| `StoreProduct` visibles / totales                | 28 / 28                                          |
| Máximo de productos visibles en una sucursal     | 15                                               |
| Bytes útiles por producto en la lectura (medido) | 302 B de datos; ~490 B ya serializado a JSON     |
| Colación de la base                              | `en_US.utf8` — y **ordena los acentos al final** |

La colación no es un detalle: `SELECT unnest(array['ácido','Agua','azúcar']) AS n ORDER BY n`
devuelve **Agua, azúcar, ácido**. El criterio 7 exige exactamente el orden
contrario (ácido, Agua, azúcar). Es la prueba ejecutada de que el orden
alfabético **no puede** hacerse en SQL con esta base, y de que tiene que salir
de un `Intl.Collator("es")` en la capa de aplicación.

## Decisión

**Una ruta dinámica nueva, src/app/[slug]/catalogo/page.tsx (por crear),
hermana de `src/app/[slug]/buscar/page.tsx`, que no abre ninguna consulta
propia: filtra, cuenta, ordena y pagina en memoria sobre `getStoreCatalog()` —
la misma entrada de caché que `/[slug]` ya paga— con un único módulo puro,
src/features/catalog/catalogFilters.ts (por crear), que también interpreta los
mismos parámetros en `/[slug]/buscar`.** Cero migraciones, cero índices, cero
tags, cero JavaScript de cliente.

Los nueve cortes que definen el diseño, uno por punto pendiente:

1. **Un vocabulario de nueve parámetros**, en § El vocabulario de la URL. Los
   valores de una faceta viajan **repetidos**, nunca separados por coma: es lo
   que un `<form method="get">` emite sin JavaScript.
2. **Un solo módulo**, en `src/features/catalog/`, no en `src/lib/`, y **con
   Zod**. El porqué de las dos decisiones está en § Dónde vive el módulo.
3. **La ruta es `/[slug]/catalogo`**, dinámica, sin `generateStaticParams` y
   **sin `loading.tsx`**. `/[slug]` y `/[slug]/p/[productSlug]` no leen
   `searchParams` en ningún punto de este feature: siguen `●` (SSG).
4. **Ningún índice nuevo, y ninguna migración.** SP3 = (a) significa que el
   cálculo no llega a SQL: la única consulta es la de hoy, y ya está servida por
   un índice existente. Medido en § El plan de la lectura, medido.
5. **El umbral es 4.000 productos visibles por tienda**, y lo fija el tamaño de
   la entrada de caché, no la CPU. Medido en § El umbral, medido.
6. **`applyCatalogFilters` no reordena cuando no hay `sort`.** Esa sola regla da
   a la vez R1 (el orden por defecto no cambia nunca), E12 (un `sort` explícito
   sustituye las capas) y el orden total de R8 para los órdenes elegidos.
7. **El producto sin precio resoluble se resuelve una vez, en el módulo**, a
   `null`: fuera de todo rango y último en las dos direcciones.
8. **La búsqueda con filtro u orden pide el conjunto entero de candidatos**
   —acotado por construcción a 424 filas— y filtra, ordena y pagina encima. Sin
   filtro y sin `sort`, el camino de F-021 no se toca ni una línea.
9. **`robots: { index: false }` y canónica a `/[slug]`** en toda respuesta de la
   superficie nueva, y en `/[slug]/buscar` **solo** cuando la URL lleva filtro u
   orden, para no alterar el HTML que F-021 ya verificó.

### Alternativas descartadas

| Alternativa                                                               | Por qué no                                                                                                                                                 |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `searchParams` sobre `/[slug]`                                            | La vuelve `ƒ` y rompe el primer criterio de F-004. Cerrado por SP4                                                                                         |
| Colgar los filtros de `/[slug]/c/[categorySlug]`, como sugería F-026      | Volvería dinámica una ruta hoy pre-renderizada (su propio § Riesgos lo anticipa) y un segmento de ruta no expresa la unión de dos categorías (criterio 4)  |
| `?categoria=` o `?category=` como nombre propio del filtro                | Prohibido explícitamente por F-026 § Qué le entrega a los que vienen, y por SP2: el parámetro ya existe y se llama `categorySlug`                          |
| Valores separados por coma (`categorySlug=a,b`)                           | Un formulario GET sin JavaScript emite repetidos; la coma obligaría a construir la URL en el cliente, en algo que renderiza catálogo (R12)                 |
| Filtrar y ordenar el precio en SQL                                        | Ordenaría por un número que nadie ve (I2) y dejaría fuera lo rebajado (E6, E6b). Cerrado por SP3                                                           |
| Una columna derivada `effectivePrice` mantenida por trigger o por el sync | Duplica la precedencia de `resolvePrice` en un segundo sitio, y las promociones caducan solas: la columna quedaría rancia sin que nada se ponga rojo       |
| Una consulta y una entrada de caché por combinación de filtros            | El producto de las opciones de cada faceta en entradas de caché (I7), y una segunda copia del `WHERE` de visibilidad. Es lo que ADR 0025 prohíbe           |
| Ordenar alfabéticamente en SQL (`ORDER BY localName`)                     | Medido: con la colación `en_US.utf8` de esta base, «ácido» va **después** de «azúcar». Falla el criterio 7                                                 |
| Un `<select>` de orden con `onChange`                                     | `"use client"` en algo que renderiza catálogo (R12). Enlaces de servidor, o un `<select>` dentro del mismo formulario GET                                  |
| `loading.tsx` en el segmento nuevo                                        | La página llama a `notFound()` (E19) y un `loading.tsx` la haría responder 200 con cuerpo de 404: ficha `nextjs-loading-tsx-rompe-status-code-de-notfound` |
| Redirigir 308 a la URL canónica cuando llega una no canónica              | Un round-trip más en una ruta dinámica, y E15 pide 200. La canonización se garantiza en los enlaces que emitimos y en `<link rel="canonical">`             |
| `Disallow: /*/catalogo` en `src/app/robots.ts`                            | Una URL bloqueada no llega a leer su propio `noindex` y puede indexarse igual. `noindex` + canónica es lo que pide R14                                     |
| Guardar el filtro elegido en cookie para «recordarlo»                     | R19 lo prohíbe: el estado vive entero en la URL                                                                                                            |

## El vocabulario de la URL

**Punto 1 de § No decidido a propósito.** Nueve parámetros, ni uno más. Los
nombres no son libres: `q` y `p` los fijó F-021, `categorySlug` lo fijó F-026
(SP2: no se renombra), y `precio_min`, `precio_max` y `sort` con sus valores
están escritos en los criterios de aceptación ya congelados
(`.agent/features.json`, criterio 11; `.agent/specs/F-027/spec.md` § Criterios,
6, 7 y 10). Lo único que este documento inventa son los tres booleanos.

| Parámetro        | Forma        | Valores aceptados                                               | Semántica                                           |
| ---------------- | ------------ | --------------------------------------------------------------- | --------------------------------------------------- |
| `q`              | uno          | término, ya normalizado por `normalizeSearchTerm`               | Solo en `/[slug]/buscar`. Nunca se emite en la otra |
| `categorySlug`   | **repetido** | `LocalCategory.slug` (el vocabulario de F-026), hasta 12        | Unión dentro de la faceta (R2, E4)                  |
| `disponibilidad` | uno          | `hay`                                                           | Deja fuera `OUT_OF_STOCK`. Opt-in (R3)              |
| `promocion`      | uno          | `si`                                                            | Solo con promoción vigente (E22)                    |
| `destacados`     | uno          | `si`                                                            | Solo `featured = true`                              |
| `precio_min`     | uno          | entero ≥ 0 en la moneda de exhibición (R6)                      | Inclusive                                           |
| `precio_max`     | uno          | entero ≥ 0 en la moneda de exhibición                           | Inclusive                                           |
| `sort`           | uno          | `precio_asc`, `precio_desc`, `nombre`, `reciente`, `relevancia` | Sustituye el orden por defecto (E12)                |
| `p`              | uno          | entero, acotado a `[1, 50]` por `clampSearchPage`               | Página                                              |

Reglas del vocabulario, todas verificables:

- **Repetidos, no coma.** Una faceta multivalor viaja como parámetro repetido
  porque es lo que emite un `<form method="get">` con casillas del mismo
  `name`, sin una línea de JavaScript (E14, R12). La coma exigiría componer el
  valor en el cliente.
- **Un parámetro de un solo valor que llega repetido se queda con la primera
  aparición** y descarta el resto. Determinista y sin error (R10).
- **`sort=relevancia` es exactamente lo mismo que no mandar `sort`**: en la
  búsqueda el orden por defecto ya **es** la relevancia por capas, y en el
  catálogo filtrado no existe con qué medirla (E11). Existe como token para que
  el selector de orden pueda marcar «Relevancia» en la búsqueda; la canonización
  lo borra de la URL.
- **Canonización (R11).** Orden fijo de los parámetros: `q`, `categorySlug`
  (valores deduplicados y ordenados ascendentemente), `disponibilidad`,
  `promocion`, `destacados`, `precio_min`, `precio_max`, `sort`, `p`. Se omite
  todo lo que valga su valor por defecto (`p=1`, `sort` ausente o `relevancia`).
  La misma selección produce **una** URL porque las URL las construye el mismo
  módulo que las lee: `catalogFilterHref()` es el único sitio del repo donde se
  concatena una de estas direcciones.
- **Una URL no canónica que llega de fuera responde 200 y no redirige**, con el
  mismo resultado que su forma canónica (E15). Lo que evita que el índice se
  llene de variantes es el `<link rel="canonical">` a `/[slug]`, no un 308.
- **Tope por faceta.** `CATALOG_FILTER_VALUES_MAX = 12` valores por faceta,
  aplicado **después** de deduplicar y ordenar, y **antes** de tocar los datos:
  los cuarenta valores repetidos de la tabla de casos límite no llegan nunca al
  recorrido.
- **Lo desconocido se ignora en silencio.** Un parámetro que no está en la
  tabla, un valor que no está en su columna, `precio_min > precio_max` (se caen
  los dos límites), un decimal o una letra donde va un entero (se cae ese
  límite, el otro sigue): 200 siempre, y sin chip (R10, R18).

Ejemplo de URL canónica, con dos categorías, disponibilidad y orden:

```
/tienda-demo/catalogo?categorySlug=bebidas&categorySlug=panaderia&disponibilidad=hay&precio_max=500&sort=precio_asc
```

**La mezcla de idiomas está asumida y es deliberada**: `categorySlug` en inglés
camelCase porque SP2 prohíbe renombrarlo, `precio_min`/`precio_max` en español
porque así están escritos en los criterios congelados. Renombrar cualquiera de
los dos para «que combine» costaría un criterio de aceptación o una URL de F-026,
que es un precio muy alto por una coherencia estética.

## Dónde vive el módulo

**Punto 2.** Un solo archivo, src/features/catalog/catalogFilters.ts (por
crear), al lado de `src/features/catalog/storeCategories.ts`. Puro: sin Prisma,
sin React, sin `"use client"`.

**Por qué ahí y no en `src/lib/`.** La mitad que aplica los filtros necesita el
tipo `CatalogProduct`, que vive en `src/features/catalog/server/queries.ts`.
Poner el parser en `src/lib/` y el aplicador en `src/features/` partiría el
vocabulario en dos archivos de dos capas distintas, que es literalmente lo que
R17 prohíbe («un solo módulo que lo interpreta»). Y hay precedente de una
semana: F-026 puso sus derivaciones puras sobre `CatalogProduct[]` en
`src/features/catalog/storeCategories.ts`, fuera de `server/` justamente porque
no tocan Prisma. La tabla de capas de `AGENTS.md` lo permite: `src/features/*/`
es «lógica y componentes de un dominio».

**Por qué con Zod.** Es servidor, así que está permitido, y el requisito
central de R10 —«ignorar, no rechazar»— es una línea de Zod (`.catch()`) en vez
de una convención que cada campo tiene que recordar. Un esquema donde **todo**
campo tiene su `.catch()` no puede lanzar: la garantía de que la página nunca
responde 400 pasa a ser estructural. La regla que lo acompaña: este módulo
**nunca** se importa desde un archivo con `"use client"`; hoy no hay ninguno en
la superficie de tienda y el criterio 12 lo comprueba con un `grep`.

Los tokens del vocabulario (los literales `hay`, `si`, `precio_asc`…, el tope
por faceta y el segmento de ruta nuevo) van a `src/constants/catalog.ts`, con
`CATEGORY_ROUTE_SEGMENT`: `AGENTS.md` § Prohibiciones no admite magic strings.
El tamaño de página y el tope de páginas **se importan de**
`src/constants/storeSearch.ts` (`STORE_SEARCH_PAGE_SIZE`,
`STORE_SEARCH_MAX_PAGE`) en vez de duplicarse: R16 admite las dos, y una
constante propia con el mismo valor es una divergencia esperando a pasar. Ese
archivo gana una línea de comentario diciendo que ya no es solo del buscador.

## Componentes

| Componente                                      | Capa                       | Responsabilidad                                                                                                                                      | Archivo                                                                            |
| ----------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `catalogFilters`                                | `features/catalog/`        | Parsear, canonizar, construir hrefs, filtrar, contar facetas, calcular el rango y los tramos de precio, ordenar y paginar. El único intérprete (R17) | src/features/catalog/catalogFilters.ts (por crear)                                 |
| Tokens del vocabulario                          | `constants/`               | Literales de valores, tope por faceta, segmento de ruta                                                                                              | `src/constants/catalog.ts` (crece)                                                 |
| `getFilteredStoreCatalog`                       | `features/catalog/server/` | Envoltorio `cache()` sobre `getStoreCatalog` + `applyCatalogFilters`. Cero Prisma nuevo, cero entrada de caché nueva                                 | `src/features/catalog/server/queries.ts` (crece)                                   |
| `CatalogProduct.createdAt`                      | `features/catalog/server/` | El campo que falta para `sort=reciente`, proyectado en los DOS lectores del tipo                                                                     | `src/features/catalog/server/queries.ts` y `src/features/catalog/server/search.ts` |
| `searchStoreProducts` en modo conjunto completo | `features/catalog/server/` | Devolver los ≤424 candidatos sin paginar cuando la petición lleva filtro u orden (I8)                                                                | `src/features/catalog/server/search.ts` (crece)                                    |
| Página del catálogo filtrado                    | `app/`                     | Rutear y componer: resolución, tienda cerrada, estados vacíos, metadata                                                                              | src/app/[slug]/catalogo/page.tsx (por crear)                                       |
| Panel de filtros                                | `components/store/`        | `<form method="get">` con casillas y dos campos de precio. Servidor                                                                                  | src/components/store/StoreFilterPanel.tsx (por crear)                              |
| Chips de lo aplicado                            | `components/store/`        | Un chip por filtro **aplicado**, con enlace de quitar (R18)                                                                                          | src/components/store/StoreFilterChips.tsx (por crear)                              |
| Selector de orden                               | `components/store/`        | Enlaces de servidor, uno por criterio ofrecido                                                                                                       | src/components/store/StoreCatalogSort.tsx (por crear)                              |
| Rejilla + pie                                   | `components/store/`        | Rejilla de `ProductCard` y estado de página fuera de rango                                                                                           | src/components/store/StoreCatalogResults.tsx (por crear)                           |
| Paginador compartido                            | `components/store/`        | El pie «anterior / N-M de T / siguiente», con `hrefFor(page)` como prop                                                                              | src/components/store/StorePager.tsx (por crear)                                    |
| Enlace de entrada                               | `app/`                     | «Filtrar y ordenar» en `/[slug]` y en la vista por categoría. Un `<Link>`, nada más                                                                  | `src/app/[slug]/page.tsx`, `src/app/[slug]/c/[categorySlug]/page.tsx`              |
| Miga de pan                                     | `features/storefront/`     | `filterTrail(store)`, gemelo de `searchTrail`                                                                                                        | `src/features/storefront/trail.ts` (crece)                                         |
| `formatWholeMoney`                              | `lib/`                     | Un importe sin decimales («$350») con el MISMO `Intl` que `formatMoney`, para que el símbolo no pueda discrepar (RD4)                                | `src/lib/money.ts` (crece)                                                         |

El paginador se **extrae** de `src/components/store/StoreSearchResults.tsx` con
el mismo marcado, y ese componente pasa a usarlo: duplicar la paginación está
prohibido (`AGENTS.md` § Prohibiciones) y la prueba visual de F-021 sigue verde
porque el HTML no cambia.

## Flujo de datos

### La petición de `/[slug]/catalogo`

1. `requireResolution(slug)`. `kind: "selector"` → `notFound()` (E19). Retirado
   o inexistente → 404 por el resolvedor de siempre.
2. `requireStore(resolution)`. `DRAFT` → 404. `status !== "PUBLISHED"` → aviso
   de cerrada y **return**: ninguna lectura de catálogo (E18), copiado línea a
   línea de `src/app/[slug]/buscar/page.tsx`.
3. `parseCatalogFilters(await searchParams)` → `CatalogFilterState`. Es puro y
   no puede lanzar.
4. `Promise.all([getStoreCatalog(resolution), getStoreRates(resolution)])`. Con
   la caché caliente son **cero** round-trips; en frío, los mismos que `/[slug]`
   ya paga.
5. Si el catálogo está vacío → mensaje de siempre, **sin panel** (E17), y se
   acabó.
6. `applyCatalogFilters(products, state, { displayCurrency, rates, categories })`
   en un solo recorrido: resuelve el precio de cada producto, decide cada faceta,
   acumula los conteos, ordena si hay `sort` y corta la página.
7. Se pinta: panel + chips de `result.applied` + orden + rejilla, o el vacío
   «con estos filtros no queda nada» con sus chips y el enlace de quitar todo
   (E16), o el aviso de página fuera de rango.

`generateMetadata` repite 1-2 y añade `robots` y `alternates`; **no** repite la
lectura del catálogo, porque el título no depende del resultado. Si el diseño
pidiera un total en el título, la lectura se comparte con `cache()` de React,
como hace hoy `loadSearch` en la página de búsqueda.

### La petición de `/[slug]/buscar`

Idéntica a hoy mientras la URL no lleve filtro ni `sort`. Con cualquiera de los
dos:

1. `searchStoreProducts({ storeId, term, mode: "all" })` trae los candidatos
   **sin paginar**: como mucho `STORE_SEARCH_LAYER_MAX × 2 + STORE_SEARCH_EXPANSION_MAX = 424`
   filas, un tope que ya existe en el SQL de F-021 y que este feature no cambia.
2. `applyCatalogFilters(items, state, …)` filtra, ordena de punta a punta y
   pagina en memoria. El `totalCount` que se enseña es el de **después** de
   filtrar.
3. Los conteos por faceta se calculan igual pero **no se pintan** (SP5).

Sin filtro y sin `sort`, el camino es el de hoy: mismo SQL, mismo `LIMIT/OFFSET`,
mismo orden por capas. Por eso los criterios 1 y 2 de F-021 se re-ejecutan tal
cual (criterio 9).

### El recorrido, en una pasada

Para cada producto, en orden:

1. `resolvePrice(product, { targetCurrency, rates, baseCurrency, promotions })`
   dentro de un `try/catch`. Si lanza (`MoneyError`, no hay tasa vigente), el
   precio comparable del producto es `null` — el mismo caso que `ProductCard`
   pinta como «Consultar».
2. Cuatro predicados independientes: categoría, disponibilidad, promoción y
   destacados, más el rango de precio.
3. Los conteos por faceta se acumulan con la regla estándar: **una faceta se
   cuenta contra el resultado filtrado por todas las demás, pero no por ella
   misma**, así que «Bebidas (12)» dice cuántos productos añadiría marcarla, no
   cuántos quedan si ya está marcada. Se resuelve en la misma pasada guardando
   por producto qué facetas falla; si falla más de una, no cuenta en ninguna.
4. **El precio de un producto que pasa todas las facetas menos la de precio se
   añade a una lista de números** (RD3). Es el mismo conjunto que ya define el
   conteo de las otras cuatro facetas, así que no hace falta una segunda vuelta:
   solo un `push` en la vuelta que ya existe.
5. `kept` se ordena solo si hay `sort`, y se corta con
   `slice((page - 1) * pageSize, page * pageSize)`.
6. Terminada la pasada, esa lista de precios se ordena numéricamente y se
   recorre una vez para sacar el rango y los tres tramos (§ El rango y los tres
   atajos de precio). **0,30 ms a 4.000 productos**, medido; el 3 % del
   recorrido.

Un solo recorrido, un solo `resolvePrice` por producto, ninguna llamada a
`resolvePrice` dentro del comparador.

## Contratos

### Tipos

```ts
export type CatalogSort = "precio_asc" | "precio_desc" | "nombre" | "reciente" | "relevancia";

/** Lo que la URL dice, ya canonizado. Nunca lo que se aplicó de verdad:
 *  eso es `CatalogFilterResult.applied` (R18). */
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

/** RD3: el rango de precios del conjunto y, cuando se puede, los tres
 *  atajos. `null` significa que no queda ni un producto con precio
 *  resoluble: no hay nada que decir y la faceta de precio no se dibuja. */
export type CatalogPriceFacet = {
  /** Enteros en la moneda de exhibición, redondeados HACIA FUERA (`min`
   *  hacia abajo, `max` hacia arriba), para que la línea de rango nunca
   *  anuncie un intervalo que deje fuera un producto real. */
  min: number;
  max: number;
  /** Cuántos productos con precio resoluble hay detrás de esos dos números.
   *  Es lo que la vista necesita para la regla de § Decisión 4 del diseño
   *  («2 o más, y no todos al mismo precio»). */
  pricedCount: number;
  /** Los tres atajos, o `null` si falla cualquiera de las cuatro
   *  condiciones. Nunca un array de otra longitud. */
  brackets: readonly [CatalogPriceBracket, CatalogPriceBracket, CatalogPriceBracket] | null;
};

export type CatalogPriceBracket = {
  /** Ya listos para la URL: enteros **inclusivos**, `null` = sin límite por
   *  ese lado. Los tres tramos son disjuntos por construcción, así que sus
   *  conteos suman `pricedCount`. */
  min: number | null;
  max: number | null;
  /** Exactamente lo que se ve al pulsar el atajo, nunca la página actual. */
  count: number;
  /** «Hasta $350» · «De $350 a $540» · «Más de $540», compuesto con
   *  `formatWholeMoney` (RD4) y con los textos de § Textos del diseño. */
  label: string;
  /** Del mismo constructor que los chips y la paginación (R11). */
  href: string;
};

export type CatalogFilterResult = {
  /** R18: lo aplicado de verdad, ya sin los valores que esta tienda no
   *  conoce. Los chips y todos los hrefs se construyen SOBRE ESTO. */
  applied: CatalogFilterState;
  items: readonly CatalogProduct[];
  /** Después de filtrar y antes de paginar. Sobrevive a una página vacía,
   *  que es lo que distingue «fuera de rango» de «sin resultados»
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
    /** RD3. Se calcula sobre el mismo conjunto que los otros cuatro: todo lo
     *  que pasa las demás facetas, la de precio no. */
    price: CatalogPriceFacet | null;
  };
};

export type CatalogFilterContext = {
  displayCurrency: string;
  rates: RateTable;
  /** De `deriveStoreCategories`: lo que decide qué `categorySlug` existe en
   *  esta tienda y con qué nombre se pinta el chip (E3). */
  categories: readonly StoreCategory[];
  /** La ruta sobre la que se construyen TODOS los enlaces de este resultado:
   *  `/tienda-demo/catalogo` o `/tienda-demo/buscar`. Vive aquí, y no como
   *  parámetro suelto, para que los atajos de precio, los chips y la
   *  paginación no puedan discrepar de base (R11). */
  basePath: string;
};
```

### Funciones

```ts
export function parseCatalogFilters(
  raw: Record<string, string | string[] | undefined>,
): CatalogFilterState;

/** La URL canónica de un estado, con un parche encima. Cambiar cualquier
 *  cosa que no sea `page` reinicia a la página 1 (R9, E13). Es el
 *  constructor de bajo nivel: `applyCatalogFilters` y
 *  `describeCatalogFilters` lo llaman con `context.basePath`, y la página lo
 *  llama directamente para los enlaces de paginación. Un solo sitio compone
 *  estas direcciones (R11). */
export function catalogFilterHref(
  basePath: string,
  state: CatalogFilterState,
  patch?: Partial<CatalogFilterState>,
): string;

export function applyCatalogFilters(
  products: readonly CatalogProduct[],
  state: CatalogFilterState,
  context: CatalogFilterContext,
): CatalogFilterResult;

/** Un chip por filtro aplicado, con su etiqueta en español y el href que lo
 *  quita. La vista no compone ninguna de las dos cosas. El `basePath` viaja
 *  en el contexto, no como parámetro: un solo sitio del que sale. */
export function describeCatalogFilters(
  applied: CatalogFilterState,
  context: CatalogFilterContext,
): readonly { key: string; label: string; removeHref: string }[];
```

Y en `src/lib/money.ts`, un solo añadido (RD4):

```ts
/** El mismo importe sin decimales: «$350», nunca «$350.00» (RD4). Comparte
 *  con `formatMoney` el `Intl.NumberFormat` y su rama de respaldo —el mismo
 *  helper privado—, que es justamente lo que impide que el símbolo de un
 *  chip discrepe del de una tarjeta. */
export function formatWholeMoney(
  value: Money,
  options?: { locale?: string; symbol?: string },
): string;
```

### El esquema Zod, en su forma

Uno por campo, cada uno con su `.catch()`, de modo que `safeParse` no pueda
fallar y la página no pueda responder 400:

```ts
const oneOf = <T extends string>(values: readonly T[]) =>
  z.preprocess(
    first,
    z
      .enum(values as [T, ...T[]])
      .nullable()
      .catch(null),
  );

const nonNegativeInt = z.preprocess(
  first,
  z.coerce.number().int().min(0).max(PRECIO_MAX_ABSOLUTO).nullable().catch(null),
);
```

`first` es el helper que se queda con la primera aparición de un parámetro
repetido (el gemelo del `firstParam` que ya tiene la página de búsqueda). La
regla cruzada `precio_min > precio_max` se resuelve **después** del esquema, en
`parseCatalogFilters`, tirando los dos límites: es una regla de negocio de la
tabla de casos límite, no una validación de forma.

### El rango y los tres atajos de precio (RD3)

**Sobre qué conjunto.** Los productos que pasan **todas las demás facetas menos
la de precio** — exactamente la misma regla con la que ya se cuentan las otras
cuatro (§ Decisión 4 del diseño). De ahí sale la propiedad que hace útil un
atajo: **su número es lo que se ve al pulsarlo**, ni más ni menos.

**La fórmula, para que sea verificable y no opinable.** Sobre la lista de
precios resueltos, ordenada ascendentemente (`v`, con `n` elementos):

1. `min = floor(v[0])` y `max = ceil(v[n - 1])`. Hacia fuera los dos, para que
   la línea «los precios van de X a Y» no excluya un producto real.
2. `c1 = v[ceil(n / 3) - 1]` y `c2 = v[ceil(2n / 3) - 1]`, cada uno redondeado a
   **dos cifras significativas** y a entero.
3. Los tres tramos, ya en la forma que la URL acepta (enteros inclusivos):
   `[—, c1]`, `[c1 + 1, c2]`, `[c2 + 1, —]`.
4. Se cuenta cada uno en un solo recorrido de `v`.

**Las cuatro condiciones para dibujarlos**, las del diseño, comprobadas
**después** de redondear: `pricedCount >= CATALOG_PRICE_BRACKETS_MIN_PRODUCTS`
(12), `c1 !== c2`, y ninguno de los tres conteos a cero. Si falla cualquiera,
`brackets` es `null` y quedan los dos campos y la línea de rango. El 12 es una
constante en `src/constants/catalog.ts`, no un número suelto.

**Comprobado contra los precios reales que midió el diseño**, ejecutando la
fórmula sobre sus dos listas:

| Tienda        | n   | `min` | `c1` | `c2` | Conteos       | ¿Atajos?     |
| ------------- | --- | ----- | ---- | ---- | ------------- | ------------ |
| `tienda-demo` | 15  | 90    | 350  | 540  | **5 / 5 / 5** | Sí           |
| `tienda-dos`  | 5   | 245   | 470  | 880  | 2 / 2 / 1     | No: `n < 12` |

Los tres cincos y los cortes 350 y 540 son **los mismos números** de § Decisión 2
del diseño y de su verificación visual V11. Que salgan de la fórmula y no de una
tabla copiada a mano es el único motivo por el que se puede confiar en ellos.

**Por qué los tramos son medio abiertos y no inclusivos en los dos cortes.** Con
`[—, 350]`, `[350, 540]`, `[540, —]` el producto que vale exactamente 350 cae en
dos tramos: `tienda-demo` leería 5 / 6 / 6, los conteos no sumarían 15 y V11
dejaría de cuadrar. Medio abiertos, suman `pricedCount` y cada atajo enseña un
trozo distinto del catálogo.

**Nota de unidades.** Los terciles y el rango se calculan con
`Number(price.amount)` sobre el importe ya resuelto y convertido: es una
**estadística** que sale del módulo como entero, no un importe que se cobre.
Ordenar productos por precio sigue haciéndose con `compare()` de
`src/lib/money.ts`, y nada de lo que se paga pasa por aquí.

### El importe entero de la UI (RD4)

**`formatWholeMoney` vive en `src/lib/money.ts`, no en un archivo nuevo.** La
petición es que el símbolo no pueda discrepar del de las tarjetas, y la única
forma estructural de garantizarlo es que las dos funciones construyan el
`Intl.NumberFormat` en el **mismo** helper privado, con la misma rama de
respaldo para un runtime al que le falte la moneda. Un formateador en otro
módulo sería una segunda copia de esa lógica, que es justo lo que RD4 quiere
evitar.

Tres restricciones que van con ella:

- **`formatMoney` no cambia de opciones.** Sigue pasando solo
  `minimumFractionDigits: 2`; el helper recibe las opciones de dígitos, no un
  número fijo. Añadirle un `maximumFractionDigits` cambiaría la salida de una
  moneda de tres decimales y con ella cadenas ya verificadas por F-010 y F-013.
- **No redondea nada en la práctica.** Todo lo que se le pasa —los límites de la
  URL, los cortes de los tramos, `min` y `max`— es entero por construcción; lo
  que hace es no escribir el `.00`.
- **El separador de miles es el de `Intl`.** «$1 150», «$1,150» o «$1.150»
  depende del ICU del runtime, no de este código: una prueba que afirme la
  cadena exacta está probando ICU. Se afirma sobre el número, o comparando con
  una llamada a `formatWholeMoney`.

Quién la usa: los chips de precio y las etiquetas de los tres atajos, que las
compone el módulo de filtros; y la línea de rango, que la compone el panel —una
frase con voz de tienda, no un dato— con `money(String(min), displayCurrency)`.

`src/lib/money.ts` ya lo importan componentes de cliente (`CheckoutForm`), así
que un export más se apoya en el tree-shaking para no pesar donde no se usa.
`node scripts/check-bundle-budget.mjs` es quien lo confirma (criterio 12).

### El orden total (punto 6)

`compareBy(sort)` devuelve un comparador con **tres** escalones, siempre:

| `sort`        | Criterio                                                                | Desempate 1                     | Desempate 2 |
| ------------- | ----------------------------------------------------------------------- | ------------------------------- | ----------- |
| `precio_asc`  | `compare(a.price, b.price)` de `src/lib/money.ts`; sin precio, al final | `localName` con `Intl.Collator` | `id`        |
| `precio_desc` | el mismo invertido; **sin precio, también al final**                    | `localName`                     | `id`        |
| `nombre`      | `Intl.Collator("es", { sensitivity: "base" })`                          | —                               | `id`        |
| `reciente`    | `createdAt` descendente, comparado como cadena ISO                      | `localName`                     | `id`        |
| ausente       | **no se reordena**: el array llega ya ordenado                          | —                               | —           |

Tres propiedades que salen de esa tabla:

- **Es un orden total.** `id` es único por fila, así que el comparador nunca
  devuelve 0 para dos productos distintos. El resultado no depende ni del orden
  de entrada ni de la estabilidad de `Array.prototype.sort`.
- **Paginar no repite ni se salta** (criterio 8): las páginas son cortes de
  **un mismo array ya ordenado**, no `OFFSET` sobre una consulta que se vuelve a
  ejecutar. Con `createdAt` idéntico en las 400 filas de un alta inicial, el
  desempate por `localName` y `id` decide todo y decide igual en las dos
  páginas.
- **El orden por defecto no cambia nunca** (R1): sin `sort` no se toca el array,
  así que `/[slug]/catalogo` sin parámetros lista exactamente en el orden de
  `getStoreCatalog` —destacados y nombre, con la colación de Postgres— y
  `/[slug]/buscar` sin `sort` lista exactamente en el orden por capas de F-021.

El límite honesto de la totalidad, escrito: si el tag del catálogo se invalida
entre la página 1 y la página 2, el conjunto cambia y un producto puede
repetirse o faltar. Es exactamente la misma propiedad que ya tienen `/[slug]` y
la búsqueda de F-021, y no la introduce este feature.

### El producto sin precio resoluble (punto 7)

Se decide **una vez**, en el recorrido de `applyCatalogFilters`, y se propaga:

| Situación                   | Qué pasa                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `precio_min` o `precio_max` | **Fuera**: no se puede demostrar que esté dentro del rango (R5, E7)                |
| `sort=precio_asc`           | Al final, después de todo producto con precio                                      |
| `sort=precio_desc`          | **También al final** — «último en las dos direcciones» es literal en el criterio 6 |
| Sin filtro de precio        | Aparece como cualquier otro, y su tarjeta sigue diciendo «Consultar»               |

El `try/catch` alrededor de `resolvePrice` queda en **dos** sitios: aquí y en
`safeResolve` de `src/components/store/ProductCard.tsx`, que necesita el
`ResolvedPrice` entero para pintar el tachado. No es lógica duplicada —la
precedencia sigue viviendo solo en `src/lib/pricing.ts`—, pero sí una regla
compartida: el comentario de cada uno cita al otro.

### Errores

| Situación                                             | Respuesta                                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Parámetro desconocido, valor no reconocido, tipo malo | 200, se ignora, sin chip (R10, R18)                                                             |
| `precio_min > precio_max`                             | 200, se caen los dos límites                                                                    |
| Más de 12 valores en una faceta                       | 200, se quedan los 12 primeros tras deduplicar y ordenar                                        |
| `categorySlug` que esta tienda no tiene               | 200, se ignora y no genera chip. Ver § Incongruencias, I-A1                                     |
| `p` fuera de rango                                    | `clampSearchPage` lo acota a `[1, 50]`; si supera la última página, aviso y enlace a la primera |
| Combinación válida sin resultados                     | 200, vacío con los filtros nombrados y «quitar» (E16)                                           |
| Tienda sin productos visibles                         | 200, mensaje de siempre, sin panel (E17)                                                        |
| Tienda `SUSPENDED`                                    | Aviso de cerrada, sin consulta de catálogo (E18)                                                |
| Slug en modo selector                                 | 404 (E19)                                                                                       |
| Base caída                                            | Propaga: la lectura no lleva `catch` que devuelva lista vacía                                   |

## Modelo de datos y migraciones

**Ninguna migración, y ningún índice nuevo (punto 4).** SP3 = (a) deja el
cálculo entero en la capa de aplicación: la única consulta que sirve la
superficie filtrable es `loadCatalog`, la de hoy, sin una cláusula nueva. No hay
`WHERE` que indexar porque no hay `WHERE` nuevo, no hay `ORDER BY` que indexar
porque el orden se decide en JavaScript, y no hay columna derivada que mantener.

El único cambio en un tipo es aditivo y **no toca la base**:
`CatalogProduct` gana `createdAt: string` (ISO), que `loadCatalog` proyecta —la
columna ya existe, `prisma/schema.prisma:438`— y que el CTE `page` de
`buildStoreSearchSql` proyecta también, porque si no el otro lector del tipo no
compila. Es exactamente el mecanismo que ADR 0025 describe como deseable: «un
`CatalogProduct` gana una columna cada vez que un recorte necesita un predicado
nuevo… y rompe la compilación de los dos lectores, que es justo lo que garantiza
que no diverjan».

**Se proyecta como cadena ISO, no como `Date`.** El valor cruza `unstable_cache`,
que serializa a JSON; una cadena ISO se compara cronológicamente tal cual y no
depende de qué revive el deserializador.

Consecuencia agradable: al no generarse ninguna migración, este feature no puede
tropezar con la ficha `prisma-migrate-dev-borra-indices-gin-no-declarados`.

### El plan de la lectura, medido

Criterio 15 pide que el `EXPLAIN` de la consulta que sirve la superficie no haga
`Seq Scan` sobre `StoreProduct`, «en la medida en que el cálculo llegue a SQL».
Llega solo la consulta de hoy. Medida contra el Postgres de desarrollo, dentro
de una transacción que termina en `ROLLBACK` (no se escribió nada):

- Fixture: 10.000 productos visibles en la sucursal medida y 90.000 repartidos
  entre las otras nueve, **100.028 filas** en `StoreProduct`, con `ANALYZE`
  antes de medir.
- Plan: `Bitmap Index Scan on "StoreProduct_storeId_deletedAt_visible_idx"` →
  `Bitmap Heap Scan` → hash joins → `Sort`. **Sin `Seq Scan` sobre
  `StoreProduct`.**
- `Execution Time: 13.9 ms` para las 10.015 filas.

El índice ya existe desde la migración inicial. **Trampa para quien escriba la
prueba**: con un fixture donde la tienda medida es dueña de casi toda la tabla,
el planificador elige `Seq Scan` y hace bien —lo comprobé, es el primer plan que
salió con 10.000 filas y ninguna otra—. El fixture del criterio 15 necesita
volumen **en otras tiendas**, igual que el del criterio 8 de F-021, y nunca
`enable_seqscan = off`.

## El umbral, medido

**Punto 5: a partir de qué volumen filtrar en memoria deja de valer.**

Cómo se midió: un guion con `tsx` que importa el `resolvePrice` real y ejecuta
el pipeline completo —deserializar la entrada de caché, resolver el precio de
cada producto, filtrar, contar facetas, ordenar con `Intl.Collator` y cortar la
página— sobre catálogos sintéticos con cuatro monedas (una sin tasa), overrides
y promociones. Node 24, media de 20 repeticiones hasta 10.000 y de 5 por encima.
El peor caso se midió aparte: sin filtros (no se descarta nada) y `sort=nombre`,
que es el que hace `n·log n` comparaciones de colación sobre el catálogo entero.

| Productos | Entrada de caché | `JSON.parse` | Peor caso del pipeline | CPU por petición |
| --------- | ---------------- | ------------ | ---------------------- | ---------------- |
| 400       | 0,19 MB          | 0,22 ms      | 0,92 ms                | ~1,1 ms          |
| 1.000     | 0,47 MB          | 0,57 ms      | 2,13 ms                | ~2,7 ms          |
| 4.000     | 1,9 MB           | 2,35 ms      | 8,96 ms                | ~11 ms           |
| 10.000    | 4,7 MB           | 5,62 ms      | 22,3 ms                | ~28 ms           |
| 40.000    | 18,7 MB          | 25,8 ms      | 94,3 ms                | ~120 ms          |

Sale lineal en el peso —490 bytes por producto ya serializado, coherente con los
302 bytes de datos que miden las 28 filas reales— y prácticamente lineal en CPU:
**2,2 µs por producto**.

**El límite que muerde primero no es la CPU: es el tamaño de la entrada de
caché.** El despliegue es Vercel (`vercel.json`) y su Runtime/Data Cache no
guarda entradas de más de **2 MB**. A 490 bytes por producto eso son **≈ 4.200
productos visibles por tienda**. Pasado ese punto `getStoreCatalog` deja de
cachearse **en silencio**: cada petición vuelve a pagar los 13,9 ms de consulta,
`/[slug]` pierde el beneficio del que vive, y nada se pone rojo.

**El umbral operativo, entonces: 4.000 productos visibles por tienda.** Por
debajo, SP3 = (a) es holgadamente la opción correcta (11 ms de CPU y 1,9 MB en
el peor caso). El techo de CPU pura llega mucho más tarde, sobre los 10.000
productos (28 ms por petición), y es el número que se aplica si algún día la
caché deja de ser el cuello.

Qué hacer cuando se acerque, en orden y con la causa: (1) alertar a los 3.000 y
mirar la métrica de aciertos de caché; (2) recortar el peso por producto en la
entrada cacheada —`description` e `imageUrls` son casi todo— dejando fuera del
`CatalogProduct` lo que solo usa la ficha; (3) recién entonces reabrir SP3 hacia
una columna derivada (opción (c)) con estos números delante. Los tres pasos
valen también para lo que ADR 0025 llama «el día que se pagine el catálogo»: este
documento le pone a esa frase el número que le faltaba.

Dos detalles medidos que el implementador agradecerá:

- Ordenar por precio llamando a `compare()` de `src/lib/money.ts` **dentro** del
  comparador cuesta 14,3 ms a 4.000 productos, frente a 7,6 ms precalculando las
  unidades menores. Se elige `compare()`: 6 ms al doble del volumen esperado es
  un precio razonable por no reimplementar dinero, y precalcular queda escrito
  como la salida de emergencia si algún día importa.
- El rango y los tres tramos de precio de RD3 —ordenar la lista de precios,
  sacar `min`, `max`, los dos terciles y los tres conteos— cuestan **0,09 ms a
  1.000 productos, 0,30 ms a 4.000 y 0,70 ms a 10.000**: entre el 3 % y el 4 %
  del recorrido. No mueven el umbral ni un producto.

## Escalabilidad y límites

| Multiplicador                         | Qué pasa                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 100× productos por tienda (1.500)     | 0,7 MB por entrada y ~4 ms de CPU. Cómodo                                                                                                         |
| 100× tiendas (700 publicadas)         | 700 entradas de catálogo. A 200 productos cada una son ~69 MB, contra los 128 MB del Data Cache de un plan Pro: empieza a haber desalojos por LRU |
| 100× peticiones                       | La superficie es dinámica: no hay HTML de CDN que la amortigüe. Cada petición paga su CPU; con la caché de datos caliente, **cero** round-trips   |
| Catálogo de 4.200 productos           | La entrada deja de caber en 2 MB y deja de cachearse en silencio. Es el umbral de arriba                                                          |
| Un término de búsqueda con filtros    | 424 filas como mucho, tope que ya impone el SQL de F-021. El coste no crece con el catálogo                                                       |
| 40 valores repetidos en una faceta    | Se cortan a 12 antes de tocar los datos                                                                                                           |
| `p=50` (el tope de `clampSearchPage`) | 1.200 productos por delante. Sobre un array ya en memoria, un `slice`                                                                             |

Round-trips por petición: **0** con la caché de datos caliente (catálogo, tasas,
tienda y resolución de slug están las cuatro cacheadas); 4 en frío, los mismos
que `/[slug]`. JavaScript de cliente añadido: **0 KB** — ningún componente nuevo
lleva `"use client"`, así que `node scripts/check-bundle-budget.mjs` no puede
moverse (criterio 12) y no hay que discutir el presupuesto.

ISR y caché: la ruta nueva es `force-dynamic` y **no** entra en
`src/lib/cache.ts`. La lectura que hay debajo conserva su piso de 3.600 s y su
tag; no se crea ningún tag nuevo, así que no hay una segunda lista que alguien
pueda olvidar de disparar —el defecto de
`.agent/playbook/revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md`—.
El `matcher` de `src/proxy.ts` no se toca.

## Patrones a seguir / antipatrones a evitar

- **`export const dynamic = "force-dynamic"` y `export const revalidate = 0`
  literales**, copiados de `src/app/[slug]/buscar/page.tsx`. Una constante
  importada rompe el build con un mensaje que no nombra el archivo
  (`.agent/playbook/revalidate-no-literal.md`).
- **Sin `loading.tsx` en el segmento nuevo.** La página llama a `notFound()`
  (E19) y un `loading.tsx` la haría responder 200 con el cuerpo del 404:
  `.agent/playbook/nextjs-loading-tsx-rompe-status-code-de-notfound.md`, fichada
  en este mismo repo por esta misma razón, en la ruta de al lado.
- **El `matcher` de `src/proxy.ts` no se toca**
  (`.agent/playbook/proxy-matcher-anula-isr.md`). Ninguna etapa del sensor lo
  detecta.
- **Un `<form method="get">` descarta la querystring actual al enviarse.** Los
  parámetros que el formulario no pinta (`q`, y `sort` si el orden va por
  enlaces) viajan en `<input type="hidden">`; `p` **no**, porque cambiar un
  filtro vuelve a la página 1 (R9, E13).
- **Los chips se pintan desde `result.applied`, nunca desde lo parseado** (R18).
- **Ningún `"use client"` en el árbol de la tienda** (`AGENTS.md` §
  Prohibiciones). El criterio 12 lo comprueba con un `grep`.
- **Ni un número ni una cadena suelta**: los tokens del vocabulario, el tope por
  faceta y el segmento de ruta viven en `src/constants/catalog.ts`.
- **No añadir un segundo `Date` a `CatalogProduct`.** El tipo cruza
  `unstable_cache`, que serializa a JSON: `createdAt` entra como cadena ISO.
- **No reimplementar dinero**: comparar con `compare()` de `src/lib/money.ts`,
  construir cantidades con `money()`, y el rango de precio en la moneda de
  exhibición (R6).
- **Ordenar alfabéticamente solo con `Intl.Collator("es", { sensitivity: "base" })`.**
  Está medido: la colación de la base pone los acentos al final.
- **`npm run format` sobre lo que escribas en `.agent/`** antes de dar una etapa
  por buena, y nunca a ciegas sobre prosa ajena (`AGENTS.md` § Cosas que
  muerden).

## Incongruencias y notas para el orquestador

**I-A1 — la categoría de otra tienda: dos filas de la spec dicen cosas
distintas.** La tabla de casos límite dice que un filtro de categoría con un id
de otra tienda da «cero resultados con el vacío explicado», y la fila de arriba
—más el criterio 11, que es el congelado— dice que un valor que no existe en
esta tienda «se ignora, 200, sin chip». **Resuelto a favor del criterio 11**: un
`categorySlug` que no aparece en `deriveStoreCategories` de esta sucursal se
descarta al aplicar, no genera chip, y el resto de la selección se aplica igual.
El fondo de la otra fila —«nunca un producto ajeno»— se cumple por construcción:
todo sale de `getStoreCatalog(branch)`, que solo lee una tienda (R20). Quien
escriba las pruebas: no hay un caso «cero resultados por categoría ajena».

**I-A2 — el orden alfabético de `/[slug]` y el de `sort=nombre` no coinciden, y
es correcto.** `/[slug]` ordena en Postgres (acentos al final) y `sort=nombre`
en ICU (acentos donde un hispanohablante los busca). No se unifica: tocar el
`ORDER BY` de `loadCatalog` cambiaría `/[slug]` y rompería el criterio 1. Sin
`sort` no se reordena nada, así que las dos pantallas coinciden salvo cuando el
comprador pide explícitamente el orden por nombre.

**I-A3 — F-026 dijo que F-027 colgaría sus filtros de
`/[slug]/c/[categorySlug]`.** Se sigue su regla importante (no renombrar
`categorySlug`) y no la sugerencia de URL, que es incompatible con el criterio 4
—dos categorías a la vez— y volvería dinámica una ruta pre-renderizada. La
vista por categoría **no** gana `searchParams`: gana un enlace a
`/[slug]/catalogo?categorySlug=…`. El riesgo que F-026 anotó no se materializa.

**I-A4 — el atajo del medio pide `precio_min = c1 + 1`, y su chip dirá un peso
más que su rótulo.** Los tres tramos son disjuntos (§ El rango y los tres atajos
de precio), así que el del medio es `[351, 540]` cuando los cortes son 350 y 540:
al pulsarlo, los chips leen «Desde $351» y «Hasta $540», mientras su rótulo
—texto del diseño— dice «De $350 a $540». La alternativa era solapar los tramos
y que `tienda-demo` leyera 5 / 6 / 6, contra los 5 / 5 / 5 de § Decisión 2 y de
V11. El contrato se queda con los conteos correctos; el rótulo es del diseño y
puede quedarse como está o pasar a «De $351 a $540» sin que aquí cambie nada.

**Para `sdd-designer`**, ya disponible y decidido: nueve parámetros con sus
valores, los conteos por faceta (los cuatro), `result.applied` para los chips,
`describeCatalogFilters` para etiqueta y href de quitar, el tamaño de página
(24) y el tope de páginas (50), y los cuatro criterios de orden ofrecidos —más
«Relevancia», solo en la búsqueda—. Y desde la adición de RD3 y RD4:
`facets.price` con `min`, `max`, `pricedCount` y los tres tramos ya con rótulo,
conteo y href, más `formatWholeMoney` para la línea de rango. Su documento cerró
en `listo` con todo lo que pedía; no le queda nada pendiente de este lado.

## Riesgos y plan B

| Riesgo                                                                            | Plan B                                                                                                                    |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Una tienda supera los 4.200 productos y su catálogo deja de cachearse en silencio | Está escrito con número y con síntoma. Se recorta el peso por producto antes de reabrir SP3                               |
| El modo «conjunto completo» de la búsqueda cambia sin querer el orden por defecto | El modo solo se activa si hay filtro o `sort`; los criterios 1 y 2 de F-021 se re-ejecutan en el otro camino (criterio 9) |
| Añadir `createdAt` a `CatalogProduct` rompe la compilación de `search.ts`         | Es el mecanismo, no el accidente (ADR 0025). Una línea de SQL y una de mapeo                                              |
| El build marca la ruta nueva como `●` por descuido                                | Criterio 2 lo mira. La combinación `force-dynamic` + `searchParams` no deja alternativa                                   |
| Extraer el paginador altera el HTML que F-021 verificó                            | El marcado se mueve tal cual; su prueba visual es la que lo confirma                                                      |
| El panel gana un `"use client"` para «que se aplique solo»                        | Prohibido por R12 y por `AGENTS.md`; el criterio 12 lo pesca con `grep`                                                   |

## ¿Hace falta una ADR?

**Sí, y el borrador está escrito**:
`docs/adr/0026-vocabulario-unico-de-querystring-del-catalogo.md`, en estado
**Propuesta**, pendiente de la firma del humano junto con el plan. Fija lo que
sobrevive a este feature: un solo vocabulario, un solo intérprete, nunca sobre
una ruta pre-renderizada, y `noindex` + canónica en todo recorte. Complementa a
ADR 0025 (que dice cómo se calcula un recorte) sin contradecirla, y no toca
ninguna otra.

## Preguntas al humano

**Ninguna.** Los cinco huecos de la spec los cerró el humano el 2026-08-29
(SP1–SP5) y los nueve que quedaban para arquitectura están decididos arriba, con
sus mediciones. Lo que queda abierto es de `sdd-designer` y está enumerado en
§ Incongruencias y notas para el orquestador.
