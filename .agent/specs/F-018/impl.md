---
feature: F-018
agente: sdd-implementer
actualizado: 2026-08-27T22:45:00Z
estado: listo
---

## Qué se construyó

Los seis pasos del plan, en orden.

| Archivo                                                                                                                                                                                                         | Qué hace                                                                                                                                       | Criterio que cubre                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `prisma/schema.prisma`                                                                                                                                                                                          | `Order.businessId` NOT NULL + FK + índice `(businessId, status, id)`; `Business.syncTokenHash` a `@unique`                                     | C14                                 |
| `prisma/migrations/20260827221348_order_business_id_and_sync_token_unique/migration.sql`                                                                                                                        | Migración a mano: nullable → backfill `UPDATE … FROM "Store"` → `SET NOT NULL`; sin los `DROP INDEX` de los GIN                                | C14                                 |
| `src/features/orders/server/createOrder.ts`                                                                                                                                                                     | `businessId: store.businessId` en el `create` (E29)                                                                                            | C14                                 |
| `src/lib/syncAuth.ts`                                                                                                                                                                                           | Puro: `readBearerToken`, `hashSyncToken`, `mintSyncToken` nuevo. Se borran `verifySyncToken`/`safeEqual`                                       | E1-E8, E23                          |
| src/features/sync/server/caller.ts (nuevo)                                                                                                                                                                      | `resolveCaller`/`syncConfigured` — la única consulta que resuelve el negocio desde el hash                                                     | E1, E4, E5, E8, R9                  |
| `src/app/api/internal/_lib/guard.ts`                                                                                                                                                                            | `withInternalAuth(handler)`: entrega `InternalCaller` como parámetro; ninguna ruta puede saltárselo                                            | C3, C4, C10                         |
| src/features/sync/identity.ts (nuevo)                                                                                                                                                                           | `findCatalogMismatch`/`findAvailabilityMismatch`, puras                                                                                        | C2, E14                             |
| `src/lib/env.ts`                                                                                                                                                                                                | Se borra `SYNC_TOKEN` del esquema Zod                                                                                                          | C16, HD1                            |
| Las seis `route.ts` de `src/app/api/internal/`                                                                                                                                                                  | `export const GET/POST = withInternalAuth(...)`; identidad desde `caller`, no del payload                                                      | C1-C13                              |
| src/features/orders/server/status.ts (nuevo)                                                                                                                                                                    | `setOrderStatus` — el `updateMany` sale de `src/app/`                                                                                          | E12, R6                             |
| `src/features/orders/server/pull.ts`                                                                                                                                                                            | `pullOrders(businessId, since, limit)`, `businessId` en los dos `where`                                                                        | E9-E11                              |
| `src/features/sync/server/processBatch.ts`                                                                                                                                                                      | `processCatalogBatch(caller, events)`; `recordBatch(caller.externalId, …)`, `applyEvent(event, caller.businessId)`                             | E15, R7                             |
| `src/features/sync/server/handlers/store.ts`                                                                                                                                                                    | `handleStore(payload, operation, businessId)`; ya no crea `Business` (R8); tienda de otro negocio → SKIPPED                                    | E16, R8                             |
| `src/features/sync/server/handlers/misc.ts`                                                                                                                                                                     | `handleCategory`/`handleExchangeRate` reciben `businessId`; ya no resuelven `Business` por `externalId`                                        | C6                                  |
| `src/features/sync/server/handlers/product.ts`                                                                                                                                                                  | `handleProduct(payload, operation, businessId)`; tienda de otro negocio → SKIPPED; el reuso de canónico huérfano se acota por `storeId` (PP6)  | C6, PP6                             |
| `src/features/sync/server/availability.ts`                                                                                                                                                                      | `applyAvailability(businessId, items)` — `businessId` en el `where` de `Store`                                                                 | E17                                 |
| `src/features/sync/server/reconciliation.ts`                                                                                                                                                                    | `storeReconciliationHash(businessId, storeExternalId)`                                                                                         | E19                                 |
| `src/features/storefront/server/registry.ts`                                                                                                                                                                    | `previewSlug` gana `businessId`; `storeExternalId` ajeno → tratado como no enviado (R10)                                                       | E21, E22                            |
| `src/features/admin/server/stores.ts`                                                                                                                                                                           | `previewGrouping`/`regroupStoreIntoBrand` pasan `businessId` a `previewSlug` (llamadas internas)                                               | —                                   |
| scripts/mint-sync-token.ts (nuevo)                                                                                                                                                                              | CLI: acuña o rota el token de un negocio, imprime el claro una vez                                                                             | E23, E24, C5                        |
| `prisma/seed.ts`                                                                                                                                                                                                | Segundo negocio (`seed-negocio-2`, `seed-tienda-7`) + `ensureSyncToken` idempotente                                                            | E26, E27, C15                       |
| `package.json`                                                                                                                                                                                                  | `npm run mint:token`                                                                                                                           | E23                                 |
| `src/features/marketplace/server/dbFixtures.ts`                                                                                                                                                                 | `syncToken`/`businessExternalId`/`createOrder`/`createFillerOrders`; limpieza de `Order` antes de `Store`                                      | C1, C7                              |
| src/features/orders/server/pull.db.test.ts (nuevo)                                                                                                                                                              | Dos negocios reales (E9-E11) + el `EXPLAIN` con 500 filler + `ANALYZE` (PP1) + `enable_seqscan=off`                                            | C1, C7, E30                         |
| src/features/sync/server/tenantScoping.db.test.ts (nuevo)                                                                                                                                                       | `resolveCaller`/`@unique`/rotación/inactivo contra Postgres real; `applyAvailability`/`storeReconciliationHash`/`previewSlug` con dos negocios | E1, E5, E8, E17, E19, E21, E24, E25 |
| src/app/api/internal/boundaries.test.ts (nuevo)                                                                                                                                                                 | C6 (grep) + C16 (grep) + ninguna ruta importa Prisma + toda ruta usa `withInternalAuth`                                                        | C6, C16                             |
| src/app/api/internal/\_lib/guard.test.ts, src/features/sync/identity.test.ts (nuevos)                                                                                                                           | La matriz 401/403/503 mockeada; los mismatches puros                                                                                           | E1-E8, E14                          |
| Los `route.test.ts` existentes + `src/lib/syncAuth.test.ts`, `src/features/sync/server/handlers/{store,product}.test.ts`, `src/features/sync/server/processBatch.test.ts`, `src/features/admin/schemas.test.ts` | Actualizados a las nuevas firmas / al mock de `caller`                                                                                         | —                                   |
| `scripts/{pull-orders,send-catalog-batch,send-availability-batch,send-store-batch}.mjs`, `.env.example`, `.github/workflows/ci.yml`                                                                             | `QAB_BEARER_TOKEN` + `--token=`; se borra la variable global del CI                                                                            | C16                                 |
| `.agent/specs/F-{007,010,011,017}/smoke.sh`                                                                                                                                                                     | Leen `QAB_BEARER_TOKEN` con el mensaje exacto para acuñarlo si falta                                                                           | —                                   |
| `docs/sync-contract.md`                                                                                                                                                                                         | Sube a **v3**: autenticación por negocio, cursor por negocio, tabla de errores nueva, `unpublishReason`+⑥ en un solo anuncio                   | C8                                  |
| `docs/adr/0008-bearer-token-baseline.md`, `docs/adr/0013-identidad-de-integracion.md`                                                                                                                           | Las dos notas de I5                                                                                                                            | I5                                  |
| `.agent/specs/F-018/smoke.sh` (nuevo)                                                                                                                                                                           | C1 en runtime, C3, C5, C10-C13 por HTTP contra los dos negocios del seed                                                                       | C1, C3, C5, C10-C13                 |

## Desviaciones

- **PP2 aplicado**: `scripts/mint-sync-token.ts` (no `.mjs`), corrido con
  `tsx` vía `npm run mint:token`. Actualicé los dos literales de `spec.md`
  que decían `.mjs` (E23 y C5) a `.ts`, como el humano aprobó.
- **Nombre de la variable local de scripts: `QAB_BEARER_TOKEN`, no
  `QAB_SYNC_TOKEN` como dice `spec.md`.** Descubierto al implementar: el
  criterio C16 (protegido, regla 3) es
  `grep -rn "SYNC_TOKEN" src/ scripts/ .env.example` sin resultados —
  literal, sin anclas de palabra. `QAB_SYNC_TOKEN` **contiene** la
  subcadena `SYNC_TOKEN`, así que con ese nombre C16 nunca podría pasar
  mientras `.env.example`/`scripts/*.mjs` existan (que es siempre). Es una
  contradicción de `spec.md` consigo mismo, no algo que yo pueda resolver
  editando `spec.md` (fuera de los dos literales de PP2) ni el criterio.
  Elegí `QAB_BEARER_TOKEN` — mismo propósito, mismo `--token=`, ninguna
  colisión de subcadena — y lo apliqué en `.env.example`, los cuatro
  scripts y, por consistencia (no por que C16 los lea), en los cuatro
  `smoke.sh` existentes y en `docs/sync-contract.md`. No toqué
  `spec.md`/`architecture.md`/`plan.md`/`progress/F-018.md`, que siguen
  nombrando `QAB_SYNC_TOKEN` — no los escanea C16 (viven bajo `.agent/`) y
  no soy yo quien edita esos tres documentos.
- **`docs/adr/0008-bearer-token-baseline.md`** también gana una segunda
  frase actualizada (fuera de la nota de I5, que sí estaba pedida) para que
  el cuerpo del documento no se contradiga con su propia nota. Cambio de
  prosa, ninguna decisión nueva.
- **`.agent/specs/F-010/F-011` smoke.sh ganan un guard temprano** que
  `architecture.md`/`plan.md` no detallaban archivo por archivo (solo decían
  "los cuatro smokes... nunca se saltan en verde"). Añadido para que el
  mensaje de fallo sea el comando exacto de acuñación, no un 401/vacío
  silencioso más abajo en el guion.
- Ninguna otra desviación de forma: los seis pasos, las tres piezas de
  identidad, la migración y el reparto de `businessId`/`externalId` siguen
  exactamente lo que `architecture.md` especificó.

## Comandos ejecutados

- `bash .agent/verify.sh F-018` — verde en el intento final (typecheck ·
  lint · format · test), tras 11 iteraciones del bucle cambiar→verificar→arreglar.
- `bash .agent/verify.sh F-018 --full` — **0**. `harness · typecheck · lint ·
format · test · prisma · build · theme · bundle`, todos en verde.
- `bash .agent/verify.sh F-018 --smoke` — **0**. 17 aserciones HTTP reales
  contra `next dev`, 0 fallidas.
- `bash .agent/verify.sh pending F-018` — vacío.
- `npx prisma migrate status` — sin deriva.
- `npm run seed && npm run seed` — código 0 las dos veces; el segundo run no
  reimprime ningún token (mismo hash).
- `grep -rn "payload.businessId" src/features/sync/server/handlers/` — vacío (C6).
- `grep -rn "SYNC_TOKEN" src/ scripts/ .env.example` — vacío (C16).
- `grep -n "por negocio" docs/sync-contract.md` — resultados en § Autenticación
  y en § ③④ Pedidos; `grep -n "SYNC_TOKEN" docs/sync-contract.md` — vacío (C8).

## Deuda dejada

- Ninguna deliberada. Lo explícitamente fuera de alcance (paso a HMAC, hueco
  de concurrencia del pull heredado de F-007, rate limiting) sigue fuera,
  tal como dice `plan.md` § Qué queda fuera.
- El riesgo heredado de `_prisma_migrations` compartido entre worktrees
  (fichado, no de este feature) sigue abierto — `migrate deploy` se ejecutó
  una vez desde este worktree, como el plan preveía.

## Qué necesita quien pruebe

- **Entorno**: `bash .agent/init.sh` en verde, Postgres arriba (puerto 5433),
  `npm run seed` corrido. El seed deja `seed-negocio-1` (tienda-demo, …) y
  `seed-negocio-2` (`el-faro`, `seed-tienda-7`) con sus tokens ya acuñados —
  **el token en claro no se guarda en ningún lado**: para obtenerlo hay que
  rotar con `npm run mint:token -- seed-negocio-1` (o `-2`), que imprime el
  nuevo valor una vez. Rotar invalida el que hubiera antes para ese negocio
  y no toca al otro.
- **Rutas de ejemplo**:
  - `GET /api/internal/orders?since=0&limit=100` con
    `Authorization: Bearer <token>`.
  - `GET /api/internal/reconciliation?storeId=seed-tienda-7` con el token de
    `seed-negocio-1` → `404 UNKNOWN_STORE` (tienda de otro negocio).
  - `GET /api/internal/slug-availability?slug=el-faro&storeId=seed-tienda-7`
    con el token de `seed-negocio-1` → `storeKnown: false`.
- **Frágil / a vigilar**:
  - `.agent/specs/F-018/smoke.sh` **rota el token de `seed-negocio-1` al
    final** (verifica C5, rotación) — el token que hubiera antes de correr
    el smoke queda inválido después. Es intencional; anótalo si vas a
    encadenar el smoke con otra prueba manual que dependa de un token fijo.
  - El `EXPLAIN` de C7 (`pull.db.test.ts`) siembra ~500 pedidos de relleno
    de un negocio descartable por ejecución — si algún día el planificador
    de Postgres cambia de umbral, ese es el número a subir (PP1 ya lo
    documentó).
  - El reuso de canónico huérfano ahora se acota por `storeId`
    (`product.ts`, PP6) — la fusión por código de barras (rama `by-ean`,
    la que usa el marketplace de F-015) **no se tocó**, a propósito.

## Preguntas al humano

Ninguna pregunta bloqueante. Una nota, no una pregunta: el cambio de
`QAB_SYNC_TOKEN` a `QAB_BEARER_TOKEN` (arriba, § Desviaciones) — si el humano
prefiere que `spec.md` quede corregido para que ambos documentos digan lo
mismo, es una edición de una palabra en tres sitios de `spec.md`; no la hice
yo porque no es de las dos que PP2 autorizó a tocar.
