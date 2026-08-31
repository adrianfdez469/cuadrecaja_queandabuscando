---
feature: F-026
agente: sdd-implementer
actualizado: 2026-08-31T06:20:00Z
estado: listo
---

> **Primer ciclo (2026-08-31T04:40:00Z)**: pasos 1–3 de `plan.md` — la
> migración de `LocalCategory`, el slug sin colisión con guarda anti-rancia en
> `handleCategory`, y que un evento `CATEGORY` reporte qué revalidar. Queda
> tal cual abajo, sin reabrir.
>
> **Segundo ciclo (esta actualización)**: pasos 4, 5, 6, 5b y 7 — la lectura,
> el selector, la vista por categoría con su 404, el enlace en la ficha del
> producto y la documentación operativa. Su detalle está en
> § Segundo ciclo — pasos 4, 5, 6, 5b y 7, al final del archivo. El paso 8
> (`bash .agent/verify.sh F-026 --full` en 0, con `/[slug]` en ●) cerró en el
> intento 16 de este ciclo.

## Qué se construyó

| Archivo                                                                     | Qué hace                                                                                                                                                                                                                                                                                                                                                            | Criterio que cubre |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `prisma/schema.prisma` (`LocalCategory`, líneas 303-324)                    | `sourceUpdatedAt DateTime?` y `@@unique([businessId, slug])`                                                                                                                                                                                                                                                                                                        | 11                 |
| `prisma/migrations/20260831033437_local_category_slug_unique/migration.sql` | Migración aditiva: columna nueva, higiene de slug vacío, backfill de desambiguación con `row_number()` (no-op hoy, verificado), `CREATE UNIQUE INDEX`. Los cinco `DROP INDEX` que Prisma propuso se borraron a mano                                                                                                                                                 | 11                 |
| `src/constants/catalog.ts` (nuevo)                                          | `CATEGORY_SLUG_FALLBACK = "categoria"`, mismo valor que usa la higiene de la migración                                                                                                                                                                                                                                                                              | 10                 |
| `src/lib/slug.ts`                                                           | `uniqueSlug` gana `honorReserved` (por defecto `true`, ningún llamador existente cambia de comportamiento)                                                                                                                                                                                                                                                          | 10                 |
| `src/features/sync/server/handlers/misc.ts`                                 | `handleCategory` reescrito: guarda anti-rancia contra `sourceUpdatedAt` (I8), slug sin colisión en el `CREATE` con reintento ante `P2002` sobre `slug` (calcado de `createStorefrontWithStore`), slug intocado en el `UPDATE` (R8/E7), y `affectedStoreSlugs()` que resuelve las sucursales afectadas ANTES de escribir/borrar y las reporta en `touchedStoreSlugs` | 9, 10, 11          |
| `src/features/sync/server/handlers/types.ts`                                | `HandlerOutcome` gana `touchedStoreSlugs?: readonly PublicSlug[]` (plural)                                                                                                                                                                                                                                                                                          | 9, 10              |
| `src/features/sync/server/processBatch.ts`                                  | Vuelca `outcome.touchedStoreSlugs` en el mismo `Set` (`touchedStores`) que ya alimenta `revalidateStores` — cero llamadas nuevas de invalidación                                                                                                                                                                                                                    | 9, 10              |
| `src/features/sync/server/handlers/misc.test.ts` (nuevo, 14 tests)          | Slug sin colisión (incluida la carrera con reintento y el `P2002` ajeno que no se traga), `honorReserved: false`, `UPDATE` no mueve el slug, guarda anti-rancia (fila nueva y fila premigración con `sourceUpdatedAt: null`), orden `findMany` → `delete`, `DELETE` repetido idempotente                                                                            | 9, 10, 11          |
| `src/features/sync/server/processBatch.test.ts` (+4 tests)                  | `CATEGORY`/`DELETE` con dos sucursales afectadas dispara una sola invalidación deduplicada; se funde con el `touchedStoreSlug` de otro handler en la misma llamada; `CATEGORY`/`CREATE` sin producto no dispara ninguna                                                                                                                                             | 9                  |

## Desviaciones

Ninguna respecto a `architecture.md`. Dos decisiones de detalle que la
arquitectura dejaba implícitas y que valen la pena anotar:

- **`affectedStoreSlugs` no filtra por `status` del `Store` propio** (solo
  filtra `status !== "DRAFT"` de las hermanas, dentro del `select` anidado que
  calcula `brandBranchCount`), exactamente como el SQL que
  `architecture.md` § La invalidación dejó escrito verbatim. Una sucursal en
  `DRAFT` con un producto de la categoría borrada dispara una revalidación de
  más, no de menos — barato y correcto por R7/`AGENTS.md` § Prohibiciones
  («revalidar de más es barato; revalidar de menos deja una URL rancia para
  siempre»).
- **`operation` no decide sola qué rama corre.** Igual que el `upsert` que
  reemplaza, si `existing` ya existe la escritura pasa por `UPDATE` aunque el
  evento diga `CREATE` (y viceversa): un evento fuera de orden no rompe nada,
  porque el handler entero es idempotente. Es el mismo comportamiento que ya
  tenía el código, ahora con guarda anti-rancia delante.

## Comandos ejecutados

- `npx prisma validate` → 0.
- `npx prisma migrate dev --create-only --name local_category_slug_unique`
  (vía `expect`, porque el entorno no tiene TTY y Prisma exige uno para el
  prompt de confirmación de un `ALTER` con posible pérdida de datos — ningún
  flag de línea de comandos lo evita en `migrate dev`) → migración creada, sin
  aplicar.
- Edición manual de `migration.sql`: se borraron las cuatro líneas `DROP INDEX`
  que Prisma propuso (`CanonicalProduct_searchVector_idx`,
  `CanonicalProduct_name_trgm_idx`, `StoreProduct_searchVector_idx`,
  `StoreProduct_searchDocument_trgm_idx` — `StoreProduct_visible_catalog_idx`
  no apareció esta vez en el diff, ver § Deuda dejada) y se pegó el backfill
  completo de `architecture.md` § El SQL que hay que revisar a mano.
- `npm run db:migrate` (`prisma migrate dev`, vía `expect`) → aplicada
  `20260831033437_local_category_slug_unique`.
- `npx prisma migrate status` → "Database schema is up to date!".
- Comprobación contra la base (`docker exec queandabuscando-postgres psql`):
  `LocalCategory_businessId_slug_key` existe, y los cinco índices GIN
  (`CanonicalProduct_searchVector_idx`, `CanonicalProduct_name_trgm_idx`,
  `StoreProduct_visible_catalog_idx`, `StoreProduct_searchVector_idx`,
  `StoreProduct_searchDocument_trgm_idx`) siguen los cinco, verificado antes Y
  después de aplicar.
- `npx prisma generate` → cliente regenerado en `src/generated/prisma`.
- `bash .agent/verify.sh F-026` → **PASA** en el intento 11 (typecheck · lint ·
  format · test, 21s de test). El intento 10 falló en `format` sobre
  `misc.ts` (código propio, no prosa ajena); se arregló con
  `npx prettier --write` sobre los archivos que yo mismo escribí, siguiendo
  `.agent/playbook/prettier-sin-formatear.md`.
- `npx tsc --noEmit` (suelto, antes de cada `verify.sh`) → 0 en todas las
  pasadas tras el primer intento.

## Deuda dejada

- **`StoreProduct_visible_catalog_idx` no apareció en el `DROP INDEX` que
  Prisma propuso esta vez**, a diferencia de los otros cuatro. No se tocó
  (sigue existiendo, comprobado contra la base), pero queda para quien migre
  después de mí: si un futuro `prisma migrate dev` sí lo propone, sigue
  aplicando la misma ficha
  (`.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md`).
  No es una regresión de este ciclo — es que el diff de Prisma no es
  determinista entre corridas para índices no declarados, y esto ya lo advertía
  la ficha.
- **`docs/despliegue.md` no lleva la línea de esta migración.** Es
  deliberado: el plan la asigna al paso 7, del segundo ciclo, y las
  instrucciones de este ciclo prohíben tocar ese paso. Quien haga el paso 7
  necesita saber que la migración `20260831033437_local_category_slug_unique`
  ya está aplicada en este entorno y **no** necesita repetirse; solo falta la
  línea operativa.
- **Ningún test contra Postgres real** (`*.db.test.ts`) para el backfill del
  `migration.sql` — la arquitectura lo verificó consultando la base de
  desarrollo (0 colisiones, 0 slugs vacíos) antes de escribir el SQL, y este
  ciclo repitió esa comprobación contra la misma base tras aplicar. No hay un
  test automatizado de la rama `RAISE EXCEPTION` del backfill (que solo se
  ejercitaría con datos que hoy no existen en ningún entorno); si el paso
  vuelve a tocarse, un `*.db.test.ts` con filas duplicadas sembradas a mano lo
  cerraría.

## Qué necesita quien pruebe

- El entorno ya tiene la migración aplicada (`npx prisma migrate status` → up
  to date) y el cliente regenerado. No hace falta `npm run db:migrate` de
  nuevo en este mismo checkout.
- `bash .agent/verify.sh F-026` corre en 0 tal cual está el árbol.
- Los tests nuevos son unitarios (`node`, con Prisma mockeado) en
  `src/features/sync/server/handlers/misc.test.ts` y los cuatro añadidos a
  `src/features/sync/server/processBatch.test.ts` — no requieren Postgres
  levantado para correr, solo para la migración en sí.
- Nada de lo construido en este ciclo es visible en la tienda pública: no hay
  ruta nueva, ni componente, ni cambio de comportamiento para un comprador. Es
  puramente el camino del sync y el modelo de datos; el segundo ciclo es el
  que lo hace visible.

## Preguntas al humano

Ninguna. El plan firmado no dejó ambigüedad para estos tres pasos.

---

## Segundo ciclo — pasos 4, 5, 6, 5b y 7

> Con la migración del primer ciclo ya aplicada en este entorno. Implementa
> el plan firmado (PP1 = (a), PP2 = (a), PP3 = solo 5b) tal cual, sin
> reabrir alcance.

### Qué se construyó

| Archivo                                                         | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Criterio que cubre                |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `src/features/catalog/storeCategories.ts` (nuevo)               | Lógica pura, sin Prisma: `StoreCategory`, `deriveStoreCategories` (agrupa por `categorySlug`, descarta nulos — E6/R6 —, ordena con `Intl.Collator("es")` creado a nivel de módulo), `productsOfCategory` (filtro que conserva el orden de `getStoreCatalog`), `storeCategoryPath`                                                                                                                                                                                                | 1, 2, 5, 11                       |
| `src/features/catalog/storeCategories.test.ts` (nuevo, 9 tests) | Agrupación por slug y no por nombre; dos categorías homónimas con slug distinto dan dos entradas (criterio 11); exclusión de categoría nula; colación española (Aseo < Niños < Nueces); `productsOfCategory` conserva el orden de entrada; `storeCategoryPath`                                                                                                                                                                                                                   | 1, 11                             |
| `src/features/catalog/server/queries.ts` (se amplía)            | `CatalogProduct.categorySlug` (proyecta `localCategory.slug`, misma fila y mismo JOIN que `categoryName`); `getStoreCategories` y `getStoreCategoryView` como envoltorios finos sobre `getStoreCatalog`, `StoreRef` obligatorio, **cero consultas nuevas**, envueltos en `cache()` de React (dedupe entre `generateMetadata` y el cuerpo de la página, como `resolvePublicSlug`)                                                                                                 | 1, 2, 5                           |
| `src/features/catalog/server/search.ts` (PP1)                   | `categorySlug` proyectado en el CTE `page` (`lc."slug" AS "categorySlug"`), sobre el JOIN a `LocalCategory` que ya existía. Solo la columna: cero cambios de ranking, capas, cascada o paginación                                                                                                                                                                                                                                                                                | (compilación de `CatalogProduct`) |
| `src/constants/catalog.ts` (se amplía)                          | `CATEGORY_ROUTE_SEGMENT = "c"`                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 1, 2                              |
| `src/components/store/StoreCategoryNav.tsx` (nuevo)             | El selector: componente de servidor, sin `"use client"`. `<nav aria-label="Categorías">` con `<ul>` de `<a>` (`next/link`, `prefetch={false}` — RD5), chip «Todo el catálogo» siempre primero, clases de `design.md` § Decisión 1 al carácter                                                                                                                                                                                                                                    | 1, 13, 14                         |
| `src/app/[slug]/page.tsx` (se amplía)                           | Pide `getStoreCategories(resolution)` en paralelo con el catálogo y las tasas; monta `StoreCategoryNav` **solo si `categories.length >= 2`** (design.md § Inventario, umbral), entre la descripción y la rejilla, nunca en el layout (RD6)                                                                                                                                                                                                                                       | 1                                 |
| `src/app/[slug]/c/[categorySlug]/page.tsx` (nuevo)              | Ruta estática, `generateStaticParams` calcado del de `/[slug]/p/[productSlug]` (una lectura por sucursal, no por par), `generateMetadata` sin `robots: { index: false }` (R12/RD8) y con `alternates.canonical` bajo alias vivo. Orden selector→404 / DRAFT→404 / SUSPENDED→aviso **antes** de tocar el catálogo; `notFound()` si la categoría no deja productos (RD4, sin estado vacío). Ningún `export const dynamic`/`revalidate` propio: hereda el `3600` literal del layout | 2, 3, 4, 5, 6, 14                 |
| `src/app/[slug]/c/[categorySlug]/not-found.tsx` (nuevo)         | 404 con el marco de la tienda (el `layout` sigue montado), calcado de `pedido/[code]/not-found.tsx`. Enlace de salida relativo — ver § Desviaciones, la única de fondo de este ciclo                                                                                                                                                                                                                                                                                             | 5                                 |
| `src/app/[slug]/p/[productSlug]/page.tsx` (paso 5b)             | El nombre de la categoría (línea ~190) pasa de `<p>` a `<Link href={storeCategoryPath(...)}>` cuando el producto tiene `categorySlug`. Una línea, cero JavaScript nuevo: `next/link` ya está en este árbol                                                                                                                                                                                                                                                                       | (5b)                              |
| `docs/despliegue.md` (se amplía)                                | Línea operativa sobre `20260831033437_local_category_slug_unique`: es aditiva y viaja en `prisma/migrations/`, así que `db:deploy` la aplica sola; documenta el modo de fallo del backfill (`RAISE EXCEPTION` si no converge) y cómo diagnosticarlo                                                                                                                                                                                                                              | (paso 7)                          |
| `docs/adr/0025-recortes-del-catalogo-como-proyeccion.md`        | `Propuesta` → `Aceptada`, con una línea que apunta a `getStoreCategories`/`getStoreCategoryView` como su primer caso real                                                                                                                                                                                                                                                                                                                                                        | (paso 7)                          |

### Desviaciones

Una, y es de detalle, no de alcance:

- **El `not-found.tsx` del segmento usa `href=".."`, no `href="../.."`** como
  literalmente pide `design.md` § El 404 de categoría y RD4 («"../.." aquí,
  porque este segmento cuelga dos niveles»). Verificado antes de escribir el
  archivo, no asumido: `next/link` en el app router (
  `node_modules/next/dist/client/app-dir/link.js`) pasa el `href` **tal
  cual** al `<a>` que renderiza — no hay resolución contra `router.pathname`
  como en el router de páginas — así que la resolución la hace el navegador
  con la regla estándar de URLs relativas (WHATWG/RFC 3986), la misma que usa
  `new URL()` en Node. Comprobado con las dos rutas:

  ```
  new URL("..", "https://x/tienda-demo/pedido/CODE123").pathname → "/tienda-demo/"
  new URL("..", "https://x/tienda-demo/c/bebidas").pathname       → "/tienda-demo/"
  new URL("../..", "https://x/tienda-demo/c/bebidas").pathname    → "/"
  ```

  Las dos rutas cuelgan **la misma** profundidad bajo el slug de la tienda
  (`pedido/[code]` y `c/[categorySlug]` son ambas dos segmentos), así que la
  misma resolución que `pedido/[code]/not-found.tsx` ya usa con un solo
  `".."` es la que aterriza en `/tienda-demo` para esta también; `"../.."`
  habría mandado al comprador a la raíz del sitio (`/`), no a la tienda —
  justo el bug que RD4 pedía evitar. `design.md` deja escrita la salida para
  este caso exacto: «Si eso no resuelve limpio, propón otra vía» (§ El 404 de
  categoría). El archivo lleva un comentario con esta misma comprobación para
  quien lo relea.

### Comandos ejecutados

- `bash .agent/verify.sh F-026` → **PASA** en el intento 15 (typecheck·
  lint·format·test). El intento 14 falló en `format` sobre tres archivos
  propios (`page.tsx` de la categoría, `StoreCategoryNav.tsx`,
  `queries.ts`) — ficha `.agent/playbook/prettier-sin-formatear.md`, ya
  fichada; se arregló con `npx prettier --write` sobre esos tres archivos
  exactos (nunca sobre un documento ajeno).
- `bash .agent/verify.sh F-026 --full` → **PASA** en el intento 16
  (harness·typecheck·lint·format·test·prisma·build·theme·bundle).
  Comprobado en la salida cruda de `build` (`.agent/runs/F-026/016-build.log`):
  `/[slug]` sigue `●` (SSG) para sus rutas concretas
  (`/tienda-demo`, `/tienda-dos`, `/bodega-central`, `[+6 more paths]` — 9 en
  total, igual que antes de este ciclo) y `/[slug]/c/[categorySlug]` sale
  pre-renderizada con **14** rutas (`/tienda-demo/c/alimentos`,
  `/tienda-demo/c/aseo`, `/tienda-demo/c/bebidas`, `[+11 more paths]`) —
  el mismo número que `architecture.md` § El número que decide el
  pre-renderizado calculó contra la base de desarrollo. Criterio 12
  verificado en la salida real del build, no asumido.
- `bash .agent/verify.sh pending F-026` → sin salida: nada que fichar ni
  descartar en este ciclo.
- `npx prettier --write` **solo** sobre los tres archivos propios señalados
  arriba — nunca `npm run format` a ciegas sobre el árbol completo, por
  `.agent/playbook/prettier-write-reescribe-prosa-ajena.md`.

### Deuda dejada

Ninguna nueva. El primer ciclo dejó anotado que `docs/despliegue.md` no
tenía la línea de la migración: ya está (arriba, paso 7). La única deuda que
sigue en pie es la que el plan firmado deja fuera a propósito: el conteo por
categoría (RD2), la paginación de la vista, migas de pan (F-025), filtros y
ordenamientos (F-027), y el arreglo de raíz del contraste 3.33:1 de
`bg-brand`/`text-brand-contrast` (PP2 — es de un feature aparte que abre el
humano).

### Qué necesita quien pruebe

- Todo lo de este ciclo es visible sin datos nuevos: `tienda-demo` en la base
  de desarrollo ya trae 4 categorías con stock (bebidas, alimentos, aseo,
  panadería), que es lo que ejercita el umbral de ≥2 categorías (design.md §
  Inventario) y el criterio 1.
- Rutas para probar a mano: `/tienda-demo` (selector visible, 4 chips + «Todo
  el catálogo»), `/tienda-demo/c/bebidas` (vista de categoría), una URL de
  categoría inventada como `/tienda-demo/c/no-existe` (404 con marco de
  tienda y enlace a `/tienda-demo`), y la ficha de cualquier producto de
  `tienda-demo` (el nombre de categoría ahora es enlace).
- `bash .agent/verify.sh F-026 --full` corre en 0 tal cual está el árbol, sin
  pasos manuales adicionales — la migración del primer ciclo ya está
  aplicada.
- Frágil, y ya verificado pero vale la pena repetir en otro entorno: el
  enlace relativo del `not-found.tsx` de categoría (`href=".."`). Si algún
  día se anida un segmento más entre `[slug]` y `c`, este cálculo hay que
  rehacerlo — no es una constante, es geometría de la URL.

### Preguntas al humano

Ninguna. El plan firmado (PP1/PP2/PP3) no dejó ambigüedad para estos cinco
pasos; la única desviación (el `href` del 404 de categoría) es de detalle
verificable, no de alcance, y queda documentada arriba en vez de preguntada.

### Ajuste posterior — literalidad del criterio 13

El comentario de `src/components/store/StoreCategoryNav.tsx:11` citaba la
cadena literal `"use client"` (para explicar que el componente no la lleva),
lo que hacía que `grep -rn "use client"` sobre los archivos nuevos de este
feature devolviera una coincidencia — el criterio 13 exige que ese `grep`
salga vacío, al pie de la letra. Se reescribió a «no client directive» sin
tocar código ni el criterio. Comprobado: `grep -rn "use client"` sobre
`src/app/[slug]/c`, `StoreCategoryNav.tsx`, `storeCategories.ts`,
`storeCategories.test.ts` y `src/constants/catalog.ts` sale vacío;
`bash .agent/verify.sh F-026` → 0 (intento 22).
