---
feature: F-036
agente: sdd-architect
actualizado: 2026-09-07T04:34:15Z
estado: listo
---

> Diseño sobre `.agent/specs/F-036/spec.md` en `estado: listo`, con `SP1` y
> `SP2` abiertas y **no bloqueantes** (la propia spec lo dice). `design.md`
> está en `estado: no aplica`: este feature es backend puro.
>
> Este documento decide **las cinco** cosas que la spec dejó a propósito en
> § «No decidido a propósito» para arquitectura —las claves del `ORDER BY` y el
> `sort: Desc` del índice, el índice viejo, `DISTINCT ON`, el `businessId` de
> `BranchResolution` y la ADR— y **nada más**: ni alcance, ni criterios, ni
> R1..R18, ni el contrato. Deja tres preguntas al humano, `AP1`..`AP3`, y
> **ninguna de las tres bloquea** la firma del plan.
>
> Todo lo numérico de aquí está **medido**, no razonado, en bases de usar y
> tirar del contenedor `queandabuscando-postgres` (`CREATE DATABASE`,
> `migrate deploy`, sembrar, `EXPLAIN`, `DROP DATABASE`). La base compartida
> `queandabuscando` **no se tocó**: sigue con 23 filas y sin la columna,
> comprobado al terminar. Ningún comando prohibido, en ningún paso.
>
> Tres hallazgos cambian recomendaciones literales de la spec y van arriba
> porque el resto del documento depende de ellos:
>
> 1. **La premisa de «el índice sirve el orden sin nodo `Sort`» es falsa con
>    un índice de tres columnas**: Postgres prefiere `Bitmap Heap Scan` +
>    `Sort` por coste, y forzado a usar el índice el plan sale **más caro**
>    (coste 1809 contra 1490). Lo que sí elimina el `Sort` —y el acceso al
>    heap— es un índice **cubridor**. Ver § AD1.
> 2. **El nombre que la spec propone para el índice no es el que Prisma
>    genera.** Con seis columnas, Prisma trunca a
>    `ExchangeRate_businessId_currencyCode_sourceUpdatedAt_create_idx` (límite
>    de 63 caracteres de Postgres). Se le pone nombre explícito con `map:`.
> 3. **La línea que Prisma genera para la columna no se puede aplicar.**
>    `ADD COLUMN … TIMESTAMP(3) NOT NULL` en un solo enunciado falla con
>    `contains null values` —reproducido, el mensaje completo está en § Modelo
>    de datos y migraciones— y a partir de ahí `migrate dev` ofrece
>    **resetear**, que es comando prohibido. El rodeo obligatorio es
>    `--create-only`.

## Estado actual relevante

| Pieza                                                                       | Qué aporta, y qué se reutiliza tal cual                                                                                                                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/catalog/server/queries.ts`                                    | `loadRates` (línea 389) y `getStoreRates` (línea 404), el envoltorio con `cached()` y `storeTag`. El envoltorio se queda; el cuerpo de la consulta se va                                    |
| `src/features/orders/server/quote.ts`                                       | `loadFreshRates` (línea 151), sin caché, en el camino de `quoteCart` → `POST /api/orders/quote` y `POST /api/orders`. Su `businessId` **ya lo tiene** (`OrderStore.businessId`, línea 149)  |
| `src/features/sync/server/handlers/misc.ts`                                 | `handleExchangeRate` (línea 199): el `return SKIPPED` de `CUP` (línea 204), el `currency.upsert` y el `exchangeRate.create` (línea 212). Solo cambia el `data` del `create`                 |
| `src/features/catalog/server/search.ts`                                     | El molde de AD3: `buildStoreSearchSql` (línea 152) devuelve un `Prisma.Sql` que el lector ejecuta con `$queryRaw` (línea 269) **y el test importa** para explicarlo                         |
| `src/features/catalog/server/search.db.test.ts`                             | `hasSeqScanOnStoreProduct` (línea 471), el caminador del árbol de `EXPLAIN (FORMAT JSON)`, y el precedente de «el volumen se mide y se justifica en el comentario» (líneas 415-423)         |
| `src/features/storefront/server/resolve.ts`                                 | `BranchResolution` (línea 41) y el `findUnique` de `Storefront` (línea 91) que ya trae la fila del negocio: el `businessId` de AD4 es **una columna más en un `select` que ya corre**       |
| `src/lib/cache.ts`                                                          | `cached()` (línea 70), `storeTag` (línea 27) y `revalidateStores` (línea 86). No cambia nada aquí                                                                                           |
| `prisma/schema.prisma`                                                      | `model ExchangeRate` (líneas 523-535) y su `@@index([businessId, currencyCode, createdAt])` (línea 534). La única tabla que este feature migra                                              |
| `prisma/seed.ts`                                                            | El array `RATES` (línea 71) y el `create` con guarda `findFirst` (líneas 336-343). Entra en alcance por I4                                                                                  |
| `prisma/migrations/20260831033437_local_category_slug_unique/migration.sql` | El precedente exacto de forma: cabecera que **documenta los `DROP INDEX` quitados a mano** y pasos numerados con su porqué. F-026 lo generó con `--create-only`                             |
| `src/features/marketplace/server/dbFixtures.ts`                             | `createFillerOffers`/`createFillerOrders` (líneas 437 y 380): el patrón de «filas de relleno de otro negocio para que el `businessId` sea selectivo». El helper de tasas es de `sdd-tester` |

Nada nuevo en `src/lib/`, nada en `src/app/`, nada en `src/components/`, **cero
JavaScript de cliente**, cero tags de caché nuevos, cero endpoints, cero
esquemas Zod (R10).

## Decisión

Los dos lectores dejan de traer todas las filas del negocio: pasan por **una
sola** función que ejecuta **un solo** `DISTINCT ON (currencyCode)` construido
con `Prisma.sql`, servido por **un** índice cubridor que hace el plan un
`Index Only Scan` sin nodo `Sort`. `BranchResolution` gana `businessId` para que
la consulta de la vitrina sea, literalmente, la misma sentencia que la del
checkout. Cinco decisiones, en orden de dependencia.

### AD1 — `currencyCode` va antes de `sourceUpdatedAt`, el índice declara `sort: Desc` **y** lleva `rate` de cola

**Decisión.** El criterio de orden, idéntico en los dos lectores porque es la
misma cadena de SQL en el mismo archivo (R4, R5):

```sql
ORDER BY "currencyCode" ASC, "sourceUpdatedAt" DESC, "createdAt" DESC, "id" DESC
```

y el índice:

```prisma
@@index([businessId, currencyCode, sourceUpdatedAt(sort: Desc), createdAt(sort: Desc), id(sort: Desc), rate], map: "ExchangeRate_current_rate_idx")
```

**Por qué medido y no razonado.** La spec planteaba la disyuntiva como «con
`currencyCode` primero el índice sirve el orden sin nodo `Sort`; sin él, se
acepta el `Sort`». Medido en una base con 50 negocios, 4 monedas y 47 200 filas
(800 del negocio objetivo), con `VACUUM ANALYZE` antes de cada plan:

| Índice disponible                                                           | Plan elegido para el orden de arriba                               | Coste   | `Sort` |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------- | ------ |
| `(businessId, currencyCode, sourceUpdatedAt)` (todo ASC)                    | `Bitmap Heap Scan` + `Sort`                                        | 1490    | sí     |
| `(businessId, currencyCode, sourceUpdatedAt DESC, createdAt DESC, id DESC)` | `Bitmap Heap Scan` + `Sort` (el índice **existe** y **no** se usa) | 1490    | sí     |
| el mismo, forzado con `enable_bitmapscan=off, enable_seqscan=off`           | `Index Scan using ix_b_mixed`                                      | 1809    | no     |
| **el de arriba + `rate` de cola (cubridor)**                                | **`Index Only Scan`, `Heap Fetches: 0`**                           | **547** | **no** |

Es decir: **declarar `sort: Desc` no basta**. Con las cinco claves y sin `rate`
el índice puede servir el orden pero Postgres no lo elige, y tiene razón: las
filas de un negocio están dispersas por todo el heap (la tabla es append-only e
intercalada entre negocios), así que el `Index Scan` paga ~800 accesos
aleatorios y sale **más caro** que escanear y ordenar. Lo que cambia el plan de
verdad es que la consulta **no necesite el heap**: con `rate` como última clave,
las seis columnas que la sentencia toca (`businessId` en el `Index Cond`;
`currencyCode`, `sourceUpdatedAt`, `createdAt`, `id` en el orden; `rate` en el
`SELECT`) están todas en el índice.

Y `currencyCode` **tiene que ir antes** de `sourceUpdatedAt`, no por el `Sort`
sino porque es lo que `DISTINCT ON (currencyCode)` exige de su `ORDER BY`
(AD3): el prefijo del orden ha de ser la expresión del `DISTINCT ON`. Las dos
decisiones son una.

**Con qué volumen se mide y qué plan se espera** (criterio 7, y esto va tal cual
al andamio de `sdd-tester`). Medido sembrando en escalones sobre una base limpia,
con 21 filas del negocio objetivo y relleno de **otro** negocio:

| Filas totales | `relpages` | Nodo sobre `ExchangeRate` |
| ------------- | ---------- | ------------------------- |
| 21            | 1          | `Seq Scan` + `Sort`       |
| 121           | 2          | `Seq Scan` + `Sort`       |
| **321**       | **4**      | **`Index Only Scan`**     |
| 621 … 9 121   | 8 … 113    | `Index Only Scan`         |

El salto está **entre 121 y 321 filas totales**. Con las 23 de hoy el plan es
`Seq Scan` por coste y con razón (fila «La tabla vacía al hacer el `EXPLAIN`» de
la spec). Recomendación para el test: **2 000 filas de relleno de otro negocio y
~20 del propio** — un orden de magnitud por encima del salto, diez veces menos
volumen que las 20 000 de `src/features/catalog/server/search.db.test.ts:415-423`
(la búsqueda necesitaba tanto porque comparaba dos GIN), y por tanto un
`*.db.test.ts` que sigue siendo rápido. `VACUUM ANALYZE` en vez de `ANALYZE`
desde el principio (ficha
`.agent/playbook/explain-seq-scan-flaky-bajo-analyze-sin-vacuum.md`).

Plan esperado, literal, medido:

```
Result
  ->  Unique
        ->  Index Only Scan using "ExchangeRate_current_rate_idx" on "ExchangeRate"
              Index Cond: ("businessId" = 'b1'::text)
              Heap Fetches: 0
```

**Un aviso sobre `Heap Fetches`, para que nadie escriba la aserción
equivocada.** `Heap Fetches: 0` depende del mapa de visibilidad, no del plan:
medido, tras insertar 3 filas y correr solo `ANALYZE`, el nodo **sigue siendo**
`Index Only Scan` y `Heap Fetches` pasa a `3`. La aserción del criterio 7 va
sobre el **nodo** —ningún `Seq Scan` cuyo `Relation Name` sea `ExchangeRate`— y
sobre que el texto del plan **nombre** `ExchangeRate_current_rate_idx`; nunca
sobre `Heap Fetches`.

**El nombre del índice se fija con `map:`.** Sin él, Prisma genera
`ExchangeRate_businessId_currencyCode_sourceUpdatedAt_create_idx` —comprobado
con `prisma migrate diff`—: el nombre por convención pasa de 63 caracteres y se
trunca. Eso rompe dos cosas: la aserción del criterio 7, que tiene que nombrar
el índice, y la estabilidad del nombre, que cambiaría al tocar cualquier columna
del índice. `map: "ExchangeRate_current_rate_idx"` sale tal cual en el
`CREATE INDEX` y `npx prisma validate` da verde con él.

**Alternativas descartadas**: el orden global `sourceUpdatedAt DESC, createdAt
DESC, id DESC` con `(businessId, sourceUpdatedAt DESC, …)` —igual de correcto,
mismo plan `Bitmap Heap Scan` + `Sort` sin cubrir, y **no** es compatible con
`DISTINCT ON`, así que obligaría a quedarse con el bucle de JS y a traer todas
las filas—; el índice de tres columnas todo ASC —el `Sort` no es el problema
(0,1 ms con 800 filas), pero deja los 800 registros viajando y 213 páginas
leídas—; declarar el orden **todo** descendente (`currencyCode DESC, …`) para
que un índice todo ASC lo sirva escaneando hacia atrás —medido, funciona
(`Index Only Scan Backward`, `Heap Fetches: 0`), y se descarta porque
`currencyCode DESC` no significa nada y solo se sostiene si el lector sabe que
un índice se recorre al revés cuando **todas** las direcciones se invierten: la
próxima persona que añada una clave ASC rompe el plan sin entender por qué—;
`INCLUDE (rate)` —lo canónico para un índice cubridor, pero `prisma/schema.prisma`
no lo expresa, así que el índice quedaría sin declarar y Prisma propondría
borrarlo en cualquier diff futuro, que es exactamente la trampa de R16.

### AD2 — el índice viejo `(businessId, currencyCode, createdAt)` se retira

**Decisión: se retira**, y su `DROP INDEX` es la única línea de `DROP INDEX` que
se **conserva** en el `migration.sql` generado.

Es legítimo: lo administra Prisma (R9), a diferencia de los cuatro de R16 que
Prisma proponía borrar en este mismo diff. Y no sirve a nadie:

- Los dos únicos lectores dejan de ordenar por `createdAt` como primera clave
  (AD1), así que el índice ya no sirve ningún criterio de orden.
- El único otro acceso de lectura de la tabla es el `findFirst` de
  `prisma/seed.ts:337`, cuyo `where` es `{ businessId, currencyCode }`: lo sirve
  **mejor** el índice nuevo, cuyo prefijo es exactamente ese par.
- Coste de conservarlo, medido: 2 424 kB con 47 200 filas (~52 bytes por fila) y
  una inserción de btree por cada `exchangeRate.create` del sync, en una tabla
  que **nunca borra nada**. El índice nuevo cuesta 4 832 kB (~105 bytes/fila);
  retirar el viejo deja el coste total de índices de lectura donde estaba, más o
  menos, en vez de duplicarlo.

Lo que **no** puede pasar, y por eso está en § Modelo de datos con su medición:
que la migración se lleve por delante los índices de R16.

**Alternativa descartada**: conservarlo «por si acaso» — una tabla de escritura
pura con un índice que ningún lector usa es coste sin lector, y el día que
alguien quiera consultar por orden de llegada tiene `id` y `createdAt` en el
índice nuevo.

### AD3 — los lectores pasan a `DISTINCT ON (currencyCode)`, en **una** función compartida

**Decisión: sí, `DISTINCT ON`, con `$queryRaw(Prisma.sql\`…\`)`,** en un módulo
nuevo src/features/catalog/server/rates.ts (por crear) que exporta el
constructor de la sentencia y el lector. Los dos lectores de hoy dejan de tener
consulta propia: llaman a la misma función.

**El argumento de escala, con los números.** El lector de hoy trae **todas** las
filas del negocio para devolver una por moneda, y la tabla es append-only: ese
número crece con cada evento **para siempre**. En la base de desarrollo son ya
23 filas para devolver 4, con 19 de `QAB` de las corridas del smoke de F-035
(I5). Medido con el cliente Prisma real, un negocio con 4 monedas:

| Filas del negocio | `findMany` + bucle en JS | `$queryRaw` con `DISTINCT ON` | Filas que viajan |
| ----------------- | ------------------------ | ----------------------------- | ---------------- |
| 800               | 2,53 ms (vitrina 3,37)   | 1,18 ms (vitrina 0,82)        | 800 → **4**      |
| 8 000             | 12,80 ms (vitrina 9,55)  | 3,93 ms (vitrina 4,38)        | 8 000 → **4**    |

Y en páginas leídas, con el índice de AD1: **3 buffers** para responder, contra
**213** del `Bitmap Heap Scan` de 800 filas. Los dos caminos siguen siendo
lineales en el número de filas del negocio —Postgres 16 no tiene _skip scan_ de
btree, eso llega en 18; comprobado: `server_version` 16.15 en desarrollo y
`postgres:16` en CI—, pero la constante es ~3× menor y, sobre todo, **la
respuesta deja de crecer**: 4 filas hoy, 4 filas dentro de tres años. Eso
importa especialmente en el checkout, que **no tiene caché** y corre en cada
`POST /api/orders/quote` y en cada `POST /api/orders`.

**Lo que cuesta, y por qué se acepta.**

- **Prisma no expresa `DISTINCT ON`**, así que hace falta SQL crudo. No es un
  estreno: lo decide ya `docs/adr/0019-sql-crudo-para-tsvector-y-pruebas-contra-postgres-real.md`
  («todos los valores viajan ligados», nunca `$queryRawUnsafe`), y el camino
  público de búsqueda del catálogo ya corre así en producción
  (`src/features/catalog/server/search.ts:269`). Se compone con `Prisma.sql` y
  el único valor interpolado es el `businessId`, ligado como `$1` —comprobado en
  el `sql.text` generado.
- **El pooler en modo transacción** (`AGENTS.md` § Cosas que muerden): la
  sentencia es **una**, fuera de cualquier `$transaction`, exactamente como el
  `$queryRaw` de la búsqueda. No hay nada que pueda hacer deadlock contra la
  conexión del pool.
- **El tipo de `rate`.** Comprobado, y era el riesgo real de perder la API
  tipada: `$queryRaw` devuelve la columna `numeric` como `Prisma.Decimal`, y
  `.toString()` da **exactamente** la misma cadena que hoy (`'440'` por los dos
  caminos, sobre la misma fila de la base compartida). El
  `Record<string, string>` que consumen `resolveProductPrice` y `convert()` no
  cambia ni un carácter.

**Y lo que compra además, que es lo que decide la forma.** R4 exige que el orden
sea «el mismo `ORDER BY` … carácter por carácter» en los dos lectores. Con
`orderBy` de Prisma eso es disciplina: dos arrays en dos archivos que alguien
tiene que acordarse de mantener iguales. Con **una** función que devuelve **un**
`Prisma.Sql`, R4 deja de ser una regla que cumplir y pasa a ser una propiedad
del código: no hay dos sitios donde divergir. Y el criterio 7 se explica sobre
**la sentencia real**, importando el constructor en el test como hace
`src/features/catalog/server/search.db.test.ts:452` —`Prisma.Sql` lleva su
`.text` con los `$1` y sus `.values`, que es justo lo que `Client.query` de `pg`
acepta—. Eso resuelve la disyuntiva (a)/(b) que la spec dejaba en C7 con una
tercera opción mejor que las dos: no hace falta capturar la sentencia del log
—que, medido, **sí** emite bajo el driver adapter: `$on("query")` imprimió las
dos consultas de los lectores actuales— ni copiarla a mano y añadir una
aserción anti-deriva, porque **no hay copia**.

**Dónde vive, y por qué en `catalog` y no en `storefront`.** Las tasas ya viven
en `src/features/catalog/server/` (`loadRates`), y `getStoreRates` —el
envoltorio con `cached()` y `storeTag`— se queda con sus hermanos en
`src/features/catalog/server/queries.ts`. `src/features/orders/server/quote.ts`
importará el módulo nuevo, que no es un tipo de arista nueva: ya importa
`@/features/storefront/server/resolve` (línea 13). Meterlo en
`src/features/storefront/server/` haría a ese feature dueño de un dato que no
tiene nada que ver con él, y ese módulo es el dueño de `Slug` por
`src/features/storefront/server/boundaries.test.ts`.

**Alternativas descartadas**: seguir trayendo todas las filas y quedarse con la
primera en JS —correcto, y es lo que hay hoy, pero la respuesta crece sin techo
en la única tabla del repo que no borra nunca—; `DISTINCT ON` a través de
`findMany` con `distinct: ["currencyCode"]` de Prisma —no es lo mismo: Prisma
aplica el `distinct` **en memoria, después** de traer las filas, así que arregla
el bucle de JS y no el volumen, que es el problema—; una vista o una columna
`isCurrent` mantenida al escribir —rompe el append-only y añade un escritor que
puede quedarse a medias, y R14 lo pone fuera—; dos `$queryRaw` con dos `WHERE`
distintos —dos cadenas de SQL crudo sin compilador que las mantenga iguales, que
es peor que lo que hay hoy.

### AD4 — `BranchResolution` gana `businessId`, y el lector de tasas recibe su **propio** `Pick`

**Decisión: sí.** `BranchResolution` y `SelectorResolution`
(`src/features/storefront/server/resolve.ts:41` y `:62`) ganan
`businessId: string`, y `getStoreRates` deja de tomar `StoreRef` para tomar un
tipo propio.

**Lo que cuesta, medido en el código.** El `findUnique` de `Storefront`
(`src/features/storefront/server/resolve.ts:91`) **ya trae la fila del negocio**:
`Storefront.businessId` es una columna más en un `select` que ya corre. Cero
consultas nuevas, cero round-trips nuevos, cero cambios en la caché de
`resolvePublicSlug`. Se añade a los tres `return` de `loadResolution` (líneas
145, 165, 182) y a la fixture `storefrontRow()` de
`src/features/storefront/server/resolve.test.ts`. Los tests de resolución usan
`toMatchObject`, así que un campo más no rompe ninguna aserción existente.

**Lo que compra.** La consulta de la vitrina pasa de esto —la sentencia real,
capturada del log del cliente, no deducida—:

```sql
SELECT … FROM "ExchangeRate"
  LEFT JOIN "Business" AS "j0" ON ("j0"."id") = ("ExchangeRate"."businessId")
 WHERE (EXISTS(SELECT "t1"."businessId" FROM "Store" AS "t1"
                WHERE ("t1"."id" = $1 AND ("j0"."id") = ("t1"."businessId")
                  AND "t1"."businessId" IS NOT NULL)) AND ("j0"."id" IS NOT NULL))
 ORDER BY …
```

a `WHERE "businessId" = $1`, que es **exactamente** la del checkout. Con eso:

1. **I2 desaparece.** El criterio 7 vuelve a ser un `EXPLAIN`, no dos, porque no
   hay dos sentencias: hay una, construida en un sitio, con dos llamadores.
2. **Y se lleva por delante una trampa concreta del test.** Medido: el plan de
   la consulta con filtro por relación contiene `Seq Scan on "Business"` (50
   filas) y `Seq Scan on "Store"` (1 fila), los dos legítimos. Un
   `toContain("Seq Scan")` sobre el texto del plan —lo que uno escribe primero—
   habría fallado por dos nodos que el criterio no prohíbe. La spec ya lo
   avisaba en I2; con AD4 el plan simplemente no los tiene.
3. **Un round-trip más barato en la vitrina**, de paso: 3 tablas a 1. Medido,
   3,37 ms → 0,82 ms con 800 filas. Es el argumento más débil de los tres y por
   sí solo no justificaría nada.

**Lo que NO se hace, y es la mitad de la decisión.** **No** se ensancha
`StoreRef` (`src/features/catalog/server/queries.ts:23`). Ese `Pick` lo comparten
`getStoreBySlug`, `requireStore`, `getStoreCatalog`, `getStoreCategories`,
`getStoreCategoryView` y `getFilteredStoreCatalog`, y uno de sus llamadores no es
una resolución: `getPublishedBranchesForParams`
(`src/features/catalog/server/queries.ts:517`) devuelve
`{ storeId, canonicalSlug, slugs }` construido a mano, y lo consumen los
`generateStaticParams` de `src/app/[slug]/p/[productSlug]/page.tsx:44` y de
`src/app/[slug]/c/[categorySlug]/page.tsx:37`. Ensanchar `StoreRef` obligaría a
arrastrar `businessId` por `loadPublishedStorefronts`, `PublishedBranch` y esos
dos `generateStaticParams`, que no tienen nada que ver con este feature. En su
lugar, un `Pick` propio para el único lector que lo necesita:

```ts
// src/features/catalog/server/queries.ts, junto a StoreRef
type RateRef = Pick<BranchResolution, "businessId" | "canonicalSlug">;
```

Las cinco páginas que llaman `getStoreRates(resolution)` pasan la resolución
entera, así que compilan sin tocarse.

**Alternativas descartadas**: dejar el filtro por relación —cumple el criterio 7
igual (medido: con 47 200 filas el plan de la vitrina es `Nested Loop` con
`Index Scan` sobre `ExchangeRate`, **sin** `Seq Scan` sobre esa tabla), pero deja
dos sentencias, dos planes y R4 en manos de la disciplina—; resolver el
`businessId` con una consulta extra en el lector de la vitrina —un round-trip
por página para un dato que la resolución ya tiene en la mano—; pasar
`businessId` solo en `BranchResolution` y no en `SelectorResolution` —el
selector no lee tasas hoy, pero dejar el campo en una de las dos ramas de la
unión invita a un `kind === "branch"` de más en el próximo lector.

### AD5 — sí, una ADR, y corta

**Decisión: sí**, `docs/adr/0030-la-tasa-vigente-la-decide-la-lectura.md`
(borrador escrito en este ciclo, siguiente número libre tras la 0029).

El motivo no es la variante de orden en sí: eso está argumentado y firmado en
`.agent/solicitudes.md` § S-005 y publicado en la regla ② del contrato, y una
ADR que lo repita es deuda. El motivo es que **ninguno de esos dos documentos es
donde alguien mira**. `.agent/solicitudes.md` es un registro de negociación con
el otro equipo; `docs/sync-contract.md` es el contrato del cable. La pregunta que
esta decisión deja para siempre es de esquema —«¿por qué `ExchangeRate` no tiene
un `@@unique([businessId, currencyCode])`, ni una bandera `isCurrent`, ni forma
de borrar una fila?»— y quien la haga estará mirando `prisma/schema.prisma`, no
una solicitud.

Y hay dos piezas estructurales que **no** están en ninguno de los dos y que esta
ADR es el único sitio donde caben: que los dos lectores pasan por **una** función
y **una** sentencia (lo que convierte R4 en una propiedad del código) y que la
tabla lleva un índice **cubridor** porque la verdad se decide leyendo. La ADR
apunta a S-005 y a la regla ② en dos líneas y no las repite.

**Alternativa descartada**: no escribirla, como hizo `.agent/specs/F-035/architecture.md`
§ «¿Hace falta una ADR?». Allí el mecanismo estaba ya decidido **y documentado en
una ADR** (la 0018); aquí lo está en un log de negociación y en un contrato de
cable, que no es lo mismo.

### Lo que esto añade a la tabla § Datos y contrato de la spec

La spec fija que `sourceUpdatedAt` sale de `payload.updatedAt` y que el índice
«contiene `sourceUpdatedAt`»; se cumple. Lo que este diseño añade y la spec
delegaba: el nombre explícito del índice, sus seis columnas con sus direcciones,
la sentencia `DISTINCT ON` como forma de la lectura, el módulo nuevo que la
contiene, el `businessId` de la resolución y el `Pick` propio del lector. El
`payload` no cambia (R10), la respuesta HTTP no cambia y `docs/sync-contract.md`
no se toca (C8, R17).

## Componentes

| Componente                                | Capa                 | Responsabilidad                                                                                                       | Archivo                                                                                        |
| ----------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `buildCurrentRatesSql(businessId)`        | `features/*/server/` | La ÚNICA sentencia: `DISTINCT ON (currencyCode)` con el `ORDER BY` de AD1. Exportada para que el test la explique     | src/features/catalog/server/rates.ts (por crear)                                               |
| `loadCurrentRates(businessId)`            | `features/*/server/` | La ejecuta con `$queryRaw` y la proyecta a `Record<string, string>`. El único sitio con Prisma del feature en lectura | src/features/catalog/server/rates.ts (por crear)                                               |
| `CurrentRateRow`                          | tipo                 | `{ currencyCode: string; rate: Prisma.Decimal }` — la fila cruda, no una interfaz paralela                            | src/features/catalog/server/rates.ts (por crear)                                               |
| `getStoreRates`                           | `features/*/server/` | Sigue siendo el envoltorio `cached()` + `storeTag`. Cambia el loader y el argumento; `loadRates` desaparece           | `src/features/catalog/server/queries.ts`                                                       |
| `RateRef`                                 | tipo                 | `Pick<BranchResolution, "businessId" \| "canonicalSlug">`. `StoreRef` **no** se toca                                  | `src/features/catalog/server/queries.ts`                                                       |
| `quoteCart` (su lectura de tasas)         | `features/*/server/` | `loadFreshRates` desaparece; llama a `loadCurrentRates(store.businessId)`. Sigue sin caché                            | `src/features/orders/server/quote.ts`                                                          |
| `handleExchangeRate`                      | `features/*/server/` | El `create` gana `sourceUpdatedAt: new Date(payload.updatedAt)`. Ninguna rama nueva, ningún `STALE` (R2, R3)          | `src/features/sync/server/handlers/misc.ts`                                                    |
| `BranchResolution` / `SelectorResolution` | tipo                 | Ganan `businessId: string`, tomado del `select` que ya corre                                                          | `src/features/storefront/server/resolve.ts`                                                    |
| `model ExchangeRate`                      | schema               | Columna `sourceUpdatedAt DateTime` (`NOT NULL`, sin `@default`) y el índice de AD1 con `map:`. El viejo se retira     | `prisma/schema.prisma`                                                                         |
| La migración                              | schema               | Los cuatro pasos de § Modelo de datos, en ese orden, en un solo `migration.sql` revisado a mano                       | prisma/migrations/&lt;timestamp&gt;\_exchange_rate_source_updated_at/migration.sql (por crear) |
| `RATES` y su `create`                     | seed                 | Marca explícita y determinista, un literal y nunca `new Date()` (R15, I4)                                             | `prisma/seed.ts`                                                                               |

### Archivos que toca cada cambio

| Archivo                                                                                        | Qué cambia                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma`                                                                         | `model ExchangeRate` (líneas 523-535): columna `sourceUpdatedAt DateTime`; `@@index` de la línea 534 sustituido por el de AD1 con `map: "ExchangeRate_current_rate_idx"`. Ningún otro modelo                                           |
| prisma/migrations/&lt;timestamp&gt;\_exchange_rate_source_updated_at/migration.sql (por crear) | Generada con `migrate dev --create-only` y **editada a mano**: los cuatro pasos de § Modelo de datos, cuatro `DROP INDEX` borrados, uno conservado, cabecera que lo documenta como la de F-026                                         |
| `prisma/seed.ts`                                                                               | `RATES` (línea 71) gana `sourceUpdatedAt` por entrada, con un literal ISO; el `create` de la línea 341 lo propaga con el spread que ya usa. La guarda `findFirst` (líneas 337-339) no se toca                                          |
| src/features/catalog/server/rates.ts (por crear)                                               | Nuevo: `buildCurrentRatesSql`, `loadCurrentRates`, `CurrentRateRow`. Importa `Prisma` de `@/generated/prisma/client` y `prisma` de `@/lib/prisma`                                                                                      |
| `src/features/catalog/server/queries.ts`                                                       | `loadRates` (líneas 389-402) **se borra**; `getStoreRates` (líneas 404-409) pasa a `cached(loadCurrentRates, …)(branch.businessId)` y su parámetro a `RateRef`; `RateRef` se define junto a `StoreRef` (línea 23)                      |
| `src/features/orders/server/quote.ts`                                                          | `loadFreshRates` (líneas 150-163) **se borra**; su llamador usa `loadCurrentRates(store.businessId)`. Una importación nueva. `OrderStore` no cambia                                                                                    |
| `src/features/sync/server/handlers/misc.ts`                                                    | Solo el `data` del `create` (línea 212). `handleCurrency` no se toca (R12); el `return SKIPPED` de `CUP` (línea 204) sigue siendo lo primero (R11)                                                                                     |
| `src/features/storefront/server/resolve.ts`                                                    | `businessId: string` en `BranchResolution` (línea 41) y `SelectorResolution` (línea 62); `businessId: true` en el `select` de la línea 91; los tres `return` (líneas 145, 165, 182) lo pasan                                           |
| `src/features/sync/server/handlers/misc.test.ts`                                               | La aserción de la línea 374 gana `sourceUpdatedAt`; el helper `exchangeRatePayload` (línea 290) ya manda `updatedAt`. Más los casos de R1/R2/R3                                                                                        |
| `src/features/orders/server/quote.test.ts`                                                     | El mock pasa de `exchangeRate.findMany` (líneas 14, 42, 164) a `$queryRaw`; la resolución de la línea 27 gana `businessId`                                                                                                             |
| `src/features/storefront/server/resolve.test.ts`                                               | La fixture `storefrontRow()` gana `businessId`, y una aserción de que la resolución lo propaga                                                                                                                                         |
| src/features/catalog/server/rates.test.ts (por crear)                                          | Unidad con `prisma` mockeado: la forma de la sentencia (el `ORDER BY` completo de AD1, sin `NULLS`), el mapeo a `Record<string, string>`, y `{}` con cero filas (E11)                                                                  |
| src/features/catalog/server/rates.db.test.ts (por crear)                                       | El `EXPLAIN` del criterio 7 con el volumen de AD1, y la invariante permanente de la migración (`IS NULL` → 0, columna `NOT NULL` en `information_schema`)                                                                              |
| `src/features/marketplace/server/dbFixtures.ts`                                                | Un helper de filas de relleno de tasas, hermano de `createFillerOffers` (línea 437). **Su forma es de `sdd-tester`** (§ No decidido, punto 6): aquí solo consta el archivo                                                             |
| .agent/specs/F-036/smoke.sh (por crear)                                                        | C1, C2, C3, C4 y C6, calcado de `.agent/specs/F-035/smoke.sh`. Guion y trampas ya escritos en la spec                                                                                                                                  |
| `docs/despliegue.md`                                                                           | Una entrada para esta migración, hermana de la de F-026 (líneas 66-81): que es aditiva, que rellena con `createdAt`, y que `migrate dev` **no** la puede aplicar de una pasada. `AGENTS.md` § Documentación lo exige en el mismo ciclo |
| `docs/adr/0030-la-tasa-vigente-la-decide-la-lectura.md`                                        | La ADR de AD5. Borrador escrito en este ciclo                                                                                                                                                                                          |
| `AGENTS.md`                                                                                    | La frase de I7 («hay dos formas de la guarda…»). **No la escribe este agente** ni el de la spec: va en el mismo commit que el código o no se escribe nunca. Ver `AP3`                                                                  |

Lo que **no** se toca, y va escrito para que el plan no lo ordene:
`src/features/sync/schemas.ts` (R10), `docs/sync-contract.md` (C8, R17),
`src/lib/cache.ts`, `src/lib/money.ts`, `src/lib/prisma.ts`,
`src/features/sync/server/processBatch.ts`, `src/features/sync/server/businessBranches.ts`
(F-035, en pie y usado como precondición), `handleCurrency` (R12),
`src/features/catalog/server/queries.ts`'s `StoreRef` y todo lo que cuelga de él,
y `src/app/` **entero**: las cinco páginas que llaman `getStoreRates(resolution)`
compilan sin cambios porque pasan la resolución completa.

## Flujo de datos

Solo los pasos con estrella son nuevos.

**Escritura.** Un lote entra por `POST /api/internal/sync/catalog`;
`findCatalogMismatch` (`src/app/api/internal/sync/catalog/route.ts:39`) garantiza
que el lote es de **un** negocio; `processCatalogBatch` separa duplicados y por
cada evento fresco llama al handler. En `EXCHANGE_RATE`: `CUP` → `SKIPPED`
**antes** de cualquier escritura (R11, E9); si no, `currency.upsert` y ★
`exchangeRate.create` con `sourceUpdatedAt: new Date(payload.updatedAt)`. El
outcome sigue siendo el de F-035 y la única `revalidateStores` del final del
lote no cambia (E8). Un evento rancio escribe su fila y responde `processed`
(R2, R3): no hay rama nueva, ni comparación de marcas, ni `STALE`.

**Lectura, vitrina.** `/[slug]` → `resolvePublicSlug` (cacheado, tag `slug:`) →
★ la resolución trae `businessId` → `getStoreRates(resolution)` →
`cached(loadCurrentRates, { keyParts: ["store-rates"], tags: [storeTag(canonicalSlug)] })(businessId)`
→ si la entrada está fría, ★ **una** sentencia `DISTINCT ON` → 4 filas →
`Record<string, string>` → `resolveProductPrice`. La entrada la expira
`revalidateStores` de F-035 al aplicar cualquier tasa del negocio, y el suelo de
3 600 s de `STOREFRONT_REVALIDATE` sigue siendo el techo.

**Lectura, checkout.** `POST /api/orders/quote` → `quoteCart` →
`loadStore(slug)` (que ya trae `businessId` en `OrderStore`) → ★
`loadCurrentRates(store.businessId)`, **la misma función y la misma sentencia**,
sin caché. De ahí el criterio 6: los dos lectores no pueden discrepar porque no
hay dos criterios de orden.

**Cambio de cardinalidad de la caché, dicho en voz alta.** El argumento de
`getStoreRates` pasa de `storeId` a `businessId`, y el argumento **es** parte de
la clave (`src/lib/cache.ts:70`, «Arguments are appended automatically»). Con eso
las entradas de tasas pasan de **una por sucursal renderizable** a **una por
negocio**. Es seguro, y no por casualidad: la entrada queda etiquetada con el
`storeTag` de la sucursal que la creó, y F-035 expira `storeTag` de **todas** las
sucursales renderizables del negocio en cualquier escritura de tasa, así que la
entrada compartida se expira siempre. No es una dependencia nueva: hoy, con una
entrada por sucursal, la frescura de las tasas **ya** depende de que F-035
invalide el negocio entero. Lo que cambia es que ahora hay una entrada que
mantener fría en vez de N. La variante conservadora está en `AP2`.

## Contratos

Nada cruza una frontera HTTP: sin endpoint nuevo, sin body nuevo, **sin esquema
Zod nuevo** (R10). Los contratos son de tipos y de una sentencia.

```ts
// src/features/catalog/server/rates.ts (por crear)

/** Una fila cruda del DISTINCT ON. `rate` llega como `Prisma.Decimal`
 *  —comprobado bajo el driver adapter—, igual que por `findMany`. */
export type CurrentRateRow = { currencyCode: string; rate: Prisma.Decimal };

/**
 * La ÚNICA sentencia que decide cuál es la tasa vigente de un par
 * (negocio, moneda). Exportada porque el EXPLAIN del criterio 7 la explica
 * TAL CUAL —`Prisma.Sql` lleva su `.text` y sus `.values`—, nunca una copia.
 */
export function buildCurrentRatesSql(businessId: string): Prisma.Sql;

/** `{ USD: "440", MLC: "210.5" }`. `{}` si el negocio no tiene ninguna fila
 *  (E11): ordenar cero filas da cero filas. */
export function loadCurrentRates(businessId: string): Promise<Record<string, string>>;
```

La sentencia, literal —el `ORDER BY` es el de R4/R5 y el prefijo que
`DISTINCT ON` exige, y **no lleva `NULLS`** en ninguna clave (R8):

```sql
SELECT DISTINCT ON ("currencyCode") "currencyCode", "rate"
  FROM "ExchangeRate"
 WHERE "businessId" = $1
 ORDER BY "currencyCode" ASC,
          "sourceUpdatedAt" DESC,
          "createdAt" DESC,
          "id" DESC
```

```ts
// src/features/catalog/server/queries.ts
type RateRef = Pick<BranchResolution, "businessId" | "canonicalSlug">;

// src/features/storefront/server/resolve.ts
export type BranchResolution = {
  kind: "branch";
  /** F-036 (AD4): el negocio de la marca, tomado del `select` de
   *  `Storefront` que esta resolución ya hace. Es lo que permite que la
   *  vitrina y el checkout ejecuten LA MISMA sentencia de tasas (R4). */
  businessId: string;
  // … el resto, sin cambios
};
```

**Tabla de errores: ninguna nueva.** Este feature no introduce ningún código de
error, ningún estado nuevo en `results[].status` (R3) y ningún camino nuevo de
fallo. Lo que ya existe sigue igual: un `EXCHANGE_RATE` que falla por base caída
cae en `failed[]` por el `catch` de `src/features/sync/server/processBatch.ts:91`
—y un evento fallido **no** es un duplicado (`AGENTS.md` § Cosas que muerden)—; un
negocio sin tasas devuelve `{}` y los productos en otra moneda salen sin importe
en la vitrina y como `orderable: false` / `NO_PRICE` en la cotización (E11).

## Modelo de datos y migraciones

```prisma
/// Append-only. `rate` is CUP per 1 unit of `currencyCode`; CUP is never stored.
/// F-036: which row is CURRENT is decided by the READ criterion below, never by
/// insertion order. See docs/adr/0030.
model ExchangeRate {
  id           String   @id @default(uuid())
  businessId   String
  currencyCode String
  rate         Decimal  @db.Decimal(18, 6)
  createdAt    DateTime @default(now())
  /// The POS payload's `updatedAt`. NOT NULL and WITHOUT `@default` on
  /// purpose (R7): Postgres orders NULLs FIRST in `ORDER BY … DESC`, so a
  /// row without a mark would win forever; and a default would hand a
  /// forgetful writer a FALSE mark that also wins.
  sourceUpdatedAt DateTime

  business Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  currency Currency @relation(fields: [currencyCode], references: [code])

  @@index([businessId, currencyCode, sourceUpdatedAt(sort: Desc), createdAt(sort: Desc), id(sort: Desc), rate], map: "ExchangeRate_current_rate_idx")
}
```

`npx prisma validate` da verde sobre este modelo (comprobado sobre una copia del
schema, fuera del repo).

### La forma del `migration.sql`, paso a paso y en orden

**Cómo se genera, y por qué no con `migrate dev` a secas.** Lo que Prisma emite
para este cambio es, literalmente:

```sql
ALTER TABLE "ExchangeRate" ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3) NOT NULL;
```

Aplicado sobre una tabla con filas —reproducido en una base de usar y tirar con
una fila— eso da:

```
ERROR:  column "sourceUpdatedAt" of relation "ExchangeRate" contains null values
```

La base compartida tiene 23 filas, así que `npx prisma migrate dev` **fallará al
aplicar** y a partir de ahí ofrecerá **resetear**, que es comando prohibido
(R18, `AGENTS.md` § Comandos prohibidos). El camino es
**`npx prisma migrate dev --create-only`** (crea la carpeta y no la aplica),
editar el archivo, y aplicar con `npx prisma migrate deploy` — el mismo
procedimiento con el que se generó la migración de F-026, que `docs/despliegue.md`
ya documenta. Si al aplicar aparece deriva de checksum de otro worktree, el
rodeo está fichado en
`.agent/playbook/prisma-migrate-dev-checksum-drift-bd-compartida.md`.

**Los cuatro pasos, en este orden, en un solo `migration.sql`:**

```sql
-- 1. Columna nullable. Aditiva: no reescribe la tabla, no necesita default y
--    no le quita nada a ningún worktree que aún no tenga este código.
ALTER TABLE "ExchangeRate" ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3);

-- 2. Relleno con `createdAt`, que para una tabla append-only es exactamente
--    "cuándo entró esta tasa" (R6). NUNCA `now()`: rellenaría con la hora de
--    la migración y no con la de la fila.
UPDATE "ExchangeRate" SET "sourceUpdatedAt" = "createdAt" WHERE "sourceUpdatedAt" IS NULL;

-- 3. Recién ahora, NOT NULL. Es lo que hace que la trampa deje de existir:
--    sin NULLs posibles, ninguna consulta futura puede resucitar una fila
--    vieja por ordenar sin `NULLS LAST` (R7, R8).
ALTER TABLE "ExchangeRate" ALTER COLUMN "sourceUpdatedAt" SET NOT NULL;

-- 4. Los índices, al final: el cubridor de AD1 y la retirada del viejo (AD2).
CREATE INDEX "ExchangeRate_current_rate_idx"
  ON "ExchangeRate"("businessId", "currencyCode", "sourceUpdatedAt" DESC, "createdAt" DESC, "id" DESC, "rate");
DROP INDEX "ExchangeRate_businessId_currencyCode_createdAt_idx";
```

Verificado de punta a punta en una base de usar y tirar con una fila de enero:
los cuatro pasos corren y la fila queda con `sourceUpdatedAt = createdAt`
(`t`). Las dos mediciones de R6 después de aplicar:
`SELECT count(*) FROM "ExchangeRate" WHERE "sourceUpdatedAt" IS NULL` → `0`, y
`… WHERE "sourceUpdatedAt" <> "createdAt"` → `0` para las filas anteriores.

### El aviso de R16, con la medición de este diff

**`prisma migrate dev` propone cinco `DROP INDEX` en este cambio, y no son los
cinco de `AGENTS.md`.** Medido con `prisma migrate diff --from-config-datasource
--to-schema` contra la base compartida, la lista exacta que Prisma emite es:

| `DROP INDEX` propuesto                               | Qué hacer con la línea                                |
| ---------------------------------------------------- | ----------------------------------------------------- |
| `CanonicalProduct_name_trgm_idx`                     | **borrarla del archivo**                              |
| `CanonicalProduct_searchVector_idx`                  | **borrarla del archivo**                              |
| `StoreProduct_searchDocument_trgm_idx`               | **borrarla del archivo**                              |
| `StoreProduct_searchVector_idx`                      | **borrarla del archivo**                              |
| `ExchangeRate_businessId_currencyCode_createdAt_idx` | **conservarla**: es la de AD2, y Prisma la administra |

Dos cosas que no se pueden leer al revés. La primera: la quinta línea **es
legítima** y borrarla junto con las otras cuatro dejaría el índice viejo en la
base y la migración desincronizada del schema. La segunda: `StoreProduct_visible_catalog_idx`
—el quinto índice de la lista de `AGENTS.md`— **no** aparece en este diff, aunque
existe en la base (comprobado: es un índice parcial y Prisma 7.9.1 no lo propone
aquí; en el diff de F-026 sí lo proponía). Eso **no** significa que la lista de
`AGENTS.md` esté mal: significa que la regla no es «borra cinco líneas», es
**«compara cada `DROP INDEX` del archivo contra los cinco nombres de la ficha y
borra los que coincidan»**. Ficha:
`.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md`.
Comprobación **después** de aplicar, la de R16:
`SELECT count(*) FROM pg_indexes WHERE indexname IN (…los cinco…)` → `5`.

La cabecera del `migration.sql` documenta las cuatro líneas quitadas, igual que
la de `prisma/migrations/20260831033437_local_category_slug_unique/migration.sql`.

**El sensor no comprueba nada de esto**: la etapa `prisma` de `verify.sh` es solo
`npx prisma validate` (C9). Lo comprueba el CI con `migrate deploy` y el seed
doble, y de este lado el guion ordenado de C5.

## Escalabilidad y límites

**Por lectura de tasas: 1 sentencia SQL, 4 filas, ~3 páginas leídas.** Medido
con el índice de AD1 y 8 000 filas del negocio: `Index Only Scan`,
`Heap Fetches: 0`, `Buffers: shared hit=3`, 0,13 ms de ejecución. La respuesta
es **constante en el número de monedas del negocio** (3-5 en la práctica), no en
el número de filas de la tabla.

**Lo que se arregla, con el número.** Hoy la respuesta crece con el histórico:

| Filas del negocio          | Hoy (`findMany`)                      | Después (`DISTINCT ON`)     |
| -------------------------- | ------------------------------------- | --------------------------- |
| 23 (la base de desarrollo) | 23 filas, 4 útiles                    | 4 filas                     |
| 800                        | 800 filas, 2,53 ms, 213 buffers       | 4 filas, 1,18 ms, 3 buffers |
| 8 000                      | 8 000 filas, 12,80 ms, sort de 880 kB | 4 filas, 3,93 ms            |

**Cuándo se llega a 8 000.** Un negocio con 4 monedas y un refresco por moneda y
por hora hace ~96 filas/día: 8 000 son ~83 días. Con un refresco diario, ~5,5
años. Los dos son plausibles y ninguno tiene freno: la tabla es append-only y
nadie borra (R14). Ése es el argumento de AD3, y no es teórico: las 19 filas de
`QAB` que el smoke de F-035 dejó en tres corridas son la misma curva en pequeño.

**Qué se rompe primero al multiplicar por 100.** No es la lectura: con 800 000
filas en la tabla y 8 000 del negocio, el `Index Only Scan` sigue leyendo solo el
tramo del negocio (~113 páginas del índice medidas a 9 121 filas, lineal en las
filas **del negocio**, no de la tabla). Lo que se rompe primero es el
**checkout**, que no tiene caché: a 100× filas por negocio (800 000 filas de un
solo negocio) el `Index Only Scan` recorre ~10 000 páginas de índice por
cotización, y eso son cientos de ms **en cada** `POST /api/orders/quote`. El
umbral aproximado está en **~50 000 filas por negocio** (≈15 años de refresco
horario, o el día que alguien reenvíe el histórico completo del POS): a partir de
ahí el arreglo natural es un `LIMIT 1` por moneda con un `LATERAL` sobre las
monedas del negocio, que convierte el recorrido en 4 búsquedas de una entrada
—Postgres 16 no tiene _skip scan_ de btree y por eso hoy no se hace solo—. No se
hace ahora: hoy son 23 filas y esto sería complejidad sin problema. Queda
escrito con su umbral.

**Round-trips por petición: los mismos que hoy.** La vitrina hacía 1 y hace 1; el
checkout hacía 1 y hace 1. Lo que baja es el número de tablas de esa consulta en
la vitrina (3 → 1, AD4) y el número de filas que vuelven.

**Escrituras.** Un lote de 500 `EXCHANGE_RATE` sigue costando 2 sentencias por
evento (`currency.upsert` + `exchangeRate.create`). Los índices por fila
insertada pasan de 2 (pk + el viejo) a 2 (pk + el cubridor), porque AD2 retira
uno: **el coste de escritura no sube**. Lo que sube es el tamaño del índice,
~105 bytes/fila contra ~52: 5 MB por millón de filas más que hoy. Es la única
cifra de coste de este feature y es la de `AP1`.

**El pooler.** Ninguna consulta nueva dentro de un `$transaction`
(`AGENTS.md` § Cosas que muerden). El `$queryRaw` es una sentencia suelta, como
la de `src/features/catalog/server/search.ts:269`, que ya corre así contra el
mismo pooler en producción.

**Caché e ISR.** Cero tags nuevos, cero entradas nuevas: las de tasas pasan de
una por sucursal renderizable a **una por negocio** (§ Flujo de datos). El suelo
sigue siendo `STOREFRONT_REVALIDATE` = 3 600 s y lo que la invalida sigue siendo
`revalidateStores` de F-035.

**JavaScript de cliente: 0 KB nuevos**, ni un byte: no hay componente, no hay
`"use client"`, no hay nada de cliente. `npm run check:bundle` no cambia de
número.

## Qué se rompe si alguien implementa esto mal

Una línea por decisión, y cada una es una decisión distinta que alguien puede
tomar mal:

- **Aplicar el `ADD COLUMN … NOT NULL` que Prisma genera** (AD1/migración): la
  migración falla en la base compartida con `contains null values`, y el
  siguiente paso que ofrece la herramienta es `migrate reset`, que destruye los
  datos de todos los worktrees.
- **Rellenar con `now()` o poner `@default(now())`** (R6, R7): las filas viejas
  quedan con la hora de la migración; la segunda medición de R6 (`<> "createdAt"`
  → 0) falla y una tasa de enero queda datada hoy.
- **Dejar la columna nullable y ordenar sin `NULLS LAST`** (R6): Postgres pone
  los `NULL` primero en `DESC`, así que la fila vieja gana **para siempre** y el
  feature produce exactamente el fallo que venía a arreglar.
- **Borrar los cinco `DROP INDEX` del archivo** (AD2, R16): el índice viejo se
  queda en la base, el schema y la migración quedan desincronizados y el
  siguiente `migrate dev` de cualquiera vuelve a proponerlo.
- **Dejar los cuatro `DROP INDEX` de búsqueda** (R16): ningún test se pone rojo y
  la búsqueda del catálogo pasa a hacer scans secuenciales en producción.
- **Poner el índice sin `map:`** (AD1): el nombre sale truncado a
  `…_sourceUpdatedAt_create_idx`, la aserción del criterio 7 que nombra el índice
  falla, y el nombre volverá a cambiar solo la próxima vez que alguien toque una
  columna del índice.
- **Poner el índice sin `rate` de cola** (AD1): el plan vuelve a
  `Bitmap Heap Scan` + `Sort` —el índice existe y Postgres no lo elige— y el
  criterio 7 pasa igual (no hay `Seq Scan`) mientras el coste se triplica en
  silencio.
- **Poner `sourceUpdatedAt` antes de `currencyCode` en el índice o en el
  `ORDER BY`** (AD1): `DISTINCT ON (currencyCode)` exige que su expresión sea el
  prefijo del `ORDER BY`; Postgres rechaza la consulta con
  `SELECT DISTINCT ON expressions must match initial ORDER BY expressions`.
- **Escribir el `ORDER BY` dos veces, una por lector** (AD3, R4): vuelve la
  divergencia que R4 prohíbe, esta vez en SQL crudo y por tanto sin compilador
  que la note, y el criterio 6 pasa a depender del plan.
- **Explicar en el test una copia a mano de la sentencia** en vez de importar
  `buildCurrentRatesSql` (AD3): la copia se despega del código sin que nada
  avise y el criterio 7 acaba certificando una consulta que ya no existe.
- **Usar `findMany` con `distinct: ["currencyCode"]`** creyendo que es lo mismo
  (AD3): Prisma lo aplica en memoria después de traer todas las filas, así que el
  volumen —el problema— no cambia y el `EXPLAIN` no mejora.
- **Ensanchar `StoreRef` para meterle `businessId`** (AD4): el cambio se propaga
  a `loadPublishedStorefronts`, `PublishedBranch` y los `generateStaticParams` de
  dos páginas, que no tienen nada que ver con este feature.
- **Añadir `businessId` al tipo y olvidarlo en el `select` de `Storefront`**
  (AD4): TypeScript no lo nota si el objeto se construye con un spread, y las
  tasas se leen con `businessId: undefined` → `{}` → todos los productos en
  moneda extranjera pierden el importe, en las dos lecturas a la vez.
- **Aserción `toContain("Seq Scan")` sobre el texto del plan** (AD4, I2): falla
  por un `Seq Scan on "Business"` de 50 filas que es legítimo; el caminador tiene
  que estar acotado al nodo cuyo `Relation Name` es `ExchangeRate`.
- **Hacer el `EXPLAIN` con las 23 filas de hoy** (AD1): Postgres elige
  `Seq Scan` por coste y con razón, y el criterio 7 falla sin que nada esté mal.
- **Correr `ANALYZE` en vez de `VACUUM ANALYZE`** (AD1): el plan se vuelve
  inestable entre corridas y se diagnostica como flaky lo que es coste
  (`.agent/playbook/explain-seq-scan-flaky-bajo-analyze-sin-vacuum.md`).
- **Poner una marca en el futuro sobre una moneda compartida en el smoke**
  (C1, I5): con el orden nuevo, un `updatedAt` de 2099 en `QAB` deja el smoke de
  F-035 fallando **para siempre**, porque sus tasas con `now()` ya no ganarían.
- **Sembrar la marca del seed con `new Date()`** (R15): dos siembras sobre bases
  distintas dan fixtures distintas y cualquier test que compare tasas depende de
  la hora de la siembra.
- **Añadirle una rama de rechazo a `handleExchangeRate`** (R2, R3): el POS recibe
  algo que no es `processed`, interpreta que su evento no se aplicó y gasta uno de
  los 6 intentos de su ADR 0011 en algo que sí insertó su fila.
- **Resolver `businessId` con una consulta propia en el lector de la vitrina**
  (AD4): un round-trip por página para un dato que la resolución ya tiene, y dos
  fuentes de verdad para el mismo negocio.
- **Escribir la ADR repitiendo S-005 y la regla ②** (AD5): tres documentos que
  dicen lo mismo y que a partir de la próxima edición dirán cosas distintas.

## Los dos comentarios que dejan de ser ciertos (I6)

Los dos, en el mismo commit que el código; son los dos únicos sitios donde este
mecanismo está documentado dentro del código.

1. **`src/features/catalog/server/queries.ts:396`** —
   `// Append-only table: the first row per currency is the current rate.`
   Deja de ser cierto de dos maneras: ya no hay bucle que tome la primera fila
   (lo hace `DISTINCT ON`), y «la primera» no significa nada sin decir **con qué
   orden**. Lo que va en su lugar, en el módulo nuevo y no aquí —porque aquí ya no
   hay consulta—: que la vigente es la de `sourceUpdatedAt` mayor, con el
   desempate de R5, y que ése es el criterio **compartido** por los dos lectores.
2. **`src/features/orders/server/quote.ts:150`** —
   `/** Fresh read of the latest rate per currency for a business — never cached. */`
   «latest» pasa a significar otra cosa: no la última que llegó, sino la de marca
   de origen mayor. Lo que se conserva de esta frase es lo único que sigue siendo
   suyo: que es **fresca y nunca cacheada**. El resto se lo lleva el módulo nuevo.

## Patrones a seguir / antipatrones a evitar

- **`AGENTS.md` § Arquitectura**: la única capa que toca Prisma es
  `features/*/server/`, y el módulo nuevo está ahí. `src/app/` no cambia y no ve
  Prisma; `src/lib/` no gana ni una línea de SQL, igual que en la decisión (a) de
  la ADR 0019.
- **`docs/adr/0019-sql-crudo-para-tsvector-y-pruebas-contra-postgres-real.md`**:
  el SQL crudo se compone **solo** con `Prisma.sql`, nunca `$queryRawUnsafe`,
  nunca interpolación de texto. El único valor va ligado como `$1`.
- **`AGENTS.md` § Cosas que muerden, el pooler en modo transacción**: una
  sentencia, fuera de `$transaction`.
- **`AGENTS.md` § Cosas que muerden, la idempotencia del sync**: las dos
  propiedades se conservan. La marca de origen es la guarda (aquí en su variante
  de orden, I7), y dos entregas del mismo `eventId` siguen dando una sola fila
  (R13).
- **`AGENTS.md` § Cosas que muerden, `console.error`**: el código nuevo no
  instrumenta nada, ni con `console.warn`.
- **`AGENTS.md` § Cosas que muerden, `prisma migrate dev` y los `DROP INDEX`**:
  § Modelo de datos lo trae con la lista medida de este diff y qué hacer con cada
  línea.
- **`AGENTS.md` § Comandos prohibidos**: ni `migrate reset` ni `db push`, en
  ningún paso. El rodeo es `--create-only` + `migrate deploy` (R18).
- **`AGENTS.md` § Cosas que muerden, las comillas invertidas de
  `check:harness`**: los seis archivos que este feature va a crear están citados
  aquí **sin** comillas y con `(por crear)`, y todas las rutas de archivos que
  existen están escritas completas desde la raíz.
- **`AGENTS.md` § Prohibiciones, «duplicar interfaces»**: `RateRef` y `StoreRef`
  son dos `Pick` del **mismo** `BranchResolution`, no dos interfaces paralelas;
  `CurrentRateRow` es la fila cruda y el `Record<string, string>` que sale es el
  que ya consumían los dos lectores.
- **`AGENTS.md` § Prohibiciones, magic strings**: el nombre del índice vive en
  `prisma/schema.prisma` (`map:`) y en la migración, que es donde tiene que
  estar; el literal de la marca del seed va en el `RATES` que ya existe, que es
  su constante con nombre.
- **`AGENTS.md` § Idioma**: código y comentarios en inglés; este documento y la
  ADR en español.

## Riesgos y plan B

| Riesgo                                                                                                               | Plan B                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El índice cubridor de seis columnas le parece demasiado al humano                                                    | El de tres, `(businessId, currencyCode, sourceUpdatedAt(sort: Desc))`. El criterio 7 se sigue cumpliendo (no hay `Seq Scan` sobre `ExchangeRate`), a cambio de `Bitmap Heap Scan` + `Sort` y ~3× el coste medido. Una línea del schema y una del `migration.sql`. Ver `AP1`  |
| `DISTINCT ON` en `$queryRaw` le parece demasiado                                                                     | Se conserva el módulo y el `Prisma.Sql` se cambia por un `findMany` con el `orderBy` de AD1 y el bucle de JS **dentro de la misma función**: se pierde el volumen y se conserva lo importante, que es que R4 sea estructural. Es un cambio de diez líneas en un solo archivo |
| Añadir `businessId` a la resolución se considera fuera de alcance                                                    | Dos sentencias: la vitrina se queda con el filtro por relación y `buildCurrentRatesSql` toma un `Prisma.Sql` de `WHERE` como parámetro. Vuelve I2 (dos `EXPLAIN`) y vuelve la trampa del `Seq Scan on "Business"`, las dos ya documentadas                                   |
| La entrada de caché compartida por negocio se considera un cambio de comportamiento no pedido                        | `keyParts: ["store-rates", branch.canonicalSlug]` y el argumento sigue siendo `businessId`: misma cardinalidad y mismas etiquetas que hoy, una línea. Ver `AP2`                                                                                                              |
| La migración no se puede aplicar a la base compartida cuando toque (deriva de checksum de otro worktree)             | La ficha `.agent/playbook/prisma-migrate-dev-checksum-drift-bd-compartida.md` (`migrate diff` → carpeta a mano → `migrate deploy`), y el guion de C5 en una base de usar y tirar del mismo contenedor, que es la recomendación de `SP1`                                      |
| Un worktree hermano con checkout viejo falla su `npm run seed` en cuanto la columna sea `NOT NULL`                   | Es fallo ruidoso, no corrupción silenciosa —es el argumento de R7—, y la decisión operativa es `SP1`. Nada que este diseño pueda mitigar sin dejar la trampa viva                                                                                                            |
| Un negocio real acumula decenas de miles de filas y el checkout se nota                                              | El `LATERAL` con `LIMIT 1` por moneda de § Escalabilidad, que es la forma que Postgres 18 hará sola con _skip scan_. Umbral escrito: ~50 000 filas por negocio                                                                                                               |
| Alguien añade una columna al `select` del lector y el `Index Only Scan` se degrada a `Index Scan` sin que nada avise | El `EXPLAIN` del criterio 7 se pone en rojo solo si aparece un `Seq Scan`; para esto el remedio es el comentario del índice en `prisma/schema.prisma` diciendo qué columnas cubre y por qué. Anotado como antipatrón arriba                                                  |

## ¿Hace falta una ADR?

**Sí.** `docs/adr/0030-la-tasa-vigente-la-decide-la-lectura.md` — borrador
escrito en este ciclo, siguiente número tras la 0029, formato de las existentes
(**Aceptada** · fecha · feature, Contexto, Decisión, Consecuencias). Es corta a
propósito y **apunta** a `.agent/solicitudes.md` § S-005 y a la regla ② de
`docs/sync-contract.md` en vez de repetirlas, según el criterio de AD5. Lo que
añade y no está en ninguna de las dos: que los dos lectores comparten **una**
sentencia y **un** módulo, y que la tabla lleva un índice cubridor porque la
verdad se decide leyendo.

No contradice ninguna ADR existente. Se apoya en la 0019 (el SQL crudo con
`Prisma.sql` y las pruebas contra Postgres real) y no toca la 0017 (el panel no
escribe tasas).

## Preguntas al humano

**AP1 — ¿se acepta el índice cubridor de seis columnas, o el de tres y un
`Sort`?**
Qué es: una decisión de coste de almacenamiento en una tabla que nunca borra
nada. Medido con 47 200 filas: el cubridor ocupa 4 832 kB (~105 bytes/fila), el
de tres columnas 2 312 kB (~50 bytes/fila). A cambio, el cubridor convierte el
plan en `Index Only Scan` sin `Sort` y sin tocar el heap: 3 páginas leídas contra
213, y 1,18 ms contra 2,53 con 800 filas del negocio (3,93 contra 12,80 con
8 000). Como AD2 retira el índice viejo, el número neto de índices por fila
insertada **no sube**; lo que sube es el tamaño. Con un millón de filas la
diferencia es ~53 MB. **No bloquea**: el criterio 7 se cumple con las dos formas
(ninguna hace `Seq Scan` sobre `ExchangeRate` con volumen). Opciones: (a) el
cubridor de AD1; (b) el de tres columnas `(businessId, currencyCode,
sourceUpdatedAt(sort: Desc))`, aceptando `Bitmap Heap Scan` + `Sort`; (c) el
cubridor ahora y la vuelta atrás si Supabase aprieta, que es una línea del schema
y una migración. **Recomendación: (a)**, porque el lector del checkout **no tiene
caché** y corre en cada cotización y en cada pedido, y porque las filas de un
negocio están dispersas por el heap por construcción —la tabla es append-only e
intercalada—, así que sin cubrir el índice el plan nunca lo va a preferir.

**AP2 — ¿puede la entrada de caché de tasas ser una por negocio en vez de una
por sucursal?**
Qué es: al pasar el argumento de `getStoreRates` de `storeId` a `businessId`, la
clave de `unstable_cache` cambia y las entradas pasan de N (una por sucursal
renderizable) a 1 por negocio. La entrada queda etiquetada con el `storeTag` de
la sucursal que la creó, y F-035 expira el `storeTag` de **todas** las sucursales
renderizables del negocio en cualquier escritura de tasa, así que la entrada
compartida se expira siempre. Y no es una dependencia nueva: hoy, con N entradas,
la frescura **ya** depende de que F-035 invalide el negocio entero. **No
bloquea**: las dos variantes son una línea. Opciones: (a) una entrada por negocio
(lo elegido): menos entradas y una lectura menos en frío por sucursal hermana;
(b) `keyParts: ["store-rates", branch.canonicalSlug]`, que conserva exactamente
la cardinalidad y las etiquetas de hoy a cambio de romper la convención del repo
—los cinco `keyParts` existentes son literales estáticos y la variación va en el
argumento—. **Recomendación: (a)**, y (b) si se prefiere que este feature no
cambie **nada** del comportamiento de caché.

**AP3 — ¿la frase de I7 va en `AGENTS.md`, en la ADR 0030, o en las dos?**
Qué es: `AGENTS.md` § Cosas que muerden dice que todo lo que el sync escribe «va
guardado contra escrituras rancias (`sourceUpdatedAt`)», y describe el mecanismo
que **rechaza** y devuelve `STALE`. Después de F-036 la promesa se cumple —el
orden de entrega deja de importar— pero hay **dos** mecanismos, y quien añada un
handler copiando esta forma esperando un `STALE` se equivocará. Ni `sdd-spec` ni
este agente escriben `AGENTS.md`: la spec lo dijo explícitamente y esa frase va
en el mismo commit que el código o no se escribe nunca. **No bloquea**, pero es
la única pieza del feature que ningún sensor puede reclamar. Opciones: (a) una
frase en `AGENTS.md` § Cosas que muerden, del estilo «hay dos formas de la
guarda: la que rechaza (`STORE`, `CATEGORY`, `PRODUCT`) y la de orden de
`EXCHANGE_RATE`, que escribe igual y decide al leer porque su tabla es
append-only», apuntando a la ADR 0030; (b) solo la ADR, y `AGENTS.md` sin tocar;
(c) las dos, con la ADR contando el porqué y `AGENTS.md` solo la advertencia.
**Recomendación: (c)**, con la frase de `AGENTS.md` en una línea y el porqué en
la ADR: es una entrada de «Cosas que muerden» de libro —un error que alguien va a
cometer copiando código correcto— y esa sección es lo que se lee **antes** de
fallar, mientras la ADR es lo que se lee **después** de preguntarse por qué.
