---
slug: pull-orders-mjs-store-slug-nulo-tras-f017
sintoma: 'Error: No orderable product found for store "tienda-demo" — run npm run seed'
firma: No orderable product found for store
etapa: smoke
visto_en: F-007 (F-018, sdd-tester, al correr la regresión)
creado: 2026-08-27T23:12:00Z
promovido_a_agents: no
arreglo: >-
  scripts/pull-orders.mjs::pickOrderableProduct() consulta
  `"Store".slug = $1` directo. Desde la migración de F-017
  (storefront_slug_registry), `Store.slug` es NULL para toda tienda que no
  conserva un alias propio (`ownSlug`) — la marca (`Storefront.slug`) es
  quien tiene "tienda-demo" ahora. Hay que resolver el store por el mismo
  camino que usa la app pública (`features/storefront/server/resolve.ts` /
  `registry.ts`), no por una columna que F-017 dejó de poblar para el caso
  general.
---

## Qué pasa de verdad

`scripts/pull-orders.mjs` (usado por `.agent/specs/F-007/smoke.sh`) siembra un
pedido llamando primero a `pickOrderableProduct("tienda-demo")`, que hace
`SELECT sp.id FROM "StoreProduct" sp JOIN "Store" s ON s.id = sp."storeId"
WHERE s.slug = $1 ...`. La migración de F-017
(`prisma/migrations/20260827023801_storefront_slug_registry/migration.sql`)
mueve el slug público a `Storefront` y deja `Store.slug` en `NULL` para
cualquier tienda que no sea una "sucursal con alias propio" (`ownSlug`) —
que es el caso de `tienda-demo` (`seed-tienda-1`) en el seed actual. La
consulta nunca encuentra fila y el script aborta.

**No es un fallo de F-018.** F-018 solo tocó la variable de token de este
script (`SYNC_TOKEN` → `QAB_BEARER_TOKEN`/`--token=`); la consulta SQL de
`pickOrderableProduct` no la escribió ni la tocó. El origen real es que
F-017 cambió dónde vive el slug público y ningún consumidor de
`scripts/pull-orders.mjs` volvió a probar F-007 contra un seed post-F-017
hasta que F-018 corrió la cadena de regresión completa.

La aplicación real (`/tienda-demo`, el checkout, `POST /api/orders/quote`)
sigue funcionando: resuelve por `Storefront`/`Slug` a través de
`loadStoreForOrder`/`resolve.ts`, no por esta columna. El bug está aislado en
el script de diagnóstico, no en el producto.

## Cómo se arregla

Cambiar `pickOrderableProduct` (y cualquier otro `JOIN` de este archivo que
asuma `Store.slug`) para resolver la tienda por el mismo camino que
`src/features/storefront/server/resolve.ts` usa (vía `Storefront.slug` +
`Slug`), o aceptar el `externalId`/`storeId` en vez de un slug público.

## Cuándo NO es esto

Si la tienda de prueba SÍ conserva `ownSlug` (como `seed-tienda-4` /
`bodega-central-vedado`), `Store.slug` no es NULL y la consulta encuentra
fila con normalidad — el guion no falla para esa tienda.

## Cómo se evita

Cuando una migración muda dónde vive un dato público (slug, en este caso),
localizar TODOS los consumidores que lo leen por SQL directo —no solo por la
capa de features/registry— antes de dar el cambio por completo. Un
`grep -rn "\.slug" scripts/` habría encontrado este archivo.
