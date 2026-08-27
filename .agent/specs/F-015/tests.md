---
feature: F-015
agente: sdd-tester
actualizado: 2026-08-27T18:40:00Z
estado: listo
veredicto: listo
---

## Estrategia

Tres niveles, cada uno en el proyecto de vitest que le toca por extensión
(`AGENTS.md` § Cosas que muerden, ficha `test-en-entorno-equivocado`):

- **Unidad, sin base** (`*.test.ts`, proyecto `server`): `src/lib/searchTerm.test.ts`
  (ya construido por `sdd-implementer`, paso 1) — `normalizeSearchTerm`,
  `clampSearchLimit`, `clampSearchOffset`. No los repito: no tocan Prisma y ya
  estaban verdes.
- **Mockeada, sin base** (`*.test.ts`, proyecto `server`):
  `src/features/sync/server/handlers/product.test.ts` (paso 2) — si el escritor
  se llama, cuántas veces, con qué documento. Y `boundaries.test.ts` (paso 6,
  C10) — lee el código fuente, sin base y sin mocks.
- **Contra Postgres real** (`*.db.test.ts`, proyecto `db`, este ciclo):
  `src/features/marketplace/server/search.db.test.ts` (Q1: C2, C3, C7, C8, C9,
  E5-E22) y `src/features/sync/server/handlers/product.db.test.ts` (W1: E1-E4,
  y la variante de C4 "dos llamadas al handler", porque en el CI `npm test`
  corre antes que `npm run seed`).

Aislamiento: un token único por ejecución (`qab_f015_<hex>`,
`src/features/marketplace/server/dbFixtures.ts::makeToken`) que viaja dentro
del propio término de búsqueda y del propio documento, nunca por truncar una
tabla. `sweepStaleFixtures()` barre restos de ejecuciones muertas (>10 min) al
arrancar. Cada archivo `*.db.test.ts` abre con un test "sentinel" que confirma
que de verdad tocó la base (anti-vacuidad, decisión 5 de architecture.md).

## Mapa criterio → prueba

| Criterio de aceptación (`.agent/features.json`, literal)                       | Prueba                                                                                                                                                                                                                                                                                                                                                        | Archivo                                                                                                                                                                                | Resultado |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| "searchVector se puebla al sincronizar usando to_tsvector con unaccent." (C1)  | `handleProduct` real crea el canónico y dentro de la misma escritura `"searchVector" IS NOT NULL` y `"searchVector"::text NOT LIKE '%é%'` (E1). Además el ejecutable de relleno demostrado con una fila heredada simulada.                                                                                                                                    | `src/features/sync/server/handlers/product.db.test.ts` ("a new canonical is born indexed, unaccented (E1)"); `scripts/backfill-search-vector.ts` (ejecutado a mano, ver § Ejecuciones) | LISTO     |
| "Buscar 'cafe' encuentra un producto llamado 'Café'." (C2)                     | Crea `Café molido 250 g <token>` y `Cafe tostado 500 g <token>`, busca `cafe <token>` y `café <token>`, los dos aparecen en ambos sentidos (E5, E6)                                                                                                                                                                                                           | `search.db.test.ts` ("finds an accented document with an unaccented term...")                                                                                                          | LISTO     |
| "Los canónicos con isExclusive = true quedan FUERA de los resultados." (C3)    | Dos canónicos con documentos casi idénticos, uno `isExclusive: true`: nunca aparece, con el filtro de existencia encendido o apagado (E7, R4)                                                                                                                                                                                                                 | `search.db.test.ts` ("excludes isExclusive products...")                                                                                                                               | LISTO     |
| "Un alias nuevo se refleja en los resultados sin reprocesar el catálogo." (C4) | Dos llamadas a `handleProduct` con el mismo `barcode` y `localName` distinto (de otra `businessId`): el documento contiene ambos nombres, `searchCanonicalProducts({ term: "coca <token>" })` encuentra el canónico por el alias nuevo, sin pasada de reindexado aparte (E2); y variante con dos tiendas de un mismo negocio: una fila, `storeCount: 2` (E22) | `product.db.test.ts` ("a new alias from another business reindexes...", "two handler calls with the same barcode...")                                                                  | LISTO     |
| C5 `[nuevo]` — relleno de filas heredadas                                      | Fila insertada a mano con `searchVector` NULL: `--check` da `N=1` → sin bandera `before=1 updated=1 after=0` → segunda pasada `updated=0`. Ejecutado contra la base compartida, con limpieza posterior (ver § Ejecuciones)                                                                                                                                    | `scripts/backfill-search-vector.ts` (manual, no automatizable sin ensuciar el CI vacío — ver spec.md nota bajo C5)                                                                     | LISTO     |
| C6 `[nuevo]` — el seed deja la base buscable                                   | `npm run seed && npm run seed` en 0, después `--check` dos conteos en `0`                                                                                                                                                                                                                                                                                     | manual, spec.md dice explícitamente que no se automatiza (el CI siembra después de `npm test`, el aserto sería vacuo)                                                                  | LISTO     |
| C7 `[nuevo]` — el filtro de existencia, cuatro condiciones                     | `OUT_OF_STOCK` fuera (E9), `LOW_STOCK` dentro (E10), `visible:false` fuera, `deletedAt` no nulo fuera, tienda no `PUBLISHED` fuera (E11); apagado, todos con `storeCount: 0` (E8)                                                                                                                                                                             | `search.db.test.ts` (describe "the live-offer filter's four conditions")                                                                                                               | LISTO     |
| C8 `[nuevo]` — el orden                                                        | Documento idéntico, uno con oferta viva: sale primero (E12); paginación estable y orden total en llamadas repetidas (E21)                                                                                                                                                                                                                                     | `search.db.test.ts` ("with an equal document...", "pagination is stable...")                                                                                                           | LISTO     |
| C9 `[nuevo]` — el término no rompe la consulta                                 | Metacaracteres de `tsquery`, comillas sueltas: no lanza (E17); inyección SQL: `items: []` y la tabla sigue existiendo (E18, R11); término de 10 000 caracteres ya cubierto en unidad (`searchTerm.test.ts`)                                                                                                                                                   | `search.db.test.ts` (`it.each` de términos hostiles + "a SQL injection attempt...")                                                                                                    | LISTO     |
| C10 `[nuevo]` — la guarda contra la degradación silenciosa                     | G1-G5, los cinco. G5 desgateado en este ciclo (ya no tiene el `if` de escape): exige el proyecto `db` y ≥2 archivos `*.db.test.ts`, y hoy hay exactamente 2                                                                                                                                                                                                   | `src/features/marketplace/server/boundaries.test.ts`                                                                                                                                   | LISTO     |
| C11 `[nuevo]` — el sensor completo                                             | `bash .agent/verify.sh F-015 --full` en 0                                                                                                                                                                                                                                                                                                                     | — (ver § Ejecuciones)                                                                                                                                                                  | LISTO     |

Los 22 escenarios E1-E22 y las reglas R1-R14 quedan cubiertos por las filas de
arriba: E1-E4 en `product.db.test.ts`, E5-E22 en `search.db.test.ts`, R2/R6/R7
en `searchTerm.test.ts` (paso 1, ya existente), R1/R14 en `product.test.ts` +
`npm run seed` doble, R13 en el ejecutable del relleno.

## Ejecuciones

```
$ bash .agent/verify.sh F-015 --full
[intento 33]
  ✓ harness    0s
  ✓ typecheck  1s
  ✓ lint       3s
  ✓ format     3s
  ✓ test       3s
  ✓ prisma     0s
  ✓ build      4s
  ✓ theme      0s
  ✓ bundle     0s

PASA
```

Código de salida: **0**.

```
$ npx vitest run
 Test Files  51 passed (51)
      Tests  468 passed (468)
```

(los tres proyectos: `server`, `ui`, `db`)

```
$ npx vitest run --project db --reporter=verbose
 Test Files  2 passed (2)
      Tests  24 passed (24)
```

24/24 en `search.db.test.ts` (18) + `product.db.test.ts` (6), contra Postgres
real (`docker compose` local, puerto 5433). Verificado limpio antes y después:
`SELECT count(*) FROM "CanonicalProduct" WHERE name LIKE '%qab_f015_%'` = `0`,
igual para `Business.externalId` — el token no deja residuo.

```
$ npx vitest run src/features/marketplace/server/boundaries.test.ts --reporter=verbose
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

Las cinco guardas (G1 son dos pruebas) + G5, ahora incondicional.

**PP1 — la precondición falla ruidosamente, verificado ejecutando:**

```
$ DATABASE_URL="" npx vitest run --project db
Error: DB TEST SETUP: DATABASE_URL is not set — run: docker compose up -d postgres && npm run db:deploy
 Test Files  2 failed (2)
      Tests  24 skipped (24)
$ echo $?
1
```

Código de salida **1**, no 0: un Postgres inalcanzable pone rojo el proyecto
`db` entero, nunca lo salta en silencio. `.agent/init.sh` también cambiado
(PP1): "Postgres no alcanzable" pasa de `warn` a `bad`, con el comando exacto.

**C5 — el relleno de filas heredadas, ejecutado contra la base compartida (sin
dejar rastro):**

```
$ node -e '... INSERT INTO "CanonicalProduct" (... "searchVector" NULL ...)'
inserted
$ npx tsx scripts/backfill-search-vector.ts --check
searchDocument <> '' AND searchVector IS NULL: 1
searchVector IS NULL: 1
$ npx tsx scripts/backfill-search-vector.ts
before=1 updated=1 after=0
$ npx tsx scripts/backfill-search-vector.ts
before=0 updated=0 after=0
$ npx tsx scripts/backfill-search-vector.ts --check
searchDocument <> '' AND searchVector IS NULL: 0
searchVector IS NULL: 0
$ node -e '... DELETE FROM "CanonicalProduct" WHERE id = ... '
deleted
```

La fila de prueba se insertó y se borró a mano; la base quedó exactamente
como estaba (`total 17`, `null_vector 0` antes y después).

**C6 — el seed deja la base buscable, ejecutado dos veces:**

```
$ npm run seed
Done: { stores: 6, storefronts: 6, canonical: 17, aliases: 20, products: 26 }
$ npm run seed
Done: { stores: 6, storefronts: 6, canonical: 17, aliases: 20, products: 26 }
$ npx tsx scripts/backfill-search-vector.ts --check
searchDocument <> '' AND searchVector IS NULL: 0
searchVector IS NULL: 0
```

**C11:** `bash .agent/verify.sh F-015 --full` → **0** (ver arriba). Repetido
tres veces en este ciclo (intentos 31, 32, 33), siempre `0` tras los ajustes
de formato y del guardián cruzado (§ Fallos encontrados).

## Fallos encontrados

- **`format:archivos sin formatear` (intento 28).** `dbFixtures.ts` y
  `search.db.test.ts` recién creados, sin pasar por prettier. Descuido propio,
  arreglado con `npm run format`. Ya fichado (`prettier-sin-formatear.md`), sin
  ficha nueva.
- **`test:AssertionError: expected [ Array(1) ] to deeply equal []` (intento
  29).** `src/features/marketplace/server/dbFixtures.ts::sweepStaleFixtures`
  usaba `prisma.storefront.findMany({ where: { slug: { contains: ... } } })`
  para barrer fixtures viejas por su prefijo. Ese texto exacto
  (`where: { slug`) es lo que
  `src/features/storefront/server/boundaries.test.ts` (guarda I6 de **otro**
  feature, F-017) vigila fuera de su lista blanca — un cruce de guardianes por
  coincidencia de texto, no un defecto real de F-015. **Severidad: baja** (falso
  positivo de una guarda ajena, no un bug de producto). **Reproducción:**
  `bash .agent/verify.sh F-015` con `dbFixtures.ts` en el estado del intento 28. **`archivo:línea` sospechoso:** era
  `src/features/marketplace/server/dbFixtures.ts:262` (ya corregido). **Arreglo
  aplicado (no vuelve a ningún agente, se resolvió en este ciclo):** reescribí
  el barrido para encontrar el `Storefront` stale por `businessId` (ya
  disponible desde la `Business` stale) en vez de por `slug`, sin tocar el
  `boundaries.test.ts` ajeno. **Lección fichada:**
  `.agent/playbook/boundaries-guard-cruzado-por-patron-de-texto.md` (nueva,
  `visto_en: F-015`) — describe el patrón general para que la próxima persona
  que escriba un `where: { slug: ... }` por cualquier razón no relacionada con
  resolver una tienda sepa qué guardia se va a disparar y por qué.
- **Doble error al desconectar cuando `DATABASE_URL` falta (encontrado
  verificando PP1 a mano, no por el sensor).** `vitest.setup.db.ts`'s `afterAll`
  llamaba `prisma.$disconnect()` incondicionalmente; cuando `beforeAll` ya
  había lanzado por falta de `DATABASE_URL`, tocar `prisma.$disconnect` volvía
  a lanzar (el `Proxy` de `src/lib/prisma.ts` construye el cliente perezoso en
  el propio acceso a la propiedad), enterrando el mensaje real bajo un segundo
  error sin relación. No cambia el código de salida (ya era 1), así que no es
  un fallo del sensor — es una molestia de legibilidad del mensaje. Arreglado
  con un `try/catch` en el propio `afterAll`. No fichado: es específico de este
  archivo, no una trampa del repo.

`bash .agent/verify.sh pending F-015` → sin salida (lista vacía): los dos
fallos de arriba están fichados o resueltos, ninguno queda suelto.

## Huecos de cobertura

- **El término de 10 000 caracteres (parte de C9)** se verifica en
  `src/lib/searchTerm.test.ts` (unidad, ya existente) porque `normalizeSearchTerm`
  lo trunca **antes** de tocar la base — repetirlo contra Postgres real no
  añadiría nada que la unidad no demuestre ya, y agrandaría el archivo sin
  motivo.
- **El plan B de escala (columna `hasLiveOffer` materializada) no se prueba**:
  no está construido en este ciclo (es plan B, no el diseño de hoy,
  architecture.md § Escalabilidad). Ningún criterio lo pide.
- **`EXPLAIN` sobre el plan de consulta**: deliberadamente fuera, como
  `spec.md` § Nota sobre EXPLAIN explica — con las decenas de filas de esta
  base el planificador elegiría `Seq Scan` con razón, y forzarlo sería teatro.
  Lo que sí se prueba es la forma del predicado (G4).
- **Migración de datos, no aplicada contra la base local compartida (PP2,
  deliberado).** Se verificó sintácticamente (`npx prisma validate`, verde) y
  su contenido se comparó con la constante del diccionario (G3). El primer
  sitio donde de verdad corre es `npx prisma migrate deploy` en el CI, contra
  una base vacía — no lo repetí a mano contra una base vacía real porque
  levantar una segunda instancia de Postgres solo para esto está fuera del
  alcance de este paso; el CI ya lo corre en cada PR
  (`.github/workflows/ci.yml`).

## Veredicto

**LISTO.** Los 11 criterios (C1-C11, `.agent/features.json` + spec.md) se
verificaron ejecutando algo: los cuatro literales del feature contra Postgres
real con datos propios (nunca el seed, que en C2/C3 se contradice consigo
mismo — spec.md I5), los siete nuevos con su prueba automática o su comando
manual documentado con salida real, y el sensor completo en `0` tres veces
seguidas tras los dos únicos fallos del ciclo, ambos resueltos y con su
aprendizaje anotado.

`bash .agent/verify.sh pending F-015` queda vacío: no hay lección por fichar.

## Preguntas al humano

Ninguna. Los cuatro criterios literales de `.agent/features.json` se pudieron
verificar tal como están escritos, y el plan firmado no dejó ningún criterio
fuera de este ciclo (paso 5 completo, paso 7 es del orquestador).
