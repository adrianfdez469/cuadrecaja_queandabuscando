---
slug: pull-orders-mjs-store-slug-nulo-tras-f017
sintoma: 'Error: No orderable product found for store "tienda-demo" — run npm run seed'
firma: No orderable product found for store
etapa: smoke
visto_en: F-007 (F-018, sdd-tester, al correr la regresión) · F-033 (sdd-implementer, verificando --lateral) · ARREGLADO 2026-09-03 con /fix
creado: 2026-08-27T23:12:00Z
promovido_a_agents: no
arreglo: >-
  YA ESTÁ ARREGLADO en scripts/pull-orders.mjs: la consulta usa ahora el
  mismo `STORE_BY_SLUG_JOIN` que los otros cuatro guiones —
  `JOIN "Storefront" sf ON sf.id = s."storefrontId" WHERE (sf.slug = $1 OR
  s.slug = $1)` — que acepta el slug de la marca (el caso normal) o el
  alias de sucursal. Si esta firma vuelve a aparecer, NO es este bug:
  comprueba primero si la tienda que le pasaste tiene algún producto
  visible y en stock, porque el mensaje nuevo cubre las dos causas. En la
  semilla actual hay marcas SIN ningún producto pedible (`el-trebol`, sus
  tres sucursales), y para esas el guion falla con razón. Y si aparece en
  otro guion, es el mismo error de origen: busca `s.slug` sin el JOIN a
  `Storefront`.
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

## Cómo se arregló (2026-09-03)

`pickOrderableProduct` pasó a usar el `STORE_BY_SLUG_JOIN` que **ya existía
en el repo**: los guiones `place-order.mjs`, `quote-delivery-order.mjs`,
`order-link-probe.mjs`, `renegotiate-order.mjs` y `realtime-bell.mjs` lo
llevaban desde antes, con el comentario de F-017 y todo. `pull-orders.mjs`
era el último que seguía leyendo `Store.slug` a pelo — así que el arreglo
no fue diseñar nada, fue copiar el idioma de al lado.

Era la única consulta del archivo con el problema (`grep -n 's\.slug'
scripts/pull-orders.mjs` lo confirma).

De paso, el mensaje de error dejó de acusar a la semilla: ahora nombra las
**dos** causas posibles —ningún slug de marca ni de sucursal coincide, o la
tienda no tiene producto visible y en stock— porque la segunda es real y en
la semilla actual afecta a `el-trebol`.

**Medido antes y después, contra la base de desarrollo:** antes funcionaba
**una** tienda (`bodega-central-vedado`, la única con alias propio); después
funcionan **seis**, incluida `tienda-demo`, que es la que el guion usa por
defecto. Los cinco modos y `--lateral` salen 0 sin ningún `--store=`.

## La lección que no es sobre slugs

Este bug sobrevivió cinco días **porque el apaño funcionaba**: pasarle
`--store=bodega-central-vedado` lo hacía pasar, y esa tienda es
precisamente la única excepción que la semilla siembra a propósito
(`prisma/seed.ts:443-447`, «the ONLY fixture whose branch keeps a live
`Store.slug`»). Un guion que solo se prueba con el dato excepcional parece
correcto justo donde no lo es. Cuando un apaño consiste en cambiar **qué
dato** le pasas, sospecha del código, no del dato.

## Cuándo NO es esto

Si la tienda de prueba SÍ conserva `ownSlug` (como `seed-tienda-4` /
`bodega-central-vedado`), `Store.slug` no es NULL y la consulta encuentra
fila con normalidad — el guion no falla para esa tienda.

## Cómo se evita

Cuando una migración muda dónde vive un dato público (slug, en este caso),
localizar TODOS los consumidores que lo leen por SQL directo —no solo por la
capa de features/registry— antes de dar el cambio por completo. Un
`grep -rn "\.slug" scripts/` habría encontrado este archivo.
