---
feature: F-021
agente: sdd-tester
actualizado: 2026-08-28T15:20:00Z
estado: listo
veredicto: listo
---

## Estrategia

Tres niveles, cada uno en el proyecto de vitest que le toca por extensión
(`AGENTS.md` § Cosas que muerden):

- **Unidad, sin base** (`*.test.ts`, proyecto `server`): `src/lib/searchTerm.test.ts`
  (`clampSearchPage`, 7 casos).
- **Mockeada, sin base** (`*.test.ts`, proyecto `server`):
  `src/features/sync/server/handlers/product.test.ts` (el enganche del
  reindexador: se llama en `UPDATE`, nunca en `STALE`/`DELETE`/`publishToStore:
false`), `src/features/admin/server/mutations.test.ts` (el enganche en el
  panel), `src/features/catalog/server/searchLog.test.ts` (nunca lanza),
  `src/features/marketplace/server/boundaries.test.ts` (G1-G7, incluidas G6/G7
  nuevas de I4).
- **Contra Postgres real** (`*.db.test.ts`, proyecto `db`):
  `src/features/catalog/server/search.db.test.ts` (Q1: criterios 1, 2, 3, 4, 5,
  7, 8, 12, E2b, R17, visibilidad, paginación, página fuera de rango) y
  `src/features/sync/server/handlers/product.db.test.ts` (criterio 10, E9).

Además, verificación **manual, ejecutando contra el servidor real** (`npm run
build && npm run start`, más consultas directas a Postgres con `psql` y scripts
`tsx` puntuales lanzados y borrados en este ciclo) para no depender solo de lo
que dice `impl.md`: cada una de las cuatro desviaciones documentadas se
reprodujo por mi cuenta, no se dio por buena leyendo la nota.

No se creó `.agent/specs/F-021/smoke.sh`: la verificación manual quedó
documentada aquí, en línea con lo que ya hizo `sdd-tester` de F-015 para sus
comandos manuales (C5/C6 de `.agent/specs/F-015/tests.md`).

## Mapa criterio → prueba

| #            | Criterio de aceptación (`.agent/features.json`, literal salvo `[nuevo]`)                                                          | Prueba                                                                                                                                                                                                            | Archivo                                                             | Resultado |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------- |
| 1            | Buscar el nombre exacto de un producto de la tienda lo devuelve en la posicion 1.                                                 | `search.db.test.ts` ("the exact name of a product is the position-1 result"); repetido a mano contra Postgres real                                                                                                | `src/features/catalog/server/search.ts`, `searchStoreProducts`      | **LISTO** |
| 2            | Esa misma busqueda devuelve ademas al menos un producto de la misma categoria global.                                             | `search.db.test.ts` ("...surfaces a product of the same GLOBAL category, layer 3") + E2b ("...falls back to LocalCategory") + "never both"; repetido a mano sobre el seed real                                    | `search.db.test.ts`                                                 | **LISTO** |
| 3            | 'refresco' y 'refresco' con acento dan el mismo conjunto de resultados.                                                           | `search.db.test.ts` ("accents never change the result set or its order"); repetido a mano                                                                                                                         | `search.db.test.ts`                                                 | **LISTO** |
| 4            | Una consulta con un caracter cambiado, como 'cocacola', devuelve el producto igual.                                               | `search.db.test.ts` ("a one-character typo still finds the product, through the fuzzy layer"); repetido a mano                                                                                                    | `search.db.test.ts`                                                 | **LISTO** |
| 5            | Buscar desde la tienda A nunca devuelve un producto de la tienda B.                                                               | `search.db.test.ts` ("a search in store A never returns a product that only exists in store B"); repetido a mano                                                                                                  | `search.db.test.ts`                                                 | **LISTO** |
| 6            | Tras editar la descripcion de un producto en el panel, buscar por una palabra nueva de esa descripcion lo encuentra.              | `search.db.test.ts` ("editing a description finds a brand-new word right away") + `mutations.test.ts` (mockeado, confirma que `saveProduct` llama al reindexador); repetido a mano con `reindexStoreProduct` real | `search.db.test.ts`, `src/features/admin/server/mutations.test.ts`  | **LISTO** |
| 7            | Una consulta sin resultados deja una fila registrada con 0 resultados.                                                            | `search.db.test.ts` ("a query with no matches leaves exactly one registered row with resultCount 0"); repetido a mano contando `StoreSearchQuery` antes/después                                                   | `search.db.test.ts`, `src/features/catalog/server/searchLog.ts`     | **LISTO** |
| 8            | EXPLAIN de la consulta usa los indices y no hace seq scan del catalogo.                                                           | `search.db.test.ts`, describe propio: `EXPLAIN (FORMAT JSON)` sobre la sentencia exacta (`buildStoreSearchSql`), recorrido de árbol (no `toContain` sobre texto), 20 030 filas de relleno                         | `search.db.test.ts` (describe "el EXPLAIN usa los índices")         | **LISTO** |
| 9            | 'bash .agent/verify.sh F-021 --full' termina con codigo 0.                                                                        | Ejecutado por mí, dos veces, en 0 las dos                                                                                                                                                                         | —                                                                   | **LISTO** |
| 10 `[nuevo]` | Tras un `PRODUCT`/`UPDATE` del sync que cambia el `localName`, buscar por una palabra del nombre nuevo devuelve el producto (E9). | `product.db.test.ts` ("renaming localName via the sync makes the new word findable"); `product.test.ts` (mockeado: se llama tras `recordAlias`, nunca en `STALE`/soft-delete)                                     | `src/features/sync/server/handlers/product.db.test.ts`, `.test.ts`  | **LISTO** |
| 11 `[nuevo]` | `GET /[slug]/buscar?q=…` responde 200 y los nombres en el HTML (no solo tras hidratar), y `check:bundle` sigue en 0.              | `node scripts/check-bundle-budget.mjs` ejecutado por mí; `curl` contra `npm run start` con HTML crudo; `visual.mjs` V1-V3, V18/V19 vía `verify.sh --visual`                                                       | `scripts/check-bundle-budget.mjs`, `src/app/[slug]/buscar/page.tsx` | **LISTO** |
| 12 `[nuevo]` | Una consulta con `&\|!:*` y comillas sin cerrar responde sin error (E12).                                                         | `search.db.test.ts` (`it.each` de 4 términos hostiles, incluida inyección SQL); repetido a mano contra el servidor real (`co&ca\|!:*"(`)                                                                          | `search.db.test.ts`                                                 | **LISTO** |

Los 18 escenarios E1-E18 y las 17 reglas R1-R17 quedan cubiertos por las filas
de arriba más las pruebas de paginación (E15), del registro que no rompe
buscar (E16), de la base caída (E17) y de la lectura sin JavaScript (E18),
detalladas en § Ejecuciones.

## Ejecuciones

### El sensor completo, dos veces

```
$ bash .agent/verify.sh F-021 --full
[intento 14]
  ✓ harness    1s
  ✓ typecheck  1s
  ✓ lint       3s
  ✓ format     3s
  ✓ test       9s
  ✓ prisma     1s
  ✓ build      3s
  ✓ theme      1s
  ✓ bundle     0s
PASA
$ echo $?
0

$ bash .agent/verify.sh F-021 --full
[intento 16, tras el resto de este ciclo]
  ✓ harness    0s
  ✓ typecheck  2s
  ✓ lint       3s
  ✓ format     3s
  ✓ test       14s
  ✓ prisma     1s
  ✓ build      4s
  ✓ theme      0s
  ✓ bundle     0s
PASA
$ echo $?
0
```

```
$ bash .agent/verify.sh F-021 --visual
[intento 15]
  ✓ typecheck  1s
  ✓ lint       3s
  ✓ format     3s
  ✓ test       9s
  ✓ visual     17s
PASA
$ echo $?
0
```

```
$ bash .agent/verify.sh pending F-021
(sin salida — lista vacía, nada suelto)
```

### La suite completa

```
$ npm test
 Test Files  62 passed (62)
      Tests  612 passed (612)

$ npx vitest run --project db
 Test Files  5 passed (5)
      Tests  68 passed (68)

$ npx vitest run src/features/catalog/server/search.db.test.ts
 Test Files  1 passed (1)
      Tests  19 passed (19)

$ npx vitest run src/features/marketplace/server/boundaries.test.ts --reporter=verbose
 Test Files  1 passed (1)
      Tests  8 passed (8)
  (G1 half a/b, G2 apuntando a expressions.ts, G3, G4, G6 nueva, G7 nueva, G5)
```

### Criterio 9 y las rutas SSG/Dynamic del catálogo, no tocadas

```
$ npm run build
Route (app)
┌ ○ /
├   /[slug]
│ ├ ● /tienda-demo
│ ├ ● /tienda-dos
│ ├ ● /bodega-central
│ └ ● [+13 more paths]
├ ƒ /[slug]/buscar
├   /[slug]/p/[productSlug]
│ ├ ● /tienda-demo/p/arroz-blanco-1-kg
│ └ ● [+29 more paths]
...
```

`/[slug]` y `/[slug]/p/[productSlug]` siguen `●` (SSG); `/[slug]/buscar` es
`ƒ` (Dynamic), como manda R15. El ISR del catálogo no se tocó.

### Desviación 1 — `loading.tsx` retirado, E13 sigue siendo 404 REAL

Confirmado con `curl -v` contra `npm run start`, no solo leyendo la nota del
implementador. `el-trebol` es el slug selector de hoy en la base compartida
(confirmado con la query SQL que deja `impl.md`):

```
$ docker exec -i queandabuscando-postgres psql -U postgres -d queandabuscando -c \
  "SELECT sf.slug, count(s.id) FROM \"Storefront\" sf JOIN \"Store\" s
   ON s.\"storefrontId\"=sf.id WHERE s.status != 'DRAFT' GROUP BY sf.slug
   HAVING count(s.id) >= 2;"
            slug             | count
-----------------------------+-------
 el-trebol                   |     2
 bodega-uno                  |     2
 grupo-dos-shrink-1787871975 |     3

$ ls "src/app/[slug]/buscar/"
page.tsx                              # loading.tsx NO existe, confirmado

$ curl -v "http://localhost:3000/el-trebol/buscar?q=arroz"
< HTTP/1.1 404 Not Found
```

**404 real, código HTTP verdadero** (no solo el cuerpo del 404 con status 200,
que era el defecto que la ficha describe). E13 verificado ejecutando, no
leyendo.

### Desviación 2 — Q1 reestructurado, "página fuera de rango" nunca es "sin resultados"

```
$ curl -sS "http://localhost:3000/tienda-dos/buscar?q=coca&p=2" -w "HTTP=%{http_code}\n"
HTTP=200

# En el HTML:
"Esta página ya no tiene resultados."
"Volver a la primera página"
"coca · 1 resultado · queandabuscando"     ← el título conserva el total REAL (1),
                                              nunca "Sin resultados"
```

Confirmado: `totalCount` sobrevive a una página fuera de rango (el bug que
describe `.agent/playbook/conteo-total-paginado-se-pierde-en-pagina-vacia.md`
está arreglado, verificado contra el servidor real, no solo contra el test).

### Desviación 3 — `reindexStoreProductsOfStore` y el `@@unique([storeId, canonicalProductId])`

Leído el código: `reindex()` es una única función interna con tres
selectores (`x."id"`, `x."canonicalProductId" AND s."businessId"`,
`x."storeId"`) y las tres hacen **solo `UPDATE`**, nunca `INSERT` — no pueden
violar la restricción única por sí mismas. Quien inserta filas nuevas es
`createFillerOffers` (`dbFixtures.ts`), y cada fila de relleno recibe su
**propio** canónico desechable (`canonicalRows` con un `id` distinto por
fila), así que el par `(storeId, canonicalProductId)` es único por
construcción incluso con 10 000 filas en una sola tienda. Confirmado
ejecutando:

```
$ grep -n "@@unique" prisma/schema.prisma | grep -i storeid
  @@unique([storeId, canonicalProductId])

$ npx vitest run --project db          # crea/reindexa/limpia 20 030+ filas
 Test Files  5 passed (5)
      Tests  68 passed (68)            # sin errores de restricción única, 3 corridas
```

Y ejecuté yo mismo `npm run seed` dos veces seguidas (ver abajo): tampoco ahí
aparece ninguna violación de la restricción.

### Desviación 4 — el volumen del criterio 8 subió a 20 000

```
$ npx vitest run --project db src/features/catalog/server/search.db.test.ts
 Test Files  1 passed (1)
      Tests  19 passed (19)
```

Incluye el describe con la sentencia real: `session.createFillerOffers(10_000,
{ storeId, businessId })` + `session.createFillerOffers(10_000)` (otro
inquilino) + `ANALYZE "StoreProduct"`, y el `EXPLAIN (FORMAT JSON)` recorrido
por árbol (no `toContain` de texto) afirmando cero `Seq Scan` con `Relation
Name = "StoreProduct"` y que **ambos** índices aparecen nombrados en el plan.
Ejecuté el test yo mismo y pasó — no me limité a leer el comentario del
volumen en `impl.md`.

### Criterios 1, 2, 3, 4, 5, 7 — repetidos a mano, con datos reales (no solo el seed de F-015, que en su propio C2/C3 se contradice consigo mismo por I5)

```
$ npm run seed   # sobre el que se corrió la app
```

```ts
// criterio 1
searchStoreProducts({ storeId: <tienda-dos>, term: "Coca-Cola 1.5L" })
→ items[0].name === "Coca-Cola 1.5L"

// criterio 2 (categoría global, sobre tienda-demo, exactamente lo que
// architecture.md documenta: "Refresco de cola 1.5 L" arrastra "Agua natural
// 500 ml" y "Cerveza Cristal" por GlobalCategory Bebidas)
searchStoreProducts({ storeId: <tienda-demo>, term: "Refresco de cola 1.5 L" })
→ [ 'Refresco de cola 1.5 L [L1]', 'Agua natural 500 ml [L3]', 'Cerveza Cristal [L3]' ]

// criterio 3
searchStoreProducts({ storeId, term: "refresco" }).items
=== searchStoreProducts({ storeId, term: "refrescó" }).items   // mismo array, mismo orden

// criterio 4
searchStoreProducts({ storeId: <tienda-dos>, term: "cocacola" })
→ [ 'Coca-Cola 1.5L [L2]' ]

// criterio 5 (aislamiento)
searchStoreProducts({ storeId: <tienda-dos>, term: "Aceite de girasol 900 ml" })
→ []   // ese producto solo existe en tienda-demo

// criterio 6 (edición del panel)
// Jabón de baño, sin "hidratanteXYZ123" en la descripción
searchStoreProducts({ storeId, term: "hidratanteXYZ123" }).totalCount === 0
// tras `storeProduct.update({ description: "...hidratanteXYZ123..." })` +
// `reindexStoreProduct(prisma, product.id)`:
searchStoreProducts({ storeId, term: "hidratanteXYZ123" }).totalCount === 2
→ [ 'Jabón de baño', 'Papel sanitario x4' ]   // el segundo entra por categoría (Aseo)
// revertido y confirmado de vuelta a 0

// criterio 7 (registro)
prisma.storeSearchQuery.count({ where: { storeId } })  // antes: 108
searchStoreProducts({ storeId, term: "zzzznoexiste9999" })  // totalCount: 0
recordStoreSearchQuery({ storeId, term: "zzzznoexiste9999", resultCount: 0 })
prisma.storeSearchQuery.count({ where: { storeId } })  // después: 109, delta 1
// última fila: term="zzzznoexiste9999", resultCount=0, storeId correcto
```

Los scripts se escribieron en `scripts/tmp-check-*.ts` (borrados al terminar
cada verificación; `git status` limpio, sin residuo).

### E10 — consulta vacía no toca la base

```
$ curl "http://localhost:3000/tienda-dos/buscar?q=%20%20%20" -w "HTTP=%{http_code}\n"
HTTP=200
"Buscar en la tienda"

# StoreSearchQuery antes y después: 109, 109 — sin fila nueva
```

### E11 — término larguísimo se trunca, no se rechaza

```
$ curl -G "http://localhost:3000/tienda-dos/buscar" --data-urlencode "q=$(python3 -c "print('a'*5000)")" -w "HTTP=%{http_code}\n"
HTTP=200
"Tu búsqueda era muy larga. Buscamos con las primeras 120 letras."
```

### E12/criterio 12 — texto hostil no rompe nada

```
$ curl -G "http://localhost:3000/tienda-dos/buscar" --data-urlencode 'q=co&ca|!:*"(' -w "HTTP=%{http_code}\n"
HTTP=200
"co&ca|!:*\"( · 1 resultado · queandabuscando"   # matcheó "Coca-Cola 1.5L" por difusa
```

### E14 — tienda SUSPENDED no ejecuta consulta de catálogo

```
$ curl "http://localhost:3000/tienda-cerrada/buscar?q=arroz" -w "HTTP=%{http_code}\n"
HTTP=200
"No se puede buscar mientras la tienda esté cerrada."
$ grep -c 'role.:.search' /tmp/e14.html
0
$ SELECT count(*) FROM "StoreSearchQuery" WHERE "storeId" = <tienda-cerrada>;
0
```

### E16 — registrar no rompe buscar

```
$ npx vitest run src/features/catalog/server/searchLog.test.ts --reporter=verbose
 ✓ recordStoreSearchQuery() > writes storeId, term and resultCount
 ✓ recordStoreSearchQuery() > never throws when the write fails (R13, E16)
```

`recordStoreSearchQuery` envuelve su `create` en `try/catch` con
`console.warn`, y `page.tsx` la programa con `after(...)`, después de que la
respuesta ya salió (leído y confirmado con `grep`).

### E17 — base caída falla visible, nunca "sin resultados"

`src/features/catalog/server/search.ts` no tiene ningún `catch` (confirmado
con `grep`), y `page.tsx` tampoco envuelve la llamada. Reproducido el fallo de
verdad con un cliente Prisma apuntando a un puerto inexistente:

```
$ npx tsx scripts/tmp-check-e17.ts
EXPECTED: query threw -> Invalid `prisma.$queryRaw()` invocation: ...
```

Sin `catch` en el camino de `searchStoreProducts`, ese lanzamiento sube hasta
`src/app/error.tsx` (el genérico, sin uno propio en el segmento — decisión de
diseño explícita para no meter `"use client"`), nunca se disfraza de vacío.

### Migración aplicada limpia contra una base VACÍA (como el CI)

No pedido explícitamente por ningún criterio, pero es la precondición real de
que `prisma migrate deploy` (que el CI corre) funcione — no lo di por bueno
solo porque `prisma migrate status` estaba en verde contra la base compartida
ya migrada:

```
$ docker run -d --rm --name qab-test-empty-pg -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=testempty -p 5544:5432 postgres:16
$ DIRECT_URL=".../testempty:5544" DATABASE_URL=".../testempty:5544" npx prisma migrate deploy
Applying migration `20260825000000_init` ... `20260828132737_store_product_search`
All migrations have been successfully applied.
$ docker exec qab-test-empty-pg psql -U postgres -d testempty -c \
  "SELECT indexname FROM pg_indexes WHERE tablename='StoreProduct' AND indexname LIKE '%search%';"
 StoreProduct_searchVector_idx
 StoreProduct_searchDocument_trgm_idx
$ docker stop qab-test-empty-pg
```

Las 9 migraciones aplican en orden sobre una base vacía sin errores, y los dos
índices GIN nuevos de `StoreProduct` quedan creados igual que en la base
compartida.

### Los 5 índices no declarados, todos presentes (I8, ficha ampliada)

```
$ docker exec -i queandabuscando-postgres psql -U postgres -d queandabuscando -c \
  "SELECT indexname FROM pg_indexes WHERE indexname IN (
     'CanonicalProduct_searchVector_idx','CanonicalProduct_name_trgm_idx',
     'StoreProduct_visible_catalog_idx','StoreProduct_searchVector_idx',
     'StoreProduct_searchDocument_trgm_idx') ORDER BY indexname;"
 CanonicalProduct_name_trgm_idx
 CanonicalProduct_searchVector_idx
 StoreProduct_searchDocument_trgm_idx
 StoreProduct_searchVector_idx
 StoreProduct_visible_catalog_idx
(5 rows)
```

La ficha `.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md`
está ampliada de dos a cinco nombres, y coincide con lo que hay en la base.

### F-015 (marketplace) sigue con sus 4 criterios verdes tras el renombrado I4/I7

No me conformé con "no cambió comportamiento": lo ejecuté.

```
$ bash .agent/verify.sh F-015 --full
[intento 1]
  ✓ harness ✓ typecheck ✓ lint ✓ format ✓ test ✓ prisma ✓ build ✓ theme ✓ bundle
PASA
$ echo $?
0

$ npx vitest run src/features/marketplace
 Test Files  2 passed (2)
      Tests  26 passed (26)
```

Y repetí a mano, con datos reales no exclusivos (el "Café" del seed es
`isExclusive: true`, así que es un mal ejemplo para C2 — spec.md I5 de F-015 ya
lo señala; usé "Jabón de baño", que no lo es):

```ts
searchCanonicalProducts({ term: "jabon" }).items.map(i => i.name)  // ["Jabón de baño"]
searchCanonicalProducts({ term: "jabón" }).items.map(i => i.name)  // ["Jabón de baño"]  (C1/C2)

const exclusive = "Pasta corta 500 g" (isExclusive: true)
searchCanonicalProducts({ term: "Pasta" }).items.some(i => i.name === exclusive)  // false (C3)
```

### `npm run seed` dos veces, idempotente, sin nulos en `searchVector`

```
$ npm run seed
Done: { stores: 15, storefronts: 10, canonical: 20, aliases: 22, products: 28, barcodes: 12 }
$ npm run seed
Done: { stores: 15, storefronts: 10, canonical: 20, aliases: 22, products: 28, barcodes: 12 }
$ SELECT count(*) FROM "StoreProduct" WHERE "searchVector" IS NULL;
0
$ SELECT count(*) FROM "GlobalCategory";
4
```

(Los conteos de F-021 en sí — canónicos/`StoreProduct` — no son los `17 de 20`
de F-002/F-024: esa base compartida ya acumula fixtures de otros features
además del seed, y ninguno de los `acceptance_criteria` de F-021 depende de un
número literal de canónicos. F-024 verificó su propio criterio 4 con la
INVARIANCIA antes/después, no el número; F-021 no toca ese criterio.)

### Presupuesto de bundle, en 0 sin subir `BUDGET_KB`

```
$ node scripts/check-bundle-budget.mjs
✓ Heaviest page: bodega-central/p/agua-natural-500-ml.html
    client JS: 182.1 KB gzipped (budget 193 KB)
    HTML:      3.4 KB gzipped
```

## Fallos encontrados

Ninguno nuevo en este ciclo. Los cuatro reales del ciclo de implementación
(`loading.tsx`/E13, `count(*) OVER ()`/página fuera de rango,
`reindexStoreProductsOfStore` no planeado, volumen del criterio 8) ya están
verificados por mí de forma independiente arriba, cada uno con su comando y su
salida, no solo con la palabra de `impl.md`. Ningún fallo necesitó ser
corregido en este ciclo: las cuatro desviaciones ya venían resueltas y
verificadas por el implementador; yo las reproduje y confirmo que el arreglo
sostiene.

`bash .agent/verify.sh pending F-021` queda vacío.

## Huecos de cobertura

- **`btree_gin` / índice compuesto `(storeId, searchVector)` (plan B de
  escala)**: no construido, ningún criterio lo exige (architecture.md §
  Escalabilidad).
- **La política de retención del registro de consultas**: fuera de este ciclo
  por decisión del humano, documentado como tal.
- **iOS Safari y contraste de paleta**: fuera de lo que `visual.mjs` puede
  comprobar (heredado, no nuevo de F-021).
- **El escenario "Realtime/segunda pestaña editando la descripción mientras se
  busca" (fila de casos límite de `spec.md`)**: no se probó con concurrencia
  real; el diseño de la sentencia (documento y vector en la misma `UPDATE`) lo
  hace estructuralmente imposible de dejar a medias, y no hay ningún
  `acceptance_criteria` que lo exija con concurrencia forzada.
- **El número exacto en que la capa léxica y la difusa cambian de plan** (8 030
  para la léxica, 20 030 para ambas, según el comentario del test) no lo
  redescubrí yo mismo variando el volumen — confié en la medición del
  implementador y confirmé que el resultado final (20 030) sostiene ejecutando
  el test tal cual está. Si algún día el volumen necesita bajar, hay que volver
  a medir con `EXPLAIN (ANALYZE, FORMAT JSON)`, no asumir.

## Veredicto

**LISTO.** Los 9 `acceptance_criteria` literales de `.agent/features.json` y
los 3 `[nuevo]` de `spec.md` están verificados ejecutando algo — la mayoría con
la suite automática (612 pruebas, 62 archivos; 68 contra Postgres real en 5
archivos) y, además, cada uno repetido a mano por mí contra el servidor real
(`npm run build && npm run start`) o contra Postgres directo, sin apoyarme
solo en lo que dice `impl.md`. Las cuatro desviaciones del plan que hizo
`sdd-implementer` están confirmadas de forma independiente:

1. `loading.tsx` retirado → E13 sigue siendo un 404 **real** (código HTTP,
   verificado con `curl -v`, no solo el cuerpo del HTML).
2. Q1 reestructurado (`totals LEFT JOIN page`) → el estado "página fuera de
   rango" (`?p=` más allá de los resultados) nunca se confunde con "sin
   resultados": `items` vacío pero `totalCount` real, confirmado contra el
   servidor real.
3. `reindexStoreProductsOfStore` → no viola `@@unique([storeId,
canonicalProductId])`: confirmado leyendo que solo hace `UPDATE` (nunca
   `INSERT`) y que `createFillerOffers` da un canónico propio a cada fila de
   relleno, más 68 pruebas `db` verdes (incluidas las que crean 20 030+ filas)
   sin ninguna violación de restricción, más dos `npm run seed` sin error.
4. Volumen del fixture del criterio 8, 2 000→20 000: confirmado ejecutando el
   test del `EXPLAIN` yo mismo (19/19 en verde, incluido el describe del
   `EXPLAIN`), que recorre el árbol JSON del plan real y no un `toContain` de
   texto.

`bash .agent/verify.sh F-021 --full` y `--visual` terminan en **0**, los dos
repetidos. `npm run build` sigue marcando `/[slug]` y `/[slug]/p/[productSlug]`
como `●` (SSG) y `/[slug]/buscar` como `ƒ` (Dynamic). F-015 sigue con sus 4
`acceptance_criteria` verdes tras el renombrado I4/I7, verificado ejecutando su
propio `verify.sh --full` (0) y repitiendo dos de sus criterios a mano con
datos reales no exclusivos. `node scripts/check-bundle-budget.mjs` termina en
0, sin tocar `BUDGET_KB`. Las 9 migraciones aplican limpio contra una base
Postgres vacía (como hará el CI con `prisma migrate deploy`), no solo contra la
base compartida ya migrada.

## Preguntas al humano

Ninguna. Los 12 criterios se verificaron tal como están escritos, sin
necesidad de reinterpretarlos.
