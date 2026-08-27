---
feature: F-015
agente: sdd-spec
actualizado: 2026-08-27T14:37:11Z
estado: listo
---

## Problema

El modelo del marketplace existe desde F-002 y el sync lo llena desde F-005:
`CanonicalProduct` con `searchDocument`, `ProductAlias`, `isExclusive`, la
columna `searchVector` y su índice GIN. Pero **nadie escribe nunca
`searchVector` y no hay ninguna consulta de búsqueda**: `grep -rn searchVector
src/` solo devuelve el comentario del schema. Hoy es imposible preguntarle a
esta base «quién vende café», aunque tenga los datos y el índice para
contestarlo.

F-015 cierra ese hueco por la capa de datos: una función de servidor que, dado
un término escrito por una persona, devuelve productos canónicos del
marketplace. Sin pantalla y sin ruta HTTP (SP-H1): lo que se construye aquí es
lo que la pantalla usará cuando exista.

## Alcance

### Dentro

1. **Poblar `searchVector`** en cada escritura de `searchDocument`: los tres
   `create` de canónico y el `update` de recálculo por alias de
   `src/features/sync/server/handlers/product.ts`, y las dos escrituras
   equivalentes de `prisma/seed.ts`.
2. **Rellenar de una vez** las filas ya sincronizadas que tienen
   `searchDocument` lleno y `searchVector` en NULL.
3. **Una función de búsqueda** en src/features/marketplace/server/ (por crear),
   con el contrato de § Datos y contrato.
4. **Pruebas contra Postgres real** para lo que no se puede probar con Prisma
   mockeado: la semántica de `tsvector`, `unaccent` y el orden.

### Fuera (explícito)

- **La búsqueda dentro de una tienda.** Es **F-021** (tres capas, `pg_trgm`,
  expansión por `GlobalCategory`, `storeId` obligatorio). F-015 no filtra por
  tienda, no hace difusa y no registra consultas de cero resultados.
- **La cercanía geográfica.** SP-H5: `docs/adr/0011-sin-postgis-por-ahora.md`
  no se reabre. Nada de PostGIS, `geography`, GiST ni ordenar por distancia.
- **Cualquier ruta HTTP y cualquier UI.** SP-H1. Ni `src/app/`, ni componente,
  ni `revalidateTag`, ni caché de datos: la función se llama desde código de
  servidor y nada más la llama todavía.
- **El precio.** SP-H6: ni precio mínimo, ni moneda, ni conversión, ni
  `priceOverride`. Meter precio arrastraría `src/lib/pricing.ts` y las tasas de
  cambio dentro de la búsqueda.
- **La lista de tiendas por resultado.** SP-H6: solo el conteo.
- **Ampliar `searchDocument`.** Sigue siendo nombre + alias
  (`buildSearchDocument` en `src/lib/canonical.ts`, ADR 0004). Ni
  `CanonicalProduct.description`, ni `GlobalCategory.name`, ni
  `StoreProduct.description`/`localName` — eso último es la incongruencia que
  `.agent/features.json` deja anotada **en F-021**, no aquí.
- **Ponderar nombre por encima de alias** (`setweight`). El documento es un
  blob y todos sus términos pesan igual; mejorarlo es otro feature.
- **Sugerencias, autocompletado, corrección ortográfica y sinónimos.**

## Actores y precondiciones

| Actor                   | Qué hace                                                         |
| ----------------------- | ---------------------------------------------------------------- |
| Cuadre de Caja (el POS) | Entrega eventos `PRODUCT`; cada uno deja `searchDocument` al día |
| Código de servidor      | Llama a la función de búsqueda con un término                    |
| Quien despliega         | Ejecuta una vez el relleno de `searchVector`                     |

Precondiciones:

- `F-005` en `passes: true` (cumplido).
- Las extensiones `unaccent` y `pg_trgm` creadas — ya lo hace
  `prisma/migrations/20260825000000_init/migration.sql`.
- El índice `CanonicalProduct_searchVector_idx` presente. Ojo con la ficha
  `.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md`:
  cualquier `prisma migrate dev` de este feature propondrá borrarlo.

## Comportamiento esperado

Escenarios sobre la función de búsqueda, salvo E1–E4 que son del sync.

**E1 · Un canónico nuevo nace indexado.**
Dado un evento `PRODUCT` con `barcode` `7501031311309` que crea un canónico
nuevo, cuando el handler termina, entonces esa fila tiene `searchVector` no
nulo y sus lexemas están sin acentos (`café` se guarda como `cafe`).

**E2 · Un alias nuevo reindexa en la misma escritura.**
Dado un canónico ya existente con `searchDocument` = `Refresco de cola 1.5 L`,
cuando llega un evento de OTRO negocio con el mismo `barcode` y
`localName` = `Coca-Cola 1.5L`, entonces `searchDocument` pasa a contener
ambos nombres **y** `searchVector` se recalcula en la misma escritura, sin
ninguna pasada posterior de reindexado.

**E3 · Un alias repetido no cambia nada.**
Dado que el negocio ya usó ese `localName` para ese canónico, cuando el evento
se reentrega, entonces solo sube `useCount`, y `searchDocument` y
`searchVector` quedan **idénticos** (idempotencia, § Cosas que muerden de
`AGENTS.md`).

**E4 · Un evento rancio no toca el índice.**
Dado un `StoreProduct` con `sourceUpdatedAt` posterior al `updatedAt` del
payload, cuando llega ese evento, entonces el handler devuelve `stale` y
`searchVector` no se recalcula.

**E5 · Acento en el documento, sin acento en el término.**
Dado un canónico no exclusivo llamado `Café molido 250 g`, cuando se busca
`cafe`, entonces ese canónico está entre los resultados (criterio 2).

**E6 · Acento en el término, sin acento en el documento.**
Dado un canónico no exclusivo llamado `Cafe molido 250 g`, cuando se busca
`café`, entonces ese canónico está entre los resultados. Es la mitad simétrica
de E5 y falla si solo se normaliza uno de los dos lados.

**E7 · El exclusivo no existe para el marketplace.**
Dados dos canónicos que ambos casan con `cafe`, uno con `isExclusive: false` y
otro con `isExclusive: true`, cuando se busca `cafe`, entonces solo aparece el
primero, tenga el exclusivo ofertas vivas o no (criterio 3).

**E8 · Sin oferta viva, igual aparece.**
Dado un canónico no exclusivo cuya única oferta está `OUT_OF_STOCK`, cuando se
busca su nombre **sin** el filtro, entonces aparece con `storeCount: 0`
(SP-H2).

**E9 · El filtro lo saca.**
Mismo dado que E8, cuando se busca **con** `onlyWithLiveOffer: true`, entonces
no aparece.

**E10 · `LOW_STOCK` es oferta viva.**
Dado un canónico no exclusivo cuya única oferta está `LOW_STOCK`, visible, sin
`deletedAt` y en una tienda `PUBLISHED`, cuando se busca con el filtro
activado, entonces aparece con `storeCount: 1` (SP-H3: solo `OUT_OF_STOCK`
queda fuera; es la mitad que es fácil implementar mal).

**E11 · Las otras tres condiciones del filtro.**
Dado un canónico con exactamente una oferta `AVAILABLE`, cuando esa oferta
tiene `visible: false`, o `deletedAt` no nulo, o su tienda no está
`PUBLISHED`, entonces con el filtro activado no aparece, y sin filtro aparece
con `storeCount: 0`. Los tres casos se comprueban por separado.

**E12 · El orden es relevancia y después disponibilidad.**
Dados dos canónicos no exclusivos con el MISMO `searchDocument` —y por tanto el
mismo `ts_rank` para el término—, uno con una oferta viva y otro sin ninguna,
cuando se busca ese término sin filtro, entonces el que tiene oferta viva sale
primero (SP-H4).

**E13 · Varias palabras exigen todas.**
Dado un canónico `Café molido 250 g` y otro `Chocolate molido`, cuando se busca
`cafe molido`, entonces aparece el primero y no el segundo: los términos se
combinan con Y, no con O.

**E14 · Término que no casa con nada.**
Cuando se busca `xilofono`, entonces la función devuelve `items: []` y
`hasMore: false`. No es un error, no lanza, no registra nada.

**E15 · Término vacío.**
Cuando se busca con `""`, `"   "` o solo signos de puntuación, entonces
devuelve `items: []` y `hasMore: false` **sin consultar la base**: no hay
listado completo del marketplace en este feature (R6).

**E16 · Término de una sola letra.**
Cuando se busca `c`, entonces devuelve los canónicos cuyo documento contiene la
palabra `c` —normalmente ninguno—, sin error y sin prefijo implícito: F-015 casa
lexemas completos, no comienzos de palabra.

**E17 · Término con metacaracteres de `tsquery`.**
Cuando se busca `café & | ! ( ) : *`, `"` o `'`, entonces devuelve un resultado
—posiblemente vacío— sin lanzar ningún error de sintaxis de `tsquery`.

**E18 · Término hostil.**
Cuando se busca `'; DROP TABLE "CanonicalProduct"; --`, entonces devuelve
`items: []` y la tabla sigue existiendo.

**E19 · Documento vacío.**
Dado un canónico con `searchDocument` = `""` (el `@default("")` del schema),
entonces su `searchVector` es un `tsvector` vacío, nunca casa con ningún
término, y ni el relleno ni la búsqueda fallan por su causa.

**E20 · Filas heredadas sin vector.**
Dadas las filas ya sincronizadas con `searchDocument` lleno y `searchVector` en
NULL, cuando se ejecuta el relleno, entonces todas quedan con vector y
buscables; volver a ejecutarlo no cambia ninguna fila.

**E21 · Paginación estable.**
Dados 4 canónicos que casan con el término, cuando se piden
`limit: 2, offset: 0` y luego `limit: 2, offset: 2`, entonces los dos conjuntos
son disjuntos y su unión es igual a `limit: 4, offset: 0`, en el mismo orden.
Dos llamadas idénticas devuelven exactamente la misma secuencia.

**E22 · Un canónico ofrecido en dos tiendas es un solo resultado.**
Dado el canónico del EAN `7501031311309`, ofrecido por `tienda-demo` como
`Refresco de cola 1.5 L` y por la segunda tienda como `Coca-Cola 1.5L`, cuando
se busca `coca`, entonces aparece **una** fila, con el `name` del canónico y
`storeCount: 2`. Es a la vez la prueba de que el alias indexa (criterio 4) y de
que la búsqueda no duplica por oferta.

## Reglas de negocio

- **R1.** Toda escritura de `searchDocument` escribe también `searchVector`, en
  el mismo viaje a la base. Son seis sitios hoy: tres `create` y un `update` en
  `src/features/sync/server/handlers/product.ts`, más `create` y `update` en
  `prisma/seed.ts`. Es la trampa que ADR 0004 § Trampa describe: olvidarlo
  degrada la búsqueda **en silencio**.
- **R2.** La normalización de escritura y la de consulta son **la misma
  expresión**, definida en un solo sitio. Escritura:
  `to_tsvector('spanish', unaccent(<documento>))`. Consulta:
  `plainto_tsquery('spanish', unaccent(<término>))`. Si solo se normaliza un
  lado, E5 o E6 falla.
- **R3.** Nunca `to_tsquery` con texto de una persona: lanza error de sintaxis
  ante `&`, `|`, `!`, `:` o un paréntesis suelto (E17). Se usa
  `plainto_tsquery` —Y implícita entre términos, E13— o `websearch_to_tsquery`.
- **R4.** El resultado excluye siempre `isExclusive: true`. No es un filtro
  opcional ni un parámetro: es la definición del conjunto (criterio 3, ADR
  0004).
- **R5.** El filtro de existencia es **opcional y por defecto está apagado**
  (SP-H2). Con él encendido, una oferta cuenta como viva si y solo si cumple
  las cuatro condiciones: `availability` distinto de `OUT_OF_STOCK`
  (equivalente SQL de `isOrderable` en `src/lib/availability.ts`),
  `visible: true`, `deletedAt: null`, y `Store.status = 'PUBLISHED'`.
- **R6.** Término vacío o solo espacios devuelve el conjunto vacío sin
  consultar (E15). No existe «listar todo el marketplace» en F-015.
- **R7.** El término se recorta a los extremos y se limita a una longitud
  máxima declarada en `src/constants/` (prohibición de números mágicos de
  `AGENTS.md`); lo que exceda se trunca, no se rechaza con error.
- **R8.** El orden es, en este orden exacto: `ts_rank` descendente; después
  «tiene oferta viva» descendente (SP-H4); después `name` ascendente; después
  `id` ascendente. Los dos últimos existen para que el orden sea **total** y
  la paginación no repita ni se salte filas (E21).
- **R9.** Un canónico es **una** fila del resultado, aunque lo ofrezcan N
  tiendas (E22). La consulta agrega, no hace producto cartesiano.
- **R10.** `storeCount` es el número de ofertas **vivas** según R5, tenga el
  filtro encendido o apagado. Así el número significa lo mismo en las dos
  llamadas y el desempate de R8 es exactamente `storeCount > 0`.
- **R11.** El término y la paginación viajan como **parámetros ligados**. No se
  interpola texto de una persona en SQL, y no se usa `$queryRawUnsafe` (E18).
- **R12.** La función es de solo lectura: no escribe, no registra consultas, no
  invalida caché. El registro de consultas con cero resultados es de F-021.
- **R13.** El relleno de `searchVector` es **idempotente** y no toca ninguna
  fila que ya tenga vector correcto (E20).
- **R14.** `prisma/seed.ts` deja toda fila de `CanonicalProduct` con
  `searchVector` no nulo, y sigue siendo idempotente: el CI lo corre dos veces
  seguidas (`.github/workflows/ci.yml`).

## Casos límite y errores

| Caso                                               | Comportamiento exigido                                                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Término vacío o solo espacios                      | `items: []`, sin consulta (E15, R6)                                                                                                                                      |
| Término de una letra                               | Sin error, casa solo palabra completa (E16)                                                                                                                              |
| Término sin coincidencias                          | `items: []`, no es error (E14)                                                                                                                                           |
| Acentos en cualquiera de los dos lados             | Mismo conjunto (E5, E6)                                                                                                                                                  |
| Metacaracteres de `tsquery` o comillas sueltas     | Sin error de sintaxis (E17, R3)                                                                                                                                          |
| Intento de inyección                               | Vacío y sin daño (E18, R11)                                                                                                                                              |
| `searchDocument` vacío                             | Vector vacío, nunca casa, no rompe el relleno (E19)                                                                                                                      |
| `searchVector` NULL heredado                       | Invisible hasta el relleno; el relleno lo arregla y es re-ejecutable (E20)                                                                                               |
| Canónico exclusivo                                 | Fuera siempre (E7, R4)                                                                                                                                                   |
| Canónico sin ninguna oferta viva                   | Presente con `storeCount: 0`; ausente con el filtro (E8, E9)                                                                                                             |
| Todas las ofertas borradas en blando               | Igual que el anterior: el canónico permanece buscable. Consecuencia aceptada de SP-H2                                                                                    |
| Oferta en tienda `DRAFT` o `SUSPENDED`             | No cuenta como viva (E11). Cerrar una tienda en el panel escribe `SUSPENDED` junto a `disabledAt` (`src/features/admin/server/mutations.ts`), así que basta con `status` |
| Alias que viene de un negocio sin tienda publicada | Indexa igual: el documento es del canónico, no de la oferta. Con el filtro encendido ese canónico no aparece si no le queda otra oferta viva                             |
| `limit` u `offset` fuera de rango                  | Se acotan a los límites de § Datos y contrato; nunca se pasan crudos a SQL                                                                                               |
| Reentrega del mismo evento del POS                 | `searchVector` idéntico (E3, idempotencia de `AGENTS.md`)                                                                                                                |
| Evento rancio                                      | No reindexa (E4)                                                                                                                                                         |
| Dos eventos concurrentes del mismo canónico        | Gana el último en escribir; ambos calculan el vector desde el `searchDocument` que ellos mismos escriben, así que el par (documento, vector) nunca queda cruzado         |
| Base de datos inalcanzable                         | El error de Prisma se propaga; la función **no** devuelve lista vacía disimulando el fallo                                                                               |

## Datos y contrato

**Nada de esto toca `docs/sync-contract.md`.** El POS no cambia: ningún campo
nuevo del payload, ninguna respuesta distinta. `searchVector` es derivado y
privado de este lado.

### Entrada

| Campo               | Tipo      | Obligatorio | Por defecto | Límites                   |
| ------------------- | --------- | ----------- | ----------- | ------------------------- |
| `term`              | `string`  | sí          | —           | Se recorta; máximo por R7 |
| `onlyWithLiveOffer` | `boolean` | no          | `false`     | SP-H2, SP-H3              |
| `limit`             | `number`  | no          | 20          | entero, 1 a 50            |
| `offset`            | `number`  | no          | 0           | entero, 0 o más           |

### Salida

Un objeto con `items` y `hasMore`.

| Campo de `items[]`   | Tipo             | Nota                                                    |
| -------------------- | ---------------- | ------------------------------------------------------- |
| `canonicalProductId` | `string`         | `CanonicalProduct.id`                                   |
| `name`               | `string`         | El nombre del canónico, no el `localName` de una tienda |
| `imageUrl`           | `string \| null` | `CanonicalProduct.imageUrl`                             |
| `storeCount`         | `number`         | R10. **`number`, nunca `bigint` ni `string`**           |

`hasMore: boolean` — si hay al menos una fila más allá de `offset + limit`. Se
resuelve pidiendo una fila extra, no con un `COUNT(*)` sobre todo lo que casa.

Tres cosas que el tipo no dice y el contrato sí:

1. **`storeCount` llega del driver como `bigint` o `string`** (es un
   `COUNT(*)`, `int8` en Postgres) y hay que convertirlo explícitamente. Un
   `bigint` en la salida rompe `JSON.stringify` en cuanto alguien serialice el
   resultado.
2. **`searchVector` no se puede leer ni escribir con la API tipada de Prisma**:
   es `Unsupported("tsvector")` y no aparece en el tipo del modelo. Toda la
   búsqueda es SQL crudo, el primero del repo. Con `any` prohibido por
   `AGENTS.md`, la fila cruda necesita un tipo declarado y la conversión de
   `storeCount` hecha a mano.
3. **`searchVector` no puede ser una columna generada de Postgres.**
   `to_tsvector('spanish', unaccent(...))` no es inmutable, porque `unaccent`
   resuelve su diccionario en tiempo de ejecución. Por eso el schema dice
   «populated by application code» y por eso el criterio 1 habla de poblarlo
   _al sincronizar_. Tampoco vale un índice de expresión sobre esa misma
   expresión, por lo mismo.

### Qué se lee

`CanonicalProduct` (id, name, imageUrl, isExclusive, searchVector) y
`StoreProduct` (canonicalProductId, availability, visible, deletedAt) con
`Store.status`. Nada más. Ni precio, ni `priceOverride`, ni `ExchangeRate`, ni
`GlobalCategory`, ni `latitude`/`longitude`.

## Criterios de aceptación propuestos

Los cuatro `[ya]` son literales de `.agent/features.json` y no se tocan (regla
3). Cada uno con **cómo se comprueba ejecutando**. `<DB>` es
`docker compose exec -T postgres psql -U postgres -d queandabuscando -Atc`, o
el mismo SQL por `$queryRaw`: en esta máquina no hay `psql` en el PATH, así que
el segundo camino es el que hay que dejar escrito en un guion.

**C1 `[ya]` — «searchVector se puebla al sincronizar usando to_tsvector con
unaccent».**
Con la app levantada y la base migrada: `node scripts/send-catalog-batch.mjs`
responde 207 con `processed`, y después

```sql
SELECT "searchVector" IS NOT NULL, "searchVector"::text NOT LIKE '%é%'
FROM "CanonicalProduct" WHERE ean = '7501031311309';
```

devuelve `t|t`. La segunda columna es la que prueba el `unaccent`: si faltara,
un documento con `Café` guardaría el lexema acentuado. Además, la prueba de
Postgres real de C2 falla si el vector no se puebla.

**C2 `[ya]` — «Buscar 'cafe' encuentra un producto llamado 'Café'».**
Prueba contra Postgres real que crea un canónico `Café molido 250 g` con
`isExclusive: false`, lo indexa por el mismo camino que el sync y afirma que
`searchCanonicalProducts({ term: "cafe" })` lo devuelve. Se ejecuta con
`npm test` y, por tanto, con `bash .agent/verify.sh F-015`. La simétrica (E6,
buscar `café` sobre `Cafe`) va en la misma prueba.
**Atención:** el único producto acentuado del seed, `Café molido 250 g`
(`prisma/seed.ts`), **no tiene EAN**, así que el seed lo crea con
`isExclusive: true` y el criterio 3 lo excluye. La prueba tiene que crear su
propio dato; verificar C2 «contra el seed» sale rojo por una razón correcta.

**C3 `[ya]` — «Los canónicos con isExclusive = true quedan FUERA de los
resultados».**
Prueba con dos canónicos de documento idéntico y `isExclusive` distinto: el
resultado tiene exactamente uno, y es el no exclusivo. Se repite con el filtro
de existencia encendido y apagado (E7).

**C4 `[ya]` — «Un alias nuevo se refleja en los resultados sin reprocesar el
catálogo».**
Sobre una base recién sembrada, `npm run seed` y después
`searchCanonicalProducts({ term: "coca" })` devuelve una fila cuyo
`canonicalProductId` es el del EAN `7501031311309` y cuyo `name` es `Refresco
de cola 1.5 L` —el nombre del canónico— con `storeCount: 2`. El término `coca`
solo puede venir del alias `Coca-Cola 1.5L` de la segunda tienda, y no se
ejecutó ningún reindexado entre medias (E22). La versión sin seed: dos llamadas
al handler con el mismo `barcode` y `localName` distinto, y la búsqueda por el
segundo nombre después de la segunda llamada.

**C5 `[nuevo]` — el relleno de las filas heredadas.**
Antes de correrlo,

```sql
SELECT count(*) FROM "CanonicalProduct" WHERE "searchDocument" <> '' AND "searchVector" IS NULL;
```

es mayor que 0 en una base ya sincronizada. Después de correrlo es `0`, y
correrlo una segunda vez lo deja en `0` sin error (E20, R13). Sin este criterio,
C2 y C4 pueden pasar en una base nueva y la búsqueda seguir vacía en la base que
ya existe: es el hueco que las notas de `.agent/progress/F-015.md` señalan y que
el criterio 1, al hablar solo del sync, no cubre.

**C6 `[nuevo]` — el seed deja la base buscable.**
`npm run seed && npm run seed` termina en 0 y después
`SELECT count(*) FROM "CanonicalProduct" WHERE "searchVector" IS NULL;`
devuelve `0` (R14). Importa porque el CI siembra dos veces y porque un
desarrollador que solo siembra tendría hoy una base con búsqueda muda.

**C7 `[nuevo]` — el filtro de existencia, en sus cuatro condiciones y su
frontera.**
Una prueba contra Postgres real por cada caso de E9, E10 y E11: `OUT_OF_STOCK`
fuera, `LOW_STOCK` dentro, y `visible: false` / `deletedAt` no nulo /
`status` distinto de `PUBLISHED` fuera. Con el filtro apagado, todos presentes
con `storeCount: 0`.

**C8 `[nuevo]` — el orden.**
Prueba con dos canónicos de `ts_rank` igual, uno con oferta viva: el primero del
array es el que la tiene (E12). Y la prueba de paginación de E21.

**C9 `[nuevo]` — el término no rompe la consulta.**
Prueba parametrizada con `""`, `"   "`, `"c"`, `"café & | ! ( ) : *"`, `"'"`,
`'; DROP TABLE "CanonicalProduct"; --` y un término de 10 000 caracteres: cada
uno devuelve una respuesta y ninguno lanza (E15–E18). Después,
`SELECT to_regclass('"CanonicalProduct"') IS NOT NULL` sigue siendo `t`.

**C10 `[nuevo]` — la guarda contra la degradación silenciosa.**
Una prueba de frontera al estilo de `src/features/admin/server/boundaries.test.ts`
que lee el código fuente y falla si aparece una escritura de `searchDocument`
sin su `searchVector` al lado (R1), o si el predicado de búsqueda se escribe
como `to_tsvector(...) @@ ...` en vez de contra la columna `searchVector`
—forma que dejaría el índice GIN sin usar—. Es la única defensa ejecutable
contra la trampa de ADR 0004: nada más se pondría rojo si mañana alguien añade
un quinto sitio que escribe el documento.

**C11 `[nuevo]` — el sensor completo.**
`bash .agent/verify.sh F-015 --full` termina con código 0. F-021 tiene el
criterio equivalente; F-015 no lo tiene y debería, porque es el único que
obliga a que `check:harness`, el build y el presupuesto sigan verdes con el
feature dentro.

**Nota sobre EXPLAIN.** Deliberadamente **no** se propone un criterio de
«EXPLAIN no hace seq scan», como el que tiene F-021. Con las decenas de filas
de una base de desarrollo el planificador elige `Seq Scan` con toda la razón, y
forzarlo con `enable_seqscan = off` convertiría el criterio en teatro. Lo que
sí es verificable hoy es la **forma** del predicado, y de eso se encarga C10.

## Incongruencias detectadas

**I1 · `docs/adr/0011-sin-postgis-por-ahora.md` § «Reabrir cuando» dice
literalmente «Se implemente F-015», y SP-H5 decide no reabrirla.** Es una
contradicción textual, no de criterio: ningún `acceptance_criteria` de F-015
menciona distancia. Al cerrar el feature la ADR necesita una nota que diga que
F-015 se implementó sin PostGIS y que el disparador pasa a ser «cualquier
consulta de tipo tiendas a menos de N km». No la escribo yo: `docs/adr/` no es
mío. **Dueño: el humano o el orquestador, en el plan.**

**I2 · El criterio 1 dice «al sincronizar» y deja fuera las filas que ya se
sincronizaron.** Las notas de `.agent/progress/F-015.md` lo reconocen («hay
filas ya sincronizadas con `searchDocument` lleno y `searchVector` en NULL»),
pero el criterio, tal como está escrito, se cumple sin rellenarlas — y con la
base actual la búsqueda seguiría devolviendo casi nada. No se modifica el
criterio (regla 3): se añade C5.

**I3 · El criterio 1 tampoco cubre `prisma/seed.ts`, que escribe
`searchDocument` en dos sitios más y no es «el sync».** Sin C6, una base recién
sembrada —la del CI y la de cualquier sesión nueva— tiene búsqueda muda y
ninguno de los cuatro criterios lo detecta.

**I4 · «Se recalcula en la misma escritura» no es literalmente posible con
Prisma.** La nota de `.agent/progress/F-015.md` lo pide así, y `recordAlias`
(`src/features/sync/server/handlers/product.ts`) usa
`prisma.canonicalProduct.update`, que **no puede** escribir una columna
`Unsupported`. La intención se cumple con un `$executeRaw` que escriba las dos
columnas a la vez; lo que no se puede es mantener el `update` tipado y añadirle
el vector. Es un dato para el arquitecto, no un cambio de alcance.

**I5 · El único producto acentuado del seed es exclusivo.** `Café molido 250 g`
(`prisma/seed.ts`) no lleva `ean`, y el seed hace `isExclusive: !product.ean`,
así que el criterio 2 (encontrar `Café` buscando `cafe`) y el criterio 3 (los
exclusivos fuera) se contradicen si se intentan verificar los dos sobre el seed.
Recomendación: las pruebas crean su propio dato (C2), y **no** se le pone un EAN
al café del seed solo para que cuadre — el café sin código de barras es
justamente el caso que ADR 0004 quiere representar.

**I6 · Ninguna prueba de este repo ha tocado Postgres todavía.** Las 42
`*.test.ts` mockean `@/lib/prisma`; `vitest.config.mts` no carga `.env` para el
proyecto `server` (los guiones de `scripts/` lo hacen con `import
"dotenv/config"`). SP-H1 pide «pruebas contra Postgres real», así que F-015
estrena esa categoría. Dos consecuencias que el plan tiene que asumir:

- En el CI hay Postgres y `migrate deploy` corre **antes** de `npm test`, pero
  `npm run seed` corre **después** (`.github/workflows/ci.yml`). Las pruebas de
  base real ven un esquema vacío: tienen que crear sus propios datos y no
  pueden apoyarse en el seed. Eso afecta a C4, que en el CI necesita la variante
  «dos llamadas al handler» en vez de la variante «después de `npm run seed`».
- En local la base es compartida y sembrada. Las pruebas no pueden truncar
  tablas ni reutilizar los EAN del seed (`CanonicalProduct.ean` es único):
  necesitan datos con sufijo propio por ejecución y limpieza al terminar.

**I7 · Cualquier `prisma migrate dev` de este feature intentará borrar el índice
GIN.** Ficha `.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md`,
ya visto en F-010. Si el relleno de C5 se hace como migración, hay que revisar
el `migration.sql` generado a mano antes de aplicarlo.

## Huecos y preguntas al humano

**No queda ninguna pregunta abierta.** Las seis decisiones SP-H1 a SP-H6
resuelven la superficie, el conjunto, el filtro, el orden, la cercanía y la
forma del resultado, que era todo lo que bloqueaba. Por eso este documento sale
en `estado: listo` y no en `borrador`.

Dos cosas las decidí yo, dentro de lo que SP-H1 a SP-H6 ya dejaban implícito, y
las dejo señaladas aquí porque son las que el humano querría poder revertir en
una línea al firmar el plan:

- **`storeCount` cuenta ofertas vivas (R10), no ofertas totales.** SP-H6 pide
  «en cuántas tiendas se ofrece» sin decir con qué predicado. Cuento las vivas
  porque es el número sobre el que una persona puede actuar, porque hace que el
  desempate de SP-H4 sea exactamente `storeCount > 0` y porque así el número
  significa lo mismo con el filtro encendido que apagado. El precio de esta
  elección: un canónico sin ofertas vivas sale con `storeCount: 0`, que una
  futura pantalla tendrá que saber pintar como «sin disponibilidad ahora».
  Contarlas todas es cambiar un predicado del agregado y un aserto.
- **Término vacío devuelve vacío (R6), no el catálogo entero.** Sin ruta y sin
  UI (SP-H1) nadie necesita un listado, y un listado sin `ts_rank` no tendría
  con qué ordenarse más que por nombre.

## No decidido a propósito

- **Cómo se ejecuta el relleno de C5** —migración SQL, guion idempotente en
  `scripts/`, o ambos— lo decide `sdd-architect`. La spec solo exige que
  después el conteo sea 0 y que sea re-ejecutable.
- **Cómo se aíslan las pruebas de base real** (naming de archivo, si se salta
  la prueba cuando falta `DATABASE_URL`, cómo se cargan las variables de
  entorno en el proyecto `server` de `vitest.config.mts`) lo deciden
  `sdd-architect` y `sdd-tester`. La exigencia de la spec es una sola: una
  prueba que se salta sin decirlo no verifica nada, así que el sensor tiene que
  poder distinguir «pasó» de «no se ejecutó».
- **La ponderación futura de nombre frente a alias** (`setweight`), la búsqueda
  difusa y los embeddings: fuera de F-015 por decisión ya tomada en las notas de
  F-021.
- **La nota en ADR 0011** (I1): la escribe el humano o el orquestador al cerrar.
