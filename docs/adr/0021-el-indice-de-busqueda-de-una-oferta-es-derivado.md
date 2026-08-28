# 0021 — El índice de búsqueda de una oferta es derivado

**Aceptada** · 28 de agosto de 2026 · F-021

## Contexto

[ADR 0007](0007-price-override.md) y [ADR 0017](0017-frontera-de-escritura-del-panel.md)
reparten cada columna de `StoreProduct` entre exactamente dos dueños: el sync
(`localName`, `syncedPrice`, `availability`, `localCategoryId`, …) y el panel
(`description`, `imageUrls`, `priceOverride`, `visible`, `featured`). Todas las
demás reglas de este repo —la lista blanca tipada de `saveProduct`, el `data`
estrecho del handler del sync, las dos guardas de `boundaries.test.ts`— existen
para que esa frontera se cumpla por construcción.

F-021 añade el documento de búsqueda de una oferta
(`searchDocument`/`searchVector`), y ese documento **se alimenta de las dos
mitades a la vez**: `localName` (del sync) y `description` (del panel), más los
`ProductAlias` del negocio. No hay ningún dueño de los dos existentes al que
pueda asignársele sin romper la frontera que las dos ADR anteriores ya
establecieron: si el sync lo escribiera, tendría que leer `description` para no
perderla; si el panel lo escribiera, tendría que leer `localName`. Cualquiera de
las dos opciones vuelve a poner la propiedad de una columna en manos de quien no
la posee, que es exactamente la trampa que [ADR 0004](0004-identidad-canonica-en-el-sync.md)
§ Trampa describe para el canónico y que aquí se repetiría para la oferta.

## Decisión

**(a) Las columnas derivadas son una tercera categoría de propiedad**, con su
propio bloque en el schema —`// --- derived search index (F-021): owned by
NEITHER side ---`— junto a los dos que ya existían («owned by the sync» y
«owned by the admin panel»). Un escritor propio, al que los otros dos solo
**llaman**, nunca al que escriben directamente.

**(b) Ese escritor recompone el valor leyendo la base, nunca recibiendo texto.**
`reindexStoreProduct`/`reindexStoreProductsOfCanonical`/`reindexStoreProductsOfStore`
(`src/features/catalog/server/searchIndex.ts`) reciben un selector de filas —un
id, un `(canonicalProductId, businessId)`, un `storeId`— y recalculan
`searchDocument`/`searchVector` leyendo `localName`, `description` y los
`ProductAlias` tal como están en ese instante. Ninguno de los dos escritores
existentes le pasa texto: el sync llama al reindexador después de su propio
`update` tipado (que nunca toca `description`), y el panel hace lo mismo después
del suyo (que nunca toca `localName`). Eso es lo que hace imposible que un lado
pise al otro **por construcción**, no por disciplina — la misma propiedad que
[ADR 0019](0019-sql-crudo-para-tsvector-y-pruebas-contra-postgres-real.md) (b)
ya estableció para el documento del canónico.

**(c) La pareja `to_tsvector`/`plainto_tsquery` sube a un módulo compartido y
neutral**, `src/features/search/server/expressions.ts`, y la guarda de
«exactamente un compositor» que ADR 0019 (b) fijó para el canónico se mantiene
apuntando a él en vez de a `src/features/marketplace/server/searchVector.ts`:
esta vez el compositor tiene DOS escritores que lo usan —el del canónico
(F-015) y el de la oferta (F-021)—, y ninguno de los dos pertenece al
vocabulario del otro (`src/features/marketplace/` es del marketplace;
`src/features/catalog/` es de la tienda). Moverlo a un tercer sitio neutral
conserva la invariante entera; dejarlo en cualquiera de los dos la hubiera
degradado a «un dominio importa el vocabulario del otro».

## Consecuencias

- `StoreProduct` tiene ahora tres bloques de propiedad en el schema, no dos. El
  próximo campo derivado que aparezca (un campo calculado, un agregado) tiene
  dónde ir sin inventar una cuarta categoría.
- El sync gana un round-trip por evento `PRODUCT` procesado (el reindexado), y
  el panel gana uno por `saveProduct`. Ninguno de los dos entra en un
  `$transaction` (el pooler corre en modo transacción).
- La guarda G2 de `src/features/marketplace/server/boundaries.test.ts` cambia
  de sujeto (de `searchVector.ts` a `expressions.ts`) pero no de forma: sigue
  exigiendo exactamente un archivo. Es una prueba, no un `acceptance_criteria`:
  se pudo editar sin volver a preguntar.
- Un futuro feature de clasificación que separe `GlobalCategory` en un
  pipeline propio no toca ninguna de las tres decisiones de aquí: seguiría
  llamando al mismo reindexador después de escribir lo que sea que posea.

## Reabrir cuando

Aparezca una CUARTA fuente de texto para el documento de búsqueda de una oferta
(hoy son tres: `localName`, `description`, alias) que no encaje en «leer la base
y recomponer» — por ejemplo, un campo que solo exista fuera de Postgres.
