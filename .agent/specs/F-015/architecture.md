---
feature: F-015
agente: sdd-architect
actualizado: 2026-08-27T15:38:27Z
estado: listo
---

## Estado actual relevante

Lo que ya existe y se reutiliza tal cual:

| Pieza                                                 | Qué aporta a F-015                                                                                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma` (`CanonicalProduct`)           | `searchDocument String @default("")`, `searchVector Unsupported("tsvector")?`, `isExclusive`, `@@index([isExclusive])`                                                                      |
| `prisma/migrations/20260825000000_init/migration.sql` | `CREATE EXTENSION unaccent` (línea 13), la columna `tsvector` (126) y el índice `CanonicalProduct_searchVector_idx` (513)                                                                   |
| `src/lib/canonical.ts`                                | `buildSearchDocument(name, aliases)` — el documento sigue siendo nombre + alias (ADR 0004)                                                                                                  |
| `src/features/sync/server/handlers/product.ts`        | los cuatro sitios que escriben `searchDocument` (líneas 159, 178, 198, 261) y el guardado contra escrituras rancias (línea 62)                                                              |
| `prisma/seed.ts`                                      | los otros dos (líneas 645 y 669), con su propio `PrismaClient` y `import "dotenv/config"`                                                                                                   |
| `src/lib/availability.ts`                             | `isOrderable` — el predicado que la consulta replica en SQL (R5)                                                                                                                            |
| `src/lib/prisma.ts`                                   | el cliente perezoso (`max: 5`), y el aviso de que nada puede correr en `$transaction`                                                                                                       |
| `src/features/catalog/server/queries.ts`              | el estilo de módulo de lectura de servidor: tipos exportados, un solo módulo por dominio                                                                                                    |
| `src/features/admin/server/boundaries.test.ts`        | la técnica de la guarda de C10: leer el fuente, extraer los bloques `data: { … }` por paréntesis balanceados y afirmar que no hay columnas prohibidas, con un aserto anti-vacuidad al final |
| `src/features/storefront/server/boundaries.test.ts`   | la variante que recorre todo `src/` y mantiene una lista blanca de archivos permitidos                                                                                                      |

Lo que no existe: nada escribe `searchVector`, no hay ninguna consulta de búsqueda,
no hay SQL crudo en el repo (`grep -rn queryRaw src/` solo devuelve
`src/generated/`), no hay `src/features/marketplace/`, y ninguna de las 42
`*.test.ts` toca Postgres — todas mockean `@/lib/prisma`.

## Decisión

**Una sola función de servidor de solo lectura, una sola expresión de
normalización compartida por escritura y consulta, y las seis escrituras de
`searchDocument` reducidas a seis llamadas a un único escritor que pone las dos
columnas en un `UPDATE`.** El schema declarativo **no se toca**; la única
migración es de datos y su carpeta se escribe a mano.

Los cinco cortes que definen el diseño:

1. **La expresión vive en un módulo de `features/*/server/`, no en `src/lib/`.**
   Para componer SQL seguro hace falta `Prisma.sql` —`import { Prisma } from "@/generated/prisma/client"`—, y la propia prueba de frontera del panel
   (`src/features/admin/server/boundaries.test.ts`, `PRISMA_IMPORTS`) cuenta ese
   import como «tocar Prisma». Un módulo de `src/lib/` que lo hiciera rompería la
   tabla de capas de `AGENTS.md`. En `src/lib/` queda solo lo verdaderamente puro:
   recortar, truncar y acotar el término y la paginación, sin una línea de SQL.
2. **`searchDocument` sale de los cuatro `create`/`update` tipados.** No se les
   «añade» el vector: se les quita el documento. Después de la etapa 2 hay
   exactamente **un** sitio en todo el repo que escribe esa columna, y escribe
   siempre las dos a la vez. R1 pasa de ser una regla que hay que recordar en seis
   sitios a una propiedad de construcción, y la guarda de C10 se vuelve trivial de
   escribir y difícil de burlar. Es la trampa de ADR 0004 § Trampa cerrada por
   estructura, no por disciplina.
3. **`hasLiveOffer` no se materializa y `storeCount` se calcula con una
   subconsulta escalar correlacionada.** Una fila por canónico por construcción
   (R9): sin `GROUP BY` no hay producto cartesiano que deshacer. El coste es
   lineal en candidatos y se describe con número en § Escalabilidad.
4. **El relleno es una función, un ejecutable y una migración de datos.** La
   función (por lotes, `WHERE "searchVector" IS NULL`) es lo que se prueba; el
   ejecutable es lo que corre quien despliega y lo que hace verificables C1, C5 y
   C6 **sin `psql`** (imprime el conteo); la migración es lo que garantiza que
   ningún entorno se quede sin rellenar por olvido.
5. **Las pruebas contra Postgres real son un tercer proyecto de vitest y no se
   saltan nunca.** Aislamiento por un **token único por ejecución** que viaja
   dentro del propio término de búsqueda: eso las hace herméticas sobre una base
   compartida y sembrada sin truncar una sola tabla ni reutilizar un EAN del seed.

### Alternativas descartadas

| Alternativa                                             | Por qué no                                                                                                                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Columna generada o índice de expresión                  | `to_tsvector(unaccent(...))` no es inmutable (spec § Datos y contrato, punto 3)                                                                                                              |
| Trigger PL/pgSQL que mantenga el vector                 | Cerraría R1 de raíz, pero mueve la búsqueda a un sitio que ningún test de TypeScript ve. Es el plan B                                                                                        |
| La expresión como `string` en `src/lib/`                | Obliga a `Prisma.raw`/interpolación en cada llamador; y viola la capa (corte 1)                                                                                                              |
| `$queryRawUnsafe` con interpolación                     | Prohibido por R11 y por E18                                                                                                                                                                  |
| `websearch_to_tsquery`                                  | R3 admite las dos; `plainto_tsquery` no le regala sintaxis (`OR`, `-`, `"…"`) a quien no la pidió, y E13 se cumple igual                                                                     |
| `LEFT JOIN` + `GROUP BY` para `storeCount`              | Equivalente y más difícil de leer y de ordenar; la subconsulta escalar no puede duplicar filas                                                                                               |
| `COUNT(*)` total para `hasMore`                         | Duplica el coste de la consulta; el contrato pide una fila extra                                                                                                                             |
| `$transaction` para create + escritura del vector       | El pooler corre en modo transacción (`AGENTS.md` § Cosas que muerden)                                                                                                                        |
| Zod para la entrada                                     | No hay frontera externa (SP-H1): la entrada es tipada y se acota con funciones puras. Zod entra con la ruta HTTP, y con ella src/features/marketplace/schemas.ts (fuera de F-015, por crear) |
| Truncar tablas o resetear la base en las pruebas        | `prisma migrate reset` está prohibido y la base local es compartida y sembrada — de ahí el token                                                                                             |
| Saltar las pruebas cuando falta Postgres                | «Una prueba que se salta sin decirlo no verifica nada» (spec § No decidido a propósito)                                                                                                      |
| Guion de relleno en `.mjs`, como el resto de `scripts/` | Un `.mjs` no puede importar la expresión única y la duplicaría, rompiendo R2. Va en TypeScript con `tsx`, igual que `prisma/seed.ts`                                                         |
| Materializar `hasLiveOffer` en `CanonicalProduct`       | Resuelve el umbral de los 10 000 candidatos, pero añade una escritura al sync por cada evento de disponibilidad. Es el plan B de escala, no el diseño de hoy                                 |

## Componentes

| Componente                                                                        | Capa                            | Responsabilidad                                                                                                               | Archivo                                                                                       |
| --------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `MARKETPLACE_SEARCH_*`                                                            | `src/constants/`                | Longitud máxima del término (R7), límites de paginación, tamaño de lote del relleno y el nombre del diccionario               | src/constants/marketplace.ts (etapa 1, por crear)                                             |
| `normalizeSearchTerm`, `clampSearchLimit`, `clampSearchOffset`                    | `src/lib/`                      | Recorte, colapso de espacios, truncado, «sin letras ni dígitos → nada» (R6, E15) y acotado de paginación. Sin Prisma, sin SQL | src/lib/searchTerm.ts (etapa 1, por crear)                                                    |
| `searchVectorOf`, `searchQueryOf`, `writeSearchDocument`, `backfillSearchVectors` | `src/features/*/server/`        | **La expresión única (R2)** y las dos escrituras: el `UPDATE` de una fila y el del relleno por lotes                          | src/features/marketplace/server/searchVector.ts (etapa 1, por crear)                          |
| `searchCanonicalProducts` + sus tipos                                             | `src/features/*/server/`        | La consulta: R4, R5, R8, R9, R10, `hasMore` con una fila extra, conversión de `storeCount`                                    | src/features/marketplace/server/search.ts (etapa 4, por crear)                                |
| Las seis llamadas al escritor                                                     | `src/features/*/server/` + seed | Sustituyen las seis escrituras actuales de `searchDocument`                                                                   | `src/features/sync/server/handlers/product.ts`, `prisma/seed.ts`                              |
| Ejecutable del relleno (`--check` cuenta, sin bandera rellena)                    | `scripts/`                      | Lo que corre quien despliega; y el contador que hace verificables C1, C5 y C6 sin `psql`                                      | scripts/backfill-search-vector.ts (etapa 3, por crear)                                        |
| Migración de datos (sin cambio de schema)                                         | `prisma/migrations/`            | Que ningún entorno se quede sin rellenar por olvido                                                                           | prisma/migrations/&lt;timestamp&gt;_backfill_search_vector/migration.sql (etapa 3, por crear) |
| Tercer proyecto `db` de vitest + su setup                                         | raíz                            | Entorno `node`, carga de `.env`, precondición ruidosa, `$disconnect`                                                          | `vitest.config.mts`, vitest.setup.db.ts (etapa 5, por crear)                                  |
| Fixtures con token por ejecución                                                  | `src/features/*/server/`        | Crear negocio/marca/tienda/canónicos únicos y borrarlos al terminar                                                           | src/features/marketplace/server/dbFixtures.ts (etapa 5, por crear)                            |
| Pruebas de la búsqueda contra Postgres real                                       | `src/features/*/server/`        | C2, C3, C7, C8, C9 y E5–E22                                                                                                   | src/features/marketplace/server/search.db.test.ts (etapa 5, por crear)                        |
| Pruebas del sync contra Postgres real                                             | `src/features/*/server/`        | E1, E2, E3, E4 y la variante de C4 «dos llamadas al handler»                                                                  | src/features/sync/server/handlers/product.db.test.ts (etapa 5, por crear)                     |
| Guarda contra la degradación silenciosa                                           | `src/features/*/server/`        | C10, más el aserto de que el proyecto `db` sigue declarado y alimentado                                                       | src/features/marketplace/server/boundaries.test.ts (etapa 6, por crear)                       |

Nada en `src/app/`, nada en `src/components/`, ningún `"use client"`, ningún
`revalidateTag`: SP-H1 y R12. El presupuesto de JavaScript de cliente no se mueve.

## Flujo de datos

**Escritura (sync).** Sin `$transaction`: cada paso es su propio viaje, como ya
documenta la cabecera de `src/features/sync/server/handlers/product.ts`.

```
handleProduct
  └─ guarda de rancio (sourceUpdatedAt) ──► STALE ──► fin, sin tocar el índice   (E4)
  └─ resolveCanonical
       ├─ explicit / by-ean / orphan: create tipado SIN searchDocument
       └─ writeSearchDocument(prisma, id, buildSearchDocument(localName, []))    (E1)
  └─ recordAlias
       ├─ alias repetido ──► useCount++ ──► fin                                  (E3)
       └─ alias nuevo ──► create alias ──► lee nombre + alias
            └─ writeSearchDocument(prisma, id, buildSearchDocument(name, alias)) (E2)
```

El vector nunca queda cruzado con el documento porque **un solo `UPDATE`
escribe los dos** desde el mismo parámetro. Dos entregas concurrentes del mismo
canónico: gana la última, y cada una deja el par coherente (spec § Casos límite).

E3 se cumple por la guarda del propio `UPDATE`: el alias repetido no llega a
recomputar, y si llegara, el `WHERE` haría que la sentencia afecte **0 filas**,
así que `searchDocument`, `searchVector` y `updatedAt` quedan idénticos.

**Lectura (búsqueda).** Un round-trip, cero N+1:

```
searchCanonicalProducts({ term, onlyWithLiveOffer, limit, offset })
  └─ normalizeSearchTerm(term) ──► null ──► { items: [], hasMore: false }  sin consultar  (E15, R6)
  └─ clampSearchLimit / clampSearchOffset
  └─ prisma.$queryRaw(Q1)  ── LIMIT limit + 1
  └─ items = rows.slice(0, limit).map(fila => ({ …, storeCount: Number(fila.storeCount) }))
     hasMore = rows.length > limit
```

## Contratos

### Tipos

```ts
// src/features/marketplace/server/search.ts
export type MarketplaceSearchInput = {
  term: string;
  onlyWithLiveOffer?: boolean; // por defecto false (R5, SP-H2)
  limit?: number; // por defecto 20, acotado a [1, 50]
  offset?: number; // por defecto 0, acotado a >= 0
};

export type MarketplaceSearchItem = {
  canonicalProductId: string;
  name: string; // del canónico, nunca el localName de una tienda
  imageUrl: string | null;
  storeCount: number; // ofertas VIVAS (R10). number, nunca bigint ni string
};

export type MarketplaceSearchResult = {
  items: MarketplaceSearchItem[];
  hasMore: boolean;
};

export async function searchCanonicalProducts(
  input: MarketplaceSearchInput,
): Promise<MarketplaceSearchResult>;

/** La fila cruda. `any` es error de ESLint, y `count(*)` es int8: el driver la
 *  entrega como bigint o como string según la ruta, así que el tipo admite las
 *  tres formas y la conversión es explícita. */
type SearchRawRow = {
  canonicalProductId: string;
  name: string;
  imageUrl: string | null;
  rank: number;
  storeCount: bigint | number | string;
};
```

```ts
// src/features/marketplace/server/searchVector.ts
import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { MARKETPLACE_SEARCH_TS_CONFIG } from "@/constants/marketplace";

/** Lo mínimo que el escritor necesita, para que valga tanto el cliente global
 *  de `src/lib/prisma.ts` como el que `prisma/seed.ts` construye por su cuenta. */
export type SearchIndexWriter = Pick<PrismaClient, "$executeRaw">;

/** LA expresión de escritura (R2). Único sitio del repo donde se escribe. */
export const searchVectorOf = (document: string): Prisma.Sql =>
  Prisma.sql`to_tsvector(${MARKETPLACE_SEARCH_TS_CONFIG}::regconfig, unaccent(${document}))`;

/** LA expresión de consulta (R2, R3). Su gemela; si una cambia, cambia la otra. */
export const searchQueryOf = (term: string): Prisma.Sql =>
  Prisma.sql`plainto_tsquery(${MARKETPLACE_SEARCH_TS_CONFIG}::regconfig, unaccent(${term}))`;

/** Devuelve las filas afectadas: 0 significa «ya estaba así» (E3). */
export async function writeSearchDocument(
  db: SearchIndexWriter,
  canonicalProductId: string,
  document: string,
): Promise<number>;

/** Rellena por lotes hasta que no queda ninguna fila con vector nulo. */
export async function backfillSearchVectors(
  db: SearchIndexWriter & Pick<PrismaClient, "$queryRaw">,
): Promise<{ before: number; updated: number; after: number }>;
```

```ts
// src/constants/marketplace.ts
/** El diccionario de Postgres. Vive aquí y no como literal en dos sitios de SQL
 *  (AGENTS.md § Prohibiciones); la migración de datos, que no puede importar,
 *  lo repite y la guarda de C10 compara los dos textos. */
export const MARKETPLACE_SEARCH_TS_CONFIG = "spanish";
/** R7: un término más largo que esto no es una búsqueda. Se trunca, no se rechaza.
 *  El nombre de producto más largo del seed tiene 25 caracteres. */
export const MARKETPLACE_SEARCH_TERM_MAX_LENGTH = 120;
export const MARKETPLACE_SEARCH_LIMIT_DEFAULT = 20;
export const MARKETPLACE_SEARCH_LIMIT_MIN = 1;
export const MARKETPLACE_SEARCH_LIMIT_MAX = 50;
/** Filas por sentencia del relleno: acota el bloqueo y la memoria del UPDATE. */
export const MARKETPLACE_BACKFILL_BATCH_SIZE = 1000;
```

`normalizeSearchTerm(raw): string | null` — recorta, colapsa cada racha de
espacios en uno, trunca a `MARKETPLACE_SEARCH_TERM_MAX_LENGTH` y devuelve `null`
si lo que queda **no contiene ninguna letra ni dígito** (`/[\p{L}\p{N}]/u`). Esa
última condición es la que hace literal el «sin consultar la base» de E15 para
`""`, `"   "` y un término de solo signos de puntuación.

### SQL — W1, la escritura de una fila

```sql
UPDATE "CanonicalProduct"
   SET "searchDocument" = $2,
       "searchVector"   = to_tsvector($1::regconfig, unaccent($2)),
       "updatedAt"      = now()
 WHERE "id" = $3
   AND ("searchDocument" <> $2 OR "searchVector" IS NULL);
```

- Las dos columnas, una sentencia, un round-trip: I4 resuelto sin perder la
  intención de «en la misma escritura» (E2).
- El `WHERE` es lo que hace la reentrega **idempotente y sin efecto** (E3): si el
  documento ya es ese y hay vector, 0 filas y `updatedAt` intacto.
- `... OR "searchVector" IS NULL` es lo que arregla las filas heredadas que
  vuelvan a pasar por el sync, y lo que da vector vacío al documento vacío (E19).
- La guarda contra escrituras rancias **no se duplica aquí**: vive donde ya está,
  en el `return STALE` de `src/features/sync/server/handlers/product.ts` (línea
  62), que corta antes de llegar a cualquier escritura. E4 se verifica afirmando
  que con un payload rancio el escritor **no se llama** — aserto de la prueba
  mockeada, no de la real.
- `updatedAt` se pone a mano porque el SQL crudo no pasa por el `@updatedAt` de
  Prisma. Nada lee hoy `CanonicalProduct.updatedAt`; dejarlo colgado sería peor.

### SQL — W2, el relleno por lotes

```sql
UPDATE "CanonicalProduct"
   SET "searchVector" = to_tsvector($1::regconfig, unaccent("searchDocument"))
 WHERE "id" IN (
         SELECT "id"
           FROM "CanonicalProduct"
          WHERE "searchVector" IS NULL
          ORDER BY "id"
          LIMIT $2
       );
```

Se repite hasta que devuelve 0. El predicado es `IS NULL` y no
`"searchDocument" <> ''`: así también los documentos vacíos acaban con un
`tsvector` vacío y el conteo de C6 (`WHERE "searchVector" IS NULL`) puede llegar
a 0. R13 se cumple por construcción: una fila con vector nunca vuelve a tocarse,
así que la segunda ejecución actualiza 0 filas. No se toca `updatedAt`: el
documento no cambió.

El conteo que imprime el ejecutable, y que es literalmente el de C5:

```sql
SELECT count(*) FROM "CanonicalProduct" WHERE "searchDocument" <> '' AND "searchVector" IS NULL;
SELECT count(*) FROM "CanonicalProduct" WHERE "searchVector" IS NULL;
```

### SQL — Q1, la consulta

```sql
SELECT m.*
  FROM (
        SELECT c."id"       AS "canonicalProductId",
               c."name"     AS "name",
               c."imageUrl" AS "imageUrl",
               ts_rank(c."searchVector", plainto_tsquery($1::regconfig, unaccent($2))) AS "rank",
               (
                 SELECT count(*)
                   FROM "StoreProduct" sp
                   JOIN "Store" s ON s."id" = sp."storeId"
                  WHERE sp."canonicalProductId" = c."id"
                    AND sp."deletedAt" IS NULL
                    AND sp."visible" = TRUE
                    AND sp."availability" <> $3::"Availability"
                    AND s."status" = $4::"StoreStatus"
               ) AS "storeCount"
          FROM "CanonicalProduct" c
         WHERE c."isExclusive" = FALSE
           AND c."searchVector" @@ plainto_tsquery($1::regconfig, unaccent($2))
       ) m
 WHERE $5::boolean = FALSE OR m."storeCount" > 0
 ORDER BY m."rank" DESC,
          (m."storeCount" > 0) DESC,
          m."name" ASC,
          m."canonicalProductId" ASC
 LIMIT $6::int OFFSET $7::int;
```

Parámetros, todos ligados (R11, E18): `$1` el diccionario, `$2` el término
normalizado, `$3` `Availability.OUT_OF_STOCK`, `$4` `StoreStatus.PUBLISHED`,
`$5` `onlyWithLiveOffer`, `$6` `limit + 1`, `$7` `offset`. Los dos valores de
enum se importan de `@/generated/prisma/enums` y van con su `::"Tipo"`, así que
un renombrado del enum rompe la compilación en vez de la búsqueda. El predicado
`<> OUT_OF_STOCK` es el gemelo SQL de `isOrderable` (`src/lib/availability.ts`),
y así queda comentado en el código: si uno cambia, el otro tiene que cambiar.

Por qué esta forma y no otra:

- **El predicado va contra la columna** (`c."searchVector" @@ …`), nunca
  `to_tsvector(...) @@ …`: esa segunda forma deja el índice GIN sin usar, y es la
  mitad de C10 que la guarda vigila. `plainto_tsquery(…::regconfig, unaccent($2))`
  es una expresión **estable**, no volátil, así que Postgres la evalúa una vez y
  puede usar el GIN.
- **Una fila por canónico** (R9) sin `GROUP BY`: la subconsulta escalar no puede
  multiplicar filas. E22 sale de aquí: dos ofertas, una fila, `storeCount: 2`.
- **`storeCount` cuenta lo mismo con el filtro encendido y apagado** (R10), y por
  eso el desempate de R8 es exactamente `storeCount > 0` sobre el valor ya
  calculado, sin repetir el predicado.
- **El filtro es un parámetro, no dos consultas.** Una sola forma de sentencia
  que mantener, y las pruebas de C7 recorren las dos ramas del mismo SQL.
- **`isExclusive = FALSE` está en el `WHERE`, no en una firma**: es la definición
  del conjunto (R4), no un argumento que alguien pueda olvidar.
- **El orden es total** (R8): `rank`, tiene-oferta-viva, `name`, `id`. `id` es
  único, así que dos páginas nunca repiten ni se saltan una fila (E21) mientras
  los datos no cambien entre llamadas.

### Errores

| Situación                               | Comportamiento                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| Término vacío, blanco o solo puntuación | `{ items: [], hasMore: false }` sin consultar (E15, R6)                             |
| Término hostil o con metacaracteres     | Parámetro ligado + `plainto_tsquery`: resultado, nunca excepción (E17, E18)         |
| `limit`/`offset` fuera de rango         | Se acotan antes de llegar al SQL; nunca crudos                                      |
| Base inalcanzable                       | El error de Prisma se propaga tal cual. **No** hay `catch` que devuelva lista vacía |
| `searchVector` NULL heredado            | La fila no casa; el relleno la arregla                                              |

No hay códigos de error: no hay ruta HTTP (SP-H1).

## Modelo de datos y migraciones

**`prisma/schema.prisma` no se toca.** Ni una columna, ni un índice, ni un
`@@index`. Todo lo que F-015 necesita está en la migración inicial desde F-002.

Consecuencia directa y deliberada: **no se ejecuta `prisma migrate dev` en este
feature**, así que la ficha
`.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md` (I7) no
se esquiva a mano — se **evita**, porque no hay diff declarativo que hacer.

La única migración es de datos, y su carpeta se escribe a mano:

```
prisma/migrations/<timestamp>_backfill_search_vector/migration.sql
```

con la sentencia W2 **sin `LIMIT`** (una migración corre una vez) y el
diccionario como literal `'spanish'` —un archivo `.sql` no puede importar la
constante—, más un comentario que diga por qué la carpeta no la generó
`migrate dev`. Se aplica con `npx prisma migrate deploy`, que es lo que ya corre
el CI antes de `npm test` y lo que no revalida checksums viejos (ficha
`.agent/playbook/prisma-migrate-dev-checksum-drift-bd-compartida.md`). En el CI
la base está vacía: actualiza 0 filas y no molesta.

Ninguno de los dos comandos prohibidos aparece en este camino. Si alguien cree
que hace falta `prisma db push` o `prisma migrate reset`, es una pregunta.

## Escalabilidad y límites

Números, no adjetivos. Hoy: 12 canónicos sembrados, decenas en una base de
desarrollo con eventos del POS.

**Por búsqueda:** 1 round-trip, 1 sentencia, 0 N+1. Respuesta máxima
50 items × ~180 B ≈ **9 KB**. 0 KB de JavaScript de cliente, 0 entradas de caché,
0 tags que invalidar (R12): `npm run check:bundle` no se mueve.

**Por evento `PRODUCT` del sync:** hoy son 5–7 round-trips. F-015 añade **0** en
el camino común (el `update` tipado se convierte en el `UPDATE` crudo) y **+1**
cuando se crea un canónico (create tipado + escritura del documento). El
recompute del alias repetido pasa a costar una sentencia que afecta 0 filas.

**A 100×** (≈500 tiendas × 500 productos → ~250 000 `StoreProduct` y ~50 000
`CanonicalProduct`), en orden de lo que se rompe primero:

1. **Términos muy comunes.** El GIN devuelve los candidatos en 1–5 ms, pero la
   subconsulta cuesta ~2 lookups de índice por candidato
   (`StoreProduct_canonicalProductId_idx` + PK de `Store`, ambos ya existen). Con
   1 000 candidatos son ~10 ms; con **10 000 candidatos, ~50–150 ms** — ese es el
   umbral. Con 100 000 (un «agua» en un catálogo nacional) la consulta deja de
   servir en línea. Plan B: columna `hasLiveOffer` materializada en
   `CanonicalProduct` mantenida por el sync, con índice parcial, que convierte la
   subconsulta y el desempate en una lectura de columna.
2. **`OFFSET` profundo.** `offset` no tiene techo en el contrato: un `offset`
   10 000 vuelve a calcular y ordenar las 10 050 filas anteriores. Con `limit`
   ≤ 50 y sin llamador todavía es teórico; el día que haya paginación de verdad,
   keyset sobre `(rank, storeCount > 0, name, id)` en vez de `OFFSET`.
3. **Escrituras al GIN.** Cada `UPDATE` del vector escribe en el índice. Con
   `fastupdate` por defecto la pending list la vacía el autovacuum; a partir de
   ~10 000 eventos/minuto habría que medirlo. Hoy el sync procesa lotes de
   decenas.
4. **El relleno.** 50 000 filas / 1 000 por lote = **50 sentencias**, cada una de
   decenas de ms: segundos en total. Por lotes precisamente para que ninguna
   sentencia mantenga un bloqueo largo, que es lo que importa cuando la tabla
   crezca.

**Pooler.** Ninguna pieza abre `$transaction`: cada sentencia es un round-trip
independiente sobre la conexión del pool (`AGENTS.md` § Cosas que muerden, ficha
`.agent/playbook/pooler-transaccion-deadlock.md`). El bucle del relleno son N
sentencias secuenciales, no una transacción larga.

**Conexiones en las pruebas.** Cada archivo de prueba es un worker con su propio
`PrismaClient` (`max: 5` en `src/lib/prisma.ts`). Dos archivos `*.db.test.ts` en
paralelo → ≤10 conexiones, contra un `max_connections` de 100 en local y en el
`postgres:16` del CI. Techo práctico: **6 archivos** de base real; a partir de
ahí, `fileParallelism` o un `max` menor.

## Pruebas contra Postgres real

Es la parte que estrena categoría (I6), y son cinco decisiones:

1. **Un tercer proyecto de vitest, `db`.** En `vitest.config.mts`:
   `environment: "node"`, `include: ["src/**/*.db.test.ts"]`,
   `setupFiles: ["./vitest.setup.db.ts"]` (etapa 5, por crear); y el proyecto
   `server` añade `"src/**/*.db.test.ts"` a su `exclude` para no correrlas dos
   veces. La extensión sigue siendo `.test.ts`, así que el entorno sigue siendo
   deducible de un vistazo y jsdom no entra (ficha
   `.agent/playbook/test-en-entorno-equivocado.md`).
2. **El entorno se carga solo ahí.** `import "dotenv/config"` en el setup del
   proyecto `db`, nunca global: `src/lib/prisma.test.ts` stubea `DATABASE_URL` a
   propósito y una carga global cambiaría lo que esa prueba comprueba. En el CI no
   hay `.env` y dotenv no sobreescribe, así que ganan las variables del workflow.
3. **La precondición es ruidosa, nunca un salto.** El setup, en `beforeAll`:
   `DATABASE_URL` presente, `SELECT 1` responde y
   `to_regclass('"CanonicalProduct"')` no es NULL. Si algo falla, `throw` con el
   comando exacto (`docker compose up -d postgres && npm run db:deploy`), lo que
   deja al `test` de `verify.sh` una firma estable (`Error: DB TEST SETUP …`). No
   hay `it.skip` ni bandera de opt-out: es lo que exige la spec. También
   `prisma.$disconnect()` en `afterAll`, o los workers no terminan.
4. **Aislamiento por token, no por truncado.** Cada ejecución genera
   `qab_f015_<hex>` y lo mete en los nombres de sus canónicos. Las aserciones no
   dependen de que la base esté vacía porque **el token viaja dentro del término
   de búsqueda**: para E5 el documento es `Café molido 250 g qab_f015_ab12` y el
   término `cafe qab_f015_ab12`; `plainto_tsquery` combina con Y, así que solo
   puede casar la fila del fixture. Eso hace exactas incluso las aserciones de
   orden y de paginación (E12, E21) sobre una base compartida y sembrada. El token
   se escribe en el documento y en el término por el **mismo** camino de
   normalización, así que da igual si el stemmer español lo altera: lo altera
   igual en los dos lados.
   - **EAN:** 13 dígitos derivados del token (`"9" + 12 dígitos`), válidos para
     `normalizeBarcode` y nunca los del seed (`CanonicalProduct.ean` es único).
   - **Limpieza:** `afterAll` borra en orden `StoreProduct` → `CanonicalProduct`
     (los `ProductAlias` caen por cascade) → `Store` → `Storefront` → `Business`.
   - **Restos de una ejecución muerta:** al arrancar se barren los fixtures cuyo
     nombre lleve el prefijo **y** tengan `createdAt` de más de 10 minutos, para
     no pisar una ejecución paralela.
5. **Ninguna prueba vacua.** Cada archivo abre con un centinela que afirma que de
   verdad consultó la base y que su fixture existe; y la guarda de la etapa 6
   —que corre en el proyecto `server`, siempre— afirma que `vitest.config.mts`
   sigue declarando el proyecto `db` y que hay al menos dos archivos
   `*.db.test.ts` en disco. Si alguien quita el proyecto o renombra los archivos,
   se pone rojo algo que sí corre.

**C4 en el CI va por la variante «dos llamadas al handler»**, no por la de
`npm run seed`: en `.github/workflows/ci.yml` el seed corre **después** de
`npm test`, así que las pruebas ven un esquema vacío. C6 (el seed deja la base
buscable) se verifica ejecutando `npm run seed && npm run seed` y después el
conteo del ejecutable del relleno con `--check` — no se convierte en prueba
automática porque en el CI el aserto sería vacuo (base sin sembrar) y una prueba
que pasa por vacía es exactamente lo que la spec no acepta.

## La guarda de C10

Un archivo al estilo de `src/features/admin/server/boundaries.test.ts`: lee el
fuente del disco, sin base y sin mocks. Cinco asertos, cada uno con su
anti-vacuidad:

| Aserto | Qué afirma                                                                                                                                                    | Qué caza                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| G1     | En todo `src/` más `prisma/seed.ts`, ningún bloque `data: { … }` contiene `searchDocument:`, y ningún archivo salvo el escritor contiene `"searchDocument" =` | El séptimo sitio que escribe el documento sin el vector (R1)           |
| G2     | Exactamente un archivo bajo `src/` contiene `to_tsvector(`, y es el escritor                                                                                  | La expresión copiada a un segundo sitio (R2)                           |
| G3     | El `migration.sql` del relleno contiene `to_tsvector('<config>', unaccent(` con el valor de `MARKETPLACE_SEARCH_TS_CONFIG`                                    | La deriva entre la constante y el literal que el SQL no puede importar |
| G4     | El módulo de la consulta contiene `"searchVector" @@` y **no** contiene `to_tsvector(`                                                                        | El predicado que deja el GIN sin usar (C10)                            |
| G5     | `vitest.config.mts` declara un proyecto `db` con el `include` esperado, y hay ≥ 2 archivos `*.db.test.ts`                                                     | Que las pruebas de base real desaparezcan en silencio                  |

G1 reutiliza literalmente `extractDataBlocks` de la prueba del panel: un
`select: { searchDocument: true }` no es una escritura y no debe teñir el aserto.

## Etapas de implementación

| Etapa | Qué entra                                                                                                                                                         | Qué verifica al terminar                                                                                                                                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | src/constants/marketplace.ts, src/lib/searchTerm.ts (+ su prueba de unidad), src/features/marketplace/server/searchVector.ts                                      | Unidad pura: E15, E16, E17 y R7 sobre `normalizeSearchTerm`; los dos `clamp`. Sin base                                                                                            |
| 2     | Las seis llamadas en `src/features/sync/server/handlers/product.ts` y `prisma/seed.ts`, más asertos nuevos en `src/features/sync/server/handlers/product.test.ts` | Mockeado: rancio → el escritor **no** se llama (E4); create → una llamada con el documento esperado; alias nuevo → una llamada. Y `npm run seed && npm run seed` sigue en 0 (R14) |
| 3     | `backfillSearchVectors`, scripts/backfill-search-vector.ts, el script `db:backfill-search` de `package.json`, la carpeta de migración escrita a mano              | `--check` imprime N > 0 en la base actual; sin bandera lo deja en 0; la segunda pasada actualiza 0 filas (C5, R13, E20). Y `npx prisma validate` sigue verde                      |
| 4     | src/features/marketplace/server/search.ts                                                                                                                         | Compila y pasa el lint. Todavía sin llamador y sin prueba: es la etapa que menos verifica y por eso no va antes                                                                   |
| 5     | `vitest.config.mts`, vitest.setup.db.ts, src/features/marketplace/server/dbFixtures.ts, search.db.test.ts y product.db.test.ts                                    | C2, C3, C4 (variante del handler), C7, C8, C9 y E1–E3, E5–E22                                                                                                                     |
| 6     | src/features/marketplace/server/boundaries.test.ts                                                                                                                | C10 y G1–G5                                                                                                                                                                       |
| 7     | Cierre                                                                                                                                                            | C11 (el sensor completo en 0), la nota de I1 en `docs/adr/0011-sin-postgis-por-ahora.md` (del humano) y las ADR que se acepten                                                    |

El orden no es negociable en dos puntos: la etapa 1 va primera porque las cinco
siguientes importan de ella, y la etapa 5 va después de la 3 porque las pruebas
de base real necesitan el relleno para no depender del estado previo de la base.

## Patrones a seguir / antipatrones a evitar

- **Prisma solo en `features/*/server/`** (`AGENTS.md` § Arquitectura). El SQL
  crudo no es una excepción: vive en la misma capa.
- **Nunca `$queryRawUnsafe` ni `$executeRawUnsafe`**, ni interpolación de texto de
  una persona (R11, E18). Todo por `Prisma.sql` con valores ligados.
- **Nada de `$transaction`** (`AGENTS.md` § Cosas que muerden: el pooler corre en
  modo transacción).
- **Ni un número ni una cadena mágica**: a src/constants/marketplace.ts o al enum
  generado (`AGENTS.md` § Prohibiciones).
- **`any` es error de ESLint**: la fila cruda lleva tipo declarado y `storeCount`
  se convierte a `number` a mano.
- **Idempotencia y guarda de rancio en todo lo que el sync escribe**: la primera
  la da el `WHERE` de W1, la segunda el `return STALE` que ya existe.
- **Una ruta que todavía no existe no se cita entre comillas invertidas** — la
  razón de que en este documento los archivos por crear vayan sin ellas.
- **Antipatrón que este feature podría introducir y no debe**: un `catch` en la
  búsqueda que devuelva `items: []` cuando la base falla. La spec lo prohíbe
  explícitamente: disimularía la caída.

## Riesgos y plan B

| Riesgo                                                                                                                            | Plan B                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| En un proyecto Supabase, `unaccent` puede vivir en el esquema `extensions`; `unaccent(...)` sin cualificar fallaría en producción | La expresión está en un sitio: cualificarla (`public.unaccent`) o fijar `search_path` es una línea. Se detecta con el ejecutable del relleno `--check` contra producción antes de anunciar nada |
| El sensor pasa a exigir Postgres arriba para toda la repo (hoy `.agent/init.sh` solo avisa)                                       | AP1                                                                                                                                                                                             |
| Dos ejecuciones de pruebas en paralelo sobre la base compartida                                                                   | Token por ejecución + barrido por antigüedad; ninguna prueba afirma «la base tiene exactamente N filas»                                                                                         |
| Aplicar la migración de datos en la base de desarrollo compartida deja `_prisma_migrations` por delante de los otros worktrees    | AP2                                                                                                                                                                                             |
| Alguien corre `prisma migrate dev` por costumbre y se lleva el índice GIN                                                         | La etapa 3 dice que la carpeta se escribe a mano y se aplica con `migrate deploy`; el plan lo repite, y la ficha ya está escrita                                                                |
| `ts_rank` sin `setweight` ni bandera de normalización: entre dos documentos de largo muy distinto el orden puede sorprender       | Fuera de alcance por decisión de la spec. La ponderación es otro feature; el orden ya es total y estable                                                                                        |
| El proyecto `db` engorda y las conexiones se acumulan                                                                             | Techo declarado: 6 archivos. Después, `fileParallelism: false` o `max` menor                                                                                                                    |

## Incongruencias y notas para el orquestador

- **I4 queda resuelta, no esquivada.** «Se recalcula en la misma escritura» es
  literalmente posible: W1 escribe las dos columnas en una sentencia. Lo que se
  pierde es el `update` tipado, como la spec anticipaba.
- **R1 habla de «seis sitios» y el diseño los deja en seis llamadas a una sola
  función**, quitando `searchDocument` de los cuatro `create`/`update` tipados.
  Es la misma regla cumplida por construcción; conviene que el plan lo diga con
  esas palabras, porque un lector rápido lo leería como «solo se toca la mitad».
- **C1 y C6 no necesitan `psql`** (que no está en el PATH de esta máquina): el
  ejecutable del relleno con `--check` imprime los dos conteos. Es el camino que
  la spec pedía dejar escrito en un guion.
- **I1 sigue siendo del humano:** la nota en
  `docs/adr/0011-sin-postgis-por-ahora.md` diciendo que F-015 se implementó sin
  PostGIS. Yo no escribo en `docs/adr/`.
- **Ninguna regla de la spec resultó imposible.** No hay nada que escalar a
  `sdd-spec`.

## ¿Hace falta una ADR?

Sí, y creo que **una sola**, porque las dos decisiones estructurales que F-015
estrena son la misma historia contada de dos lados: hay una columna que Prisma no
modela, y por eso aparecen el primer SQL crudo del repo y las primeras pruebas
contra Postgres real.

Propuesta (borrador, **no** escrito por mí — `docs/adr/` no es mío):

- **docs/adr/0019-sql-crudo-para-tsvector-y-pruebas-contra-postgres-real.md**
  (por crear, y no por mí) —
  Contexto: `searchVector` es `Unsupported("tsvector")` y su expresión no es
  inmutable. Decisión: (a) el SQL crudo se compone solo con `Prisma.sql`, nunca
  `Unsafe`, y vive en `features/*/server/`; (b) la expresión de escritura y la de
  consulta se definen una vez, en el mismo módulo, y una prueba de frontera lo
  vigila; (c) lo que no se puede probar con Prisma mockeado se prueba contra
  Postgres real, en un tercer proyecto de vitest que **falla** —no se salta— si la
  base no está; (d) el aislamiento es por token único por ejecución, nunca por
  truncado, porque la base local es compartida y sembrada.

Si el humano prefiere separarlas, la 0020 sería la mitad (c)+(d). Ver AP3.

## Preguntas al humano

Las tres tienen recomendación y camino por defecto, así que el diseño no queda a
medias: si no hay respuesta, se implementa la recomendación. Lo que bloquean es
la firma del plan, no el trabajo de arquitectura — por eso este documento sale en
`estado: listo`.

**AP1 · ¿El sensor pasa a exigir Postgres levantado?** Hoy `.agent/init.sh` trata
un Postgres inalcanzable como aviso, y `npm test` pasa con la base apagada. Con
las pruebas de la etapa 5, si la base no está, o falla o se salta.

- (a) **Falla, ruidosamente**, con el comando exacto en el mensaje.
- (b) Se salta cuando falta `DATABASE_URL`, con un aviso en la salida.
- (c) Solo corren en el CI.

**Recomendación: (a).** (b) reintroduce el salto invisible que la spec prohíbe
—`verify.sh` mira el código de salida, y un salto sale verde—, y (c) le quita al
implementador la única forma de verificar C2, C3, C7, C8 y C9 antes de abrir el
PR. El precio de (a) es real y hay que aceptarlo con los ojos abiertos: cualquier
sesión de este repo, incluso una que solo toque CSS, necesitará
`docker compose up -d postgres`. Si se acepta, propongo además cambiar el aviso
de `.agent/init.sh` por un fallo, para que el entorno no diga «LISTO» cuando el
sensor va a ponerse rojo. Eso es un archivo del arnés y no lo toco sin permiso.

**AP2 · ¿Migración de datos además del ejecutable, y se aplica en la base
compartida de desarrollo?** El relleno de C5 puede ir por los dos caminos.

- (a) Migración + ejecutable, y la migración se aplica también en local.
- (b) Migración + ejecutable, y en local se usa **solo** el ejecutable.
- (c) Solo el ejecutable; quien despliega se acuerda.

**Recomendación: (b).** La migración existe y va al repo, porque ADR 0010 dejó
`postinstall` sin `migrate deploy` y sin ella el relleno de producción depende de
que alguien se acuerde. Pero no la aplico en la base de desarrollo compartida
entre worktrees: el rodeo de la ficha
`.agent/playbook/prisma-migrate-dev-checksum-drift-bd-compartida.md` avisa de que
adelantar `_prisma_migrations` allí es un riesgo que se escala, no se resuelve en
silencio; y en local el ejecutable hace exactamente lo mismo sin tocar la
contabilidad de migraciones. Nota de escala para decidir: hoy la tabla tiene
decenas de filas y la migración es instantánea; si algún día pasa de ~100 000, el
`UPDATE` de la migración bloquearía el despliegue algunos minutos y habría que
sustituirlo por el ejecutable por lotes, que ya está escrito para eso.

**AP3 · ¿Una ADR o dos, y quién la escribe?**

- (a) Una sola, 0019, con las cuatro decisiones.
- (b) Dos: 0019 (SQL crudo y la expresión única) y 0020 (pruebas contra Postgres
  real).

**Recomendación: (a)**, y que la escriba el orquestador al cerrar, junto con la
nota de I1 en la ADR 0011. Son la misma causa —una columna que Prisma no
modela— y partirla en dos deja dos documentos que solo se entienden juntos.
