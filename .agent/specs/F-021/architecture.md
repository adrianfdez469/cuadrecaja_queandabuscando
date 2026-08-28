---
feature: F-021
agente: sdd-architect
actualizado: 2026-08-28T06:11:22Z
estado: listo
---

> Diseño sobre `.agent/specs/F-021/spec.md` en `estado: listo`. SP1–SP4 están
> cerradas por el humano y no se reabren. Este documento **decide I4 e I7**, que
> la spec dejó a propósito en manos de arquitectura, y **no deja ninguna
> pregunta abierta**: no hay `AP`.

## Estado actual relevante

| Pieza                                                 | Qué aporta a F-021                                                                                                                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/marketplace/server/searchVector.ts`     | `searchVectorOf` / `searchQueryOf` — la pareja gemela escritura/consulta, hoy el **único** archivo de `src/` que compone `to_tsvector(` (I4), y `writeSearchDocument` del canónico |
| `src/lib/searchTerm.ts`                               | `normalizeSearchTerm` (recorte, colapso, truncado, «sin letras ni dígitos → null»), `clampSearchOffset`. Puro, sin Prisma, sin SQL. Es literalmente R9                             |
| `src/constants/marketplace.ts`                        | `MARKETPLACE_SEARCH_TS_CONFIG = "spanish"`, `MARKETPLACE_SEARCH_TERM_MAX_LENGTH = 120` y los topes de paginación del marketplace (I7)                                              |
| `src/features/marketplace/server/search.ts`           | El estilo de la lectura: `Prisma.sql`, un round-trip, sin `$transaction`, sin `catch` que disfrace la base caída                                                                   |
| `src/features/marketplace/server/boundaries.test.ts`  | Las cinco guardas G1–G5. G2 es la que I4 pone en juego (línea 108-113)                                                                                                             |
| `src/features/catalog/server/queries.ts`              | `CatalogProduct` (el tipo que la vista ya sabe pintar), el filtro de visibilidad de R7 (línea 194-198) y la precedencia descripción/imagen del canónico                            |
| `src/features/storefront/server/resolve.ts`           | `requireResolution` → `branch` \| `selector` \| 404. E13 sale de aquí gratis                                                                                                       |
| `src/features/sync/server/handlers/product.ts`        | La guarda anti-rancio (`return STALE`), el `update` deliberadamente estrecho y `recordAlias`                                                                                       |
| `src/features/admin/server/mutations.ts`              | `saveProduct` y su lista blanca `PanelProductWrite`; `commit()` revalida siempre                                                                                                   |
| `src/components/store/ProductCard.tsx`                | La tarjeta de producto ya existente: la página de resultados **no** dibuja una nueva                                                                                               |
| `prisma/migrations/20260825000000_init/migration.sql` | `unaccent` y `pg_trgm` (línea 13-14), los dos GIN de `CanonicalProduct` (513, 517) y el índice parcial de catálogo (521) — los tres **no declarados** en el schema (I8)            |
| `src/features/marketplace/server/dbFixtures.ts`       | Fixtures con token por ejecución, `sweepStaleFixtures` y el patrón de relleno de `createFillerOrders` para el `EXPLAIN`                                                            |
| `src/features/orders/server/pull.db.test.ts`          | El precedente exacto del `EXPLAIN` con volumen (líneas 98-141): filler de otro inquilino + `ANALYZE`                                                                               |
| `vitest.config.mts`, `vitest.setup.db.ts`             | El tercer proyecto `db` (ADR 0019 (c)): ya existe, no hay que crearlo                                                                                                              |

Lo que **no** existe: `StoreProduct` no tiene documento, ni vector, ni índice de
búsqueda (I1); `GlobalCategory` está vacía y nadie la escribe (I5); no hay
registro de consultas; no hay ninguna ruta bajo `/[slug]` que dependa de
`searchParams`; y el feature `catalog` solo tiene
`src/features/catalog/server/queries.ts`.

## Decisión

**Un índice de búsqueda propio de `StoreProduct` —documento + `tsvector`
ponderado— que no pertenece ni al sync ni al panel sino a un tercer escritor
derivado, y una lectura de tres capas en una sola sentencia, servida por una
página propia bajo /[slug]/buscar (por crear) sin una línea de JavaScript de
cliente.**

Los seis cortes que definen el diseño:

1. **El documento de búsqueda de una oferta es una columna DERIVADA, y su dueño
   es el índice, no un escritor de datos.** Ni el sync ni el panel lo escriben en
   su `data: { … }`: los dos **llaman**, después de su propia escritura, a un
   reindexador que **recalcula el documento leyendo la fila y sus alias tal como
   están en ese instante**. Ninguno de los dos le pasa texto. Eso hace que ADR
   0007 y ADR 0017 se cumplan por construcción y no por disciplina: el sync no
   puede pisar `description` porque no la escribe (la lee), y el panel no puede
   pisar `localName` por el mismo motivo. R3 deja de ser una regla que recordar en
   dos sitios. Es la trampa de ADR 0004 § Trampa cerrada igual que la cerró F-015,
   pero para las dos mitades de la propiedad.
2. **La pareja de expresiones sube a un módulo compartido y neutral, y G2 sigue
   diciendo «exactamente un archivo»** (resolución de I4, abajo con su
   justificación).
3. **El diccionario y el tope de término se rebautizan sin dueño** y se reutilizan
   desde los dos buscadores (resolución de I7, abajo).
4. **Las tres capas son tres predicados indexables separados, no un `OR`.** Cada
   capa es su propio CTE con su propio índice: léxica (`"searchVector" @@`),
   difusa (`"searchDocument" %>`, `word_similarity`) y expansión por categoría
   (cascada de R17). R1 —«las capas no se mezclan»— pasa a ser estructural: el
   número de capa es un literal por CTE, no un `CASE` que alguien pueda invertir.
   Y el plan del criterio 8 es estable: un `OR` de dos predicados GIN obliga al
   planificador a elegir `BitmapOr` o `Seq Scan`, y elegiría lo segundo en cuanto
   uno de los dos lados le pareciera poco selectivo.
5. **La página es dinámica y el registro se escribe con `after()`**, después de
   que la respuesta salga: R13/E16 sin `setTimeout`, sin cola y sin proceso
   aparte.
6. **La vista reutiliza `CatalogProduct` y `src/components/store/ProductCard.tsx`
   tal cual.** El tipo de un resultado es `CatalogProduct` más el número de capa.
   Duplicar la interfaz entre la capa de datos y la vista está prohibido
   (`AGENTS.md` § Prohibiciones), y una tarjeta nueva sería una regresión
   disfrazada de entrega.

### Alternativas descartadas

| Alternativa                                                                    | Por qué no                                                                                                                                                            |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apoyarse en `CanonicalProduct.searchVector` y no dar índice propio a la oferta | Deja fuera `localName` y `description`, que es justo el texto del comerciante (I2). Además cruzaría tiendas: el canónico es compartido y R6/E7 lo prohíben            |
| Un solo `SELECT` con `WHERE (vector @@ q OR doc %> t OR categoría …)`          | El plan se vuelve un `BitmapOr` frágil y la capa 3 depende del resultado de las otras dos: no es un `OR`, es una segunda fase                                         |
| Trigger PL/pgSQL que mantenga documento y vector                               | Cerraría R3 de raíz, pero mueve la invariante a un sitio que ninguna prueba de TypeScript ve. Es el plan B                                                            |
| Columna generada / índice de expresión con `unaccent`                          | `unaccent` no es inmutable (ADR 0019 § Contexto). Por eso el documento se almacena **ya sin acentos**: así el índice trigram es un índice de columna, no de expresión |
| `similarity()` / operador `%` sobre el documento                               | La similitud se diluye con la longitud: «cocacola» contra un documento con descripción larga baja de 0.3 y E4 se cae. `word_similarity` toma el mejor tramo           |
| Fijar `pg_trgm.word_similarity_threshold` por consulta                         | Es un GUC de sesión; hacerlo seguro exige `SET LOCAL` dentro de una transacción, y el pooler corre en modo transacción (`AGENTS.md` § Cosas que muerden)              |
| Índice compuesto `(storeId, searchVector)` con `btree_gin`                     | Es la respuesta correcta a escala, pero exige una extensión nueva de Postgres en producción. Queda como plan B con su umbral escrito, no como dependencia de hoy      |
| `ts_headline` para resaltar la coincidencia                                    | Recompone `to_tsvector` (segundo compositor, I4) y obliga a inyectar HTML en la página. Fuera, y dicho explícitamente para `sdd-designer`                             |
| Un `COUNT(*)` aparte para el total de R4                                       | Duplica el coste. `count(*) OVER ()` da el total exacto en la misma sentencia y en la misma pasada                                                                    |
| Filtrar en memoria sobre `getStoreCatalog()` (que ya está cacheado)            | Trae el catálogo entero por consulta y deja el criterio 8 sin sentido                                                                                                 |
| Cachear la página por tag                                                      | Depende de `searchParams`: R15. Cachear por término sería una entrada de caché por consulta distinta                                                                  |
| Escribir el registro en el camino crítico (`await` antes de responder)         | R13. `after()` existe justo para esto y está documentado en `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`                               |
| Zod para `searchParams`                                                        | No hay frontera HTTP con cuerpo; la entrada son dos cadenas y se acotan con funciones puras, como ya hizo F-015                                                       |
| Un feature nuevo `storeSearch/` para la lectura                                | `StoreProduct` ya es de `catalog`; abrir un feature para tres archivos que leen la misma tabla parte el dominio en dos                                                |

### I4 — quién compone `to_tsvector(`, y qué pasa con la guarda G2

**Decisión: se mueve la pareja de expresiones a un módulo compartido y neutral,
src/features/search/server/expressions.ts (por crear), y la guarda G2 se
actualiza para apuntar a él. Sigue habiendo EXACTAMENTE UN archivo bajo `src/`
que compone `to_tsvector(`.** No se relaja la guarda: se le cambia el sujeto.

Por qué esta y no las otras dos:

- **Reutilizar `src/features/marketplace/server/searchVector.ts` tal cual** (que
  es lo que la letra de G2 pide hoy) obligaría a que un módulo del _marketplace_
  escriba el índice de `StoreProduct`, que es la tabla de la _tienda_. El
  buscador de la tienda quedaría importando el vocabulario del marketplace justo
  cuando la spec (I9) insiste en que son dos features que no se mezclan.
- **Permitir un segundo escritor** —relajar G2 a una lista blanca de dos
  archivos— es lo que la spec dejaba abierto como opción, y es peor: la razón de
  ser de G2 (ADR 0019 (b)) es que si la expresión de escritura y la de consulta
  se separan, `cafe` deja de encontrar `Café` **y nada se pone rojo**. Cada
  archivo que se añade a esa lista blanca es una copia más que puede derivar.
  Mover el compositor conserva la invariante entera; duplicarlo la degrada.

Lo que hay que tocar, exactamente:

- src/features/search/server/expressions.ts (por crear) pasa a contener
  `searchQueryOf` (sin cambios), `canonicalSearchVectorOf` (el `searchVectorOf`
  de hoy, renombrado por simetría) y `storeProductSearchVectorOf` nuevo (el
  ponderado con `setweight`). Es el único archivo con `to_tsvector(`.
- `src/features/marketplace/server/searchVector.ts` conserva
  `writeSearchDocument` y `backfillSearchVectors` y pasa a **importar** la
  expresión. Deja de contener el literal.
- `src/features/marketplace/server/boundaries.test.ts`: su constante
  `WRITER_FILE` se parte en tres —el compositor, el escritor del canónico y el
  escritor de la oferta— y G1(b) pasa de «un archivo escribe `"searchDocument" =`»
  a «exactamente estos dos, uno por tabla», con su anti-vacuidad en los dos. G2
  no cambia de forma, solo de sujeto: `expect(matches).toEqual([EXPRESSIONS_FILE])`.
  Es una prueba, no un `acceptance_criteria`: se puede editar, y la edición la
  hace **más** exigente, no menos.

Por qué el módulo va en `src/features/search/server/` y no en `src/lib/`:
componer `Prisma.sql` exige importar el cliente generado, y eso es «tocar
Prisma» para la tabla de capas de `AGENTS.md` y para la propia guarda del panel.
Es la misma decisión que ADR 0019 (a) ya tomó. `search` es un dominio real y
transversal —lo comparten el marketplace y la tienda—, no una carpeta de
conveniencia.

### I7 — el diccionario y los topes bautizados «marketplace»

**Decisión: se reutilizan, rebautizados a nombres sin dueño. Lo compartido sube
a src/constants/search.ts (por crear); lo que de verdad es del marketplace se
queda donde está.** `src/lib/searchTerm.ts` se reutiliza **tal cual** —solo
cambian sus imports y su comentario de cabecera— y gana una función.

Duplicar el diccionario o el tope sería exactamente el fallo que I7 describe:
«cafe» encontraría «Café» en un buscador y no en el otro, y nada se pondría
rojo. Y dejarlos con el nombre `MARKETPLACE_*` haría que una lectura de la
tienda importe el vocabulario del marketplace, que es la otra mitad de la queja.

| Constante                             | Antes                                | Después                                             |
| ------------------------------------- | ------------------------------------ | --------------------------------------------------- |
| Diccionario de Postgres               | `MARKETPLACE_SEARCH_TS_CONFIG`       | `SEARCH_TS_CONFIG` en src/constants/search.ts       |
| Tope de longitud del término (R9/E11) | `MARKETPLACE_SEARCH_TERM_MAX_LENGTH` | `SEARCH_TERM_MAX_LENGTH` en src/constants/search.ts |
| Separador del documento               | —                                    | `SEARCH_DOCUMENT_SEPARATOR = " · "` (nuevo)         |
| Topes de paginación del marketplace   | `MARKETPLACE_SEARCH_LIMIT_*`         | **no se mueven**: son suyos                         |
| Lote del relleno del canónico         | `MARKETPLACE_BACKFILL_BATCH_SIZE`    | **no se mueve**: es suyo                            |

`clampSearchLimit` **no se toca ni se generaliza**: F-021 no acepta un tamaño de
página por URL, lo fija con su propia constante. Lo que sí se añade a
`src/lib/searchTerm.ts` es `clampSearchPage(raw)`, puro, con el mismo estilo que
sus dos hermanas. Así las dos búsquedas comparten normalización de término
—E3/E12 valen igual en las dos— sin que ninguna herede la paginación de la otra.

Riesgo asumido y acotado: el renombrado toca cuatro archivos de F-015
(`src/constants/marketplace.ts`, `src/lib/searchTerm.ts`,
`src/features/marketplace/server/searchVector.ts` y
`src/features/marketplace/server/boundaries.test.ts`). **No cambia ningún
comportamiento**, así que los cuatro `acceptance_criteria` de F-015 siguen
verificándose con las mismas pruebas y con el mismo resultado. La spec de F-021
autoriza el rebautizo por escrito (I7).

## Componentes

| Componente                                                                         | Capa                     | Responsabilidad                                                                                                                          | Archivo                                                                                                    |
| ---------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `SEARCH_TS_CONFIG`, `SEARCH_TERM_MAX_LENGTH`, `SEARCH_DOCUMENT_SEPARATOR`          | `src/constants/`         | Lo que comparten los dos buscadores (I7)                                                                                                 | src/constants/search.ts (etapa 1, por crear)                                                               |
| `STORE_SEARCH_*`                                                                   | `src/constants/`         | Tamaño de página, topes por capa, pesos de `ts_rank`, página máxima                                                                      | src/constants/storeSearch.ts (etapa 1, por crear)                                                          |
| `clampSearchPage`                                                                  | `src/lib/`               | Acotar `?p` a un entero de `[1, STORE_SEARCH_MAX_PAGE]`. Puro                                                                            | `src/lib/searchTerm.ts` (existe; se añade la función)                                                      |
| `searchQueryOf`, `canonicalSearchVectorOf`, `storeProductSearchVectorOf`           | `src/features/*/server/` | **El único compositor de `to_tsvector(` del repo** (I4)                                                                                  | src/features/search/server/expressions.ts (etapa 1, por crear)                                             |
| `reindexStoreProduct`, `reindexStoreProductsOfCanonical`                           | `src/features/*/server/` | El escritor derivado: recalcula documento + vector de la fila leyendo `localName`, alias del negocio y `description` (R2, R3)            | src/features/catalog/server/searchIndex.ts (etapa 2, por crear)                                            |
| `searchStoreProducts` + sus tipos                                                  | `src/features/*/server/` | La lectura de tres capas: R1, R6, R7, R8, R10, R11, R12, R16, R17 y el total de R4                                                       | src/features/catalog/server/search.ts (etapa 4, por crear)                                                 |
| `recordStoreSearchQuery`                                                           | `src/features/*/server/` | Una fila por consulta (R4, R5). **Nunca lanza** (R13, E16)                                                                               | src/features/catalog/server/searchLog.ts (etapa 4, por crear)                                              |
| Las tres llamadas al reindexador                                                   | sync · panel · seed      | Sustituyen a «nadie lo recalcula». No entran en ningún `data: { … }`                                                                     | `src/features/sync/server/handlers/product.ts`, `src/features/admin/server/mutations.ts`, `prisma/seed.ts` |
| Taxonomía mínima + `globalCategoryId` de los canónicos con EAN                     | seed                     | SP3: datos para la capa 3 y para el criterio 2                                                                                           | `prisma/seed.ts`                                                                                           |
| Página de resultados                                                               | `src/app/`               | Resolver, decidir 404/cerrada/vacío, llamar a la lectura, componer y programar el registro con `after()`                                 | src/app/[slug]/buscar/page.tsx (etapa 5, por crear)                                                        |
| Caja de búsqueda (`<form method="get">`, server component)                         | `src/components/store/`  | E18, R14. La usan la página de resultados **y** `src/app/[slug]/page.tsx`                                                                | src/components/store/StoreSearchBox.tsx (etapa 5, por crear)                                               |
| Lista de resultados por capas + pie de paginación                                  | `src/components/store/`  | Compone `src/components/store/ProductCard.tsx`; no inventa tarjeta                                                                       | src/components/store/StoreSearchResults.tsx (etapa 5, por crear)                                           |
| Modelo `StoreSearchQuery` + 2 columnas de `StoreProduct` + 2 índices GIN + relleno | `prisma/`                | El delta de datos, en **una** migración                                                                                                  | prisma/migrations/&lt;timestamp&gt;_store_product_search/migration.sql (etapa 3, por crear)                |
| Fixtures ampliadas                                                                 | `src/features/*/server/` | `createLocalCategory`, `createGlobalCategory`, overrides de `description`/categoría en `createOffer`, y `createFillerOffers(n)` para SP4 | `src/features/marketplace/server/dbFixtures.ts`                                                            |
| Pruebas de la búsqueda de tienda contra Postgres real                              | `src/features/*/server/` | Criterios 1–8, 10, 12 y E1–E12                                                                                                           | src/features/catalog/server/search.db.test.ts (etapa 6, por crear)                                         |
| Guardas ampliadas                                                                  | `src/features/*/server/` | G1–G5 actualizadas + G6/G7 nuevas (I4)                                                                                                   | `src/features/marketplace/server/boundaries.test.ts`                                                       |

Cero `"use client"` nuevos. Cero módulos de cliente. `scripts/check-bundle-budget.mjs`
no se mueve de 193 KB (criterio 11).

## Flujo de datos

### Escritura del índice — quién recalcula y cuándo (R3, ADR 0007)

La pieza clave: **nadie le pasa texto al reindexador**. Recibe un selector de
filas y recompone el documento leyendo la base. Por eso el sync no puede pisar
`description` y el panel no puede pisar `localName`: ninguno de los dos escribe
lo que no es suyo, solo dispara el recálculo de una columna que no es de
ninguno.

```
SYNC — src/features/sync/server/handlers/product.ts
  guarda anti-rancio ─► STALE ─► fin, sin reindexar            (spec § Casos límite)
  DELETE / publishToStore=false ─► soft delete ─► fin, sin reindexar
  create|update de StoreProduct (data estrecho, sin tocar el índice)
  recordCanonicalBarcodes
  recordAlias  (useCount++ o alias nuevo, y el documento del CANÓNICO como hoy)
  reindexStoreProductsOfCanonical(prisma, canonicalId, businessId)   ← +1 round trip
        └─ cubre esta oferta Y las hermanas del mismo negocio, que
           acaban de heredar el alias nuevo (R2). El resto sale a 0 filas.

PANEL — src/features/admin/server/mutations.ts :: saveProduct
  update tipado con PanelProductWrite (las seis columnas de siempre)
  reindexStoreProduct(prisma, storeProductId)                        ← +1 round trip
  commit() revalida los tags de la tienda, como siempre

SEED — prisma/seed.ts
  storeProduct.upsert(...)
  reindexStoreProduct(prisma, producto.id)   ← una base recién sembrada es buscable
```

Tres propiedades que hay que mantener y que este flujo da gratis:

- **Idempotente.** El `WHERE` de la sentencia (`IS DISTINCT FROM` + `IS NULL`)
  hace que repetir la llamada afecte 0 filas.
- **Guardado contra escrituras rancias.** No se duplica: vive donde ya está, en
  el `return STALE` del handler, que corta antes de llegar aquí.
- **No hay documento a medias.** Documento y vector se escriben en la **misma**
  sentencia y desde la misma subconsulta, así que jamás quedan cruzados (la
  trampa de ADR 0004 y la propiedad que ADR 0019 (b) ya estableció para el
  canónico).

### Lectura — la petición completa

```
GET /[slug]/buscar?q=…&p=…
  requireResolution(slug)
    ├─ null                     ─► 404
    └─ kind === "selector"      ─► notFound()                                   (E13)
  requireStore(resolution)
    ├─ DRAFT                    ─► 404
    └─ status !== PUBLISHED     ─► StoreClosedNotice + BranchBar, SIN consultar  (E14)
  normalizeSearchTerm(q)
    └─ null                     ─► 200 con la caja y su ayuda, SIN consultar
                                     y SIN fila de registro                      (E10)
  Promise.all([
     searchStoreProducts({ storeId, term, page }),   ← 1 round trip (Q1)
     prisma.promotion.findMany(...)  dentro de la misma lectura,
     getStoreRates(resolution),                      ← cacheado por tag
  ])
  render (server components, 0 KB de cliente)
  after(() => recordStoreSearchQuery({ storeId, term, resultCount }))            (R13, E16)
```

`after()` es de `next/server` y está pensado exactamente para esto: se ejecuta
cuando la respuesta ya salió, y corre **aunque** el render haya lanzado o
llamado a `notFound` —por eso se programa después de tener el resultado, no
antes—. La página es dinámica porque lee `searchParams`; se declara además
`export const dynamic = "force-dynamic"` **como literal** (`AGENTS.md` § Cosas
que muerden: los segment config se analizan estáticamente).

## Contratos

### Lo que `sdd-designer` puede dar por disponible

Esta es la interfaz que la página le pasa a los componentes de presentación. El
componente visual no es mío; **lo que hay dentro de estos tipos, sí**.

```ts
// src/features/catalog/server/search.ts (etapa 4, por crear)
import type { CatalogProduct } from "./queries";

/** R1: 1 = léxica, 2 = difusa, 3 = expansión por categoría. El orden de los
 *  resultados YA respeta esto; el número está para que la vista pueda
 *  agrupar y titular, no para que reordene. */
export type StoreSearchLayer = 1 | 2 | 3;

/** EXACTAMENTE lo que `ProductCard` ya sabe pintar, más la capa.
 *  Nada de duplicar la interfaz (AGENTS.md § Prohibiciones). */
export type StoreSearchItem = CatalogProduct & { layer: StoreSearchLayer };

export type StoreSearchInput = {
  storeId: string; // R6: obligatorio, no un filtro que se pueda olvidar
  term: string; // ya normalizado por normalizeSearchTerm
  page?: number; // 1-based, acotado por clampSearchPage
};

export type StoreSearchResult = {
  /** El término normalizado con el que se buscó de verdad (R9, E11): es lo
   *  que la caja debe volver a mostrar y lo que se registra. */
  term: string;
  /** Ya ordenado por capa, puntuación, nombre e identificador (R10). */
  items: StoreSearchItem[];
  /** Total de las tres capas ANTES de paginar (R4: es lo que se registra). */
  totalCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export async function searchStoreProducts(input: StoreSearchInput): Promise<StoreSearchResult>;
```

Y lo que la página le pasa además a la vista, porque `ProductCard` lo pide y ya
existe: `storeSlug` (el canónico), `displayCurrency` (`store.baseCurrencyCode`) y
`rates` (de `getStoreRates`).

Lo que **no** hay, dicho para que no se diseñe sobre ello:

- **No hay resaltado ni snippet.** `ts_headline` recompone el vector (I4) y
  obligaría a inyectar HTML. Si la vista quiere marcar la coincidencia, lo hace
  con el `term` que recibe, en el cliente del render de servidor (comparación de
  texto plano), o no lo hace. **Recomendación: no hacerlo en este ciclo.**
- **No hay facetas, filtros ni ordenaciones**: fuera de alcance por la spec.
- **No hay «quizás quisiste decir»**: fuera de alcance por la spec.
- **No hay contador por capa**, solo `totalCount`. Contar por capa se deriva de
  `items` en la vista si hace falta un título tipo «12 coincidencias».
- **La capa 3 puede venir vacía** y es lo normal en una tienda sin categorías: la
  vista no puede asumir que siempre hay una tercera sección.
- **Un agotado sí aparece** (R7, E6) con su distintivo, como en el catálogo.

### El escritor derivado

```ts
// src/features/catalog/server/searchIndex.ts (etapa 2, por crear)
export type SearchIndexWriter = Pick<PrismaClient, "$executeRaw">;

/** Recalcula documento + vector de UNA oferta desde su estado actual.
 *  Devuelve las filas afectadas: 0 significa «ya estaba así» (idempotencia). */
export function reindexStoreProduct(db: SearchIndexWriter, storeProductId: string): Promise<number>;

/** Lo mismo para todas las ofertas de un negocio sobre un canónico — el
 *  abanico que abre un alias nuevo (R2). Una sola sentencia. */
export function reindexStoreProductsOfCanonical(
  db: SearchIndexWriter,
  canonicalProductId: string,
  businessId: string,
): Promise<number>;
```

```ts
// src/features/catalog/server/searchLog.ts (etapa 4, por crear)
/** R4/R5. NUNCA lanza: un fallo se registra con console.warn y se traga (E16). */
export function recordStoreSearchQuery(input: {
  storeId: string;
  term: string;
  resultCount: number;
}): Promise<void>;
```

### Constantes

```ts
// src/constants/search.ts (etapa 1, por crear) — compartidas (I7)
export const SEARCH_TS_CONFIG = "spanish";
export const SEARCH_TERM_MAX_LENGTH = 120;
/** Separa las tres partes del documento de una oferta. Viaja LIGADO al SQL,
 *  nunca interpolado, y el migration.sql repite el literal (guarda G7). */
export const SEARCH_DOCUMENT_SEPARATOR = " · ";

// src/constants/storeSearch.ts (etapa 1, por crear)
export const STORE_SEARCH_PAGE_SIZE = 24;
/** Tope de candidatos por capa antes de ordenar. Acota el coste de una
 *  consulta muy común sin cambiar el orden de lo que sí se devuelve. */
export const STORE_SEARCH_LAYER_MAX = 200;
/** La capa 3 no puede inundar el resultado: es contexto, no coincidencia. */
export const STORE_SEARCH_EXPANSION_MAX = 24;
/** Pesos de ts_rank, EN EL ORDEN QUE EXIGE POSTGRES: [D, C, B, A].
 *  A = localName, B = alias, C = description, D sin usar. Se afinan con el
 *  registro de consultas (spec § No decidido a propósito); están aquí para
 *  que afinarlos sea una línea y no un rediseño del SQL. */
export const STORE_SEARCH_RANK_WEIGHTS = [0.1, 0.4, 0.7, 1.0] as const;
/** Techo de paginación: acota el OFFSET profundo (§ Escalabilidad). */
export const STORE_SEARCH_MAX_PAGE = 50;
```

### SQL — W3, el reindexado de una oferta

Una sentencia, un round-trip, las dos columnas a la vez. El `<selector>` es lo
único que cambia entre las dos funciones exportadas.

```sql
UPDATE "StoreProduct" sp
   SET "searchDocument" = d."doc",
       "searchVector"   = setweight(to_tsvector($1::regconfig, unaccent(d."namePart")),  'A')
                       || setweight(to_tsvector($1::regconfig, unaccent(d."aliasPart")), 'B')
                       || setweight(to_tsvector($1::regconfig, unaccent(d."descPart")),  'C')
  FROM (
        SELECT x."id",
               x."localName"                  AS "namePart",
               coalesce(a."texts", '')        AS "aliasPart",
               coalesce(x."description", '')  AS "descPart",
               unaccent(concat_ws($2,
                          x."localName",
                          coalesce(a."texts", ''),
                          coalesce(x."description", ''))) AS "doc"
          FROM "StoreProduct" x
          JOIN "Store" s ON s."id" = x."storeId"
          LEFT JOIN LATERAL (
                 SELECT string_agg(DISTINCT al."text", $2 ORDER BY al."text") AS "texts"
                   FROM "ProductAlias" al
                  WHERE al."canonicalProductId" = x."canonicalProductId"
                    AND al."businessId"         = s."businessId"
               ) a ON TRUE
         WHERE <selector>          -- x."id" = $3
                                   -- | x."canonicalProductId" = $3 AND s."businessId" = $4
       ) d
 WHERE sp."id" = d."id"
   AND (sp."searchDocument" IS DISTINCT FROM d."doc" OR sp."searchVector" IS NULL);
```

Por qué así:

- **`concat_ws` + `coalesce('')` deja siempre las tres ranuras**, así que un
  producto sin descripción y sin alias tiene por documento su `localName` a
  secas (fila de § Casos límite de la spec) y el separador sigue marcando dónde
  empieza cada parte.
- **El documento se guarda ya sin acentos** (`unaccent(...)`), y por eso el
  índice trigram puede ser un índice de **columna**. Un índice de expresión sobre
  `unaccent(...)` es imposible: no es inmutable (ADR 0019 § Contexto). El vector
  no pierde nada: `to_tsvector` normaliza igual.
- **`string_agg(DISTINCT … ORDER BY …)`** hace el documento determinista: sin
  `ORDER BY`, dos ejecuciones podrían producir textos distintos con los mismos
  datos y el `IS DISTINCT FROM` escribiría para siempre.
- **No se toca `updatedAt`.** No cambió ningún dato de la fila, solo su índice;
  y `updatedAt` de `StoreProduct` no es la guarda del sync (esa es
  `sourceUpdatedAt`), así que moverlo sería ruido.
- **Los alias se filtran por el negocio DE LA TIENDA**, no por cualquiera: R2
  dice «los `ProductAlias` de **ese** negocio».
- **No incluye códigos de barras** (F-024 R9) **ni el nombre de la tienda** (R2).
  Tampoco la descripción del canónico: R2 enumera tres fuentes y son esas tres.

### SQL — Q1, la lectura de tres capas

```sql
WITH lex AS (
      SELECT sp."id",
             1::int AS "layer",
             ts_rank($1::float4[], sp."searchVector",
                     plainto_tsquery($2::regconfig, unaccent($3))) AS "score"
        FROM "StoreProduct" sp
        JOIN "Store" s ON s."id" = sp."storeId"
       WHERE sp."storeId"  = $4
         AND sp."deletedAt" IS NULL
         AND sp."visible"   = TRUE
         AND s."status"     = $5::"StoreStatus"
         AND sp."searchVector" @@ plainto_tsquery($2::regconfig, unaccent($3))
       ORDER BY "score" DESC, sp."localName" ASC, sp."id" ASC
       LIMIT $6::int
),
fuz AS (
      SELECT sp."id",
             2::int AS "layer",
             word_similarity(unaccent($3), sp."searchDocument") AS "score"
        FROM "StoreProduct" sp
        JOIN "Store" s ON s."id" = sp."storeId"
       WHERE sp."storeId"  = $4
         AND sp."deletedAt" IS NULL
         AND sp."visible"   = TRUE
         AND s."status"     = $5::"StoreStatus"
         AND sp."searchDocument" %> unaccent($3)
         AND sp."id" NOT IN (SELECT "id" FROM lex)
       ORDER BY "score" DESC, sp."localName" ASC, sp."id" ASC
       LIMIT $6::int
),
core AS (SELECT * FROM lex UNION ALL SELECT * FROM fuz),
keys AS (
      SELECT DISTINCT
             cp."globalCategoryId" AS "gid",
             CASE WHEN cp."globalCategoryId" IS NULL THEN sp."localCategoryId" END AS "lid"
        FROM core c
        JOIN "StoreProduct" sp     ON sp."id" = c."id"
        JOIN "CanonicalProduct" cp ON cp."id" = sp."canonicalProductId"
),
exp AS (
      SELECT sp."id", 3::int AS "layer", 0::float4 AS "score"
        FROM "StoreProduct" sp
        JOIN "Store" s             ON s."id"  = sp."storeId"
        JOIN "CanonicalProduct" cp ON cp."id" = sp."canonicalProductId"
       WHERE sp."storeId"  = $4
         AND sp."deletedAt" IS NULL
         AND sp."visible"   = TRUE
         AND s."status"     = $5::"StoreStatus"
         AND sp."id" NOT IN (SELECT "id" FROM core)
         AND (
              (cp."globalCategoryId" IS NOT NULL
               AND cp."globalCategoryId" IN (SELECT "gid" FROM keys WHERE "gid" IS NOT NULL))
           OR (cp."globalCategoryId" IS NULL
               AND sp."localCategoryId" IN (SELECT "lid" FROM keys WHERE "lid" IS NOT NULL))
         )
       ORDER BY sp."featured" DESC, sp."localName" ASC, sp."id" ASC
       LIMIT $7::int
),
hits AS (SELECT * FROM core UNION ALL SELECT * FROM exp)
SELECT sp."id", sp."slug", sp."localName", sp."description", sp."imageUrls",
       sp."availability", sp."featured", sp."localCategoryId",
       sp."syncedPrice", sp."syncedPriceCurrency",
       sp."priceOverride", sp."priceOverrideCurrency",
       lc."name"        AS "categoryName",
       cp."description" AS "canonicalDescription",
       cp."imageUrl"    AS "canonicalImageUrl",
       h."layer",
       count(*) OVER () AS "totalCount"
  FROM hits h
  JOIN "StoreProduct" sp     ON sp."id" = h."id"
  JOIN "CanonicalProduct" cp ON cp."id" = sp."canonicalProductId"
  LEFT JOIN "LocalCategory" lc ON lc."id" = sp."localCategoryId"
 ORDER BY h."layer" ASC, h."score" DESC, sp."localName" ASC, sp."id" ASC
 LIMIT $8::int OFFSET $9::int;
```

Parámetros, todos ligados (R11, E12): `$1` `STORE_SEARCH_RANK_WEIGHTS`, `$2`
`SEARCH_TS_CONFIG`, `$3` el término normalizado, `$4` el `storeId`, `$5`
`StoreStatus.PUBLISHED` importado del cliente generado y con su cast, `$6`
`STORE_SEARCH_LAYER_MAX`, `$7` `STORE_SEARCH_EXPANSION_MAX`, `$8`
`STORE_SEARCH_PAGE_SIZE`, `$9` `(page - 1) * STORE_SEARCH_PAGE_SIZE`.

Por qué esta forma:

- **R1 es estructural.** El número de capa es un literal por CTE y el `ORDER BY`
  final empieza por él. Cambiar la puntuación interna de una capa no puede mover
  un resultado de capa.
- **R12 se cumple literalmente**: el predicado va contra la columna
  (`sp."searchVector" @@ …`), nunca contra un `to_tsvector(...)` recalculado —
  eso dejaría el GIN sin usar y es lo que el criterio 8 existe para pescar.
- **R8**: `plainto_tsquery`, que no lanza nunca con texto de una persona (E12).
- **`%>` y no `%`**: `word_similarity` mide el **mejor tramo** del documento, así
  que una descripción larga no diluye la coincidencia con el nombre. Es lo que
  hace que «cocacola» encuentre «Coca-Cola 1.5 L» (E4) con el umbral por defecto
  de `pg_trgm` (0.6). Con la columna indexada a la izquierda para que el GIN
  trigram entre.
- **R17 sin mezclar**: la clave de categoría de cada producto es exactamente una,
  la global del canónico **o** la local de la oferta, y la pertenencia se
  comprueba contra el conjunto de claves del mismo tipo. Un producto con global
  nunca entra por la local ni al revés.
- **R10, orden total**: capa, puntuación, nombre, identificador. `id` es único,
  así que dos páginas nunca repiten ni saltan (E15).
- **R4 sin segunda consulta**: `count(*) OVER ()` se evalúa antes del `LIMIT`, así
  que da el total exacto del conjunto (con los topes de capa ya aplicados: es el
  total **de la consulta**, que es lo que la spec pide registrar).
- **R7 gemelo del catálogo**: `deletedAt IS NULL`, `visible = TRUE`,
  `Store.status = PUBLISHED`, y **nada** sobre `availability`. Va comentado en el
  código apuntando a `src/features/catalog/server/queries.ts`: si uno cambia, el
  otro también.
- **`NOT IN` sobre CTEs pequeños**, no `EXCEPT` ni `LEFT JOIN … IS NULL`: los
  conjuntos están acotados por `STORE_SEARCH_LAYER_MAX` y así se lee.
- **Las promociones no entran en esta sentencia.** Se leen en paralelo con
  `prisma.promotion.findMany({ where: { storeId, active: true } })` y se cruzan
  con `indexPromotions`, exactamente como hace `loadCatalog`. Meterlas aquí
  multiplicaría filas o exigiría un `GROUP BY` que no aporta nada.

### Errores

| Situación                                     | Comportamiento                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Slug inexistente o retirado                   | 404 por `requireResolution`                                                                          |
| Slug en modo selector                         | `notFound()` (E13), igual que `src/app/[slug]/p/[productSlug]/page.tsx`                              |
| Tienda `DRAFT`                                | 404 por `requireStore`                                                                               |
| Tienda `SUSPENDED`                            | 200 con el aviso de cerrada; **ninguna** consulta de catálogo ni de búsqueda (E14)                   |
| `q` ausente/vacía/espacios/puntuación         | 200 con la caja y su ayuda; sin consulta y sin fila de registro (E10)                                |
| `q` de un carácter alfanumérico               | Es una consulta: se ejecuta y se registra                                                            |
| `q` de miles de caracteres                    | Truncada a `SEARCH_TERM_MAX_LENGTH`, 200 (E11)                                                       |
| `q` con `&`, `\|`, `!`, `:*`, comillas        | `plainto_tsquery` + parámetro ligado: resultado o vacío, nunca 500 (E12, R8)                         |
| `p` ausente, 0, negativa, no numérica, enorme | `clampSearchPage` la lleva a `[1, STORE_SEARCH_MAX_PAGE]`; nunca llega cruda al SQL                  |
| Cero resultados                               | 200 con el vacío explicado y **una** fila con `resultCount = 0` (E5)                                 |
| Falla la escritura del registro               | Se traga con `console.warn`; la respuesta ya salió (E16, R13)                                        |
| Base caída al buscar                          | El error se propaga y lo pinta `src/app/error.tsx`. **No** hay `catch` que devuelva vacío (E17, R16) |

No hay tabla de códigos: no hay ruta HTTP propia, es una página.

## Modelo de datos y migraciones

### Cambios en `prisma/schema.prisma`

En `StoreProduct`, un tercer bloque además de los dos que ya están («owned by the
sync» y «owned by the admin panel»), y el comentario es parte del diseño:

```prisma
  // --- derived search index (F-021): owned by NEITHER side ---
  /// Concatenated, ALREADY UNACCENTED searchable text:
  /// localName · this business's aliases for the canonical · description.
  /// Never written by the sync's or the panel's typed `data`: both of them
  /// call the reindexer, which recomputes it from the row's current state.
  /// That is what makes ADR 0007's ownership hold in both directions.
  searchDocument String                   @default("")
  /// Weighted tsvector: A = localName, B = aliases, C = description.
  /// Unsupported: written with raw SQL (ADR 0019). GIN index in the migration.
  searchVector   Unsupported("tsvector")?
```

Modelo nuevo, con las tres cosas de R5 y nada más:

```prisma
/// F-021 (R4, R5): one row per search that reached the database. Three
/// columns and the instant, on purpose: no IP, no user agent, no person.
/// A query that never reached the database (E10) leaves nothing here.
/// Retention/anonymisation is deliberately out of this feature's scope.
model StoreSearchQuery {
  id          String   @id @default(uuid())
  storeId     String
  /// Already normalized (R9), never as it arrived.
  term        String
  /// Total of the three layers, not the page.
  resultCount Int
  createdAt   DateTime @default(now())

  store Store @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@index([storeId, createdAt])
}
```

y en `Store`, la contraparte de la relación: `searchQueries StoreSearchQuery[]`.

### La migración, y cómo esquiva I8

**Una sola carpeta**, prisma/migrations/&lt;timestamp&gt;_store_product_search/migration.sql
(etapa 3, por crear), con cinco cosas en este orden:

1. `ALTER TABLE "StoreProduct" ADD COLUMN "searchDocument" TEXT NOT NULL DEFAULT ''`
   y `ADD COLUMN "searchVector" tsvector` (lo genera `migrate dev`).
2. `CREATE TABLE "StoreSearchQuery"` + su índice + su FK (lo genera `migrate dev`).
3. **A mano**, los dos índices que Prisma no puede declarar:
   ```sql
   CREATE INDEX "StoreProduct_searchVector_idx"
     ON "StoreProduct" USING GIN ("searchVector");
   CREATE INDEX "StoreProduct_searchDocument_trgm_idx"
     ON "StoreProduct" USING GIN ("searchDocument" gin_trgm_ops);
   ```
4. **A mano**, el relleno: la sentencia W3 **sin selector y sin el `WHERE` de
   idempotencia** (corre una vez, sobre toda la tabla), con el diccionario y el
   separador como literales `'spanish'` y `' · '` —un `.sql` no puede importar una
   constante—. Sin esto, una base existente queda con todas las ofertas
   invisibles para el buscador hasta que alguien las toque.
5. Una cabecera de comentario que diga que el archivo **no** es la salida cruda
   de `prisma migrate diff` y por qué, igual que hace
   `prisma/migrations/20260828045433_canonical_barcode/migration.sql`.

**El procedimiento, que es donde muerde I8** (ficha
`.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md`):

```
1. editar prisma/schema.prisma
2. npx prisma migrate dev --create-only --name store_product_search
3. ABRIR el migration.sql generado y BORRAR todo DROP INDEX de:
     CanonicalProduct_searchVector_idx
     CanonicalProduct_name_trgm_idx
     StoreProduct_visible_catalog_idx      ← comprobar: es parcial y tampoco
                                             está declarado; si el diff lo
                                             propone, se borra igual
4. añadir a mano los puntos 3 y 4 de arriba
5. npx prisma migrate dev   (aplica el archivo YA editado)
6. npx prisma generate && bash .agent/verify.sh F-021 --full
```

Ninguno de los dos comandos prohibidos (`prisma migrate reset`, `prisma db push`)
aparece en este camino. Dos avisos para quien lo ejecute:

- **La lista de índices no declarados pasa de tres a cinco** después de esta
  migración. La ficha del playbook nombra solo dos: hay que **ampliarla** al
  cerrar el feature, o la próxima migración se llevará por delante los índices
  que F-021 acaba de crear.
- La base de desarrollo está compartida entre worktrees: aplicar aquí adelanta
  `_prisma_migrations` para los demás (ficha
  `.agent/playbook/prisma-migrate-dev-checksum-drift-bd-compartida.md`). Es
  inevitable —F-021 sí cambia el schema— y por eso va dicho, no en silencio.

### El delta del seed (SP3)

En `prisma/seed.ts`, tres cambios, todos idempotentes y **sin mover el número de
canónicos ni de `StoreProduct`** (lo que F-024 fijó en C4/C9):

1. Una constante `GLOBAL_CATEGORIES` con las cuatro que espejan a las locales que
   el seed ya siembra —`bebidas`, `alimentos`, `aseo`, `panaderia`— y un
   `globalCategory.upsert` por `slug` (que ya es `@unique`).
2. En `upsertCanonical`, asignar `globalCategoryId` **solo a los canónicos con
   `ean`**. Un canónico huérfano (`isExclusive: true`) está fuera del marketplace
   por definición y la taxonomía global es del marketplace; además así el seed
   deja en desarrollo un caso natural de la otra mitad de la cascada —«Jugo de
   mango 1 L», sin EAN, con categoría local `Bebidas`—.
3. Rellenar también `LocalCategory.globalCategoryId` de las cuatro locales. No lo
   lee la consulta de F-021, pero deja la taxonomía coherente y es lo que el día
   de mañana convierte la cascada en tres escalones sin volver a tocar el seed.

Con eso, el criterio 2 se verifica sobre el seed: buscar «Refresco de cola 1.5 L»
en la tienda 1 devuelve ese producto en la posición 1 y arrastra «Agua natural
500 ml» y «Cerveza Cristal» por `GlobalCategory` bebidas, ninguno de los cuales
casa por texto. E2b se verifica en su propia prueba con `globalCategoryId` a
nulo, como la propia spec anticipa.

## Escalabilidad y límites

Hoy: ~20 `StoreProduct` sembrados, 4 categorías locales, 0 filas de
`GlobalCategory` y 0 de registro.

**Por búsqueda** (camino crítico): **2 round-trips** no cacheados —Q1 y las
promociones, en paralelo— más los aciertos de caché de la resolución del slug, la
tienda y las tasas. El registro es **1 sentencia fuera del camino crítico**
(`after()`). 0 N+1: Q1 es una sentencia y las promociones son una lista por
tienda, no por producto.

**Tamaño de la respuesta:** 24 items × ~400 B ≈ **10 KB** de datos, ~50 KB de
HTML. **0 KB de JavaScript de cliente nuevo**: `scripts/check-bundle-budget.mjs`
no se mueve de 193 (criterio 11).

**Por evento `PRODUCT` del sync:** de ~6-7 round-trips a **7-8**. Uno más, y solo
en el camino que de verdad escribió algo (STALE y DELETE salen antes).

**Por guardado del panel:** de 1 a 2 round-trips.

**A 100×** (≈500 tiendas × 500 productos → 250 000 `StoreProduct`), en orden de
lo que se rompe primero:

1. **Un término muy común, por el GIN global.** El índice
   `StoreProduct_searchVector_idx` no sabe de tiendas: «agua» casa 20 % de la
   tabla (50 000 filas), el bitmap se recorre entero y el filtro por `storeId`
   descarta el 99.8 %. Umbral: **~10 000 filas casadas en toda la tabla**, a
   partir de ahí la capa léxica pasa de ~10 ms a 200-500 ms. **Plan B, ya
   diseñado:** `CREATE EXTENSION btree_gin` y un índice compuesto
   `GIN ("storeId", "searchVector")`, que mete el filtro de tienda dentro del
   índice. Es una migración y cero cambios de código. No se hace hoy porque
   añade una extensión de Postgres a producción por un problema que aún no
   existe.
2. **La capa difusa, por lo mismo y antes.** Los bitmaps trigram son más anchos
   que los de `tsvector`. Umbral estimado: **~5 000 filas** con documento
   parecido. Mismo plan B, o restringir la capa difusa a los términos de una sola
   palabra.
3. **`StoreSearchQuery` crece sin techo.** 500 tiendas × 200 búsquedas/día =
   **100 000 filas/día ≈ 36 M/año**, del orden de **5 GB/año** con su índice. No
   estorba a la búsqueda (nadie lee esa tabla en línea) pero sí al backup y al
   `autovacuum`. La política de retención está **fuera de este ciclo por decisión
   del humano**; el número queda escrito aquí para cuando la reabra.
4. **`OFFSET` profundo.** Acotado por construcción: `STORE_SEARCH_MAX_PAGE = 50`
   → `OFFSET` máximo 1 176. El día que haga falta más, keyset sobre
   `(layer, score, localName, id)`.
5. **Escrituras al GIN.** Cada reindexado escribe en dos índices GIN. Con
   `fastupdate` por defecto lo absorbe el autovacuum; a partir de ~10 000
   eventos/minuto habría que medirlo. Hoy el sync procesa lotes de decenas.

**Pooler.** Ninguna pieza abre `$transaction`: cada sentencia es su propio
round-trip (`AGENTS.md` § Cosas que muerden, ficha
`.agent/playbook/pooler-transaccion-deadlock.md`).

**Caché e ISR.** La página de búsqueda **no entra** en `src/lib/cache.ts` y no
tiene tag: depende de `searchParams` (R15). `src/proxy.ts` **no se toca**: su
`matcher` sigue cubriendo solo `/admin`, y hacerlo tocar `/[slug]` anularía el
ISR de todo el escaparate. La caja de búsqueda que se añade a
`src/app/[slug]/page.tsx` es HTML estático dentro de la página ya cacheada: no
la vuelve dinámica.

**Conexiones en las pruebas.** El techo declarado por ADR 0019 son 6 archivos
`*.db.test.ts`; hoy hay 2 y F-021 añade 1 → **3**. Sigue holgado.

## Cómo se verifica cada pieza

Para que `sdd-tester` no parta de cero. `*.test.ts` = proyecto `server`
(mockeado); `*.db.test.ts` = proyecto `db` (Postgres real, ADR 0019 (c): **no se
salta, falla**).

| Pieza                        | Prueba                                                                                                                                                                                   | Cubre                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `clampSearchPage`            | Unidad pura en `src/lib/searchTerm.test.ts`: ausente, 0, negativa, `"abc"`, 1e9 → todas dentro de `[1, MAX]`                                                                             | Caso límite de `p`                              |
| Reindexado (sync)            | `db`: `handleProduct` con `UPDATE` que cambia `localName` → buscar la palabra nueva la encuentra y la vieja ya no es la única entrada                                                    | **Criterio 10**, E9                             |
| Reindexado (sync, rancio)    | `server` mockeado: payload rancio → el reindexador **no se llama**                                                                                                                       | § Casos límite                                  |
| Reindexado (panel)           | `db`: buscar «artesanal» → 0; `saveProduct` con esa descripción; buscar → 1, sin nada entre medias                                                                                       | **Criterio 6**, E8                              |
| Reindexado (idempotencia)    | `db`: dos llamadas seguidas → la segunda devuelve 0 filas afectadas                                                                                                                      | § Casos límite                                  |
| Reindexado (no pisa al otro) | `db`: guardar descripción en el panel no cambia `localName`; un evento del sync no cambia `description`; el documento acaba con **las dos**                                              | R3, ADR 0007                                    |
| Capa 1                       | `db`: nombre exacto → posición 1                                                                                                                                                         | **Criterio 1**, E1                              |
| Capa 3 (global)              | `db` sobre el seed o fixture con `globalCategoryId`: otro producto de la misma global aparece y **no** casaba por texto                                                                  | **Criterio 2**, E2                              |
| Capa 3 (local)               | `db` con `globalCategoryId` a nulo en todos: entra por `LocalCategory`                                                                                                                   | E2b, R17                                        |
| Acentos                      | `db`: «refresco» y «refrescó» → `expect(a).toEqual(b)` sobre la lista completa de ids **en orden**                                                                                       | **Criterio 3**, E3                              |
| Difusa                       | `db`: «cocacola» encuentra «Coca-Cola 1.5 L»                                                                                                                                             | **Criterio 4**, E4                              |
| Aislamiento por tienda       | `db`: dos tiendas con el mismo producto; buscar en A no devuelve nada de B, tampoco por difusa ni por categoría                                                                          | **Criterio 5**, E7                              |
| Visibilidad                  | `db`: `visible=false` y `deletedAt` no aparecen; `OUT_OF_STOCK` **sí**                                                                                                                   | E6, R7                                          |
| Registro                     | `db`: contar antes/después de una búsqueda sin coincidencias → +1 con `resultCount = 0` y el `storeId` correcto                                                                          | **Criterio 7**, E5                              |
| Registro no rompe            | `server`: `recordStoreSearchQuery` con un cliente que lanza → resuelve sin lanzar                                                                                                        | E16, R13                                        |
| Registro no se escribe       | `server`: término que normaliza a `null` → ni consulta ni fila                                                                                                                           | E10                                             |
| Texto hostil                 | `db`: `&                                                                                                                                                                                 | !:*` y comillas sin cerrar → responde sin error | **Criterio 12**, E12 |
| Paginación                   | `db`: página 1 y 2 con más resultados que el tope → sin repetidos y sin huecos                                                                                                           | E15, R10                                        |
| `EXPLAIN`                    | `db` con fixture de volumen: el plan **no** contiene `Seq Scan` sobre `StoreProduct` y **sí** nombra `StoreProduct_searchVector_idx` y `StoreProduct_searchDocument_trgm_idx`. Ver abajo | **Criterio 8**                                  |
| Página                       | `*.test.tsx` o `db`: `GET /[slug]/buscar?q=…` 200 y los nombres en el HTML; selector → 404; `SUSPENDED` → aviso sin consulta                                                             | **Criterio 11**, E13, E14, E18                  |
| Presupuesto                  | `node scripts/check-bundle-budget.mjs` sigue en 0                                                                                                                                        | **Criterio 11**, R14                            |
| Guardas                      | `src/features/marketplace/server/boundaries.test.ts` con G1–G7                                                                                                                           | I4                                              |
| Sensor completo              | `bash .agent/verify.sh F-021 --full`                                                                                                                                                     | **Criterio 9**                                  |

### El fixture de volumen del criterio 8 (SP4)

Sigue el precedente exacto de `src/features/orders/server/pull.db.test.ts`
(líneas 98-141), con **una diferencia obligada por la spec**: `enable_seqscan = off`
queda **descartado por escrito**, así que el fixture tiene que ser suficiente por
sí solo.

- `createFillerOffers(n)` en `src/features/marketplace/server/dbFixtures.ts`:
  inserta `n` `StoreProduct` con `createMany` y los reindexa con **una** llamada
  a la variante por canónico, con el token de la ejecución dentro del
  `localName` (ADR 0019 (d)).
- **Punto de partida: 2 000 filas**, ~1 000 en la tienda de la sesión y ~1 000 en
  una tienda de relleno de otro negocio, seguidas de `ANALYZE "StoreProduct"`.
  Las dos mitades hacen falta: las de otra tienda para que `storeId` sea
  selectivo, las propias para que el GIN gane a recorrer el índice de la tienda.
- **El volumen se mide y se anota en la prueba**, y se busca el más pequeño que
  cambie el plan (recomendación literal de SP4). Si 2 000 no bastan, se sube; si
  500 bastan, se baja. Lo que no se hace es tocar `enable_seqscan`.
- El `EXPLAIN` se corre sobre **la sentencia exacta que ejecuta el código**, con
  `EXPLAIN (FORMAT JSON)` y recorriendo el árbol de nodos, no con un `toContain`
  sobre texto: Q1 tiene CTEs y un `Seq Scan` sobre `LocalCategory` (4 filas) es
  legítimo — el aserto es «ningún `Seq Scan` cuyo `Relation Name` sea
  `StoreProduct`».

## Patrones a seguir / antipatrones a evitar

- **Prisma solo en `features/*/server/`** (`AGENTS.md` § Arquitectura). El SQL
  crudo no es excepción (ADR 0019 (a)). En `src/lib/` solo queda lo puro.
- **Nunca `$queryRawUnsafe`/`$executeRawUnsafe`** ni interpolar texto de una
  persona (R11). Todo con `Prisma.sql` y valores ligados, incluido el valor de
  enum con su cast (`$5::"StoreStatus"`), importado del cliente generado para que
  un renombrado rompa la compilación y no la búsqueda.
- **Nada de `$transaction`** (`AGENTS.md` § Cosas que muerden: el pooler corre en
  modo transacción).
- **`"use client"` jamás en algo que renderice catálogo** (`AGENTS.md` §
  Prohibiciones). La caja es un `<form method="get">` y la lista son componentes
  de servidor. Es la mitad estricta del presupuesto: el HTML tiene que bastar.
- **`export const dynamic` y `export const revalidate` son literales**
  (`AGENTS.md` § Cosas que muerden).
- **Ni un número ni una cadena mágica**: a src/constants/search.ts o
  src/constants/storeSearch.ts (`AGENTS.md` § Prohibiciones).
- **`any` es error de ESLint**: la fila cruda lleva tipo declarado y `count(*)`
  (`int8`) llega como `bigint | number | string` — se convierte a mano, como ya
  hace `src/features/marketplace/server/search.ts`.
- **No duplicar interfaces entre datos y vista**: el resultado es `CatalogProduct`
  más la capa, no un tipo paralelo.
- **Un archivo que todavía no existe no va entre comillas invertidas** — por eso
  en este documento los que se van a crear van en texto plano con «(por crear)»
  (`AGENTS.md` § Cosas que muerden; ya rompió el sensor en F-011 y F-017).
- **Antipatrones que este feature podría introducir y no debe:**
  - un `catch` en la búsqueda que devuelva `items: []` con la base caída (E17);
  - `to_tsvector(...) @@ …` en la consulta en vez de la columna (R12, G6);
  - escribir `searchDocument` desde un `data: { … }` tipado del panel o del sync
    (G1) — la columna es derivada y tiene un solo camino;
  - `await` del registro antes de responder (R13);
  - añadir `availability` al filtro de visibilidad «ya que estamos» (R7).

## Riesgos y plan B

| Riesgo                                                                                                                                                               | Plan B                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El umbral por defecto de `pg_trgm.word_similarity_threshold` (0.6) deja fuera alguna errata que E4 sí espera encontrar                                               | Es una constante de Postgres, no del código: si aparece un caso real, la capa difusa pasa a `word_similarity(...) >= x` **además** del `%>` (solo puede estrechar)                                                                      |
| El planificador prefiere `Seq Scan` con el volumen del fixture y el criterio 8 sale rojo con índices correctos                                                       | Subir el volumen del fixture, que es exactamente lo que SP4 decidió. `enable_seqscan = off` está descartado por la spec y no se reintroduce                                                                                             |
| `unaccent` vive en el esquema `extensions` en algún proyecto Supabase                                                                                                | La expresión está en un solo archivo (I4): cualificarla `public.unaccent` o fijar `search_path` es una línea. Ya es un riesgo conocido de F-015                                                                                         |
| Un `prisma migrate dev` futuro se lleva los **cinco** índices no declarados                                                                                          | Ampliar la ficha del playbook al cerrar F-021, de dos nombres a cinco. Va en el plan como paso, no como buena intención                                                                                                                 |
| El documento se guarda sin acentos y alguien lo lee esperando el texto original                                                                                      | Está escrito en el comentario de la columna del schema y en el módulo. No hay ningún lector: la vista pinta `localName`, nunca el documento                                                                                             |
| Dos partes distintas del documento producen la misma concatenación y el `IS DISTINCT FROM` se salta un reindexado                                                    | Exige que un `localName` o una descripción contengan literalmente `·`. Consecuencia máxima: los pesos quedan viejos, el texto no. Plan B: quitar la guarda y escribir siempre                                                           |
| Cuando exista un feature de clasificación, media tienda tendrá categoría global y la otra media no, y la capa 3 se **parte en dos conjuntos** que no se ven entre sí | Es fiel a R17, que manda dos escalones exactos. La solución es un escalón intermedio (`LocalCategory.globalCategoryId`, que el seed ya rellena) y pertenece a ese feature, no a este. Queda escrito para que quien lo abra lo encuentre |
| `src/features/marketplace/server/dbFixtures.ts` pasa a ser fixture de tres features y sigue con el prefijo `qab_f015_`                                               | El prefijo es un token de aislamiento, no una etiqueta. Moverlo a un `src/test/` común es una limpieza que no cabe en F-021; queda dicho, no hecho                                                                                      |
| El registro crece sin política de retención                                                                                                                          | Fuera de ciclo por decisión del humano. El número (§ Escalabilidad, punto 3) está para cuando lo reabra                                                                                                                                 |

## Incongruencias y notas para el orquestador

- **I4 e I7 quedan decididas aquí**, con su justificación, y ninguna sube al
  humano: son arquitectura pura, como la spec anticipó. Las dos hacen la guarda
  G2 **más** exigente, no menos.
- **El `plan.md` tiene que ordenar explícitamente el paso de editar el
  `migration.sql`** entre `--create-only` y aplicar. Si se ejecuta `migrate dev`
  de corrido, la búsqueda del marketplace (F-015) se queda sin índice GIN y nadie
  se entera hasta que la tabla crece.
- **Ampliar la ficha del playbook de dos a cinco índices** es un paso del plan,
  no una nota al pie.
- **F-015 se toca en cuatro archivos y en ninguno cambia de comportamiento**
  (renombrado y movimiento de I4/I7). Sus cuatro criterios se siguen verificando
  con las mismas pruebas. No hay que reabrir su spec.
- **El criterio 2 se verifica sobre el seed** gracias a SP3; E2b, sobre fixture.
  Son dos pruebas, no una.
- **Ninguna regla de la spec resultó imposible.** No hay nada que escalar a
  `sdd-spec`.
- **`sdd-designer` puede trabajar en paralelo**: § Contratos → «Lo que
  `sdd-designer` puede dar por disponible» es su entrada completa, y lo que **no**
  hay (resaltado, facetas, contadores por capa) está dicho allí para que no
  diseñe sobre humo.

## ¿Hace falta una ADR?

**Sí, una**, y es corta, porque extiende un modelo de propiedad que ya está
escrito en dos ADR y no lo contradice.

Propuesta (borrador, **no** escrito por mí: `docs/adr/` lo cierra el humano o el
orquestador, igual que se hizo con la 0019):

- **docs/adr/0021-el-indice-de-busqueda-de-una-oferta-es-derivado.md** (por
  crear) — Contexto: `ADR 0007` y `ADR 0017` reparten cada columna de
  `StoreProduct` entre el sync y el panel, y el documento de búsqueda de una
  oferta se alimenta de las **dos** mitades, así que no puede ser de ninguno.
  Decisión: (a) las columnas derivadas son una **tercera** categoría de
  propiedad, con su bloque propio en el schema y un escritor propio al que los
  otros dos solo **llaman**; (b) ese escritor recompone el valor leyendo la base,
  nunca recibiendo texto, que es lo que hace imposible que un lado pise al otro;
  (c) la pareja de expresiones `to_tsvector`/`plainto_tsquery` sube a un módulo
  compartido y la guarda de «exactamente un compositor» de ADR 0019 (b) se
  mantiene apuntando a él.

Si el humano prefiere no abrir ADR, la alternativa es una nota en
`docs/adr/0017-frontera-de-escritura-del-panel.md` § Cómo se hace cumplir. Lo
que no vale es dejarlo solo aquí: la tercera categoría de propiedad se va a
repetir en cuanto haya otra columna derivada.

## Preguntas al humano

**Ninguna.** I4 e I7 eran las dos decisiones pendientes y son de arquitectura;
están tomadas arriba con su porqué. SP1–SP4 las cerró el humano y este diseño no
las reabre. Nada de lo que hay aquí necesita un comando prohibido, cambia el
contrato con cuadrecaja ni sube el presupuesto de JavaScript.
