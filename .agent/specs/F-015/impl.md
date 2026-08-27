---
feature: F-015
agente: sdd-implementer
actualizado: 2026-08-27T18:01:05Z
estado: listo (pasos 1, 2, 3, 4, 6 — paso 5 y las ADR del paso 7 quedan para sdd-tester y el orquestador)
---

## Qué se construyó

| Archivo                                                                     | Qué hace                                                                                                                                                                         | Criterio que cubre   |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `src/constants/marketplace.ts`                                              | El diccionario (`spanish`), los límites de término y paginación, y el tamaño de lote del relleno                                                                                 | C9, R7               |
| `src/lib/searchTerm.ts` + `src/lib/searchTerm.test.ts`                      | `normalizeSearchTerm`, `clampSearchLimit`, `clampSearchOffset` — pura, sin Prisma. 18 pruebas de unidad: vacío, blanco, solo puntuación, una letra, metacaracteres, 10 000 chars | C9, R2, R6, R7       |
| `src/features/marketplace/server/searchVector.ts`                           | `searchVectorOf`, `searchQueryOf` (LA expresión, R2), `writeSearchDocument` (W1), `backfillSearchVectors` (W2) — el único sitio que escribe `searchVector`                       | C1, C5, C10 (G2)     |
| `src/features/sync/server/handlers/product.ts`                              | Las tres creaciones de canónico y el recálculo de alias ya no escriben `searchDocument`: llaman a `writeSearchDocument`. Comentario de cabecera actualizado                      | C1, R1, E1–E4        |
| `src/features/sync/server/handlers/product.test.ts`                         | 4 pruebas mockeadas nuevas: rancio → escritor no llamado (E4); alias repetido → no llamado; canónico nuevo → una llamada con el documento (E1); alias nuevo → una llamada (E2)   | C1, E1–E4            |
| `prisma/seed.ts`                                                            | `upsertCanonical` ya no escribe `searchDocument` en el `create` ni en un `update` propio: llama a `writeSearchDocument` al final                                                 | C6, R14              |
| `scripts/backfill-search-vector.ts` + `package.json` (`db:backfill-search`) | `--check` imprime los dos conteos de C5/C6 sin `psql`; sin bandera aplica `backfillSearchVectors` y reporta `before/updated/after`                                               | C1, C5, C6, R13, E20 |
| `prisma/migrations/20260827180000_backfill_search_vector/migration.sql`     | La migración de datos, escrita a mano, con W2 sin `LIMIT` y el diccionario como literal `'spanish'`                                                                              | C5, I7 evitado       |
| `src/features/marketplace/server/search.ts`                                 | `searchCanonicalProducts` + sus tipos — Q1, un `$queryRaw`, sin caché, sin `catch`                                                                                               | C2, C3, C7, C8       |
| `src/features/marketplace/server/boundaries.test.ts`                        | La guarda C10: G1 (dos mitades), G2, G3, G4, G5 (gated — ver § Desviaciones)                                                                                                     | C10                  |

## Desviaciones

1. **G5 no está incondicionalmente activo.** `architecture.md` lo especifica
   como "`vitest.config.mts` declara un proyecto `db`... y hay ≥ 2 archivos
   `*.db.test.ts`" — hoy eso es falso a propósito (paso 5 es de
   `sdd-tester`, no mío). Elegí la segunda de las dos opciones que me dio el
   orquestador: **escribirlo detrás de una comprobación que se activa sola.**
   Mientras ni el proyecto `db` ni ningún `*.db.test.ts` existan, el test no
   falla; en el momento en que aparece **cualquiera de las dos mitades**
   (el proyecto declarado, o un solo archivo `*.db.test.ts`), el test exige
   las dos completas — así que un aterrizaje a medias ya se pone rojo, y no
   puede volver a pasar en silencio una vez que el trabajo empezó. Lo dejé
   comentado en el propio test, con una nota dirigida a `sdd-tester`: quitar
   el `if` de escape es lo único que hace falta para volverlo estricto de
   verdad. **No es una desaparición silenciosa: está escrito, está probado
   (confirmé que las dos mitades, activadas a mano, exigen lo correcto) y
   está documentado aquí y en el propio archivo.**
2. **`prisma/schema.prisma` no se tocó** — confirmado, cero diffs en ese
   archivo.
3. Ningún otro paso se desvió de `architecture.md`: los tipos de
   `search.ts`, `searchVector.ts` y `src/constants/marketplace.ts` son
   literalmente los del contrato (§ Contratos), y el SQL de W1, W2 y Q1 es
   el mismo, salvo la reutilización deliberada de `searchVectorOf`/
   `searchQueryOf` dentro de `writeSearchDocument`/`search.ts` en vez de
   repetir la expresión (así hay un solo sitio que la compone, no dos con
   el mismo texto).

## Comandos ejecutados

- `bash .agent/sdd.sh gate F-015` → `0` (el humano firmó el plan).
- `bash .agent/init.sh` → `ENTORNO LISTO`.
- `bash .agent/verify.sh F-015` (repetido a cada cambio) → **último intento
  (21, con `--full`): `0`, última línea `PASA`.**
- `bash .agent/verify.sh F-015 --full` → `0`, las nueve etapas en verde
  (harness · typecheck · lint · format · test · prisma · build · theme ·
  bundle).
- `npm run seed && npm run seed` → `0` las dos veces; después, contra la
  base compartida, `SELECT count(*) FROM "CanonicalProduct" WHERE
"searchVector" IS NULL` = `0` y el `café` del seed sale con
  `searchVector::text NOT LIKE '%é%'` = `t` (comprobado a mano vía
  `$queryRaw`, sin dejar rastro en el repo).
- `npx tsx scripts/backfill-search-vector.ts --check` / sin bandera / de
  nuevo → verificado a mano insertando una fila con `searchVector` NULL
  (fuera del escritor, para simular una fila heredada), confirmando
  `N > 0` → `before=1 updated=1 after=0` → segunda pasada
  `before=0 updated=0 after=0`, y borrando la fila de prueba después. La
  base compartida quedó exactamente como estaba antes de este ciclo.
- `npx prisma validate` → verde.
- Prueba manual de `searchCanonicalProducts` contra la base compartida real
  (`coca` → un resultado, `storeCount: 4`, del canónico `Refresco de cola
1.5 L`; `cafe`/`café` → vacío porque el único café del seed es exclusivo;
  término hostil `'; DROP TABLE ...` → `items: []` sin error y la tabla
  sigue existiendo) — no dejó ningún archivo en el repo, era solo para
  confirmar Q1 antes de entregarlo sin pruebas automáticas (paso 4 es
  deliberadamente el que menos verifica).
- Confirmé que la guarda de C10 sí caza el defecto que dice cazar: añadí
  temporalmente `data: { searchDocument: "x" }` a `search.ts`, corrí solo
  `boundaries.test.ts`, vi fallar exactamente G1 (mitad a), y revertí el
  archivo a su estado original (`git diff` vacío tras revertir).

## Fallos del sensor durante el ciclo (todos descartados, ninguno fichado)

- `test:AssertionError: expected null to be '\'' Object.is equality` —
  descuido propio: mi primer test de `searchTerm.test.ts` esperaba que un
  apóstrofo solo (`"'"`) pasara `normalizeSearchTerm` sin cambios, pero un
  apóstrofo no es letra ni dígito — cae bajo E15/R6 y debe devolver `null`.
  Corregido el test, no el código. Descartado con
  `bash .agent/verify.sh dismiss`.
- `format:archivos sin formatear` (intento 19) — descuido propio: dejé una
  línea de prueba manual (el probe de G1 de arriba) con espaciado sin
  formatear al borrarla a mano; `npm run format` la arregló. Descartado.
- Ninguno de los dos dio lección: son errores míos, no trampas del repo.
  `.agent/playbook/` no gana ninguna ficha nueva en este ciclo.

## Deuda dejada

- **G5 gated**, como se explica en § Desviaciones — es la única deuda
  deliberada. `sdd-tester` la cierra quitando el `if` de escape al terminar
  el paso 5.
- **`search.ts` no tiene ninguna prueba automática todavía** — ni mockeada
  ni real. Es la etapa que `architecture.md` describe como "la que menos
  verifica y por eso no va antes": sin la 5 no hay nada que demuestre que
  Q1 hace lo que dice. Lo verifiqué a mano contra la base compartida (ver
  arriba) pero eso no sustituye a `search.db.test.ts`.
- **Nadie llama a `searchCanonicalProducts` todavía** — es SP-H1, deliberado
  y fuera de alcance de F-015 entero.

## Qué necesita quien pruebe (sdd-tester, paso 5)

- **Firmas exactas que vas a consumir**, todas en
  `src/features/marketplace/server/searchVector.ts`:

  ```ts
  export type SearchIndexWriter = Pick<PrismaClient, "$executeRaw">;
  export const searchVectorOf: (document: string) => Prisma.Sql;
  export const searchQueryOf: (term: string) => Prisma.Sql;
  export function writeSearchDocument(
    db: SearchIndexWriter,
    canonicalProductId: string,
    document: string,
  ): Promise<number>; // filas afectadas; 0 = ya estaba así (E3)
  export function backfillSearchVectors(
    db: SearchIndexWriter & Pick<PrismaClient, "$queryRaw">,
  ): Promise<{ before: number; updated: number; after: number }>;
  ```

  Y en `src/features/marketplace/server/search.ts`:

  ```ts
  export type MarketplaceSearchInput = {
    term: string;
    onlyWithLiveOffer?: boolean; // default false
    limit?: number; // default 20, clamp [1,50]
    offset?: number; // default 0, clamp >= 0
  };
  export type MarketplaceSearchItem = {
    canonicalProductId: string;
    name: string;
    imageUrl: string | null;
    storeCount: number;
  };
  export type MarketplaceSearchResult = { items: MarketplaceSearchItem[]; hasMore: boolean };
  export function searchCanonicalProducts(
    input: MarketplaceSearchInput,
  ): Promise<MarketplaceSearchResult>;
  ```

- **El ejecutable del relleno se llama** `npx tsx
scripts/backfill-search-vector.ts` (o `npm run db:backfill-search`), con
  `--check` para solo contar. Imprime dos líneas etiquetadas:
  `searchDocument <> '' AND searchVector IS NULL: N` y
  `searchVector IS NULL: M`. Sin bandera imprime
  `before=X updated=Y after=Z`. Confirmé a mano que `N`/`M` bajan a `0`
  tras aplicarlo y que una segunda pasada deja `updated=0`.
- **La migración de datos** vive en
  `prisma/migrations/20260827180000_backfill_search_vector/migration.sql`.
  **No la apliqué contra la base local compartida** (PP2): la validé
  syntácticamente vía `npx prisma validate` (que no valida el contenido de
  las migraciones, solo el schema) y verifiqué el `UPDATE` equivalente a
  mano por otra vía (el ejecutable). El primer sitio real donde correrá es
  `npx prisma migrate deploy` — en el CI, contra una base vacía (actualiza
  0 filas) — hasta que tú decidas si tu entorno de pruebas contra Postgres
  real la necesita aplicada.
- **G5** en `src/features/marketplace/server/boundaries.test.ts`: en cuanto
  crees `vitest.setup.db.ts` y los dos `*.db.test.ts` (o antes, en cuanto
  añadas el proyecto `db` a `vitest.config.mts`), esa prueba empieza a
  exigir de verdad `include: ["src/**/*.db.test.ts"]` en el `vitest.config.mts`
  y `>= 2` archivos `*.db.test.ts`. Quita el `if (!hasDbProject &&
dbTestFiles.length === 0) { return; }` cuando ya no haga falta el gateo —
  déjalo incondicional.
- **`resolveCanonicalIdentity`/`buildSearchDocument`** (`src/lib/canonical.ts`)
  no cambiaron: el sync sigue resolviendo identidad igual, solo cambió
  DÓNDE se escribe el documento.
- **Aislamiento por token**: nada de lo que construí toca la base compartida
  de forma permanente — cada comprobación manual que hice insertó y borró su
  propia fila (`f015-legacy-test-row`) o corrió `searchCanonicalProducts`
  de solo lectura. La base quedó exactamente como el seed la deja.
- **El único producto acentuado del seed (`Café molido 250 g`) es
  exclusivo** — no aparece en ninguna búsqueda por diseño (R4). No lo uses
  para probar C2: crea tu propio dato, como ya anota `spec.md` (I5).

## Preguntas al humano

Ninguna. Las cuatro preguntas del plan (PP1–PP4) ya las resolvió el humano
antes de firmar, y ninguna decisión de este ciclo necesitó una nueva.

## Segundo pase: idioma del código (2026-08-27, mismo ciclo)

El orquestador señaló que los comentarios del código nuevo estaban en
español, contra `AGENTS.md` § Idioma («Código en inglés: identificadores,
comentarios, mensajes de error, logs»). Traduje la prosa (comentarios,
JSDoc, comentarios dentro del SQL) de los ocho archivos señalados —
`search.ts`, `searchTerm.test.ts`, `searchVector.ts`, `boundaries.test.ts`,
`searchTerm.ts`, la migración de datos, `marketplace.ts` y
`scripts/backfill-search-vector.ts` — sin tocar lógica ni las referencias a
reglas/escenarios (`R2`, `E15`, `G1`..`G5`, etc.), que quedan igual. No
encontré nada que cambiara de significado al traducir.

Dos decisiones que dejo anotadas en vez de aplicar a ciegas:

- Las citas literales de encabezados de un documento en español (p. ej.
  `spec.md § La guarda de C10`, o el nombre de una ficha de
  `.agent/playbook/`) las dejé tal cual: son el título real del documento
  citado, no prosa mía, y el mismo patrón ya existe en el repo (p. ej.
  `src/features/storefront/server/registry.ts` cita fichas de
  `.agent/playbook/` por su nombre real dentro de comentarios en inglés).
- `src/lib/searchTerm.test.ts` conserva `café`/`¡¿?!...` como **datos** de
  prueba (no son comentarios ni identificadores): son ejemplos de término
  con acento y de puntuación pura, coherentes con que el catálogo del seed
  usa nombres en español. Si preferís que también esos literales se
  cambien, es una línea, pero no lo hice porque no es lo que la regla de
  idioma cubre y tocar datos de un test sin que me lo pidieran explícitamente
  se sale de "solo cambiar prosa".

`bash .agent/verify.sh F-015 --full` tras el segundo pase: **código de
salida 0**, última línea `PASA`, las nueve etapas verdes.
