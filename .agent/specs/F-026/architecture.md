---
feature: F-026
agente: sdd-architect
actualizado: 2026-08-31T03:16:33Z
estado: listo
---

> Diseño sobre `.agent/specs/F-026/spec.md` en `estado: listo`. SP1–SP4 están
> cerradas por el humano el 2026-08-29 y no se reabren; la forma de la migración
> («aditiva, sin reset, con el `DROP INDEX` de los cinco GIN quitado a mano y el
> backfill en la misma migración») la cerró el humano el 2026-08-31 y este
> documento la escribe, no la discute.
>
> Este documento **decide los seis puntos** que la spec dejó a propósito en
> § «No decidido a propósito» para arquitectura: el pre-renderizado, la función
> de lectura, la derivación del selector, la invalidación, la migración e I8.
> Deja **una** pregunta al humano, `AP1`, que no bloquea el diseño sino el
> alcance de un archivo ajeno.

## Estado actual relevante

| Pieza                                                 | Qué aporta a F-026                                                                                                                                               |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/catalog/server/queries.ts`              | `loadCatalog` (el ÚNICO `WHERE` de visibilidad del catálogo, línea 194-198), `getStoreCatalog` cacheado por `storeCatalogTag`, `CatalogProduct`, `StoreRef`      |
| `src/features/catalog/server/queries.ts`              | `getPublishedBranchesForParams()` — una fila por sucursal con TODOS los slugs bajo los que responde; el molde exacto de `generateStaticParams` anidado           |
| `src/features/storefront/server/resolve.ts`           | `requireResolution` → `branch` / `selector` / 404. E9, E10, E12 salen de aquí sin escribir nada                                                                  |
| `src/lib/cache.ts`                                    | `storeCatalogTag`, `storeTag`, `revalidateStores`, `STOREFRONT_REVALIDATE = 3600`                                                                                |
| `src/app/[slug]/layout.tsx`                           | `export const revalidate = 3600`, literal, heredado por todo lo que cuelga de `/[slug]`                                                                          |
| `src/app/[slug]/page.tsx`                             | El catálogo entero, su `generateStaticParams` y el punto donde se cuelga el selector                                                                             |
| `src/app/[slug]/buscar/page.tsx`                      | La ruta hermana: orden exacto selector→404 / DRAFT→404 / SUSPENDED→aviso **antes** de cualquier consulta de catálogo                                             |
| `src/components/store/ProductCard.tsx`                | La tarjeta que la vista por categoría reutiliza tal cual (R4)                                                                                                    |
| `src/features/sync/server/handlers/misc.ts`           | `handleCategory`: `upsert` incondicional, slug solo en el `create`, y **ningún** `touchedStoreSlug` — el hueco central que este feature cierra                   |
| `src/features/sync/server/handlers/product.ts`        | El molde de la guarda anti-rancia (`sourceUpdatedAt` → `return STALE`) y del cálculo de `canonicalSlug` desde el store                                           |
| `src/features/sync/server/processBatch.ts`            | El embudo: acumula lo tocado por todo el lote y dispara UNA invalidación deduplicada por familia de tag (líneas 87-97)                                           |
| `src/features/storefront/server/registry.ts`          | `expandBrandTouch()` y su `SlugTouchSet`; `createStorefrontWithStore` como molde de reintento ante colisión de slug                                              |
| `src/lib/slug.ts`                                     | `slugify`, `uniqueSlug(input, taken, { fallback })` — el generador de slugs sin colisión que la migración y el handler reutilizan                                |
| `src/features/orders/server/prismaErrors.ts`          | `isUniqueViolation(error, "slug")`, ya usado por el registro de marcas                                                                                           |
| `src/features/admin/server/products.ts`               | `listStoreCategories` (línea 146): buen molde de «categorías que esta tienda tiene», **no** reusable (le faltan `deletedAt`, `visible` y `Store.status`, I10)    |
| `src/features/catalog/server/search.ts`               | El otro lector de `CatalogProduct`; su CTE `page` ya hace JOIN con `LocalCategory` y ya proyecta `lc."name"`                                                     |
| `prisma/schema.prisma`                                | `LocalCategory` (303-318): `@@unique([businessId, externalId])`, **sin** unique sobre `slug`, **sin** `sourceUpdatedAt`. `Store.sourceUpdatedAt DateTime?` (257) |
| `prisma/migrations/20260825000000_init/migration.sql` | `StoreProduct_localCategoryId_idx` y el `ON DELETE SET NULL` de la clave ajena (línea 472) que produce I4                                                        |

Lo que **no** existe: ninguna ruta bajo `/[slug]/c/`, ningún componente que
pinte categorías en la tienda pública, ninguna columna `slug` única en
`LocalCategory`, y ninguna revalidación disparada por un evento `CATEGORY`.

### Las cifras de la base de desarrollo, consultadas, no supuestas

Todas salen de consultas ejecutadas hoy contra el Postgres de desarrollo
(`docker exec queandabuscando-postgres psql -U postgres -d queandabuscando`):

| Pregunta                                                   | Respuesta                                                      |
| ---------------------------------------------------------- | -------------------------------------------------------------- |
| `Store` totales / `PUBLISHED`                              | 10 / 7                                                         |
| `Storefront` / `Business`                                  | 8 / 2                                                          |
| `LocalCategory`                                            | 5                                                              |
| `StoreProduct` / con `localCategoryId`                     | 28 / 28                                                        |
| Colisiones de `(businessId, slug)` en `LocalCategory` HOY  | **0**                                                          |
| `slug` nulo o vacío en `LocalCategory` HOY                 | **0**                                                          |
| Pares (sucursal publicada, categoría con producto visible) | **13**                                                         |
| Sucursales con alias vivo entre esas                       | 1 (`bodega-central` / `bodega-central-vedado`)                 |
| Categorías por sucursal, máximo                            | 4 (`tienda-demo`: bebidas 4, alimentos 5, aseo 3, panadería 3) |

El desglose exacto de los 13 pares: bodega-central 1, bodega-dos 2, bodega-uno
2, el-faro 1, tienda-demo 4, tienda-dos 3. `el-trebol-centro` está `PUBLISHED`
pero no tiene ningún producto visible, así que aporta cero — y es, gratis, el
caso límite «tienda sin selector» de la tabla de la spec.

## Decisión

**Una ruta estática nueva, src/app/[slug]/c/[categorySlug]/page.tsx (por
crear), pre-renderizada en el build, que NO abre ninguna consulta: tanto el
selector como la vista por categoría son proyecciones en memoria del resultado
de `getStoreCatalog(branch)`, la misma entrada de caché que `/[slug]` ya paga y
el mismo tag que el sync ya invalida.** Encima de eso, dos arreglos aditivos en
territorio del sync sin los cuales cuatro criterios de aceptación no se pueden
cumplir: el slug único por negocio con su backfill, y la revalidación —hoy
inexistente— de un evento `CATEGORY`.

Los seis cortes que definen el diseño:

1. **Ruta propia, estática, sin `searchParams` y sin `export const dynamic`.**
   El segmento es `c`, hermano de `p` (`src/app/[slug]/p/[productSlug]/page.tsx`),
   por el mismo motivo por el que `p` es `p`: la URL se comparte e imprime, y
   `tienda/c/bebidas` cabe donde `tienda/categoria/bebidas` empieza a estorbar.
2. **Sí se pre-renderiza**, con `generateStaticParams`, porque el número lo dice
   (§ El número que decide el pre-renderizado): son **14 páginas hoy**, contra
   las 30 que la página de producto ya pre-renderiza en el mismo build, y a
   cualquier escala el término de categorías es el pequeño.
3. **Cero consultas nuevas por petición.** El selector y la vista salen de
   `getStoreCatalog()`. Eso hace que R3 (el filtro de visibilidad) y R4 (precio,
   override, moneda, promociones) se cumplan **por construcción**: solo hay un
   `WHERE` en todo el repositorio y solo hay una foto de las promociones. Está
   promovido a ADR (`docs/adr/0025-recortes-del-catalogo-como-proyeccion.md`)
   porque quien lo va a reabrir sin querer es F-027.
4. **Cero tags nuevos.** La vista por categoría no cuelga de `storeCatalogTag`:
   **es** `storeCatalogTag`. Las «dos vistas» de E14 son dos proyecciones de una
   sola entrada de caché, así que no pueden desincronizarse ni aunque alguien
   quiera.
5. **`LocalCategory` gana dos columnas de comportamiento, no de datos**: el
   unique `(businessId, slug)` que congela la URL (SP3) y `sourceUpdatedAt`, que
   cierra I8. Migración aditiva, con backfill en el mismo `migration.sql`, y sin
   ninguno de los dos comandos prohibidos.
6. **`handleCategory` empieza a reportar qué revalidar.** Hoy devuelve
   `PROCESSED` pelado: un `CATEGORY`/`UPDATE` o `DELETE` no invalida
   absolutamente nada, y los criterios 9 y 10 son inalcanzables sin tocarlo.

### Alternativas descartadas

| Alternativa                                                                          | Por qué no                                                                                                                                                      |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Query param `?categoria=` sobre `/[slug]`                                            | Leer `searchParams` vuelve esa página ƒ (Dynamic) y rompe el primer criterio de F-004. Cerrado por SP2 y por I6, no se reabre                                   |
| Consulta propia `WHERE storeId AND localCategory.slug = …`                           | +1 round-trip por petición, una entrada de caché por (tienda, categoría), y una **segunda copia** del filtro de R3 que puede derivar sin que nada se ponga rojo |
| Consulta propia solo para el selector (el molde de `listStoreCategories`)            | Misma segunda copia de R3, y encima incompleta: `listStoreCategories` no filtra `deletedAt`, `visible` ni `Store.status` (I10)                                  |
| Reutilizar `listStoreCategories` tal cual                                            | Violaría R3: enseñaría categorías cuyo único producto está borrado u oculto. La spec ya lo llama «buen molde, no función a reusar»                              |
| Que `loadCatalog` devuelva `{ products, categories }`                                | Cambia la firma de la lectura más usada del repo y obliga a tocar tres llamadores para no ganar nada: la derivación es aritmética sobre lo que ya devuelve      |
| Cachear la vista por categoría con un tag propio `storeCategoryTag(slug, cat)`       | Un tag más que alguien tiene que acordarse de disparar. Es literalmente la forma del defecto fichado en el playbook, y aquí no compra nada                      |
| `dynamicParams = false` en la ruta nueva                                             | Una categoría que aparece entre dos builds daría 404 permanente. El defecto de `/[slug]` sería el mismo y por eso tampoco lo pone                               |
| Identificar la categoría por `id` o por `externalId` del POS                         | Cerrado por SP3: URL ilegible, y el `externalId` es un identificador de otro sistema en una URL pública                                                         |
| Slug recalculado en cada `UPDATE` del sync                                           | Rompe R8/E7: renombrar en el POS movería la URL. El slug se congela en el `CREATE`                                                                              |
| Inventar una categoría «Sin categoría» para los productos con `localCategoryId` nulo | R6 lo prohíbe explícitamente: el comerciante no la creó, y el catálogo completo ya es su puerta                                                                 |
| Añadir `c` a `RESERVED_SLUGS`                                                        | `c` es un segmento de **segundo** nivel: `/c` y `/tienda/c/bebidas` son rutas distintas. `p` tampoco está reservado, por lo mismo                               |
| Añadir las URL de categoría a `src/app/sitemap.ts`                                   | Obligaría al sitemap a leer el catálogo de cada tienda (7 lecturas hoy, 700 a escala 100×) en una ruta que hoy hace una sola consulta. Se descubren por enlace  |
| Meter la guarda anti-rancia de I8 en un feature aparte                               | El propio texto de I8 dice que deja de dar igual «en cuanto el nombre es un elemento de navegación», y este feature es el que lo convierte en uno               |

## El número que decide el pre-renderizado

La spec delega esto con una condición: «decídelo con el número de
combinaciones delante». El número:

| Camino                                    | Params hoy en la base de desarrollo                        |
| ----------------------------------------- | ---------------------------------------------------------- |
| `/[slug]`                                 | 8 (6 canónicos publicados + 1 alias + 1 selector de marca) |
| `/[slug]/p/[productSlug]`                 | 30 (28 productos visibles + 2 del alias de bodega-central) |
| `/[slug]/c/[categorySlug]` (este feature) | **14** (13 pares + 1 por el alias de bodega-central)       |

Al multiplicar por 100 el catálogo real, el reparto se separa todavía más: las
categorías de un negocio son «decenas como mucho» (R13, y el POS no ofrece
crearlas a granel), mientras que los productos por sucursal se cuentan por
cientos. Con 700 sucursales publicadas y una mediana de 12 categorías salen
8.400 páginas de categoría, frente a las 280.000 de producto que el mismo build
ya intenta pre-renderizar con 400 productos por sucursal. **Este feature nunca
es el término grande**: lo que revienta primero a esa escala es el
`generateStaticParams` de la página de producto, por un factor de unos 30, y ese
problema ya existe hoy sin F-026.

**Decisión: sí, `generateStaticParams`**, construido exactamente como el de la
página de producto —una lectura de catálogo **por sucursal**, reutilizada para
todos los slugs bajo los que esa sucursal responde—, porque hacerlo por variante
de slug es lo que agotó el pool de conexiones del build (ficha
`.agent/playbook/prisma-p2037-too-many-connections-build-static-params.md`).
Coste añadido al build: **1 consulta** (`getPublishedBranchesForParams()`, que
no está cacheada) más, en el peor caso —si los workers del build no comparten el
incremental cache—, una lectura de catálogo por sucursal publicada: 7 hoy. En el
caso normal, cero, porque `getStoreCatalog` es la misma entrada de caché que la
página de producto acaba de llenar.

`dynamicParams` se queda en su valor por defecto (`true`): una categoría que
aparece después del build se renderiza en la primera petición y se cachea desde
entonces, igual que una tienda nueva. El pre-renderizado es una optimización de
arranque en caliente, no un requisito de completitud — es la misma frase que ya
está escrita sobre `getPublishedStoreSlugs`.

## Componentes

| Componente                                                         | Capa                 | Responsabilidad                                                                                                       | Archivo                                                        |
| ------------------------------------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `StoreCategoryPage`                                                | `app/`               | Rutea y compone la vista por categoría. `generateStaticParams`, `generateMetadata`, 404 y aviso de cerrada            | src/app/[slug]/c/[categorySlug]/page.tsx (por crear)           |
| `deriveStoreCategories`, `productsOfCategory`, `storeCategoryPath` | `features/catalog/`  | Lógica pura sobre `CatalogProduct[]`: agrupar, filtrar, construir el href. Sin Prisma, sin React, testeable en `node` | src/features/catalog/storeCategories.ts (por crear)            |
| `getStoreCategories`, `getStoreCategoryView`                       | `features/*/server/` | Envoltorios finos sobre `getStoreCatalog`, con `StoreRef` obligatorio (R5). No añaden caché ni consulta               | `src/features/catalog/server/queries.ts` (se amplía)           |
| `CatalogProduct.categorySlug`                                      | `features/*/server/` | Una columna más en el tipo que ya existe. Rompe la compilación de sus dos lectores, que es el objetivo                | `src/features/catalog/server/queries.ts` (se amplía)           |
| `StoreCategoryNav`                                                 | `components/store/`  | El selector: lista de `<a>` de servidor, sin `"use client"`. Su **forma** la fija `sdd-designer`                      | src/components/store/StoreCategoryNav.tsx (por crear)          |
| `CATEGORY_ROUTE_SEGMENT`, `CATEGORY_SLUG_FALLBACK`                 | `constants/`         | `"c"` y `"categoria"`, para que ni el href ni el handler lleven la cadena a mano                                      | src/constants/catalog.ts (por crear)                           |
| `handleCategory` (revalidación + guarda anti-rancia)               | `features/*/server/` | Reporta las sucursales tocadas y descarta escrituras rancias                                                          | `src/features/sync/server/handlers/misc.ts` (se amplía)        |
| `HandlerOutcome.touchedStoreSlugs`                                 | `features/*/server/` | El campo plural que hoy falta: un evento `CATEGORY` toca N sucursales, no una                                         | `src/features/sync/server/handlers/types.ts` (se amplía)       |
| `uniqueSlug(..., { honorReserved })`                               | `lib/`               | Un solo generador de slugs, con la lista de reservadas apagada para el segundo nivel                                  | `src/lib/slug.ts` (se amplía)                                  |
| Migración `local_category_slug_unique`                             | `prisma/`            | Unique `(businessId, slug)`, `sourceUpdatedAt`, backfill de desambiguación                                            | prisma/migrations/<ts>\_local_category_slug_unique (por crear) |

Piezas que se reutilizan **sin tocar**: `ProductCard`, `Container`,
`BranchBar`, `StoreClosedNotice`, `StoreSearchBox`, `requireResolution`,
`requireStore`, `getStoreRates`, `getPublishedBranchesForParams`, `cached`,
`storeCatalogTag`, `revalidateStores`, `canonicalSlug`, `expandBrandTouch`,
`isUniqueViolation`.

## Flujo de datos

### La petición de `/[slug]/c/[categorySlug]`

1. `requireResolution(slug)` → `branch` o `selector`. Si es `selector`,
   `notFound()` (E10). Cacheado por `slugTag`, y compartido con el layout por
   `React.cache`.
2. `requireStore(resolution)` → 404 si la tienda es `DRAFT` (E12).
3. Si `store.status !== "PUBLISHED"`: `StoreClosedNotice` y **return**, antes de
   tocar el catálogo (E11). El orden es cargante a propósito: `loadCatalog` ya
   filtra `store: { status: "PUBLISHED" }`, así que llamarlo para una tienda
   suspendida devolvería una lista vacía y la página acabaría en un 404 en vez
   de en el aviso. Consecuencia deliberada: bajo una tienda `SUSPENDED`,
   **cualquier** `categorySlug` —exista o no— enseña el aviso, no un 404. Es lo
   que pide el criterio 6, palabra por palabra.
4. `getStoreCatalog(resolution)` y `getStoreRates(resolution)` en paralelo: las
   mismas dos lecturas cacheadas que `/[slug]`.
5. `productsOfCategory(catalog, categorySlug)`. Si la lista sale vacía →
   `notFound()`. Ese único `if` cubre a la vez el identificador inexistente, el
   mal formado, la categoría de otra sucursal del mismo negocio (E9) y la
   categoría que se quedó sin productos visibles (E5): para el comprador las
   cuatro son la misma cosa, y ninguna confirma que la categoría exista en
   algún sitio.
6. Se pinta con `ProductCard`, en el mismo orden que `/[slug]` —`featured DESC`,
   `localName ASC`, que viene ya resuelto por Postgres y que un filtro estable
   conserva— y con el enlace a `/[slug]` siempre presente (R6).

### La derivación del selector (R1)

`deriveStoreCategories(products)` recorre el `CatalogProduct[]` que
`getStoreCatalog` devolvió, descarta los que tienen `categorySlug` nulo (E6, R6:
no se inventa una categoría «Sin categoría»), agrupa por `categorySlug` y
devuelve `{ slug, name, productCount }[]` ordenado por `name` con un
`Intl.Collator("es")` creado una sola vez a nivel de módulo — determinista entre
el build y la petición, y con «Panadería» donde debe ir.

R1 se cumple sin escribir ninguna regla: **la lista de entrada ya es «los
productos que el catálogo de esta sucursal mostraría»**, porque es literalmente
el resultado de `loadCatalog`. R3 tampoco se escribe aquí: vive una sola vez, en
el `where` de `loadCatalog` (`deletedAt: null`, `visible: true`,
`store: { status: "PUBLISHED" }`, nada sobre `availability`). Un producto
`OUT_OF_STOCK` entra y se pinta agotado, como en `/[slug]`.

Dos categorías del mismo negocio cuyos nombres slugifican igual (criterio 11)
producen dos entradas distintas porque la clave de agrupación es el **slug**, no
el nombre; si además comparten nombre visible, el selector enseña dos entradas
homónimas con URL distinta, que es exactamente lo que el criterio pide.

### La invalidación (R7, E13, E14)

La página no lee nada que no esté detrás de un tag que ya existe:

| Lectura             | Tag                              | Quién lo dispara hoy                                |
| ------------------- | -------------------------------- | --------------------------------------------------- |
| `resolvePublicSlug` | `slugTag(requested)`             | `revalidateSlugs` desde el lote del sync y el panel |
| `getStoreBySlug`    | `storeTag(canonicalSlug)`        | `revalidateStores`                                  |
| `getStoreCatalog`   | `storeCatalogTag(canonicalSlug)` | `revalidateStores`                                  |
| `getStoreRates`     | `storeTag(canonicalSlug)`        | `revalidateStores`                                  |

**E13 (cambia el precio):** `handleProduct` ya devuelve `touchedStoreSlug`;
`processBatch` lo acumula y `revalidateStores` dispara `storeCatalogTag`. La
entrada de caché muere, y con ella la de la ruta completa —invalidar el data
cache invalida el full route cache que dependía de él, que es el mecanismo sobre
el que ya descansan F-004 y F-017. Al re-renderizarse, `/[slug]` y
`/[slug]/c/bebidas` leen **la misma entrada nueva**. No hay nada que añadir.

**E14 (cambia de categoría):** el mismo evento, la misma entrada. La vista de la
categoría vieja deja de incluir el producto y la de la nueva lo incluye porque
las dos se derivan de la misma lista. «Hay que invalidar dos, no una» deja de
ser un riesgo: **no hay dos**. Esta es la razón arquitectónica de fondo para
elegir la proyección sobre la consulta propia, y no el ahorro de un round-trip.

**El hueco real, y es de los que muerden:** `handleCategory` devuelve `PROCESSED`
pelado —sin `touchedStoreSlug`, sin `touchedBrandSlug`—, así que hoy un evento
`CATEGORY` **no invalida absolutamente nada**. Con el nombre pintándose solo en
la ficha de un producto no se notaba; con el nombre como elemento de navegación,
los criterios 9 (`CATEGORY`/`DELETE`) y 10 (`CATEGORY`/`UPDATE` que renombra) no
se pueden cumplir sin cerrarlo. Se cierra así:

1. Antes de escribir (y, en el `DELETE`, **antes** de borrar: la clave ajena es
   `ON DELETE SET NULL` y después del borrado ya no queda ningún producto que
   apunte a la categoría), una consulta que resuelve las sucursales afectadas:

   ```ts
   const stores = await prisma.store.findMany({
     where: { businessId, products: { some: { localCategoryId: existing.id, deletedAt: null } } },
     select: {
       id: true,
       slug: true,
       storefront: {
         select: {
           slug: true,
           stores: { where: { status: { not: "DRAFT" } }, select: { id: true } },
         },
       },
     },
   });
   ```

   Un round-trip, sirviéndose de `StoreProduct_localCategoryId_idx`, que ya
   existe. Cada fila se convierte en su canónico con `canonicalSlug({ storeSlug,
brandSlug, brandBranchCount })`, exactamente como hace `handleProduct`.

2. `HandlerOutcome` gana `touchedStoreSlugs?: readonly PublicSlug[]` —plural,
   porque una categoría es del **negocio** y sus productos viven en N sucursales
   (I10)— y `processBatch` lo vuelca en el **mismo** `Set` que ya alimenta
   `revalidateStores`. Cero llamadas nuevas de invalidación: un lote de 500
   eventos sigue disparando una sola invalidación deduplicada por familia de
   tag.

3. Lo que **no** se dispara, y por qué: `revalidateStorefronts` no, porque el
   selector de marca solo pinta nombres y estados de sucursal, nunca una
   categoría; `revalidateSlugs` tampoco, porque un evento `CATEGORY` no cambia lo
   que ningún slug **resuelve** — es el caso «Cuándo NO es esto» de la ficha
   `.agent/playbook/revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md`.
   Nadie arma la lista a mano: la produce esa consulta y la consume
   `revalidateStores`, y el único sitio donde había una expansión de marca —el
   camino de `handleStore`— sigue llamando a `expandBrandTouch()` sin que este
   feature lo toque.

Un `CATEGORY`/`CREATE` no revalida nada, y es correcto: una categoría recién
creada todavía no tiene ningún producto, así que por R1 no existe para el
comprador. La consulta devuelve cero filas sola, sin caso especial.

## Contratos

Nada de esto cruza una frontera HTTP: no hay endpoint nuevo, no hay body que
validar y por tanto no hay esquema Zod nuevo (mismo criterio que F-021 tomó para
sus `searchParams`). Los contratos son de tipos.

```ts
// src/features/catalog/server/queries.ts — se AMPLÍA CatalogProduct
export type CatalogProduct = {
  // …todo lo que ya tiene…
  categoryName: string | null;
  /** F-026: el identificador ESTABLE de la categoría en la URL. `null` cuando
   *  el producto no tiene categoría (E6). Va junto a `categoryName` porque
   *  sale de la misma fila y del mismo JOIN: cero consultas extra. */
  categorySlug: string | null;
};
```

```ts
// src/features/catalog/storeCategories.ts (por crear) — puro, sin Prisma
export type StoreCategory = {
  slug: string;
  name: string;
  /** Productos visibles de ESTA sucursal en esta categoría. Sale gratis del
   *  agrupamiento; que se pinte o no lo decide sdd-designer. */
  productCount: number;
};

export function deriveStoreCategories(products: readonly CatalogProduct[]): StoreCategory[];
export function productsOfCategory(
  products: readonly CatalogProduct[],
  categorySlug: string,
): CatalogProduct[];
export function storeCategoryPath(storeSlug: PublicSlug, categorySlug: string): string;
```

```ts
// src/features/catalog/server/queries.ts — la lectura, con R5 por tipos
type StoreRef = Pick<BranchResolution, "storeId" | "canonicalSlug">; // ya existe

export function getStoreCategories(branch: StoreRef): Promise<StoreCategory[]>;

export type StoreCategoryView = {
  category: StoreCategory;
  products: CatalogProduct[];
};
/** `null` = no existe para esta sucursal → la página hace notFound(). */
export function getStoreCategoryView(
  branch: StoreRef,
  categorySlug: string,
): Promise<StoreCategoryView | null>;
```

**Cómo cumplen R5 y R4.** El primer parámetro es `StoreRef`, no un `string`:
pasar un slug de URL sin resolver es un error de compilación, igual que en el
resto de `queries.ts`; el `storeId` no es un filtro opcional que quien llama
pueda olvidar, es lo único con lo que se puede llamar. Y R4 se cumple porque
ninguna de las dos funciones toca Prisma: las dos son `await
getStoreCatalog(branch)` más una función pura. Precio, override, moneda y
promociones no aparecen ni siquiera mencionados en el archivo nuevo — no hay
dónde reimplementarlos.

Las dos van envueltas en `cache()` de React, como ya hace `resolvePublicSlug` y
como hace `loadSearch` en `src/app/[slug]/buscar/page.tsx`, para que
`generateMetadata` y el cuerpo de la página no paguen dos veces ni siquiera un
acierto de caché.

**Tabla de respuestas de la ruta** (no hay códigos de error propios: son estados
de página):

| Situación                                                  | Respuesta                                  | Criterio       |
| ---------------------------------------------------------- | ------------------------------------------ | -------------- |
| Slug en modo selector                                      | 404                                        | 6 (E10)        |
| Tienda `DRAFT`                                             | 404                                        | (E12)          |
| Tienda `SUSPENDED`, cualquier `categorySlug`               | Aviso de cerrada, sin consulta de catálogo | 6 (E11)        |
| `categorySlug` inexistente, mal formado o de otra sucursal | 404                                        | 5 (E9)         |
| Categoría sin producto visible en esta sucursal            | 404                                        | 5 (E5)         |
| Categoría con productos                                    | 200, indexable, con enlace a `/[slug]`     | 2 (E2,R6)      |
| Base caída                                                 | El error sube; nunca una categoría «vacía» | (tabla límite) |

**Metadatos (R12).** La vista por categoría **es** indexable: `title` de la
forma «Nombre de la categoría · Nombre de la tienda» y **sin**
`robots: { index: false }` — al contrario que `/[slug]/buscar`, que lo pone a
propósito. Cuando la sucursal se pidió por un alias vivo (`resolution.isAlias`),
la página declara `alternates.canonical` apuntando a
`/${canonicalSlug}/c/${categorySlug}`, igual que hace `/[slug]`; las dos URL
siguen respondiendo 200, sin redirección. Una tienda `SUSPENDED` sí emite
`robots: { index: false }`, como sus hermanas.

**Segment config.** La página **no** declara ni `dynamic` ni `revalidate`:
hereda el `export const revalidate = 3600` literal de
`src/app/[slug]/layout.tsx`, exactamente igual que `/[slug]` y
`/[slug]/p/[productSlug]`. Escribir aquí un `export const dynamic =
"force-dynamic"` (lo que sí hace `/[slug]/buscar`, y con motivo) sería la forma
más rápida de perder la caché entera. Y si algún día hiciera falta un
`revalidate` propio, tiene que ser un **literal**: una constante importada rompe
el build (`AGENTS.md` § Cosas que muerden).

## Modelo de datos y migraciones

Una sola migración aditiva sobre `LocalCategory`. En `prisma/schema.prisma`:

```prisma
model LocalCategory {
  // …sin cambios…
  /// F-026: el slug es el identificador PÚBLICO de la categoría en
  /// `/[slug]/c/[categorySlug]`. Único por negocio y congelado en el primer
  /// CREATE: renombrar en el POS cambia `name`, nunca esto (R8/E7).
  slug             String
  /// F-026 (I8): guarda anti-rancia, misma forma que `Store.sourceUpdatedAt`.
  /// Nullable porque las filas que ya existen no traen marca de origen: la
  /// primera entrega posterior a la migración la fija y desde ahí queda
  /// protegida.
  sourceUpdatedAt  DateTime?

  @@unique([businessId, externalId])
  @@unique([businessId, slug])
  @@index([globalCategoryId])
}
```

### El SQL que hay que revisar a mano

El procedimiento, y no admite atajos: `npx prisma migrate dev --create-only`,
editar el `migration.sql` generado, y **solo entonces** aplicarlo con
`npm run db:migrate`. Nunca `prisma migrate reset` ni `prisma db push`
(`AGENTS.md` § Comandos prohibidos), y el humano ya lo dejó dicho el 2026-08-31.

**Aviso, y es el que más caro sale:** Prisma va a proponer, en este diff que no
tiene nada que ver con ellos, el `DROP INDEX` de **cinco** índices que
`prisma/schema.prisma` no puede declarar. Hay que **borrar esas cinco líneas**
del `migration.sql` antes de aplicarlo. Los nombres, para poder greparlos:
`CanonicalProduct_searchVector_idx`, `CanonicalProduct_name_trgm_idx`,
`StoreProduct_visible_catalog_idx`, `StoreProduct_searchVector_idx`,
`StoreProduct_searchDocument_trgm_idx`. Aplicarlo sin mirar no pone rojo ni un
test: solo deja la búsqueda de F-021 y del marketplace haciendo scans
secuenciales en producción. Ficha completa, con el SQL para recrearlos si el
drop llegara a colarse:
`.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md`.

Lo que el archivo tiene que acabar diciendo, en este orden:

```sql
-- 1. Columna nueva, aditiva y nullable: ni reescribe la tabla ni necesita
--    default. Misma forma que `Store."sourceUpdatedAt"`.
ALTER TABLE "LocalCategory" ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3);

-- 2. Higiene previa al backfill: un slug vacío no es desambiguable con sufijo
--    ('' || '-2' daría '-2', que no es un slug bien formado). Se le aplica el
--    mismo fallback que ya usa el handler del sync.
UPDATE "LocalCategory" SET "slug" = 'categoria' WHERE "slug" = '';

-- 3. Backfill de desambiguación. En la base de desarrollo NO hay ninguna
--    colisión (verificado hoy: 0 filas con (businessId, slug) repetido y 0
--    slugs vacíos), así que aquí es un no-op — pero en producción puede
--    haberlas, porque hasta hoy nadie garantizaba la unicidad (I3) y
--    `slugify(name) || 'categoria'` colapsa a un mismo valor cualquier par de
--    nombres que difieran solo en acentos, mayúsculas o puntuación.
--    Orden estable por "externalId" (no por "id", que es un uuid aleatorio):
--    la primera fila conserva el slug pelado, las demás reciben -2, -3, …
--    El bucle repite la pasada porque un sufijo puede chocar a su vez con un
--    valor preexistente ('bebidas' x2 conviviendo con un 'bebidas-2'); cada
--    vuelta alarga el sufijo, así que termina.
DO $$
DECLARE
  moved integer;
  guard integer := 0;
BEGIN
  LOOP
    WITH ranked AS (
      SELECT "id",
             "slug",
             row_number() OVER (PARTITION BY "businessId", "slug"
                                ORDER BY "externalId") AS n
        FROM "LocalCategory"
    ), fixed AS (
      UPDATE "LocalCategory" c
         SET "slug" = r."slug" || '-' || r.n
        FROM ranked r
       WHERE c."id" = r."id" AND r.n > 1
      RETURNING 1
    )
    SELECT count(*) INTO moved FROM fixed;
    guard := guard + 1;
    EXIT WHEN moved = 0 OR guard >= 10;
  END LOOP;
  IF moved > 0 THEN
    RAISE EXCEPTION 'LocalCategory slug backfill did not converge in 10 passes';
  END IF;
END $$;

-- 4. Recién ahora, el unique que SP3 exige. Si el paso 3 no hubiera corrido,
--    esta línea sería la que hace fallar la migración en producción.
CREATE UNIQUE INDEX "LocalCategory_businessId_slug_key"
  ON "LocalCategory"("businessId", "slug");
```

El `RAISE EXCEPTION` es deliberado: si el backfill no converge, la migración
falla ruidosamente en vez de dejar la base sin el unique y la aplicación
creyendo que lo tiene.

**Nota de despliegue**: esto es «una migración que hay que revisar a mano», que
es literalmente uno de los casos que `AGENTS.md` § Documentación obliga a anotar
en `docs/despliegue.md` **en el mismo ciclo**. El implementador tiene que dejar
allí una línea, no solo aplicar la migración.

### La desambiguación en el `CREATE` de `handleCategory`

El backfill arregla el pasado; esto impide que vuelva a pasar. En la rama
`create` del `upsert`, el slug deja de ser `slugify(payload.name) || "categoria"`
y pasa por el **mismo** `uniqueSlug` que usa el registro de marcas, con un
predicado `taken` acotado al negocio:

```ts
const slug = await uniqueSlug(
  payload.name,
  async (candidate) =>
    (await prisma.localCategory.count({ where: { businessId, slug: candidate } })) > 0,
  { fallback: CATEGORY_SLUG_FALLBACK, honorReserved: false },
);
```

Dos cosas que no son obvias:

- `honorReserved: false` es una opción **nueva** de `uniqueSlug`, con valor por
  defecto `true` para no tocar a ninguno de sus llamadores actuales. Sin ella,
  una categoría llamada «Buscar» acabaría con el slug `buscar-tienda`, porque
  `uniqueSlug` aplica `RESERVED_SLUGS`, que existe para el **primer** nivel de
  URL. `/tienda/c/buscar` no compite con `/tienda/buscar`: son rutas distintas
  (R11), y el slug queda congelado para siempre, así que la fealdad sería
  permanente. Se cambia `src/lib/slug.ts` y no se duplica el generador.
- Una carrera entre dos eventos que derivan el mismo candidato sigue siendo
  posible: la escritura se envuelve en el mismo bucle de reintento que
  `createStorefrontWithStore`, usando `isUniqueViolation(error, "slug")` y
  volviendo a pedir un candidato fresco. Un evento del sync no puede fallar por
  un nombre desafortunado.

La rama `update` **no** toca `slug`. Es R8/E7 y ya es así hoy; lo que cambia es
que ahora hay un unique que lo respalda.

### I8 — la guarda anti-rancia de `CATEGORY`: se cierra aquí

La spec me delegaba «cerrarlo o aceptarlo por escrito». **Se cierra**, por tres
razones y ninguna es de gusto:

1. `AGENTS.md` § Cosas que muerden es categórico —«todo lo que el sync escribe
   es idempotente y va guardado contra escrituras rancias»— y la propia I8
   explica que la excepción se toleraba solo mientras el nombre se pintaba en
   una ficha. Este feature es justo el que lo convierte en navegación.
2. Sin guarda, cada re-entrega de un evento viejo dispara ahora la consulta de
   sucursales afectadas **y** una invalidación de todas ellas. Una outbox
   reintentando deja de ser gratis y pasa a costar revalidaciones reales.
3. Cuesta una columna nullable y cuatro líneas, y no toca el contrato.

La forma, calcada de `handleProduct`: se lee la fila antes de escribir y, si
`existing.sourceUpdatedAt !== null && existing.sourceUpdatedAt.getTime() >=
new Date(payload.updatedAt).getTime()`, se devuelve `STALE` sin escribir ni
revalidar. Nullable a propósito: las filas que ya existen no tienen marca de
origen, así que aceptan la primera entrega posterior a la migración y quedan
protegidas desde la segunda. Es el mismo compromiso que `Store.sourceUpdatedAt`
ya tomó.

**No toca `docs/sync-contract.md` y no sube su versión (R14).** El campo
`updatedAt` ya viaja en el `payload` de `CATEGORY`
(`src/features/sync/schemas.ts:48-54`) y ya se valida; `stale` ya es uno de los
estados terminales documentados del lote (`docs/sync-contract.md:464`) y ya
aparece dentro de `ok`, así que para cuadrecaja no cambia ni un campo ni un
comportamiento observable nuevo. Lo único que sigue sin documentarse es la forma
del `payload` de `CATEGORY` (I7), que es deuda preexistente y de F-022: ver
`AP1`.

## Escalabilidad y límites

**Por petición de `/[slug]/c/[categorySlug]`, este feature añade CERO
round-trips.** El desglose completo, con la caché fría, son 6 consultas y las 6
las paga ya `/[slug]`: 2 de `resolvePublicSlug` (`Slug` y `Storefront`), 1 de
`getStoreBySlug`, 2 de `getStoreCatalog` (productos y promociones, en un solo
`Promise.all`) y 1 de `getStoreRates`. Con la caché caliente, **0**. Sin
`$transaction` en ningún sitio, así que no hay nada que pueda hacer deadlock
contra el pooler en modo transacción.

**Entradas de caché nuevas: 0. Tags nuevos: 0.** La alternativa descartada —una
consulta por categoría— habría creado una entrada por (tienda, categoría): 13
hoy, 8.400 a escala 100×, cada una con su propia ventana para quedarse rancia.

**Coste en memoria.** La proyección materializa el catálogo entero de **una**
sucursal por petición y lo recorre una vez: 15 objetos hoy en el peor caso,
`O(n)` con `n` = productos visibles de la sucursal. Con 400 productos son 400
comparaciones de cadena, por debajo del milisegundo. No hay N+1 en ninguna parte
porque no hay una segunda consulta.

**Qué se rompe primero al multiplicar por 100.** No es esta vista: es
`/[slug]`. La entrada de `loadCatalog` en el incremental cache de Next crece con
el catálogo entero de la sucursal —del orden de unos cientos de bytes por
producto serializado— y ese cache rechaza entradas grandes, así que una sucursal
del orden de varios miles de productos deja de cachear su catálogo y, con él,
todas sus vistas por categoría. El síntoma aparecería primero en `/[slug]`,
que hoy tampoco pagina. Es exactamente el umbral que
`docs/adr/0025-recortes-del-catalogo-como-proyeccion.md` fija para reabrir la
decisión, y coincide con el momento en que F-027 tenga que paginar el catálogo.

**El sync.** Un evento `CATEGORY` pasa de 1 consulta a 3 (guarda anti-rancia,
escritura, sucursales afectadas). Un lote de 500 eventos `CATEGORY` —que sería
insólito: un negocio tiene decenas de categorías, no miles— costaría 1.500
round-trips y seguiría disparando **una** invalidación deduplicada por familia
de tag, porque `processBatch` acumula y revalida al final. Para comparar,
`handleProduct` ya hace 3-4 consultas por evento hoy.

**El build.** 14 páginas pre-renderizadas más hoy. Una consulta más
(`getPublishedBranchesForParams`) y, en el peor caso de workers que no comparten
el incremental cache, una lectura de catálogo por sucursal publicada (7 hoy).
Ese peor caso es justo lo que agotó el pool en F-017, y la mitigación —una
lectura por sucursal, reutilizada para todos sus slugs— está escrita en el punto
2 de § El número que decide el pre-renderizado.

**JavaScript de cliente: 0 KB nuevos.** Ni el selector ni la vista llevan
`"use client"` (R9, y la prohibición literal de `AGENTS.md` para todo lo que
renderice catálogo). El selector es una lista de anclas; si el diseño pide
plegado, `<details>`/`<summary>` lo da sin una línea de JS.
`node scripts/check-bundle-budget.mjs` no debería moverse ni un kilobyte, y si
se mueve es que algo se coló.

## Patrones a seguir / antipatrones a evitar

- **Nada de Prisma fuera de `features/*/server/`.** El archivo puro nuevo vive
  en `features/catalog/` (no en `server/`) y solo importa el **tipo**
  `CatalogProduct`; la página solo llama a funciones de `queries.ts`.
  (`AGENTS.md` § Arquitectura y § Prohibiciones.)
- **Nada de `"use client"` en el árbol del catálogo.** No es presupuesto, es que
  el HTML tiene que bastar (`AGENTS.md` § El presupuesto de JavaScript no es un
  muro, último párrafo).
- **Ni tocar el `matcher` de `src/proxy.ts`.** `/[slug]/c/*` cuelga de `/[slug]`
  y hacerle match anularía la estrategia ISR entera. Es «el error más fácil de
  cometer en este repo» (`AGENTS.md` § Cosas que muerden).
- **Nada de `loading.tsx` en la ruta nueva.** Un `loading.tsx` rompe el código
  de estado de `notFound()` y los criterios 5 y 6 dependen de que el 404 sea un
  404 de verdad. Ficha:
  `.agent/playbook/nextjs-loading-tsx-rompe-status-code-de-notfound.md`.
- **`export const revalidate` literal, o mejor ninguno.** Aquí, ninguno: se
  hereda del layout.
- **Nadie arma a mano una lista de slugs de marca a revalidar.** Este feature no
  necesita hacerlo en ningún punto; donde ya se hace, se llama a
  `expandBrandTouch()` y se sigue llamando igual.
- **La ruta escrita entera desde la raíz del repo cuando se cite un archivo**, y
  un archivo que todavía no existe, sin comillas invertidas y con «(por crear)»
  detrás. Las dos mitades del mismo check muerden a quien planifica bien
  (`AGENTS.md` § Cosas que muerden; fichas
  `.agent/playbook/check-harness-falso-positivo-ruta-abreviada.md` y
  `.agent/playbook/prettier-write-reescribe-prosa-ajena.md`).
- **`npm run format` sobre lo que uno escribió**, nunca sobre documentos ajenos
  a ciegas: Prettier convierte en viñeta una línea de continuación que empiece
  por `+`, `-` o `*` y le cambia el sentido a la frase.

## Riesgos y plan B

| Riesgo                                                                                                                  | Plan B                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Un 404 de categoría se queda cacheado en el full route cache y sobrevive a que la categoría vuelva a tener productos    | El 404 se emite **después** de leer `getStoreCatalog`, así que hereda `storeCatalogTag` y muere con él. Si en pruebas resultara no ser cierto, el suelo de 3600 s lo limita y el plan B es servir 200 con «esta categoría se quedó sin productos» en vez de 404 — pero eso contradice E5, así que sería una pregunta al humano, no una decisión del implementador |
| Añadir `categorySlug` a `CatalogProduct` obliga a tocar `src/features/catalog/server/search.ts`, que la spec deja fuera | Es una columna más en la proyección del CTE `page`, sobre un JOIN a `LocalCategory` que **ya está ahí** (ya proyecta `lc."name"`): cero coste, cero cambio de semántica de las tres capas. Ver `AP1`                                                                                                                                                              |
| El backfill no converge en producción por una forma de colisión que no se previó                                        | El `RAISE EXCEPTION` aborta la migración en vez de dejar la base a medias. Se diagnostica con la consulta de colisiones y se ajusta el paso 3                                                                                                                                                                                                                     |
| `prisma migrate dev` se niega a avanzar por drift de checksum (Postgres de desarrollo compartido entre worktrees)       | No aceptar el reset. Generar el DDL con `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` y aplicar con `prisma migrate deploy`. Ficha `.agent/playbook/prisma-migrate-dev-checksum-drift-bd-compartida.md`                                                                                                                |
| La consulta nueva de `handleCategory` encarece un lote grande de eventos `CATEGORY`                                     | Es 1 round-trip por evento sobre un índice existente. Si algún día molestara, se agrupa por lote en `processBatch`, que ya es el sitio donde se deduplica todo                                                                                                                                                                                                    |
| F-027 añade `searchParams` a `/[slug]/c/[categorySlug]` y la vuelve Dynamic, perdiendo la caché de esta                 | Está anticipado en § Qué queda fuera y es decisión de F-027, no una regresión silenciosa de esta. R10 protege `/[slug]`, no esta ruta                                                                                                                                                                                                                             |

## ¿Hace falta una ADR?

**Sí, y ya está el borrador:**
`docs/adr/0025-recortes-del-catalogo-como-proyeccion.md`, en estado
**Propuesta**, «Un recorte del catálogo es una proyección de la lectura
cacheada, no una consulta nueva».

Por qué merece una ADR y no solo un párrafo aquí: la decisión sobrevive a este
feature y **restringe a otros tres** que ya están en el backlog. F-027 (filtros
y ordenamientos) es el que va a sentir la tentación de abrir su propia consulta
con su propio `WHERE`, y ahí es donde vuelve a aparecer la segunda copia del
filtro de visibilidad de R3. La ADR fija además la excepción —la búsqueda de
F-021, que es un ranking sobre un índice y no un recorte, y que no se reescribe—
y el umbral que la reabre: el día que `/[slug]` se pagine.

No hace falta ADR para el espacio de nombres del slug de categoría: R11 de la
spec y SP3 ya lo resolvieron, y ADR 0018 sigue gobernando el primer nivel sin
cambios. Una categoría vive **debajo** del slug de una tienda, no consume ningún
valor del registro `Slug` y no entra en `RESERVED_SLUGS`.

## Qué queda fuera de esta arquitectura

- **La forma visual del selector** (chips, lista lateral, `<details>`), su sitio
  respecto de la caja de búsqueda de F-021 y si `ProductCard` enseña el nombre
  de la categoría. Es de `sdd-designer`. La única restricción arquitectónica:
  sea cual sea la forma, es **un componente de servidor** bajo
  `src/components/store/` que recibe `StoreCategory[]`, el slug canónico de la
  tienda y opcionalmente el slug activo, y navega con anclas. Sin `"use
client"`, sin dependencia nueva. Que el mismo selector se pinte también dentro
  de la vista por categoría cuesta cero (la lista ya está derivada); si el
  diseño lo quiere, está disponible.
- **La paginación de la vista por categoría.** Hoy `/[slug]` no pagina; cuando
  F-027 fije el tope, esta lo hereda.
- **Las URL de categoría en `src/app/sitemap.ts`.** Se descubren por enlace
  desde `/[slug]`, que sí está en el sitemap. Meterlas obligaría al sitemap a
  leer el catálogo de cada tienda. Se reconsidera si alguna vez el selector deja
  de estar enlazado desde la portada de la tienda.
- **Subcategorías, `GlobalCategory` y su `parentId`.** Cerrado por SP1: feature
  futuro. Este documento no deja nada preparado para ellas a propósito: preparar
  un segundo nivel sin dato es exactamente lo que I1 desaconseja.
- **Filtrar los resultados de búsqueda por categoría**, y en general la
  semántica de `src/features/catalog/server/search.ts`: sus tres capas, su
  ranking, su cascada `keys`/`exp` y su paginación no se tocan.
- **Crear, renombrar u ordenar categorías desde el panel.** Son del POS
  (ADR 0007).
- **Documentar el `payload` de `CATEGORY` en `docs/sync-contract.md`** (I7):
  deuda preexistente que F-022 ya promete cerrar. Ver `AP1`.

## Qué le entrega este feature a los que vienen

**A F-027 (filtros y ordenamientos), que reutiliza la categoría como filtro sin
redefinirla (SP4):**

- **El nombre del parámetro es `categorySlug`, y es un segmento de ruta, no un
  query param.** La categoría se selecciona con `/[slug]/c/[categorySlug]`; su
  valor es `LocalCategory.slug`. F-027 **no** define un `?categoria=` ni un
  `?category=` paralelo: sus filtros de precio, disponibilidad y orden cuelgan
  como `searchParams` **de esa misma ruta**. Consecuencia que F-027 tiene que
  decidir con los ojos abiertos: en cuanto lea `searchParams`, esa ruta pasa a
  ƒ (Dynamic) y pierde el pre-renderizado; R10 solo protege `/[slug]`.
- `deriveStoreCategories` y `productsOfCategory` (src/features/catalog/storeCategories.ts,
  por crear) como predicado único de pertenencia, y `getStoreCategoryView` como
  punto de entrada ya cacheado sobre el que aplicar los filtros en memoria.
- `docs/adr/0025-recortes-del-catalogo-como-proyeccion.md` como la regla que le
  ahorra abrir una consulta por combinación de filtros.

**A F-025 (botón de atrás y breadcrumb):** el nivel intermedio, ya con dato y
con URL. `CatalogProduct` lleva `categoryName` (ya) y `categorySlug` (nuevo), y
la ficha del producto (`src/app/[slug]/p/[productSlug]/page.tsx`) ya lee ese
objeto, así que un breadcrumb tienda › categoría › producto se compone con
**cero** lecturas nuevas y con `storeCategoryPath()` para el href. La forma del
breadcrumb la decide F-025; el dato está.

## Preguntas al humano

**AP1 — Añadir `categorySlug` a `CatalogProduct` obliga a añadir una columna a
la proyección de la consulta de búsqueda de F-021, que la spec de F-026 dejó
explícitamente fuera de alcance. ¿Se acepta?**

El detalle exacto: `CatalogProduct` tiene hoy dos lectores,
`src/features/catalog/server/queries.ts` y
`src/features/catalog/server/search.ts`. Añadirle un campo obligatorio hace que
el segundo **no compile** hasta que su SQL proyecte también el slug. El JOIN a
`LocalCategory` ya está en ese CTE (ya proyecta `lc."name" AS "categoryName"`),
así que el cambio es literalmente una línea de SQL, un campo en el tipo de fila
cruda y una línea en el mapeo. Las tres capas, el ranking, la cascada de
categoría y la paginación no se tocan: la spec fenced off la **semántica** de
esa consulta, y esto no la roza.

- **(a) Sí, se acepta**: una columna proyectada de más en la consulta de F-021,
  con la ganancia de que el tipo compartido no se duplica y de que el breadcrumb
  de F-025 funciona también sobre los resultados de búsqueda.
- **(b) No**: se declara `categorySlug` como opcional en `CatalogProduct` para
  que `search.ts` siga compilando sin tocarse. Coste: un campo que unas veces
  está y otras no, que es la clase de tipo que produce el bug de «me olvidé de
  comprobar `undefined`» en el sitio equivocado.
- **(c) No, y se duplica el tipo**: un `CategoryProduct` aparte. Está prohibido
  por `AGENTS.md` § Prohibiciones («duplicar interfaces entre la capa de datos y
  la vista»).

**Recomendación: (a).** Es la única que no compra la deuda con intereses, y el
error de compilación es precisamente lo que garantiza que los dos lectores del
tipo no diverjan — el mismo argumento con el que F-021 defendió su propio
`CatalogProduct` compartido.

**AP1 no bloquea el diseño**: con (b) el resto del documento se sostiene sin un
solo cambio. Bloquea solo qué archivo se toca.

Lo que **no** es una pregunta, y se deja dicho para que nadie lo suba de más:
cerrar I8 no cambia `docs/sync-contract.md` ni su versión. `updatedAt` ya viaja
en el `payload` de `CATEGORY` y `stale` ya es un estado terminal documentado que
viaja dentro de `ok` (`docs/sync-contract.md:464`). Lo único que sigue sin
documentar es la forma del `payload` de `CATEGORY` (I7), que es de F-022 y sigue
siéndolo.
