---
feature: F-038
agente: sdd-implementer
actualizado: 2026-09-08T02:00:00Z
estado: listo
---

## Qué se construyó

Pasos 1-9 y 11-13 del plan firmado, en ese orden (AD8). El paso 10
(`business.db.test.ts`) es de `sdd-tester` y no se escribió aquí.

| Archivo                                                                      | Qué hace                                                                                                                                                                                   | Criterio que cubre             |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `src/constants/sync.ts`                                                      | Las dos constantes de error de la v12: `BUSINESS_DISPLAY_CURRENCIES_INVALID`, `BUSINESS_DELETE_NOT_SUPPORTED`                                                                              | 3, 4                           |
| `src/features/sync/displayCurrencies.ts`                                     | `findInvalidDisplayCurrency` (R3, `/^[A-Z]{3}$/`) y `dedupeDisplayCurrencies` (R4, `[...new Set(...)]`)                                                                                    | 3, 6                           |
| `src/features/sync/displayCurrencies.test.ts`                                | Parametrizado sobre R3/R4, incluidos 40 códigos                                                                                                                                            | 3, 6, 10                       |
| `prisma/schema.prisma`                                                       | `SyncEntity` gana `BUSINESS`; `Business` gana `displayCurrencies String[] @default([])` y `displayCurrenciesSourceUpdatedAt DateTime?`                                                     | 1, 5                           |
| `prisma/migrations/20260908013319_business_display_currencies/migration.sql` | La migración medida por architecture.md, sin `DROP INDEX` (lista vacía, confirmado)                                                                                                        | 1, 5                           |
| `src/features/sync/schemas.ts`                                               | `businessPayloadSchema` laxo (`z.array(z.string())`) y la sexta rama de `syncEventSchema`                                                                                                  | 1, 2                           |
| `src/features/sync/schemas.test.ts`                                          | La frontera R2: `ZONE_TARIFF` sigue matando el lote; `["usd"]`/`["US1"]`/40 códigos PASAN en el sobre; falta `displayCurrencies`/`businessId`, tipo incorrecto y `updatedAt` no ISO fallan | 1, 2, 10                       |
| `src/features/sync/dependencies.ts`                                          | `case "BUSINESS": { provides: null, requires: null }`                                                                                                                                      | 2 (vía typecheck, AD8 sitio 1) |
| `src/features/sync/dependencies.test.ts`                                     | `BUSINESS` no provee ni requiere nada; entra en el bucle "no entity plays both roles"                                                                                                      | —                              |
| `src/features/sync/server/handlers/business.ts`                              | El handler: DELETE → miembro inválido → guarda `>=` → `updateMany` condicional, sin `$transaction`                                                                                         | 1, 3, 4, 5, 6, 7, 8            |
| `src/features/sync/server/handlers/business.test.ts`                         | Orden de R5 con Prisma mockeado; `count:0`→STALE, `count:1`→PROCESSED pelado; `where` por `businessId`; nunca toca `Currency`/`ExchangeRate`                                               | 1, 3, 4, 5, 6, 7, 8            |
| `src/features/sync/server/processBatch.ts`                                   | La rama `case "BUSINESS"` de `applyEvent`                                                                                                                                                  | 1                              |
| `src/features/sync/server/processBatch.test.ts`                              | Mock de `./handlers/business` (AD6(3)); enrutado exacto; E14 en las dos direcciones                                                                                                        | 1                              |
| `src/features/sync/identity.test.ts`                                         | E11/C9 mitad unitaria: `findCatalogMismatch` ya funciona con `BUSINESS`, sin tocar `identity.ts`                                                                                           | 9                              |
| `scripts/send-catalog-batch.mjs`                                             | `--business[=caso]` con seis presets (`ok`, `invalid`, `delete`, `empty`, `dup`, `forty`)                                                                                                  | 12                             |
| `.agent/specs/F-038/smoke.sh`                                                | Los seis comandos de C12 en el orden de R22, el borrado acotado a dos ids antes del par `--repeat`, el control + normalización de C11(b)                                                   | 11, 12                         |
| `docs/sync-contract.md`                                                      | v12.2: cabecera, nueva § «Cambios respecto a la v12.1», § «Cambios requeridos en cuadrecaja» punto 1, § Verificación (+ 6 líneas `--business`)                                             | 13                             |
| `docs/despliegue.md`                                                         | § 8.3: versión vigente a v12.2 y el párrafo del aviso fechado como paso ya hecho                                                                                                           | 13                             |
| `.agent/solicitudes.md`                                                      | Línea fechada 2026-09-08 en S-008 de § Cerradas, añadida sin sustituir el registro del 2026-09-06                                                                                          | 13                             |
| `AGENTS.md`                                                                  | § Cosas que muerden: la familia rechaza-y-STALE pasa de tres a cuatro entidades (`BUSINESS` incluida)                                                                                      | 13                             |

## Migración: lo que se ejecutó, en orden

1. `npx prisma migrate dev --create-only --name business_display_currencies` —
   generó `prisma/migrations/20260908013319_business_display_currencies/migration.sql`,
   **byte a byte** el SQL que architecture.md ya había medido: `ALTER TYPE
"SyncEntity" ADD VALUE 'BUSINESS'` + `ALTER TABLE "Business" ADD COLUMN
"displayCurrencies" TEXT[] DEFAULT ARRAY[]::TEXT[], ADD COLUMN
"displayCurrenciesSourceUpdatedAt" TIMESTAMP(3)`. Revisado a mano: **cero**
   líneas `DROP INDEX` (confirmado el defecto que architecture.md midió).
2. `npx prisma generate`.
3. Validado en `f038_check` (creada con `docker exec ... CREATE DATABASE`,
   `migrate deploy` de las 16 migraciones, `migrate diff
--from-config-datasource --to-schema prisma/schema.prisma --script` →
   `"-- This is an empty migration."`, y `DROP DATABASE` al terminar).
4. Aplicada a la compartida `queandabuscando` con `npx prisma migrate deploy`
   (nunca `npm run db:migrate`). `migrate status` → «Database schema is up to
   date!»; `migrate diff` contra ella, después de aplicar → vacío.

No se ejecutó `prisma migrate reset` ni `prisma db push` en ningún momento.

## Desviaciones

Ninguna del plan firmado. Dos decisiones de implementación que el plan dejaba
abiertas («del implementador», spec.md § No decidido a propósito):

- **Cómo se dedupe**: `[...new Set(codes)]`, tal como architecture.md AD4 ya
  fijaba (no era una decisión mía, pero lo anoto porque spec.md la dejaba
  abierta antes del diseño).
- **El `--repeat` del guion de humo compone con `--unknown-store`** para que
  el borrado de AD7(2) sea acotado a EXACTAMENTE dos filas de `SyncEvent`
  (`evt-product-fixed`, `evt-business-fixed`) y nunca tres — sin
  `--unknown-store` el guion también manda un `STORE` con el mismo suffix
  fijo, y el borrado tendría que acotarse a tres ids en vez de dos. No es una
  desviación del plan (que no especifica los argumentos exactos del comando
  del par `--repeat`, solo que exista y se limpie), pero lo dejo explícito
  porque `AP3`/el humano aprobó "sus dos filas" en singular, y esta es la
  forma exacta que hace eso literalmente cierto.

Una lección nueva, fichada y ya no pendiente
(`bash .agent/verify.sh pending F-038` vacío):

- `.agent/playbook/smoke-diff-html-rsc-no-determinista.md` — dos peticiones
  seguidas de `/tienda-demo` bajo `next dev` no son byte a byte idénticas
  (RSC reordena ids internos por petición); la normalización correcta es
  quitar TODOS los `<script>…</script>` de las dos mitades antes de
  comparar, no solo el primer token que se vea diferir. El control de
  AD7(3) lo detectó como se esperaba; la ficha documenta la normalización que
  de verdad funciona (medida con `difflib` carácter a carácter).

## Comandos ejecutados

- `bash .agent/verify.sh F-038 --full` → `PASA`, todas en verde: harness · typecheck · lint · format · test · prisma · build · theme · bundle
- `bash .agent/verify.sh F-038 --smoke` → **0** (los seis comandos de C12 y el
  control + escenario de C11(b), todos ✓).
- `bash .agent/verify.sh pending F-038` → vacío.
- `npm test` (dentro de `--full`): 1473+ pruebas, ninguna roja, incluido el
  proyecto `db` ya migrado.
- `npx prisma migrate status` sobre la compartida → «Database schema is up to
  date!» (16 migraciones).

## Deuda dejada

Ninguna nueva. La deuda con nombre de I7/D4 (F-039 tiene que traer su propia
invalidación de caché cuando exista el lector) sigue siendo de spec.md/D4, no
de este ciclo: este feature deliberadamente no invalida nada.

## Qué necesita quien pruebe

- El proyecto `db` de la suite ya corre contra la migración aplicada: no hace
  falta ninguna acción adicional antes de escribir
  `business.db.test.ts` (paso 10). El error «does not exist in the current
  database» de la ficha `code-ahead-of-shared-db-migration-rompe-db-tests`
  **no debería aparecer**; si aparece, es un bug de verdad (la migración ya
  está aplicada).
- Códigos de moneda sintéticos ya quemados en `*.db.test.ts`/guiones de este
  repo (para elegir uno libre en C7): `CUP`, `USD`, `MLC` (seed), `EUR`,
  `ABC`, `XYZ`, `AAA`, `BBB`, `CCC`, `DDD`, `WVX`, `QAB`, `ZZZ`, `FQV`, `KZR`,
  `MXR`. Los 40 códigos de C10 se generan `AAA`, `AAB`, … — `AAA` ya está
  quemado pero es inofensivo porque este handler no escribe en `Currency`.
- `handleBusiness` está en `src/features/sync/server/handlers/business.ts`,
  firma `(payload: BusinessPayload, operation, businessId: string):
Promise<HandlerOutcome>` — idéntica a `handleStore`/`handleProduct`.
- El guion de humo `.agent/specs/F-038/smoke.sh` corre con
  `bash .agent/verify.sh F-038 --smoke`; deja `seed-negocio-1` con
  `displayCurrencies: ["CUP","USD","MLC"]` (residuo veraz, AD7(4)).

## Preguntas al humano

Ninguna. El plan firmado no dejó ningún hueco que requiriera decisión nueva;
las dos preguntas de spec.md (SP1/SP2) ya venían resueltas por D4/D5 y se
implementaron sobre su defecto sin desviación.
