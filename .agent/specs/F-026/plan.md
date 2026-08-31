---
feature: F-026
agente: orquestador
actualizado: 2026-08-31T03:30:06Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Quien entre a la tienda de un negocio verá, encima de la rejilla de productos,
una fila con las categorías que **esa sucursal de verdad tiene en stock**; al
tocar una, llegará a una página propia y compartible con solo esos productos, y
desde ella siempre podrá volver a todo el catálogo o saltar de lado a otra
categoría. No cambia nada de lo que ya se ve: los mismos precios, las mismas
tarjetas, el mismo orden, y `/[slug]` sigue siendo una página estática.

Por debajo se cierran dos agujeros que hoy nadie nota y que este feature vuelve
visibles: la categoría gana una URL estable que **no se mueve cuando el POS la
renombra**, y un evento `CATEGORY` del sync pasa a invalidar la caché de las
tiendas afectadas — hoy no invalida nada, así que renombrar o borrar una
categoría en el POS no se vería nunca en la tienda.

## Pasos

| Nº    | Qué se hace                                                                                                                                                                                                                                                                                                                                                             | Archivos                                                                                                                               | Criterio que acerca | Cómo se verifica                                                                                                                                                                                                           |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | Migración aditiva de `LocalCategory`: columna `sourceUpdatedAt`, higiene de slug vacío, backfill de desambiguación con `row_number()` y, solo entonces, `@@unique([businessId, slug])`. Se genera con `--create-only`, se **borran a mano** los cinco `DROP INDEX` de índices GIN que Prisma cuela de más, y solo entonces se aplica                                    | `prisma/schema.prisma`, prisma/migrations/&lt;ts&gt;\_local_category_slug_unique (por crear)                                           | 11                  | `npm run db:migrate` en 0; `npx prisma validate` en 0; `psql` confirma que existe `LocalCategory_businessId_slug_key` y que **siguen existiendo** los cinco índices GIN (`\di *_trgm_idx`, `\di *searchVector*`)           |
| **2** | `uniqueSlug` gana la opción `honorReserved` (por defecto `true`, nadie más cambia). `handleCategory`: slug sin colisión en el `CREATE` con reintento ante violación de unique, slug **intocado** en el `UPDATE`, y guarda anti-rancia contra `sourceUpdatedAt` que devuelve `STALE`                                                                                     | `src/lib/slug.ts`, `src/features/sync/server/handlers/misc.ts`, src/constants/catalog.ts (por crear)                                   | 10, 11              | Tests nuevos en `src/features/sync/server/handlers/` (node): dos nombres que slugifican igual dan dos slugs; renombrar no mueve el slug; un evento con `updatedAt` anterior devuelve `stale` sin escribir. `verify.sh` → 0 |
| **3** | `handleCategory` reporta qué revalidar: consulta de sucursales afectadas **antes** de borrar (la FK es `ON DELETE SET NULL`), canónico con `canonicalSlug`, y campo plural `touchedStoreSlugs` en `HandlerOutcome` volcado en el `Set` que ya alimenta `revalidateStores`. Cero llamadas nuevas de invalidación                                                         | `src/features/sync/server/handlers/types.ts`, `src/features/sync/server/handlers/misc.ts`, `src/features/sync/server/processBatch.ts`  | 9, 10               | Test de `processBatch` (node): un lote con `CATEGORY`/`DELETE` acumula las sucursales de esa categoría y dispara **una** invalidación deduplicada; un `CREATE` no dispara ninguna. `verify.sh` → 0                         |
| **4** | La lectura: `CatalogProduct` gana `categorySlug`; `deriveStoreCategories`, `productsOfCategory` y `storeCategoryPath` como lógica pura; `getStoreCategories` y `getStoreCategoryView` como envoltorios finos sobre `getStoreCatalog`, con `StoreRef` obligatorio. **Cero consultas nuevas.** Se proyecta la columna en la consulta de búsqueda para que compile (→ PP1) | `src/features/catalog/server/queries.ts`, src/features/catalog/storeCategories.ts (por crear), `src/features/catalog/server/search.ts` | 1, 2, 5             | Tests unitarios en `node` sobre `CatalogProduct[]` fijos: agrupación por slug y no por nombre, colación española, exclusión de los de categoría nula, orden `featured`→nombre conservado. `verify.sh` → 0                  |
| **5** | El selector: un componente de servidor sin `"use client"` —fila de chips desplazable a 360 px, que envuelve desde `sm:`, con `Todo el catálogo` de primer chip— montado por `/[slug]`, nunca por el layout. `href` siempre con `canonicalSlug`, `next/link` con el prefetch apagado                                                                                     | src/components/store/StoreCategoryNav.tsx (por crear), `src/app/[slug]/page.tsx`                                                       | 1, 13, 14           | `curl` de `/tienda-demo` trae un `<a>` por las cuatro categorías con stock y ninguno de una sin producto ahí; `grep -rn "use client"` sobre lo nuevo vacío; `node scripts/check-bundle-budget.mjs` en 0                    |
| **6** | La vista por categoría: ruta estática con `generateStaticParams` y `generateMetadata`, el orden `selector→404 / DRAFT→404 / SUSPENDED→aviso` **antes** de tocar el catálogo, `notFound()` si la categoría no deja ningún producto, y un `not-found.tsx` propio del segmento que conserva el marco de la tienda y sale con enlace relativo                               | src/app/[slug]/c/[categorySlug]/page.tsx (por crear), src/app/[slug]/c/[categorySlug]/not-found.tsx (por crear)                        | 2, 3, 4, 5, 6, 14   | `curl` de la vista de «Bebidas» y de `/tienda-demo`: mismo precio carácter a carácter para un producto con `priceOverride`; categoría de otra sucursal → 404; bajo tienda `SUSPENDED` → aviso de cerrada. `verify.sh` → 0  |
| **7** | Documentación operativa: la línea de la migración manual en `docs/despliegue.md` y el paso de `docs/adr/0025-recortes-del-catalogo-como-proyeccion.md` de `Propuesta` a `Aceptada`                                                                                                                                                                                      | `docs/despliegue.md`, `docs/adr/0025-recortes-del-catalogo-como-proyeccion.md`                                                         | —                   | `npm run check:harness` en 0; `npm run format` sobre lo escrito                                                                                                                                                            |
| **8** | Cierre: el build completo y el paso del probador                                                                                                                                                                                                                                                                                                                        | —                                                                                                                                      | 12, 15              | `bash .agent/verify.sh F-026 --full` en 0, con `/[slug]` marcado ● (SSG) en la salida del build                                                                                                                            |

### El paso que PP3 dejó dentro

| Nº     | Qué se hace                                                                                                                    | Archivos                                  | Criterio que acerca | Cómo se verifica                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------- |
| **5b** | El nombre de la categoría en la ficha del producto deja de ser texto plano y pasa a ser enlace a su vista (una línea, cero JS) | `src/app/[slug]/p/[productSlug]/page.tsx` | —                   | `curl` de una ficha trae el nombre de la categoría dentro de un `<a>` cuyo `href` responde 200. `verify.sh` → 0 |

Se ejecuta con el paso 6, cuando la vista de categoría ya existe y su URL
responde. El otro extra que se ofreció —meter las vistas de categoría en el
sitemap— **queda fuera** por decisión del humano (§ Qué queda fuera).

## De dónde sale cada paso

| Paso | Sale de                                                                                                                                                          |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `architecture.md` § Modelo de datos y migraciones, § El SQL que hay que revisar a mano. Origen: spec § Datos y contrato, SP3, I3                                 |
| 2    | `architecture.md` § La desambiguación en el `CREATE` de `handleCategory` y § I8 — la guarda anti-rancia. Origen: spec R8/E7, I3, I8                              |
| 3    | `architecture.md` § La invalidación (R7, E13, E14), «el hueco real, y es de los que muerden». Origen: spec R7, E8, E13, E14 — y un hallazgo que la spec no tenía |
| 4    | `architecture.md` § Componentes y § Flujo de datos; `design.md` RD1, RD2, RD3. Origen: spec R1, R3, R4, R5                                                       |
| 5    | `design.md` § Decisión 1 — la forma del selector, RD5, RD6, RD7. Origen: spec E1, R9, R13                                                                        |
| 6    | `architecture.md` § La petición de `/[slug]/c/[categorySlug]`; `design.md` § Inventario de pantallas y estados, RD4, RD8. Origen: spec E2, E5, E9–E12, SP2       |
| 7    | `AGENTS.md` § Documentación («una migración que hay que revisar a mano» es paso operativo, en el mismo ciclo); `architecture.md` § ¿Hace falta una ADR?          |
| 8    | Criterios 12 y 15 de `.agent/features.json`                                                                                                                      |
| 5b   | `design.md` DP2, resuelto en PP3 por el humano el 2026-08-31                                                                                                     |

**Un paso que no está y podría esperarse:** ninguno reescribe `ProductCard`. Es
`design.md` § Decisión 2, y su razón es estructural: la tarjeta envuelve todo su
contenido en un único enlace, así que el nombre de la categoría sería texto
muerto con pinta de tocable, y hacerlo enlace obligaría a desmontarla — que es lo
que R4 prohíbe.

## Qué queda fuera

- **Subcategorías.** Cerrado por SP1: hoy no existe ni una en el sistema
  (`GlobalCategory` tiene 4 filas y 0 con padre; `LocalCategory` no tiene campo
  de padre). Feature futuro, y este documento no deja nada «preparado» para
  ellas a propósito.
- **Filtros de precio, disponibilidad, promoción y destacados, y los
  ordenamientos.** Son F-027. Este feature ni los dibuja ni les deja hueco
  visual; le entrega el parámetro (`categorySlug`, segmento de ruta) y la
  lectura ya cacheada sobre la que aplicarlos.
- **Migas de pan y botón de atrás.** Son F-025. Este feature le entrega el nivel
  intermedio con dato y con URL; la forma la decide aquel.
- **Conteos por categoría en los chips** («Bebidas (7)»). RD2: a 360 px ensancha
  cada chip y un número que solo cuenta lo visible invita a la pregunta «¿por
  qué 7 y no 9?».
- **Paginación de la vista por categoría.** Hoy `/[slug]` no pagina; cuando
  F-027 fije el tope, esta lo hereda.
- **Crear, renombrar, ordenar o borrar categorías desde el panel.** Son del POS
  (ADR 0007).
- **Un estado vacío para la vista de categoría.** Cero productos es 404, y es
  deliberado (RD4): no se confirma que una categoría exista en algún sitio.
- **Documentar el `payload` de `CATEGORY` en el contrato** (I7). Deuda
  preexistente que F-022 ya promete cerrar. `docs/sync-contract.md` **no se toca
  y no sube de versión** (R14).
- **Arreglar el contraste de `brandContrast`** (PP2, resuelto en (a) por el
  humano el 2026-08-31). Es un problema heredado que hoy afecta al botón
  `Buscar` y a `Agregar al carrito`, no algo que cree este feature. El chip
  activo usa el mismo lenguaje visual que todo lo demás, y el arreglo de raíz
  —validar el contraste al guardar la marca— lo abre el humano como feature
  propio (regla 4).
- **Las vistas de categoría en el sitemap** (PP3, resuelto por el humano el
  2026-08-31: no entra). Se descubren siguiendo la fila desde `/[slug]`, que sí
  está en el sitemap. Meterlas obligaría a `src/app/sitemap.ts` a leer el
  catálogo de cada tienda, que es lo que `architecture.md` § Qué queda fuera ya
  había descartado.

## Riesgos y plan B

| Riesgo                                                                                                                                                            | Cómo se notaría                                                                                                    | Plan B                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hay migración de datos.** Aditiva y sin comandos prohibidos, pero toca una tabla que el sync escribe                                                            | `npm run db:migrate` falla, o el unique no se crea                                                                 | El backfill lleva `RAISE EXCEPTION` si no converge en 10 pasadas: falla ruidosamente en vez de dejar la base sin unique y la app creyéndolo                |
| **Prisma propone borrar cinco índices GIN que el schema no declara**, en un diff que no tiene nada que ver con ellos. Aplicarlo sin mirar no pone rojo ni un test | Nada. Solo la búsqueda haciendo scans secuenciales en producción                                                   | Se genera con `--create-only` y se borran las cinco líneas a mano (paso 1). Ficha: `.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md` |
| **El paso 3 toca el sync**, que es el camino por donde entra todo el catálogo                                                                                     | Los tests de `processBatch` e `inbox`                                                                              | Es aditivo: un campo opcional nuevo en `HandlerOutcome`. Revertir el paso 3 deja el sync exactamente como está hoy                                         |
| **Añadir `categorySlug` a `CatalogProduct` rompe la compilación de la búsqueda** de F-021 hasta que su SQL proyecte la columna                                    | `npm run typecheck`                                                                                                | Es el objetivo: el error de compilación es lo que impide que los dos lectores del tipo diverjan. → PP1                                                     |
| **Que la vista de categoría vuelva `/[slug]` dinámica** por un descuido (leer `searchParams`, un `export const dynamic`)                                          | El build deja de marcar `/[slug]` como ● — criterio 12                                                             | Es criterio de aceptación y lo comprueba el paso 8, no la vista de nadie                                                                                   |
| **A 360 px, con más de tres categorías, el resto está detrás de un deslizamiento** y no habrá JavaScript que arrastre la fila al chip activo                      | Nadie: no falla nada. Se decidió con la medición delante (15 categorías = 372 px envolviendo vs. 52 px deslizando) | Lo compensa que el `<h1>` de la vista es el nombre de la categoría. Si molesta, se revisa con datos de uso                                                 |
| **Contraste 3.33 : 1 del chip activo** en una tienda con marca propia, por debajo de AA                                                                           | Una auditoría de accesibilidad                                                                                     | → PP2. Es heredado y ya afecta a dos botones más                                                                                                           |

**`docs/sync-contract.md` no se toca.** Cerrar la guarda anti-rancia no cambia
ni un campo ni un comportamiento observable para cuadrecaja: `updatedAt` ya
viaja en el `payload` de `CATEGORY` y `stale` ya es un estado terminal
documentado que viaja dentro de `ok`.

## Coste

Dos ciclos de `sdd-implementer` (pasos 1–3, que es territorio del sync y de la
base; pasos 4–7 más 5b, que es la tienda pública) y uno de `sdd-tester`.

**Lo que se toca de lo que ya funciona:** el handler de `CATEGORY` del sync y su
tipo de salida, el embudo de `processBatch`, el generador de slugs, el tipo
`CatalogProduct` y sus dos lectores, y la página `/[slug]` para colgar la fila.
Todo aditivo: ninguna firma existente cambia de forma, ninguna función existente
cambia de comportamiento salvo `handleCategory`, que pasa a descartar eventos
rancios y a reportar lo que toca.

**Marcha atrás a mitad:** los pasos 4–7 se revierten borrando archivos nuevos y
tres líneas de `/[slug]/page.tsx`. Los pasos 2 y 3 se revierten con el diff. El
paso 1 **no**: una migración aplicada no se deshace borrando el archivo. Si hay
que retroceder después del paso 1, se escribe una migración nueva que quite el
unique — y no pasa nada por dejar la columna, que es nullable y aditiva.

## Preguntas antes de aprobar

Las tres están **resueltas por el humano el 2026-08-31**. Se quedan escritas, con
lo que se preguntó y lo que se respondió: una decisión que solo existe en el hilo
del chat se pierde en la siguiente sesión.

**PP1 (era AP1) — `categorySlug` en `CatalogProduct` obliga a proyectar una
columna más en la consulta de búsqueda de F-021, que la spec dejó fuera de
alcance. ¿Se acepta? → RESUELTO: (a) sí.**
El JOIN a `LocalCategory` ya está en ese CTE y ya proyecta el nombre: es una
línea de SQL, un campo en el tipo crudo y una del mapeo. Las tres capas, el
ranking y la paginación no se rozan. Se descartaron (b) hacer el campo opcional
—un campo que unas veces está y otras no— y (c) duplicar el tipo, que `AGENTS.md`
§ Prohibiciones prohíbe. **Consecuencia para el implementador:** el paso 4 toca
`src/features/catalog/server/search.ts`, y solo para proyectar la columna.

**PP2 (era DP1) — El chip activo mide 3.33 : 1 en una tienda con marca propia,
por debajo del 4.5 : 1 de AA. ¿Se acepta como deuda heredada? → RESUELTO: (a)
aceptarlo aquí, y el arreglo va donde está el problema.**
No lo crea este feature: la misma pareja `bg-brand`/`text-brand-contrast` la
usan hoy `Buscar` y `Agregar al carrito`, porque el tema valida que el valor sea
un color, no que contraste con su pareja. El chip usa el mismo lenguaje visual
que todo lo demás y **no se forkea**. **Consecuencia:** queda pendiente que el
humano abra el feature que valida el contraste al guardar la marca (el
«F-016bis» que F-010 y F-021 ya señalaron). Es suyo por la regla 4 y no entra
aquí.

**PP3 (eran DP2 y DP3) — ¿Entran los dos extras de alcance en este ciclo?
→ RESUELTO: entra 5b, no entra el sitemap.**
Ninguno era necesario para los 15 criterios.

- **5b, el enlace en la ficha del producto: entra.** El nombre de la categoría
  deja de ser texto plano. F-025 dejó ese eslabón explícitamente fuera de su
  alcance, así que no se pisan; la frontera sigue siendo clara: un enlace, no
  unas migas.
- **6b, las categorías en el sitemap: no entra.** Se descubren siguiendo la fila
  desde `/[slug]`, que sí está en el sitemap. Era el único punto donde
  `design.md` (DP3, que lo pedía) y `architecture.md` (§ Qué queda fuera, que lo
  excluía) no coincidían, y se resuelve del lado del arquitecto.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-026 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-08-31T03:30:06Z — aprobado por el humano: «Apruebo. PP1 = (a) sí, proyectar la columna en la consulta de búsqueda. PP2 = (a) aceptar el contraste heredado aquí y arreglar la raíz en un feature aparte. PP3 = entra solo el enlace en la ficha del producto (5b); las categorías NO entran en el sitemap. La migración, aditiva y sin reset.»
