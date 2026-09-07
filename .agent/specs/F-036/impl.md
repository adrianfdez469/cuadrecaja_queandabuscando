---
feature: F-036
agente: sdd-implementer
actualizado: 2026-09-07T12:52:59Z
estado: listo (pasos 1-6 y 10 — pasos 7, 8, 9 y 11 quedan para sdd-tester)
---

> Este ciclo implementa **exactamente** los pasos 1-6 y 10 de
> `.agent/specs/F-036/plan.md`, firmado por el humano. Los pasos 7, 8, 9 y 11
> son de `sdd-tester` y no se tocaron. `docs/sync-contract.md` no se tocó
> (R17/C8). La base compartida `queandabuscando` **sigue sin la columna**
> — comprobado al terminar — porque aplicarla es una decisión del humano,
> una sola vez y anunciada (SP1, § «Comandos ejecutados» abajo).

## Qué se construyó

| Archivo                                                                          | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Paso del plan |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `prisma/schema.prisma` (`model ExchangeRate`)                                    | Columna `sourceUpdatedAt DateTime?` — **nullable, sin `@default`** (PD1) — más `@@index([businessId, currencyCode, sourceUpdatedAt(sort: Desc), createdAt(sort: Desc), id(sort: Desc), rate], map: "ExchangeRate_current_rate_idx")` (AD1)                                                                                                                                                                                                                                                                                               | 1             |
| `prisma/schema.prisma` (`model CanonicalProduct`, `model StoreProduct`)          | Los cuatro índices GIN de búsqueda declarados, verbatim como pidió el humano: `@@index([searchVector], type: Gin)` y `@@index([name(ops: raw("gin_trgm_ops"))], type: Gin, map: "CanonicalProduct_name_trgm_idx")` en `CanonicalProduct`; `@@index([searchVector], type: Gin, map: "StoreProduct_searchVector_idx")` y `@@index([searchDocument(ops: raw("gin_trgm_ops"))], type: Gin, map: "StoreProduct_searchDocument_trgm_idx")` en `StoreProduct`. `StoreProduct_visible_catalog_idx` (parcial) queda **sin declarar**, a propósito | 1             |
| `prisma/migrations/20260907123926_exchange_rate_source_updated_at/migration.sql` | **Generada por Prisma, `--create-only`, sin editar ni una línea**: `DROP INDEX` del índice viejo de `ExchangeRate`, `ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3)` (nullable), `CREATE INDEX "ExchangeRate_current_rate_idx"`. Tres sentencias, verificado con `migrate diff` antes de generarla y después de aplicarla en una base de usar y tirar                                                                                                                                                                                         | 1, 2          |
| `src/features/sync/server/handlers/misc.ts`                                      | `handleExchangeRate`'s `create` gana `sourceUpdatedAt: new Date(payload.updatedAt)`. Ninguna rama nueva, ningún `STALE`; el `return SKIPPED` de `CUP` sigue siendo lo primero; `handleCurrency` intocado                                                                                                                                                                                                                                                                                                                                 | 3             |
| `src/features/sync/server/handlers/misc.test.ts`                                 | Assertion del `create` actualizada con `sourceUpdatedAt`; +2 tests: la marca sale de `payload.updatedAt` sin transformar (R1), y un evento rancio (T1 llegando después de T2) se escribe y responde `processed` — no hay rama `STALE` (R2, R3)                                                                                                                                                                                                                                                                                           | 3             |
| `src/features/catalog/server/rates.ts` (nuevo)                                   | `buildCurrentRatesSql(businessId)` (exportada), `loadCurrentRates(businessId)`, `CurrentRateRow`. `DISTINCT ON ("currencyCode")` con `ORDER BY "currencyCode" ASC, "sourceUpdatedAt" DESC NULLS LAST, "createdAt" DESC, "id" DESC` — `NULLS LAST` en la primera clave, la mitad de PD1 que hace cumplible el criterio 5 sin relleno                                                                                                                                                                                                      | 4             |
| `src/features/catalog/server/rates.test.ts` (nuevo, 6 tests)                     | Afirma el `ORDER BY` **completo**, `NULLS LAST` incluido, carácter por carácter (única sensor de que la trampa no vuelve); el `DISTINCT ON`; el `businessId` ligado como `$1`; el mapeo a `Record<string,string>`; `{}` con cero filas (E11); que `loadCurrentRates` ejecuta la MISMA sentencia que `buildCurrentRatesSql` devuelve, no una copia                                                                                                                                                                                        | 4             |
| `src/features/catalog/server/queries.ts`                                         | `loadRates` **borrado**. `RateRef = Pick<BranchResolution, "businessId" \| "canonicalSlug">` junto a `StoreRef` (que no se toca). `getStoreRates` pasa a `cached(loadCurrentRates, {...})(branch.businessId)`, con el comentario largo que exige PD3 (de qué depende la frescura de la caché compartida)                                                                                                                                                                                                                                 | 5             |
| `src/features/orders/server/quote.ts`                                            | `loadFreshRates` **borrado**; `quoteCart` llama a `loadCurrentRates(store.businessId)` — mismo módulo, misma sentencia que la vitrina                                                                                                                                                                                                                                                                                                                                                                                                    | 5             |
| `src/features/orders/server/quote.test.ts`                                       | Mock de `exchangeRate.findMany` cambiado a `$queryRaw` (mismo camino que `loadCurrentRates`); `branchResolution()` gana `businessId`                                                                                                                                                                                                                                                                                                                                                                                                     | 5             |
| `src/features/storefront/server/resolve.ts`                                      | `BranchResolution` y `SelectorResolution` ganan `businessId: string`, tomado de `businessId: true` en el `select` de `Storefront` que `loadResolution` ya ejecuta. Los tres `return` lo propagan                                                                                                                                                                                                                                                                                                                                         | 5             |
| `src/features/storefront/server/resolve.test.ts`                                 | `storefrontRow()` gana `businessId: "business-1"`; una aserción explícita de que la resolución lo propaga (AD4)                                                                                                                                                                                                                                                                                                                                                                                                                          | 5             |
| `prisma/seed.ts`                                                                 | `RATES` gana `sourceUpdatedAt: new Date("2026-08-01T00:00:00.000Z")` por entrada, literal ISO explícito, nunca `new Date()`. Verificado idempotente: dos `npm run seed` seguidos en una base de usar y tirar no crean filas nuevas                                                                                                                                                                                                                                                                                                       | 6             |
| `docs/adr/0030-la-tasa-vigente-la-decide-la-lectura.md`                          | `Propuesta` → `Aceptada`. Punto 1 de «Decisión» reescrito: nullable + `NULLS LAST`, no `NOT NULL` + relleno — con la cita a PD1 y por qué la objeción de la spec a esa variante ya no aplica (un solo `ORDER BY`). Nueva consecuencia sobre la degradación silenciosa de una fila sin marca                                                                                                                                                                                                                                              | 10            |
| `AGENTS.md` § Cosas que muerden                                                  | La frase de I7: ahora nombra las **dos** formas de la guarda (rechazo vs. orden) y apunta a la ADR 0030, en vez de describir solo el mecanismo de rechazo                                                                                                                                                                                                                                                                                                                                                                                | 10            |
| `.agent/playbook/code-ahead-of-shared-db-migration-rompe-db-tests.md` (nuevo)    | Ficha del fallo esperado descrito abajo en § Comandos ejecutados                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | —             |

## Desviaciones respecto al plan

Ninguna de alcance. Dos de detalle, documentadas porque el plan no las
resolvía a ese nivel:

- **El nombre de la migración es `exchange_rate_source_updated_at`, con
  timestamp `20260907123926`** (el que Prisma generó al correr
  `migrate dev --create-only` en el momento real de este ciclo), no el
  `<timestamp>_exchange_rate_source_updated_at` genérico que `plan.md` y
  `architecture.md` usaban como placeholder.
- **El comentario de `getStoreRates`** (paso 5) es más largo que una frase:
  el plan pide explícitamente que diga «de qué depende su frescura» con la
  frase completa (el `storeTag` de la sucursal que la creó, y que F-035
  invalida todas las renderizables del negocio, y que eso deja de ser
  cierto el día que algo escriba `DRAFT` sobre una sucursal renderizable) —
  no un resumen. Se prefirió la longitud a la fidelidad literal a la
  instrucción.

## Comandos ejecutados

- `npx prisma validate` → verde, con los índices GIN declarados y el modelo
  `ExchangeRate` nullable.
- Base de usar y tirar `queandabuscando_f036_impl` (mismo contenedor
  `queandabuscando-postgres`, puerto 5433): `CREATE DATABASE` → `migrate
deploy` de las 14 migraciones existentes (deja la base en el estado
  pre-F036) → `migrate diff --from-config-datasource --to-schema
prisma/schema.prisma --script` → **exactamente tres sentencias**, ningún
  `DROP INDEX` de búsqueda (confirmado, no deducido) → `migrate dev
--create-only --name exchange_rate_source_updated_at` → mismas tres
  sentencias, generadas por Prisma, **cero ediciones a mano** → `migrate
deploy` de esa carpeta → `migrate status` → "Database schema is up to
  date!" → `migrate diff` de nuevo → "This is an empty migration." (sin
  drift) → `SELECT count(*) FROM pg_indexes WHERE indexname IN (los cinco)`
  → `5` (los cinco índices de búsqueda sobreviven, incluido el parcial que
  nunca se declaró) → `npm run seed` dos veces seguidas → mismo `Done: {...}`
  las dos veces, sin filas de `ExchangeRate` duplicadas (`count = 2`,
  `sourceUpdatedAt = 2026-08-01 00:00:00` en las dos) → `DROP DATABASE
queandabuscando_f036_impl`.
- Comprobado después de dropear la base de usar y tirar: la compartida
  `queandabuscando` sigue en `count(*) = 0` sobre
  `information_schema.columns` para `sourceUpdatedAt`, y su
  `count(*) FROM "ExchangeRate")` sigue en `4` (las filas `QAB` ya se
  habían limpiado antes de este ciclo, PD4) — **no se tocó**.
- `npx prisma generate` → cliente regenerado en `src/generated/prisma`.
- `npm run typecheck` → 0.
- `npm run lint` → 0 errores (1 warning preexistente, no tocado por este
  ciclo, en `src/features/account/components/ProfileForm.tsx`).
- `npx prettier --check` sobre todos los archivos propios de este ciclo → 0.
- `npx vitest run --project server --project ui` → **1280/1280** pasan.
- `npx vitest run --project db` → **111/113** pasan; los 2 que fallan son
  `src/features/sync/server/handlers/exchangeRateAllDraft.db.test.ts`
  (de F-035, no tocado por este ciclo), y fallan **exclusivamente** porque
  la base compartida no tiene la columna `sourceUpdatedAt` todavía — el
  mensaje literal de Prisma: `The column "sourceUpdatedAt of relation
ExchangeRate" does not exist in the current database`. No es un bug: es
  la consecuencia directa y esperada de escribir código que asume la
  migración, en una base que se instruyó explícitamente NO migrar. Fichado
  en `.agent/playbook/code-ahead-of-shared-db-migration-rompe-db-tests.md`
  (firma: `does not exist in the current database`).
- `bash .agent/verify.sh F-036` → **código de salida 1** (etapa `test`),
  reconocido por la bitácora en el intento 11 con la ficha de arriba.
  `--only harness` → PASA. `--only prisma` → PASA (`npx prisma validate`,
  que es todo lo que esa etapa comprueba — C9 lo advierte: no valida la
  migración). `bash .agent/verify.sh pending F-036` → sin salida, nada
  pendiente sin fichar.
- `npm run check:harness` → verde (266 documentos, incluida la referencia
  nueva a la ADR 0030 desde `AGENTS.md`).

**No se ejecutó `bash .agent/verify.sh F-036 --full`**: incluye `build`, que
no es parte de mi alcance de verificación para pasos backend puros, y de
todos modos la etapa `test` ya bloquea `--full` por el motivo de arriba.

## Qué queda para `sdd-tester`

- **Pasos 7, 8, 9 y 11 del plan**, sin tocar: el guion ordenado de C5
  (.agent/specs/F-036/migracion-fila-vieja.sh, por crear), el `EXPLAIN` con
  volumen (src/features/catalog/server/rates.db.test.ts, por crear), el
  smoke (.agent/specs/F-036/smoke.sh, por crear) y el cierre (`tests.md`,
  `.agent/progress/F-036.md`).
- **La base compartida `queandabuscando` sigue sin la columna
  `sourceUpdatedAt`, a propósito** (comprobado arriba). Aplicar esa
  migración a la compartida es una decisión del humano, una sola vez y
  anunciada (SP1) — no de `sdd-tester` ni de este agente. Hasta que se
  aplique:
  - `bash .agent/verify.sh F-036` (y `--full`) seguirán fallando en la
    etapa `test`, con la misma firma fichada arriba — es esperado, no una
    regresión de este ciclo.
  - El guion del paso 7 (C5) necesita la migración **generada** (ya está,
    en `prisma/migrations/20260907123926_exchange_rate_source_updated_at/`)
    pero su propio paso 0 exige que la base a la que apunte `.env` **no**
    tenga la columna todavía — así que corre igual de bien contra la
    compartida hoy. Su paso 2 («aplicar la migración») es, en la práctica,
    el momento en que alguien decide aplicarla a la compartida — coordínese
    con el humano antes de correrlo tal cual sobre `queandabuscando`, o
    hágase en su propia base de usar y tirar como el propio guion permite.
  - El paso 8 (rates.db.test.ts, `EXPLAIN` con ~2000 filas) sí necesita la
    migración aplicada a la base contra la que corra
    `npx vitest run --project db` — sea la compartida ya migrada, o una base
    de usar y tirar propia con el mismo procedimiento que usé arriba.
- El `map:` del índice cubridor (`ExchangeRate_current_rate_idx`) y su forma
  de seis columnas están tal cual `architecture.md` AD1 los especificó — no
  se aceptó la alternativa de tres columnas de `AP1` (el plan firmado no la
  reabrió).
- La caché de tasas es una entrada por negocio (PD3), tal cual el humano
  decidió contra la recomendación del arquitecto. El riesgo que PD3 deja
  escrito (una sucursal renderizable que pase a `DRAFT` invalidaría la
  invariante) sigue sin ocurrir en el repo hoy — nada escribe `DRAFT` sobre
  una sucursal ya `PUBLISHED`/`SUSPENDED` — y el comentario de
  `getStoreRates` en `src/features/catalog/server/queries.ts` es el sitio
  donde queda escrito para quien lo rompa primero.
