---
feature: F-025
agente: sdd-architect
actualizado: 2026-08-31T15:12:00Z
estado: listo
---

> **Sin preguntas abiertas.** AP1 —la única que hubo— la contestó el humano el
> 2026-08-31 con estas palabras: «Construirlo y reformular el criterio». El
> criterio 9 de `.agent/features.json` ya está reformulado y los siete criterios
> nuevos (15-21) ya están añadidos; el reparto de responsabilidad entre este
> feature y la propuesta `.agent/specs/propuestas/404-sin-salida-sin-javascript.md`
> está en § El 404 dentro de una tienda › La decisión. Queda **una
> incongruencia** que este documento detecta en un criterio recién añadido y que
> no puede arreglar por su cuenta (regla 3): el 18, en § Los criterios nuevos.
> No bloquea la implementación —el diseño es inequívoco—, pero el humano tiene
> que verla.

## Estado actual relevante

Lo que ya existe y se usa tal cual, sin tocarlo:

- **La resolución marca/sucursal.** `requireResolution()`
  (`src/features/storefront/server/resolve.ts:216`) devuelve `BranchResolution`
  o `SelectorResolution` con `brandSlug`, `brandName`, `canonicalSlug`,
  `branchCount` y `isAlias` (`src/features/storefront/server/resolve.ts:41-68`).
  Está envuelta en `React.cache`, así que layout y página comparten la lectura
  dentro de la misma petición.
- **El slug canónico.** `canonicalSlug()` (`src/lib/publicSlug.ts:31`) y el tipo
  nominal `PublicSlug` (`src/lib/publicSlug.ts:15`): un slug de URL sin resolver
  **no compila** donde se espera uno canónico. Es la garantía de R3, y es de
  tipo, no de disciplina.
- **La ficha de la sucursal.** `requireStore()`
  (`src/features/catalog/server/queries.ts:171`) devuelve `StoreSummary`, que ya
  trae `name` **y `brandName`** (`src/features/catalog/server/queries.ts:41` y
  `:135`), cacheada con `storeTag(canonicalSlug)`
  (`src/features/catalog/server/queries.ts:153-157`). Ocho de las diez pantallas
  ya la llaman.
- **El href de una categoría.** `storeCategoryPath()`
  (`src/features/catalog/storeCategories.ts:78`), construido sobre
  `CATEGORY_ROUTE_SEGMENT` (`src/constants/catalog.ts:19`) y recibiendo siempre
  el canónico.
- **`categoryName`/`categorySlug` en la fila del producto**
  (`src/features/catalog/server/queries.ts:69-74`, rellenados en `:275-276`),
  desde la misma lectura cacheada `getStoreCatalog()`
  (`src/features/catalog/server/queries.ts:283-289`).
- **El patrón «componente de tienda compartido, montado por cada página»**:
  `src/components/store/BranchBar.tsx` y `src/components/store/StoreSearchBox.tsx`.
  Los dos son de servidor, sin `"use client"`, y los dos se repiten en varias
  páginas justamente para que ninguna se quede sin la marca de accesibilidad de
  las otras (`src/components/store/StoreSearchBox.tsx:5-12`).
- **Las etiquetas que ya existen**: `formatOrderCode()` (`src/lib/orderCode.ts:46`)
  y `StoreSearchResult.term`, ya normalizado y truncado a
  `SEARCH_TERM_MAX_LENGTH` (`src/features/catalog/server/search.ts:51-54`,
  `src/lib/searchTerm.ts:23-28`).

Lo que hay hoy y **desaparece o cambia**: el «← Volver a {nombre}» de
`src/app/[slug]/sucursales/page.tsx:44-49`, el `<a href>` (en vez de `<Link>`)
de `src/app/[slug]/pedido/[code]/page.tsx:299`, y los dos `<Link href="..">`
relativos de `src/app/[slug]/pedido/[code]/not-found.tsx:16` y
`src/app/[slug]/c/[categorySlug]/not-found.tsx:29`.

Lo que **no** existe todavía y este feature estrena: JSON-LD. `grep -rn "ld+json" src/`
no devuelve nada; los dos únicos `dangerouslySetInnerHTML` del repositorio son
los `<style>` del tema en `src/app/[slug]/layout.tsx:39` y `:74`. No hay patrón
que copiar, así que este feature lo funda (§ El JSON-LD).

### Las cifras de hoy, medidas, no supuestas

Con `next build && next start` sobre una copia limpia del árbol (Next 16.3.2,
base de desarrollo):

| Página                                | HTML servido | `<a>` reales | `href="/…"` distintos |
| ------------------------------------- | ------------ | ------------ | --------------------- |
| `/tienda-demo`                        | 64 428 B     | 23           | 26                    |
| `/tienda-demo/c/bebidas`              | 30 998 B     | 12           | 15                    |
| `/tienda-demo/p/arroz-blanco-1-kg`    | 20 235 B     | 4            | 8                     |
| `/tienda-demo/carrito`                | 10 878 B     | 4            | 6                     |
| `/el-trebol` (selector, 2 sucursales) | 13 014 B     | 3            | —                     |

Y el build marca hoy `● /tienda-demo`, `● /tienda-demo/c/alimentos` y
`● /tienda-demo/p/arroz-blanco-1-kg`: las tres rutas que R18 protege siguen
pre-renderizadas. Ese es el punto de partida contra el que se comparan los
criterios 3 y 19.

## Decisión

**Un tipo de dato —una lista de eslabones— construido por funciones puras en
src/features/storefront/trail.ts (por crear), y un único componente de servidor
src/components/store/StoreTrail.tsx (por crear) que lo pinta, monta el control
de «atrás» derivado de esa misma lista y, cuando la pantalla es indexable,
serializa el `BreadcrumbList`.** Las diez pantallas llaman a una función por
pantalla —todas envoltorios de una línea sobre el mismo constructor— y pasan el
resultado al componente. Cero JavaScript de cliente, cero consultas nuevas, cero
APIs dinámicas.

Por qué esta forma y no otra:

- **Una lista, no JSX.** El criterio que manda lo fijó la spec en § No decidido a
  propósito: insertar un eslabón tiene que ser añadir un elemento a una lista, no
  reescribir diez páginas. SP4 ya lo demostró una vez —la categoría entró en dos
  pantallas— y la subcategoría lo va a volver a demostrar (§ La prueba de la
  subcategoría).
- **El «atrás» no es un dato aparte.** Es `backTarget(trail)`, el penúltimo
  eslabón, calculado dentro del componente. Ninguna página puede apuntarlo a otro
  sitio, así que R2 deja de ser una regla que alguien recuerda y pasa a ser una
  consecuencia de la estructura.
- **El último eslabón nunca lleva `href` porque el constructor se lo quita**, no
  porque el llamador se acuerde de pasar `null`. R5/E16 se vuelve inviolable.

Alternativas descartadas, una línea cada una:

- **Pintarlo en `src/app/[slug]/layout.tsx`**: el layout no sabe en qué ruta hija
  está y averiguarlo exige `headers()` o una cabecera del proxy — I1, R18, y el
  `matcher` de `src/proxy.ts:6-12` tiene prohibido tocar `/[slug]`.
- **Un componente de cliente con `usePathname()`**: es lo que la documentación de
  Next sugiere para este caso
  (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md`,
  § Examples), y aquí está vetado dos veces: R8 y AGENTS.md § Prohibiciones.
- **Un `Crumb` con variantes por tipo de eslabón** (`{kind: "brand" | "branch" | …}`):
  no aporta nada. `backTarget` es «el penúltimo» y el `BreadcrumbList` es «la
  lista numerada»; ninguna de las dos operaciones pregunta de qué tipo es un
  eslabón. La spec ya lo dice y se confirma.
- **Un `switch` por pantalla dentro de una única función**
  (`buildTrail(screen, data)`): obliga a un tipo unión de datos que crece con
  cada pantalla y a que el llamador acierte el discriminante. Diez envoltorios de
  una línea sobre un constructor común dan lo mismo con mejor autocompletado y sin
  unión que mantener.
- **Poner la lógica en `src/lib/`**: § Componentes lo argumenta.

## Componentes

| Componente                                                    | Capa                   | Responsabilidad                                                                                                                   | Archivo                                                |
| ------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `Crumb`, `Trail`, `TrailStep`, `TrailStore`, `BackTarget`     | `features/storefront/` | Los tipos del rastro. Sin Prisma, sin React                                                                                       | src/features/storefront/trail.ts (por crear)           |
| `storeTrail`, `backTarget`, los diez envoltorios por pantalla | `features/storefront/` | Construir la lista y derivar el «atrás». Funciones puras, testeables en el proyecto `node`                                        | src/features/storefront/trail.ts (por crear)           |
| `breadcrumbList`                                              | `features/storefront/` | Convertir un `Trail` en el objeto `BreadcrumbList` de schema.org, o `null` si tiene menos de dos eslabones                        | src/features/storefront/trail.ts (por crear)           |
| `jsonLdScriptContent`                                         | `lib/`                 | Serializar cualquier objeto JSON-LD para meterlo en un `<script>` sin abrir un agujero de inyección. Agnóstico de dominio         | src/lib/jsonLd.ts (por crear)                          |
| `StoreTrail`                                                  | `components/store/`    | Pintar `<nav aria-label="Ruta">`, el `<ol>`, el control de «atrás» y el `<script type="application/ld+json">`. Sin `"use client"` | src/components/store/StoreTrail.tsx (por crear)        |
| `StoreNotFound`                                               | `app/`                 | El 404 con el marco de la tienda para todo `/[slug]/**` que no tenga uno propio (I6, E15)                                         | src/app/[slug]/not-found.tsx (por crear)               |
| Las diez páginas                                              | `app/`                 | Construir su `TrailStore`, llamar a su envoltorio y montar `StoreTrail`. Nada más                                                 | `src/app/[slug]/page.tsx` y las nueve de § Qué se toca |

Se reutiliza **sin tocar**: `requireResolution`, `requireStore`,
`getStoreCatalog`, `getStoreCategoryView`, `canonicalSlug`, `PublicSlug`,
`storeCategoryPath`, `formatOrderCode`, `StoreSearchResult.term`, `Container`,
`BranchBar`, `StoreCategoryNav`, `StoreClosedNotice`, `StoreSearchBox`,
`expandBrandTouch`, `storeCatalogTag`, `storeTag`, `slugTag`, `next/link`.

### Por qué `features/storefront/` y no `lib/`

La tabla de AGENTS.md dice que `src/lib/` es «lógica pura y reutilizable, sin
Prisma, sin React», y el rastro es pura. Pero el reparto que este repositorio
practica de verdad —y que es el que hay que imitar— separa por **conocimiento de
dominio**, no por pureza: `src/features/catalog/storeCategories.ts` es
igual de pura («No Prisma, no React», dice su propia cabecera en la línea 7) y
vive en `features/`, mientras que `src/lib/` guarda lo que no sabe de este
producto (`money`, `pricing`, `availability`, `slug`, `searchTerm`, `orderCode`,
`publicSlug`). El rastro sabe demasiado: sabe que existen marcas y sucursales,
que el carrito cuelga de la sucursal y el pagar del carrito, y qué etiqueta lleva
cada pantalla en español. Eso es dominio.

Y dentro de `features/`, `storefront/` y no `catalog/` por la razón que ya dejó
escrita `src/features/storefront/server/resolve.ts:8-11` para el resolvedor: lo
consumen catálogo, pedidos y carrito por igual, y meterlo en cualquiera de ellos
obligaría a los otros dos a importar de un dominio ajeno.

La única pieza que **sí** va a `src/lib/` es la serialización de JSON-LD: eso no
sabe nada de tiendas y el próximo dato estructurado que llegue (`Product`,
`LocalBusiness`) lo va a querer igual.

## Contratos

Todo en src/features/storefront/trail.ts (por crear). Comprobado con
`tsc --strict` antes de escribirlo: la forma de abajo compila; dos variantes que
parecían equivalentes, no (§ La trampa del tipo tupla).

```ts
/** Un eslabón. `href: null` marca el actual — y solo el último puede serlo. */
export type Crumb = { readonly label: string; readonly href: string | null };

/** Nunca vacío: toda pantalla pública de tienda tiene al menos su propio eslabón. */
export type Trail = readonly [Crumb, ...Crumb[]];

/** Un tramo tal y como lo declara el llamador: etiqueta y a dónde llevaría.
 *  El constructor le quita el href al último, así que R5/E16 no depende de que
 *  nadie se acuerde de pasar `null`. */
export type TrailStep = { readonly label: string; readonly href: string };

/** El destino de «atrás». Nunca tiene `href: null`, por construcción. */
export type BackTarget = { readonly label: string; readonly href: string };

/** El contexto mínimo del que cuelga cualquier rastro. Mismo discriminante que
 *  `PublicResolution`, para que no haya dos vocabularios. */
export type TrailStore =
  | { readonly kind: "brand"; readonly brandSlug: PublicSlug; readonly brandName: string }
  | {
      readonly kind: "branch";
      readonly brandSlug: PublicSlug;
      readonly brandName: string;
      readonly branchCount: number;
      readonly canonicalSlug: PublicSlug;
      readonly branchName: string;
    };

/** Adaptadores. Tipos estructurales a propósito: `BranchResolution` y
 *  `StoreSummary` los satisfacen sin que este módulo importe ni el resolvedor
 *  ni la capa de consultas. */
export function branchTrailStore(
  resolution: { brandSlug: PublicSlug; branchCount: number },
  store: { canonicalSlug: PublicSlug; name: string; brandName: string },
): TrailStore;
export function brandTrailStore(resolution: {
  brandSlug: PublicSlug;
  brandName: string;
}): TrailStore;

/** EL constructor. `steps` son tramos intermedios, todos enlazados; `current`
 *  es la etiqueta de la pantalla actual. Sin `current`, el último de
 *  (espina + steps) pierde su href y pasa a ser el actual. */
export function storeTrail(
  store: TrailStore,
  options?: { readonly steps?: readonly TrailStep[]; readonly current?: string },
): Trail;

/** El penúltimo eslabón, o `null` si el rastro tiene uno solo (R2). */
export function backTarget(trail: Trail): BackTarget | null;
```

La **espina** (lo que `storeTrail` pone siempre delante) es exactamente R4:

```ts
kind: "brand"                      → [ {brandName,  /brandSlug} ]
kind: "branch", branchCount  >  1  → [ {brandName,  /brandSlug}, {branchName, /canonicalSlug} ]
kind: "branch", branchCount === 1  → [ {branchName, /canonicalSlug} ]
```

Los envoltorios por pantalla, todos de una o dos líneas:

```ts
export function catalogTrail(store: TrailStore): Trail;
export function categoryTrail(store: TrailStore, category: { name: string }): Trail;
export function productTrail(
  store: TrailStore,
  product: {
    name: string;
    categoryName: string | null;
    categorySlug: string | null;
  },
): Trail;
export function searchTrail(store: TrailStore, term: string | null): Trail;
export function cartTrail(store: TrailStore): Trail;
export function checkoutTrail(store: TrailStore): Trail;
export function orderTrail(store: TrailStore, code: string): Trail;
export function branchSwitchTrail(store: TrailStore): Trail;
```

Y las etiquetas fijas de R11, en un solo sitio y en español:

```ts
export const TRAIL_LABEL = {
  cart: "Carrito",
  checkout: "Pagar",
  branchSwitch: "Cambiar de sucursal",
  search: "Buscar",
} as const;
```

Vive en el mismo módulo, no en `src/constants/`, con el precedente de
`AVAILABILITY_LABEL` (`src/lib/availability.ts`): la etiqueta va pegada a la
lógica que la usa, y lo que AGENTS.md prohíbe es la cadena suelta repetida, que
es justo lo que esto elimina —«Carrito» aparece en dos rastros distintos
(`/carrito` y `/checkout`) y tiene que ser la misma palabra.
Las etiquetas variables no son constantes: `Buscar «${term}»` y
`Pedido ${formatOrderCode(code)}` se componen en sus envoltorios.

### La trampa del tipo tupla

`Trail = readonly [Crumb, ...Crumb[]]` **se sostiene** con el `strict` de este
repositorio, pero solo si el constructor arma la lista **por delante**:

- `[first, ...rest]` infiere `[Crumb, ...Crumb[]]` — compila.
- `[...rest, last]` infiere `[...Crumb[], Crumb]` — **no** compila:
  «Source provides no match for required element at position 0 in target».
- `crumbs.map(...)` devuelve `Crumb[]` y pierde la tupla — tampoco compila.

O sea: el «quitarle el href al último» no se puede escribir como un `map` sobre
la lista completa. Se escribe desestructurando el primero (que siempre existe,
porque la espina nunca es vacía) y mapeando el resto. Está comprobado con
`tsc --strict --noEmit`, no deducido. `tsconfig.json` no tiene
`noUncheckedIndexedAccess`, así que `trail[trail.length - 2]` tipa como `Crumb`
y `backTarget` tiene que guardar la longitud a mano — lo hace.

### El componente

```tsx
export function StoreTrail({
  trail,
  jsonLd = false,
}: {
  trail: Trail;
  /** Solo las pantallas indexables lo piden (R13). Por omisión no se emite:
   *  el valor seguro es no declarar datos estructurados. */
  jsonLd?: boolean;
}): ReactElement;
```

Estructura del marcado, fija (el aspecto lo cierra `sdd-designer`, esto es el
contrato):

- Un `<nav aria-label="Ruta">` por pantalla. Uno solo.
- Dentro, **un `<ol>` y nada más que eslabones**: un `<li>` por `Crumb`, con
  `<a href>` cuando `href !== null` y con `<span aria-current="page">` en el
  último. Los separadores son decorativos: `aria-hidden="true"` o CSS (R15).
- El control de «atrás» va **dentro del mismo `<nav>` y fuera del `<ol>`**. Esto
  no es estética: hace que «cuántos eslabones tiene el rastro» sea contar `<li>`
  y no `<a>`, que es lo que los criterios 5 y 12 miden. Quien escriba
  `smoke.sh` cuenta `<li>` dentro de `<nav aria-label="Ruta">`.
- El «atrás» sale de `backTarget(trail)` **dentro del componente**. Si es `null`,
  no se pinta nada (E1, E12, criterio 12).
- El `<script type="application/ld+json">` es hermano del `<nav>`, dentro del
  mismo fragmento.
- Cada `<a>` con área táctil de 44 px (`min-h-11`), R17.

`StoreTrail` no recibe el slug, ni la resolución, ni el `store`: recibe un
`Trail` ya construido. Es lo que impide que una pantalla componga el rastro de
otra manera.

## Cómo se construye el rastro en cada pantalla, y de dónde sale cada dato

`{M}` = marca (solo si `branchCount > 1`, R4). `{S}` = sucursal.

| Pantalla                                | Llamada                                          | Rastro                                | JSON-LD |
| --------------------------------------- | ------------------------------------------------ | ------------------------------------- | ------- |
| `/[slug]` selector                      | `catalogTrail(brandTrailStore(resolution))`      | `{M}`                                 | no (1)  |
| `/[slug]` sucursal abierta              | `catalogTrail(store)`                            | `{M}` › `{S}`                         | sí (2)  |
| `/[slug]` sucursal cerrada              | `catalogTrail(store)`                            | `{M}` › `{S}`                         | no      |
| `/[slug]/c/[categorySlug]` abierta      | `categoryTrail(store, view.category)`            | `{M}` › `{S}` › `{Categoría}`         | sí      |
| `/[slug]/c/[categorySlug]` cerrada      | `catalogTrail(store)`                            | `{M}` › `{S}`                         | no      |
| `/[slug]/p/[productSlug]` abierta       | `productTrail(store, product)`                   | `{M}` › `{S}` › `{Cat}` › `{Prod}`    | sí      |
| `/[slug]/p/[productSlug]` sin categoría | `productTrail(store, product)`                   | `{M}` › `{S}` › `{Prod}`              | sí      |
| `/[slug]/p/[productSlug]` cerrada       | `catalogTrail(store)`                            | `{M}` › `{S}`                         | no      |
| `/[slug]/buscar` sin `q`                | `searchTrail(store, null)`                       | `{M}` › `{S}` › `Buscar`              | no      |
| `/[slug]/buscar?q=…`                    | `searchTrail(store, result.term)`                | `{M}` › `{S}` › `Buscar «término»`    | no      |
| `/[slug]/carrito`                       | `cartTrail(store)`                               | `{M}` › `{S}` › `Carrito`             | no      |
| `/[slug]/checkout`                      | `checkoutTrail(store)`                           | `{M}` › `{S}` › `Carrito` › `Pagar`   | no      |
| `/[slug]/pedido/[code]`                 | `orderTrail(store, order.code)`                  | `{M}` › `{S}` › `Pedido XXXXX-XXXXX`  | no      |
| `/[slug]/sucursales` desde una sucursal | `branchSwitchTrail(store)`                       | `{M}` › `{S}` › `Cambiar de sucursal` | no      |
| `/[slug]/sucursales` desde la marca     | `branchSwitchTrail(brandTrailStore(resolution))` | `{M}` › `Cambiar de sucursal`         | no      |

(1) Con un solo eslabón no hay camino que declarar: § El JSON-LD lo argumenta.
(2) Solo cuando `branchCount > 1`, por lo mismo.

**De dónde sale cada campo, y esto importa más de lo que parece:**

| Campo                       | Fuente                                                            | Etiqueta de caché           |
| --------------------------- | ----------------------------------------------------------------- | --------------------------- |
| `brandSlug` (href de `{M}`) | `resolution.brandSlug`                                            | `slug:<pedido>`             |
| `branchCount` (¿hay `{M}`?) | `resolution.branchCount`                                          | `slug:<pedido>`             |
| `brandName` (etiqueta)      | **`store.brandName`** (`StoreSummary`), no `resolution.brandName` | `store:<canónico>`          |
| `canonicalSlug`             | `store.canonicalSlug`                                             | `store:<canónico>`          |
| `branchName`                | `store.name`                                                      | `store:<canónico>`          |
| Categoría (nombre y slug)   | `product.categoryName`/`categorySlug` o `view.category`           | `store:<canónico>:catalog`  |
| Nombre del producto         | `product.name`                                                    | `store:<canónico>:catalog`  |
| Término de búsqueda         | `result.term`                                                     | sin caché (`force-dynamic`) |
| Código del pedido           | `order.code`                                                      | sin caché (`force-dynamic`) |

La fila en negrita es una decisión, no un detalle. `resolution.brandName` y
`store.brandName` son la misma cadena (`Storefront.name`) leída por dos caminos
con etiquetas **distintas**: el primero solo se invalida con `slug:<valor>`, que
por diseño **no** se dispara en una escritura de branding —lo dice
`expandBrandRevalidation` en `src/features/storefront/server/registry.ts:299-302`:
«a branding write does not change any slug's RESOLUTION … so this never calls
`revalidateSlugs`»—, y el segundo se invalida con `revalidateStores()`, que toda
escritura de marca sí dispara (`src/features/admin/server/mutations.ts:103-108`).
Hoy **ningún** escritor renombra una marca (el único
`prisma.storefront.update` del repositorio escribe `themeTokens`,
`src/features/admin/server/mutations.ts:125-131`, y el handler `STORE` del sync
solo pasa el nombre de marca al **crear**,
`src/features/sync/server/handlers/store.ts:159`), así que el fallo no es
alcanzable todavía; leerlo del sitio bien etiquetado desde el primer día es lo
que evita que lo sea el día que alguien añada el renombrado. Las dos pantallas
que no tienen `StoreSummary` a mano —`/[slug]` en modo selector y
`/[slug]/sucursales` bajo el slug de la marca— usan `resolution.brandName`, que
es exactamente el mismo valor que sus propias páginas ya pintan hoy
(`src/app/[slug]/layout.tsx:44`, `src/app/[slug]/page.tsx:86`): no se introduce
ninguna dependencia nueva, y pedir `getStorefrontBranding()` allí sería una
lectura más para no arreglar nada.

### Dónde se monta, en el DOM

R10, aterrizado: el rastro va **siempre por encima del `<h1>`** y por encima del
`StoreSearchBox`, y nunca dentro de otro `<nav>`.

- Páginas que abren con `<BranchBar>` (`/[slug]` abierta,
  `/[slug]/c/[categorySlug]` abierta, `/[slug]/p/[productSlug]` abierta,
  `/[slug]/buscar` abierta): inmediatamente **después** de `<BranchBar>`.
- Páginas sin `BranchBar` (`/carrito`, `/checkout`, `/pedido/[code]`,
  `/sucursales`, y el modo selector de `/[slug]`): primer hijo del primer
  `<Container>`.
- Ramas de tienda cerrada: primer hijo del `<Container>` que envuelve a
  `StoreClosedNotice`. En esas ramas `<BranchBar>` va **después** del contenido
  (`src/app/[slug]/page.tsx:121-126`), y eso no se toca.

Si el rastro va dentro o fuera del `<Container>`, con cuánto aire y con qué
separador, lo cierra `sdd-designer`.

## El 404 dentro de una tienda: lo que Next 16 hace de verdad

Esta sección responde el hallazgo 1 de `.agent/specs/F-026/tests.md`, que
`sdd-tester` dejó dirigido explícitamente a este agente.

### Lo que se midió

Con una copia limpia del árbol, `next build` y `next start` (no `next dev`), en
Next 16.3.2:

| Petición                         | Estado | `<a>` reales | `data-store="…"` en el HTML |
| -------------------------------- | ------ | ------------ | --------------------------- |
| `/tienda-demo`                   | 200    | 23           | sí                          |
| `/tienda-demo/p/no-existe`       | 404    | **0**        | **no**                      |
| `/tienda-demo/c/no-existe`       | 404    | **0**        | **no**                      |
| `/tienda-demo/pedido/ZZZZZZZZZZ` | 404    | **0**        | **no**                      |
| `/tienda-que-no-existe`          | 404    | **0**        | **no**                      |
| `/a/b/c/d/e` (ninguna ruta casa) | 404    | 1            | —                           |

El cuerpo de esos 404 es, literalmente, esto —62 caracteres sin contar los
`<script>`:

```html
<body>
  <div hidden=""><!--$--><!--/$--></div>
  …scripts…
</body>
```

Y el documento abre con `<html id="__next_error__">`. Todo el contenido —la
cabecera de la tienda, su `data-store`, el enlace canónico del layout y el
cuerpo del `not-found.tsx`— viaja **solo** dentro del payload de React Flight,
escapado (`data-store\":\"tienda-demo\"`), y lo pinta el navegador al hidratar.

### Por qué

`notFound()` lanza un error con digest `NEXT_HTTP_ERROR_FALLBACK;404`. Quien lo
recoge es `HTTPAccessFallbackBoundary`
(`node_modules/next/dist/client/components/http-access-fallback/error-boundary.js:96`),
que es un **componente de cliente** con `getDerivedStateFromError`. React no
ejecuta los error boundaries de clase durante el render de servidor, así que el
error atraviesa todo el árbol SSR hasta la raíz y cae en el `catch` de
recuperación de `node_modules/next/dist/server/app-render/app-render.js:2364`.
Ese camino pone el estado en 404 (línea 2382-2385) y sirve el árbol que fabrica
`getErrorRSCPayload`, cuyo `seedData` es —está escrito así en la línea 1324-1336—
un `<html id="__next_error__">` con `<head>` y `<body>` **vacíos**.

Lo contrario también se midió, y es la otra mitad de la ficha
`.agent/playbook/nextjs-loading-tsx-rompe-status-code-de-notfound.md`: metiendo
un `<Suspense>` entre el layout y `{children}`, el HTML **sí** sale entero
(23 `<a>`, `data-store` presente) y el estado pasa a ser **200**. Son las dos
caras de la misma moneda:

> **sin frontera de suspense → 404 correcto con cuerpo vacío; con frontera de
> suspense → cuerpo correcto con 200.** No hay una tercera casilla.

Ninguna de las dos depende de este feature: es así hoy, en `main`, para los tres
`notFound()` que ya existen.

### Lo que sí se puede hacer, y lo que no

Añadir src/app/[slug]/not-found.tsx (por crear) **no** arregla el HTML: se probó
en la copia, con un cuerpo marcado, y el marcador aparece solo dentro del
payload. Lo que sí consigue es que **el árbol que el navegador recupera sea el de
la tienda**: se verificó que el payload del 404 lleva el `<div data-store="tienda-demo">`
del layout y su `<Link href="/tienda-demo">`. Es decir: con JavaScript, E15 se
cumple entera y el criterio 9 se cumple entero; sin JavaScript, un 404 dentro de
una tienda es una página en blanco — y ya lo es hoy, en `main`, en los tres 404
que existen.

### La decisión, y de quién es cada mitad

**RESUELTO por el humano el 2026-08-31: «Construirlo y reformular el criterio»**
— la opción (a) de las tres que se le plantearon. Con sus consecuencias
escritas, que es lo que evita que dentro de tres meses alguien crea que esto se
verificó mal:

**Lo que construye F-025.** src/app/[slug]/not-found.tsx (por crear), con el
efecto real y medido: el árbol que el navegador recupera es el de la tienda —el
payload del 404 lleva el `<div data-store="tienda-demo">` del layout y su
`<Link href="/tienda-demo">`—, así que **con JavaScript** E15 se cumple entera y
el criterio 9 se cumple entero. Se verifica en la etapa `--visual` del arnés,
con navegador, que es lo que corresponde a un comportamiento que ocurre en el
navegador; es exactamente lo que hizo F-026 en su V9. El criterio 9 ya dice eso
con todas las letras en `.agent/features.json`, y el 21 quedó reformulado en la
mitad que sí es de este feature: que **ningún `not-found.tsx` del segmento
conserve un `href=".."` relativo**, comprobable con `grep` sobre el código y sin
depender de lo que el servidor sirva.

**Lo que F-025 explícitamente NO arregla.** Que el HTML **servido** lleve el
enlace. Eso es de
`.agent/specs/propuestas/404-sin-salida-sin-javascript.md`, escrita a petición
del humano el 2026-08-31 sobre el mismo hallazgo, cuyo § Alcance ya nombra los
tres archivos y cuyo punto 3 pide «decidir POR QUÉ ocurre antes de parchear». La
frontera entre los dos features es limpia: **F-025 decide qué eslabones tiene el
rastro y a dónde van; la propuesta decide cómo se sirve el HTML de un
`notFound()`.** Un cambio en la segunda no toca una línea de la primera.

**Para quien recoja esa propuesta** (su I4 y su SP1 piden justamente esto, y es
la parte que aquí ya está medida y no hay que volver a medir):

- El porqué está en `node_modules/next/dist/server/app-render/app-render.js:2364`
  (el `catch` de recuperación al que llega el error porque
  `HTTPAccessFallbackBoundary` es un componente de **cliente** y React no ejecuta
  error boundaries de clase en SSR) y en `:1324-1336` (el `seedData` que ese
  camino sirve es un `<html id="__next_error__">` con `<head>` y `<body>`
  **vacíos** — el cuerpo vacío no es un efecto colateral, está construido así).
- La alternativa que primero se le va a ocurrir a cualquiera —meter una frontera
  de suspense— **se probó en este ciclo**: devuelve el HTML entero (23 `<a>`,
  `data-store` presente) y convierte el 404 en **200**, o sea rompe su propia R2.
  Es la misma cara que ya fichó
  `.agent/playbook/nextjs-loading-tsx-rompe-status-code-de-notfound.md`.
- Su SP2 (si la página de error 500 sufre lo mismo) **no** se comprobó aquí: no
  estaba en el encargo de este ciclo y no afecta a ninguna decisión de F-025.
- Y su caso límite «el arreglo obliga a que el 404 sea estático» tiene un aviso
  concreto de este documento: cualquier arreglo que meta una API dinámica dentro
  de un `not-found.tsx` del segmento vuelve `ƒ` las tres rutas que hoy son `●`,
  porque ese archivo se ejecuta en **cada** render del segmento (§ Un efecto
  secundario).

### Un efecto secundario que hay que respetar

El elemento de `not-found.tsx` se le pasa como **prop** a un componente de
cliente (`node_modules/next/dist/server/app-render/create-component-tree.js:440`),
así que React lo serializa —y por tanto lo ejecuta— en cada render del segmento,
haya 404 o no. Next lo dice de su propio camino equivalente en el comentario de
la línea 621-624: «it needlessly invokes the `NotFound` component». **Medido**:
el marcador del `not-found.tsx` de prueba aparece en el payload de
`/tienda-demo` (200) y de una ficha de producto válida (200).

Tres consecuencias, todas de obligado cumplimiento:

1. Un `not-found.tsx` de este segmento **no puede ser `async` ni tocar
   `headers()`, `cookies()` ni ninguna consulta**: lo pagaría cada página, y una
   API dinámica ahí volvería `ƒ` las tres rutas que R18 protege.
2. Su cuerpo tiene que ser **corto**: son bytes en el payload de todas las
   páginas de la tienda (§ Escalabilidad).
3. Y explica por qué se descarta el apaño que parecía más listo (§ siguiente).

## Los dos `not-found.tsx` sin `params`: la solución, que es una sola

E21/I3/I10 piden una salida en slug canónico desde
`src/app/[slug]/pedido/[code]/not-found.tsx` y
`src/app/[slug]/c/[categorySlug]/not-found.tsx`, y exigen que sea **la misma**
para los dos.

**No existe forma de que un `not-found.tsx` conozca el slug.** No es una
limitación de esta versión ni una laguna de la documentación: es explícito por
partida doble. La documentación de esta versión dice «`not-found.js` or
`global-not-found.js` components do not accept any props»
(`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md`,
§ Reference › Props), y el código que lo instancia lo confirma sin margen:
`createElement(Component, null)`
(`node_modules/next/dist/server/app-render/create-component-tree.js:767`) — props
literalmente `null`. No hay un punto más profundo de la jerarquía donde sí los
haya: la carencia es de la convención, no de la profundidad.

Descartadas, con motivo:

- **`headers()` para reconstruir la ruta**: prohibido por R18 (lo pagaría cada
  render del segmento, § efecto secundario) y, aparte, inútil: no hay cabecera
  documentada que lleve el `pathname`, y el slug es un segmento de ruta, no el
  host.
- **Un almacén por petición con `React.cache` que la página rellena antes de
  lanzar `notFound()`**: parecía la buena y **está muerta por la medición de
  arriba** — el `not-found.tsx` se ejecuta como prop del boundary, en paralelo
  con la página, no después de ella. Leería `null`, o no, según el orden en que
  React resuelva dos ramas hermanas. Un fallo no determinista que ningún sensor
  ve es exactamente lo que `.agent/playbook/` existe para evitar.
- **Un `<Link href="..">` relativo**, que es lo que hay hoy: conserva el alias
  (I3, I10) y viola R3.
- **Que el layout pinte una salida oculta que CSS `:has()` revela cuando el hijo
  es el 404**: funciona sin JavaScript y es demasiado listo. Deja un `<a>`
  permanente en todas las páginas de la tienda (bytes, prefetch, y un riesgo
  directo contra el criterio 11 si su texto contiene «Volver a»), y se rompe en
  silencio el día que alguien quite el atributo marcador.

**La decisión: la salida canónica de todo 404 dentro de una tienda la pone
`src/app/[slug]/layout.tsx`, que es el nodo más profundo del árbol que (a) tiene
`params`, (b) envuelve siempre al cuerpo del `not-found`, y (c) ya resuelve el
slug canónico y ya pinta un enlace a él** (`src/app/[slug]/layout.tsx:85-90`, con
`data-store` en la línea 73). Los tres `not-found.tsx` del segmento pierden su
enlace propio: se quedan con el mensaje y nada más. Resultado: cero `href=".."`
en el repositorio y cero aliases propagados, que es exactamente lo que mide el
criterio 21 ya reformulado —un `grep` sobre `src/app/[slug]/` que no puede
devolver nada—; y el camino de vuelta canónico lo pone la cabecera del layout,
recuperada con el resto del árbol de la tienda.

**La degradación conocida, dicha entera**: en una tienda **cerrada** la cabecera
pinta el nombre como `<span>`, no como `<Link>`
(`src/app/[slug]/layout.tsx:80-83`, HD11: «there is nowhere else on this page to
go to»). Un 404 dentro de una tienda cerrada se queda entonces sin ninguna
salida. Son dos URL concretas y ninguna más:
`/[slug-cerrado]/pedido/<código inválido>` y `/[slug-cerrado]/sucursales` (que
404 cuando la marca tiene una sola sucursal,
`src/app/[slug]/sucursales/page.tsx:33`); `/[slug-cerrado]/p/…` y
`/[slug-cerrado]/c/…` responden 200 con el aviso, no 404. **No se toca HD11 para
esto**: convertir la cabecera en enlace siempre haría que la página de una tienda
cerrada enlace a sí misma, que es lo que esa decisión evitó a propósito, y el
rastro entero se apoya en no enlazar nunca la página actual. Si `sdd-designer`
quiere una salida visible ahí, el único sitio con el slug canónico a mano es el
layout —cabecera o pie—, y es una decisión suya, no de este documento.

## El JSON-LD de `BreadcrumbList`

**Dónde se genera.** El objeto lo arma `breadcrumbList(trail, siteUrl)` en
src/features/storefront/trail.ts (por crear), a partir del **mismo** `Trail` que
pinta el `<ol>`: es imposible que el dato estructurado y lo que ve el comprador
digan cosas distintas. Lo serializa `jsonLdScriptContent()` en src/lib/jsonLd.ts
(por crear) y lo monta `StoreTrail` cuando su prop `jsonLd` es `true`.

**La forma:**

```ts
export type BreadcrumbListJsonLd = {
  readonly "@context": "https://schema.org";
  readonly "@type": "BreadcrumbList";
  readonly itemListElement: readonly {
    readonly "@type": "ListItem";
    readonly position: number;
    readonly name: string;
    /** Absoluto. Ausente en el último eslabón: schema.org lo permite y el
     *  eslabón actual no tiene URL propia que declarar. */
    readonly item?: string;
  }[];
};
```

`item` se construye con `new URL(crumb.href, publicEnv.siteUrl).toString()` —el
mismo `publicEnv.siteUrl` (`src/lib/env.ts:34`) que ya usa
`alternates.canonical` en `src/app/[slug]/page.tsx:51` y en
`src/app/[slug]/c/[categorySlug]/page.tsx:60`.

**Cómo se serializa sin abrir un agujero.** Las etiquetas vienen del POS: el
nombre de una categoría o de un producto es texto de un comerciante, y
`</script>` dentro de un `<script>` cierra el bloque. La receta es la que
documenta esta versión de Next
(`node_modules/next/dist/docs/01-app/02-guides/json-ld.md`, línea 34):

```ts
export function jsonLdScriptContent(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
```

`<` es `<` dentro de una cadena JSON, así que el JSON sigue siendo el mismo
documento y ningún `</script`, `<!--` ni `<script` puede escapar del bloque. Va
con test propio en src/lib/jsonLd.test.ts (por crear), con una categoría llamada
`</script><script>alert(1)</script>` como caso.

**En cuáles de las diez pantallas se monta.** R13, con una precisión: solo si el
rastro tiene **dos o más** eslabones. Un `BreadcrumbList` de un solo elemento sin
`item` no describe ningún camino —no hay nada que un rastreador pueda hacer con
él— y por eso `breadcrumbList()` devuelve `null` en ese caso y `StoreTrail` no
pinta el `<script>`. En la práctica eso solo afecta a `/tienda-demo` y al
selector de una marca, que son precisamente los techos. Se monta, entonces, en:
`/[slug]` en modo sucursal de una marca multi-sucursal, `/[slug]/c/[categorySlug]`
y `/[slug]/p/[productSlug]`, **siempre que la tienda esté `PUBLISHED`** — una
tienda cerrada declara `robots: { index: false }` en sus tres
`generateMetadata` (`src/app/[slug]/page.tsx:53-59`,
`src/app/[slug]/c/[categorySlug]/page.tsx:50-52`,
`src/app/[slug]/p/[productSlug]/page.tsx:67-69`) y meter datos estructurados en
una página que se pide no indexar es contradecirse en el mismo HTML. Nunca en
`/buscar`, `/carrito`, `/checkout`, `/pedido/[code]` ni `/sucursales`: las cinco
ya declaran `robots: { index: false }`.

## `prefetch`: se queda el valor por defecto

`next/link` con `prefetch` por omisión («auto») prefetchea **la ruta completa,
con sus datos, si es estática**, y solo la parte hasta la frontera de `loading.js`
más cercana si es dinámica
(`node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md`,
línea 302). En este segmento no hay ningún `loading.tsx`
(F-021 lo quitó, ficha `nextjs-loading-tsx-rompe-status-code-de-notfound`), así
que las pantallas dinámicas prefetchean casi nada.

Lo que decide es que la caché de prefetch del router se indexa por `href`: **dos
`<Link>` al mismo destino cuestan una sola petición.** Y los destinos del rastro
ya están enlazados desde la misma página. Medido en la ficha de producto de
`tienda-demo`, cuyos únicos `href` internos hoy son:

```
/tienda-demo               (cabecera del layout)   ← el eslabón de la sucursal
/tienda-demo/c/alimentos   (chip de categoría)     ← el eslabón de la categoría
/tienda-demo/carrito       (CartBadge)
/cuenta?desde=/tienda-demo (AccountBadge)
```

De los cuatro `<Link>` que el rastro añade a esa página —marca, sucursal,
categoría y «atrás»— **ninguno estrena un destino** en una marca de una sola
sucursal, y el «atrás» apunta por definición al mismo sitio que el penúltimo
eslabón. El único destino verdaderamente nuevo que este feature introduce en
todo el storefront es `/{brandSlug}` en modo selector, y solo en marcas
multi-sucursal: 13 014 B de HTML medidos en `/el-trebol`, contra los 64 428 B de
un catálogo. Es, además, el destino que el eslabón existe para ofrecer.

**Decisión: sin `prefetch={false}`.** El criterio, que es lo que hay que dejar
escrito y no el veredicto: se pone `prefetch={false}` en un eslabón cuando (a)
su `href` **no** está ya enlazado desde esa misma página y (b) su destino es una
rejilla de catálogo completa. Hoy no hay ningún eslabón que cumpla las dos, y el
día que lo haya —el eslabón de subcategoría, si algún día enlaza a un catálogo
grande— se aplica esa regla y se anota la medición, igual que se anota una subida
de `BUDGET_KB`. Corolario para el implementador y para `sdd-designer`: **el
control de «atrás» tiene que usar exactamente la misma cadena `href` que el
penúltimo eslabón** —que es lo que hace `backTarget()`— porque es lo que lo deja
en cero peticiones.

## La invalidación: verificada, y nada nuevo hace falta

La spec concluyó que las etiquetas ya existentes bastan. Se comprobó campo por
campo (la tabla de § Cómo se construye…), y la conclusión es la misma con una
precisión que la spec no tenía: **`brandName` se lee de `StoreSummary`, no de la
resolución**, y esa precisión es justo lo que cierra el hueco que la ficha
`.agent/playbook/revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md`
describe.

El caso peligroso que la spec marcó —una marca que pasa de una a dos sucursales
con la página en caché— sí está cubierto, y por la razón exacta:

1. Agrupar pasa por `regroupStoreIntoBrand`
   (`src/features/storefront/server/registry.ts:374`) y su resultado llega a
   `revalidateStores(canonicalSlugs)`, `revalidateStorefronts(brandSlugs)` y
   `revalidateSlugs(slugValues)` (`src/features/admin/server/mutations.ts:598-600`).
2. `slugValues` es lo que devuelve `expandBrandTouch()`
   (`src/features/storefront/server/registry.ts:269-277`): el slug de la marca
   **más el slug propio de cada miembro**. O sea, `slug:tienda-demo` y
   `slug:bodega-uno` caducan los dos.
3. `resolvePublicSlug` está cacheada exactamente con `slugTag(requested)`
   (`src/features/storefront/server/resolve.ts:209-213`), que es la única fuente
   de `branchCount` y `brandSlug`. Como esa lectura participa en el render de la
   página ISR, su etiqueta viaja con la entrada de ruta: al caducar, la página se
   vuelve a renderizar y el eslabón de marca aparece.
4. El mismo embudo cubre el camino inverso (una marca que se encoge a una
   sucursal) y el camino caliente del sync (`siblingTouch()` en
   `src/features/sync/server/handlers/store.ts:225-229`).

Y el resto:

- **Renombrar una sucursal en el POS** (`Store.name`, el eslabón `{S}`): el
  handler `STORE` reporta `touchedStoreSlug` y el lote llama a
  `revalidateStores`, que expira `store:<canónico>`
  (`src/lib/cache.ts:86-93`) — la misma etiqueta con la que se lee `StoreSummary`.
- **Renombrar o borrar una categoría** (el eslabón `{Categoría}`): sale de
  `getStoreCatalog()`, etiquetada `storeCatalogTag(canonicalSlug)`
  (`src/features/catalog/server/queries.ts:283-289`), y F-026 ya le puso la
  guarda anti-rancia a `handleCategory` precisamente porque el nombre pasaba a
  ser navegación.
- **Renombrar la marca**: no hay hoy ningún escritor que lo haga (§ Cómo se
  construye…). Cuando lo haya, tiene que llamar a `revalidateStores` sobre todos
  los miembros —que es lo que `expandBrandRevalidation` + `commitBrand`
  (`src/features/admin/server/mutations.ts:103-108`) ya hacen para cualquier
  escritura de marca—, y el eslabón se actualiza sin tocar este feature.

**No se añade ninguna etiqueta, ninguna llamada a `revalidateTag` y ninguna
consulta.** Lo que sí se añade es la obligación de leer `brandName` del sitio
correcto, y eso va a § Patrones.

## Flujo de datos

Para `/tienda-demo/p/jugo-de-mango-1-l`, que es el caso con más eslabones:

1. `requireResolution(slug)` → `BranchResolution` (caché `slug:tienda-demo`,
   compartida con el layout por `React.cache`). Si es `selector`, `notFound()`.
2. `requireStore(resolution)` → `StoreSummary` (caché `store:tienda-demo`).
   404 si es `DRAFT`.
3. Si `store.status !== "PUBLISHED"`: aviso de cerrada **y** el rastro corto
   `catalogTrail(store)`. Sin leer catálogo (HD11, R20).
4. `getStoreCatalog(resolution)` (caché `store:tienda-demo:catalog`) →
   `product`. 404 si no está.
5. `branchTrailStore(resolution, store)` → `TrailStore`.
6. `productTrail(trailStore, product)` → `Trail` de cuatro eslabones. **Cero
   `await`, cero E/S**: solo lee objetos que los pasos 1-4 ya tienen en memoria.
7. `<StoreTrail trail={trail} jsonLd />` → el `<nav>`, el `<ol>`, el «atrás»
   (`backTarget` = la categoría) y el `<script type="application/ld+json">`.

Los pasos 5-7 no añaden ni un round-trip ni una entrada de caché. Es lo que hace
verificable el criterio 13.

## La prueba de la subcategoría

El criterio que la spec dejó escrito es que insertar un eslabón sea añadir un
elemento a una lista. Con esta forma, meter la subcategoría el día que
`LocalCategory` tenga padre es esto y nada más:

```ts
// src/features/storefront/trail.ts (por crear), función interna categorySteps():
function categorySteps(store, product): TrailStep[] {
  if (store.kind !== "branch") return [];
  const steps: TrailStep[] = [];
  if (product.categoryName && product.categorySlug) {
    steps.push({
      label: product.categoryName,
      href: storeCategoryPath(store.canonicalSlug, product.categorySlug),
    });
  }
  // ── la subcategoría, el día que exista: dos líneas aquí, cero en las páginas
  if (product.subcategoryName && product.subcategorySlug) {
    steps.push({
      label: product.subcategoryName,
      href: storeCategoryPath(store.canonicalSlug, product.subcategorySlug),
    });
  }
  return steps;
}
```

Lo que **no** hay que tocar: ninguna de las diez páginas (solo la ficha pasa un
campo más en el objeto que ya pasa), ni `StoreTrail`, ni `backTarget` (sigue
siendo el penúltimo, que pasa a ser la subcategoría por sí solo), ni
`breadcrumbList` (sigue numerando la lista), ni la regla del último sin `href`,
ni un solo test de las otras nueve pantallas. Eso es la prueba.

El mismo mecanismo cubre el eslabón que F-027 querrá algún día (categoría con
filtros conservados): sería `href` distinto en el mismo `TrailStep`, no una
pantalla reescrita.

## Modelo de datos y migraciones

Ninguna. No se toca `prisma/schema.prisma`, ni `docs/sync-contract.md`, ni el
panel, ni se añade una columna, un índice o un evento. Es una función pura sobre
datos que las páginas ya tienen cargados.

## Escalabilidad y límites

**Consultas: cero nuevas, y es estructural**, no una promesa: `trail.ts` no
importa nada de `server/`, no es `async` y no puede esperar a nadie. Cómo se
mide, con la trampa incluida: el contador `xact_commit` de
`pg_stat_database` es la única vía sin extensiones (`pg_stat_statements` está
disponible pero **no instalada** en la base de desarrollo, y instalarla pide
reiniciar el contenedor, que aquí es compartido con el worktree hermano). Ese
contador es **de toda la base**: medido con el `next dev` del worktree levantado,
el ruido en reposo fue de 10 transacciones en 3 segundos, más que la propia
página. El procedimiento válido es: parar todo lo demás que hable con
`queandabuscando`, tomar un control en reposo para demostrar que el contador está
quieto, y solo entonces medir el delta de una petición con `.next/cache` recién
borrada (que fuerza el render, no el HIT). Se repite en `main` y en la rama; los
dos deltas tienen que coincidir. Como comprobación estática de refuerzo, el diff
de `src/app/[slug]/p/[productSlug]/page.tsx` no puede añadir ninguna llamada a
`features/*/server/`.

**Bytes de HTML.** Cuatro eslabones con clases de Tailwind y el control de
«atrás» rondan los 600-900 B sin comprimir; el `BreadcrumbList` de cuatro
posiciones con URL absolutas, unos 450 B. Sobre los 20 235 B medidos de una ficha
de producto es un +5 % antes de gzip, y bastante menos después (las clases se
repiten entre eslabones, que es lo que mejor comprime). Se mide con
`curl -s URL | wc -c` sobre la misma lista de URL de § Las cifras de hoy, antes y
después, y se anota en `tests.md`.

**Bytes en el payload de todas las páginas.** src/app/[slug]/not-found.tsx (por
crear) se serializa en el payload de **cada** página del segmento (§ efecto
secundario). Un cuerpo de un `<h1>` y un párrafo son unos 300-500 B de payload en
todas las páginas de todas las tiendas. Es el precio de E15 y es la razón de que
ese archivo no pueda crecer.

**JavaScript de cliente: cero.** No hay módulo nuevo en el árbol de cliente:
`StoreTrail` es de servidor y `next/link` ya está en el grafo de todas estas
páginas (`src/app/[slug]/layout.tsx:1`). `node scripts/check-bundle-budget.mjs`
tiene que seguir en 0 **sin subir `BUDGET_KB`** (F-026 lo dejó en 177,6 KB de
193). Si subiera, es que alguien metió un `"use client"` donde no va.

**Al multiplicar por 100.** El rastro es O(número de eslabones) = O(4) por
página, sin importar cuántos productos, tiendas o pedidos haya: no recorre el
catálogo, no ordena nada y no toca la base. Lo primero que se rompería si esto
creciera sería la anchura en 360 px con cuatro eslabones largos, que es problema
de `sdd-designer` y no de escala. La única cifra que crece con el catálogo es la
del prefetch de `/[slug]` desde el rastro, y esa ya la paga hoy la cabecera del
layout.

## Patrones a seguir / antipatrones a evitar

- **La etiqueta de la marca sale de `StoreSummary`, no de la resolución.**
  Motivo y etiquetas de caché en § Cómo se construye…. Es la aplicación directa
  de `.agent/playbook/revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md`.
- **Todo `href` del rastro se construye a partir de un `PublicSlug`.** Un slug de
  URL sin resolver no compila ahí (`src/lib/publicSlug.ts:14-15`), que es la
  forma fuerte de R3.
- **El href de una categoría lo da `storeCategoryPath()`**
  (`src/features/catalog/storeCategories.ts:78`), nunca una plantilla a mano
  (R22): un cambio en `CATEGORY_ROUTE_SEGMENT` no puede dejar el rastro apuntando
  a una URL muerta.
- **Ningún archivo de este feature lleva `"use client"`** (AGENTS.md §
  Prohibiciones, R8).
- **Ningún `export const revalidate` nuevo**, y los que hay no se tocan: son
  literales a propósito (ficha `revalidate-no-literal`,
  `src/app/[slug]/layout.tsx:19`).
- **No se añade `loading.tsx` a ningún segmento de `/[slug]`**, ni ahora ni para
  suavizar el rastro: convierte los 404 en 200 (ficha
  `nextjs-loading-tsx-rompe-status-code-de-notfound`, y remedido en este ciclo).
- **El `matcher` de `src/proxy.ts` no se toca.** Nada de este feature necesita el
  proxy, y tocarlo anularía el ISR (AGENTS.md § Cosas que muerden).
- **`dangerouslySetInnerHTML` solo para el JSON-LD, y solo a través de
  `jsonLdScriptContent()`**. Cualquier otro uso en este feature es un error de
  revisión.
- **El control de «atrás» no se pinta a mano en ninguna página.** Sale de
  `backTarget()` dentro de `StoreTrail`, o R2 se rompe en la primera pantalla que
  alguien añada.

## Los criterios nuevos (15-21), comprobados contra este diseño

Los siete que salieron de SP4 entraron en `.agent/features.json` mientras se
escribía este documento. Repasados uno a uno contra lo que aquí está decidido:

| Criterio | Veredicto                                 | Por qué                                                                                                                                    |
| -------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 15       | Cubierto                                  | `/tienda-demo/c/bebidas` → `categoryTrail` → `{S}` enlazada + `Bebidas` actual                                                             |
| 16       | Cubierto                                  | `productTrail` mete el eslabón de categoría con `storeCategoryPath()`; tres eslabones en una marca de una sucursal                         |
| 17       | Cubierto                                  | Invalidación, § abajo                                                                                                                      |
| 18       | **A medias, y no por el diseño**: § abajo | La mitad negativa (tienda cerrada sin JSON-LD) sale sola de R13 + R20; la mitad de las tres `"position"` contradice a R4                   |
| 19       | Cubierto                                  | § abajo                                                                                                                                    |
| 20       | Cubierto                                  | R3 + R22: el `href` sale de `storeCategoryPath(store.canonicalSlug, …)`, y `canonicalSlug` es `PublicSlug`, no el slug pedido              |
| 21       | Cubierto                                  | La decisión de § Los dos `not-found.tsx` deja el repositorio sin ningún `href=".."`, que es lo que el criterio reformulado mide con `grep` |

### El criterio 17: la etiqueta que ya existe lo cubre, verificado

Un `PRODUCT`/`UPDATE` con `localCategoryId: null` tiene que hacer desaparecer el
eslabón de categoría de la ficha, y el reenvío del evento original tiene que
devolverlo. El camino, completo y sin nada nuevo:

1. `handleProduct` devuelve `touchedStoreSlug: canonical`
   (`src/features/sync/server/handlers/product.ts:190`, la rama de actualización).
2. `processCatalogBatch` lo acumula y llama **una vez** a
   `revalidateStores(touchedStores)` (`src/features/sync/server/processBatch.ts:66`
   y `:93`).
3. `revalidateStores` expira `store:<canónico>` **y**
   `store:<canónico>:catalog` (`src/lib/cache.ts:88-91`).
4. `getStoreCatalog` está cacheada exactamente con `storeCatalogTag(canonicalSlug)`
   (`src/features/catalog/server/queries.ts:283-289`), y es de donde salen
   `categoryName` y `categorySlug` (`:275-276`) — las dos únicas entradas del
   eslabón.

No es deducción: F-026 ya verificó **este mismo camino** con su criterio 8
(«tras un `PRODUCT`/`UPDATE` que cambia `localCategoryId`, el producto deja de
aparecer en la vista de la categoría anterior y aparece en la de la nueva»), que
lee del mismo `getStoreCatalog`. El eslabón del rastro no añade ni una etiqueta
ni una lectura a ese circuito, así que hereda su garantía entera. Y la
reversibilidad que el criterio pide («reenviar el evento con su categoría lo
restaura») es simétrica por la misma razón, más la guarda anti-rancia que F-026
le puso a `handleCategory`.

### El criterio 19: nada de esto puede volver `ƒ` la vista de categoría

`/[slug]/c/[categorySlug]` es `●` hoy (medido, § Las cifras de hoy). Lo que este
feature le añade son: una llamada a una función pura sin `await`, un componente
de servidor sin estado, y —solo en la rama publicada— una lectura de
`publicEnv.siteUrl` para las URL absolutas del JSON-LD. Esa lectura es
`process.env.NEXT_PUBLIC_SITE_URL` en módulo (`src/lib/env.ts:34`) y **ya se hace
en ese mismo archivo**, en `generateMetadata`
(`src/app/[slug]/c/[categorySlug]/page.tsx:60`), que es `●` con ella dentro. Cero
`headers()`, cero `cookies()`, cero `searchParams`, cero `loading.tsx` nuevo. Lo
mismo vale para el criterio 3 sobre `/[slug]` y la ficha.

El único cambio de este feature capaz de tocar el `●` de las tres rutas es
src/app/[slug]/not-found.tsx (por crear), porque se ejecuta en cada render del
segmento (§ Un efecto secundario). De ahí que su contrato sea: **síncrono, sin
APIs dinámicas, sin consultas y corto.** Si alguien lo vuelve `async`, los
criterios 3 y 19 caen a la vez, y esa es la señal.

### El criterio 18: pide tres eslabones donde R4 deja dos (I12)

**I12 — el criterio 18 exige `tres "position"` en `/tienda-demo/c/bebidas`, y en
esa URL el rastro tiene dos eslabones.** No es una elección de este documento:
`tienda-demo` es una marca de **una sola sucursal** —lo dice el criterio 12 con
esas palabras, y el 16 cuenta «tres eslabones, no dos» en su ficha de producto,
que solo cuadra si no hay eslabón de marca—, y R4 dice que el eslabón de marca no
existe cuando `branchCount === 1`, porque marca y sucursal serían **la misma
URL** (`src/lib/publicSlug.ts:31-32`). Así que ahí el rastro es
`{Sucursal} › {Categoría}`: dos eslabones y dos `"position"`. El criterio 15,
sobre esa misma URL, es coherente con dos; el 18 heredó la forma genérica
`{M} › {S} › {Categoría}` de la tabla de la spec, donde `{M}` va marcado como
condicional.

Lo que **no** se va a hacer para cuadrarlo: inflar el `BreadcrumbList` con un
eslabón de marca que el comprador no ve. El dato estructurado tiene que describir
el contenido visible de la página —es requisito de Google, no gusto— y además
rompería la propiedad que hace fiable todo este diseño: que el `<ol>` y el JSON-LD
salen del **mismo** `Trail`.

Recomendación, que la regla 3 impide aplicar desde aquí: la mitad de las tres
`"position"` se verifica contra una marca **multi-sucursal**
(`/bodega-uno/c/<categoría con stock>` → `{Marca} › {Bodega Uno} › {Categoría}`),
que es donde el número es tres, y `tests.md` deja anotado que en `/tienda-demo`
son dos por R4. Si el humano quiere el criterio limpio, se añade uno nuevo con
la URL correcta; el 18 no se reescribe.

## Riesgos y plan B

| Riesgo                                                                                                                    | Plan B                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El criterio 9 no se puede verificar con `curl` (§ El 404 dentro de una tienda)                                            | Resuelto: el criterio ya está reformulado y se verifica con navegador en la etapa `--visual`, igual que F-026 en su V9                                                                                                                                                                                                           |
| Quitarle el enlace propio a los tres `not-found.tsx` deja sin salida el 404 de una tienda **cerrada**                     | Dos URL concretas, documentadas. Si molesta, la salida la añade el layout —decisión de `sdd-designer`—, no el cuerpo del 404                                                                                                                                                                                                     |
| El chip de categoría de la ficha (`src/app/[slug]/p/[productSlug]/page.tsx:194-201`) queda duplicado con el eslabón nuevo | **Recomendación, no decisión — pendiente de `sdd-designer`**: quitarlo (mismo `href`, misma etiqueta). Ningún criterio de F-026 lo exige, pero R21 dice que el rastro no sustituye al selector de categorías y un chip está más cerca de un selector que de una ubicación. Ninguna otra parte de este documento lo da por tomado |
| Un nombre de producto y uno de categoría largos, juntos, en 360 px                                                        | E17 + R12 ya lo acotan (recorte por CSS, texto entero en el DOM, sin colapsar eslabones). El reparto de ancho lo cierra `sdd-designer`                                                                                                                                                                                           |
| Alguien añade una pantalla pública nueva y se olvida del rastro                                                           | No hay sensor que lo pesque. Mitigación barata: el envoltorio por pantalla vive en un solo archivo, así que la lista de pantallas se lee de un vistazo                                                                                                                                                                           |

## ¿Hace falta una ADR?

**No, y es un cambio respecto al borrador de este mismo documento.** El borrador
proponía `docs/adr/0026-...` para dejar escrito que el 404 de una tienda se
recupera en el cliente. Ya no procede: el humano abrió ese asunto como
**propuesta propia** (`.agent/specs/propuestas/404-sin-salida-sin-javascript.md`),
y su § Alcance punto 3 dice literalmente «decidir POR QUÉ ocurre antes de
parchear». La decisión estructural —y su ADR, si acaba haciendo falta— es de ese
feature, no de este; lo que F-025 aporta es la medición, y está entera en § El
404 dentro de una tienda › La decisión, con las dos referencias al código de Next
y el resultado de la alternativa de la frontera de suspense. Escribir aquí una
ADR sobre una decisión que va a tomar otro feature sería fijar por adelantado lo
que ese feature tiene que poder cuestionar.

F-025 no toca `docs/`.

Aparte, y sin relación con este feature: el hallazgo 2 de
`.agent/specs/F-026/tests.md` (dos `next build` seguidos sin borrar `.next/cache`
no ven los cambios de la base) también venía dirigido a este agente. No es de
F-025 y no cambia nada de aquí; su sitio es una línea en `docs/despliegue.md`
—«si el pipeline cachea `.next/cache` entre builds, un deploy puede hornear datos
viejos hasta que expire el TTL o llegue un evento de sync»— y lo escribe quien
toque el despliegue, que es donde AGENTS.md § Documentación pone ese tipo de nota.

## Qué archivos toca el implementador

Para que `plan.md` los pueda ordenar en pasos verificables. **Crear:**

| Archivo                                           | Qué                                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| src/features/storefront/trail.ts (por crear)      | Tipos, `storeTrail`, `backTarget`, los ocho envoltorios, `TRAIL_LABEL`, `breadcrumbList`                           |
| src/features/storefront/trail.test.ts (por crear) | Proyecto `node`. Las diez filas de la tabla de pantallas, R4, R5, R19, `backTarget` con un eslabón                 |
| src/lib/jsonLd.ts (por crear)                     | `jsonLdScriptContent()`                                                                                            |
| src/lib/jsonLd.test.ts (por crear)                | El caso `</script>` y el caso `<!--`                                                                               |
| src/components/store/StoreTrail.tsx (por crear)   | El componente de servidor                                                                                          |
| src/app/[slug]/not-found.tsx (por crear)          | El 404 con marco de tienda (I6, E15). Síncrono, sin APIs dinámicas y corto: se ejecuta en cada render del segmento |

**Modificar:**

| Archivo                                         | Qué                                                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/[slug]/page.tsx`                       | Rastro en las tres ramas: selector, sucursal abierta, sucursal cerrada                                                                       |
| `src/app/[slug]/c/[categorySlug]/page.tsx`      | Rastro en las dos ramas (abierta con `view.category`, cerrada corta)                                                                         |
| `src/app/[slug]/p/[productSlug]/page.tsx`       | Rastro en las dos ramas. Lo del chip de categoría de las líneas 194-201 es una recomendación pendiente de `sdd-designer`, no una instrucción |
| `src/app/[slug]/buscar/page.tsx`                | Rastro en las tres ramas: cerrada, sin término, con resultados (siempre `result.term`)                                                       |
| `src/app/[slug]/carrito/page.tsx`               | Rastro en las dos ramas                                                                                                                      |
| `src/app/[slug]/checkout/page.tsx`              | Rastro en las dos ramas                                                                                                                      |
| `src/app/[slug]/pedido/[code]/page.tsx`         | Rastro; y el `<a href>` de la línea 299 pasa a `<Link>` (I4)                                                                                 |
| `src/app/[slug]/sucursales/page.tsx`            | Rastro; y **fuera** el «← Volver a {nombre}» de las líneas 44-49 (R14, criterio 11)                                                          |
| `src/app/[slug]/pedido/[code]/not-found.tsx`    | Fuera el `<Link href="..">` de la línea 16 y su comentario                                                                                   |
| `src/app/[slug]/c/[categorySlug]/not-found.tsx` | Fuera el `<Link href="..">` de la línea 29 y el párrafo del comentario que lo justificaba                                                    |

Nada más. No se toca `prisma/`, ni `src/proxy.ts`, ni `src/lib/cache.ts`, ni
`scripts/check-bundle-budget.mjs`, ni `src/components/store/BranchBar.tsx`, ni
`src/components/store/StoreCategoryNav.tsx`.

## Preguntas al humano

**Ninguna abierta.**

**AP1 — RESUELTA por el humano el 2026-08-31: «Construirlo y reformular el
criterio».** Era la opción (a) de las tres, y la que este documento recomendaba.
Qué construye F-025 y qué queda para
`.agent/specs/propuestas/404-sin-salida-sin-javascript.md`, en § El 404 dentro de
una tienda › La decisión. Consecuencia ya aplicada en `.agent/features.json` por
el orquestador, con autorización del humano: el criterio 9 se verifica con
navegador, el 21 se reformuló a un `grep` sobre el código, entraron los siete
criterios nuevos y el `depends_on` de F-025 ganó F-026 (I11). Este documento no
tocó ese archivo.

Lo único que sigue necesitando **un ojo del humano**, y no es una pregunta que
bloquee nada, es la incongruencia del criterio 18 que está en § Los criterios
nuevos (15-21): pide tres `"position"` en una pantalla que, por la regla R4 que
él mismo aprobó, tiene dos eslabones. La implementación no queda en el aire —sigue
a R4— y la comprobación tiene un sitio donde sí vale, pero la regla 3 impide
arreglar el criterio desde aquí.
