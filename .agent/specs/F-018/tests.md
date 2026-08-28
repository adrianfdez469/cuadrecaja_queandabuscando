---
feature: F-018
agente: sdd-tester
actualizado: 2026-08-27T23:14:38Z
estado: listo
veredicto: listo
---

## Estrategia

F-018 es seguridad multi-tenant: «leer el código y concluir que funciona» no
cuenta. Cada uno de los 16 criterios de `.agent/features.json` se verificó
**ejecutando algo** — un test contra Postgres real con dos negocios sembrados
de verdad, una petición HTTP con dos tokens acuñados de verdad, o un `grep`
ejecutado a mano — y, para los cuatro que el propio orquestador señaló con
desconfianza (C1/C11/C12/C13, C2, C7, C14/C16), además **las dos direcciones**:
que A no ve lo de B **y** que A sí ve lo suyo, para que una implementación que
devolviera todo vacío no pasara por casualidad.

Niveles, por `AGENTS.md` § Cosas que muerden («los tests de servidor corren en
el proyecto `node`, no en jsdom» — aquí no aplica jsdom, todo es `*.test.ts`):

- **`server` (mock)**: la matriz 401/403/503 del guard (`@/features/sync/server/caller`
  mockeado, nunca Prisma) y las rutas que solo necesitan comprobar qué función
  downstream se llama con qué argumentos.
- **`db` (Postgres real)**: todo lo que exige dos inquilinos de verdad —
  `pull.db.test.ts`, `tenantScoping.db.test.ts` — con `createFixtureSession()`
  de `src/features/marketplace/server/dbFixtures.ts`, aislado por sesión, nunca
  tocando el seed compartido.
- **`smoke` (HTTP real)**: `.agent/specs/F-018/smoke.sh` contra `next dev` y los
  dos negocios del seed, con tokens acuñados en el momento.
- **Manual, con la app en pie y `docker exec` contra el Postgres compartido**:
  lo que ni el proyecto `db` ni el smoke cubren — la escritura (o no-escritura)
  en `SyncEvent` tras un 403, el estado de un pedido ajeno tras un intento de
  cancelación cruzada, el backfill de la migración, la idempotencia del seed.
  Documentado abajo con el comando exacto y su salida.

## Mapa criterio → prueba

| #   | Criterio (`.agent/features.json`, literal)                                                                                                                                                                                                            | Prueba                                                                                                                                                                                                                                                                                        | Archivo / comando                                                                                                                                                        | Resultado |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 1   | «Con el token del negocio A, GET /api/internal/orders no devuelve ningun pedido cuya tienda pertenezca a B, verificado con dos negocios sembrados.»                                                                                                   | Dos negocios reales (fixtures), ambas direcciones: A no ve el filler de B, y A sí ve los suyos (no vacío)                                                                                                                                                                                     | `src/features/orders/server/pull.db.test.ts` (`npx vitest run` → 5/5) + `.agent/specs/F-018/smoke.sh` vía `verify.sh F-018 --smoke`                                      | **LISTO** |
| 2   | «POST /api/internal/sync/catalog con token de A y businessId de B en el payload responde 403 y no escribe nada.»                                                                                                                                      | HTTP real + `SELECT count(*) FROM "SyncEvent"` antes/después + reintento con el `businessId` correcto para probar que NO quedó fila (si hubiera quedado, el reintento habría reportado `duplicate`, no `processed`)                                                                           | Manual (comandos abajo) + `src/app/api/internal/sync/catalog/route.test.ts` (nuevo, mockeado: `processCatalogBatch` nunca se llama)                                      | **LISTO** |
| 3   | «Un token que no corresponde a ningun negocio responde 401.»                                                                                                                                                                                          | `guard.test.ts` E4 (mock) + smoke con un token aleatorio de 48 caracteres                                                                                                                                                                                                                     | `src/app/api/internal/_lib/guard.test.ts` + smoke.sh (`C3`)                                                                                                              | **LISTO** |
| 4   | «Sin SYNC_TOKEN ni ningun hash configurado responde 503, nunca 200.»                                                                                                                                                                                  | La mitad «sin `SYNC_TOKEN`» es cierta por construcción (grep vacío, C16); la mitad «ningún hash» se prueba con mock — nulear TODOS los hashes en la base compartida está prohibido (regla del feature)                                                                                        | `guard.test.ts` E6/E7 (PP3) + `grep -rn "SYNC_TOKEN" src/ scripts/ .env.example` (vacío, ejecutado a mano)                                                               | **LISTO** |
| 5   | «Rotar el token del negocio A no afecta al sync del negocio B.»                                                                                                                                                                                       | Real: `tenantScoping.db.test.ts` E24/E25 + smoke C5 (rota A por HTTP, viejo→401, nuevo→200, B intacto) + repetido a mano con `npm run mint:token`                                                                                                                                             | `src/features/sync/server/tenantScoping.db.test.ts` + smoke.sh (`C5`)                                                                                                    | **LISTO** |
| 6   | «`grep -n "payload.businessId" src/features/sync/server/handlers/` no aparece como origen de identidad en ningun where de resolucion de negocio.»                                                                                                     | Ejecutado a mano con `-rn` (I2 de spec.md)                                                                                                                                                                                                                                                    | `grep -rn "payload.businessId" src/features/sync/server/handlers/` → vacío, código 1 + `src/app/api/internal/boundaries.test.ts` (automatizado en cada `npm test`)       | **LISTO** |
| 7   | «EXPLAIN de la consulta del pull usa el indice (businessId, status, id).»                                                                                                                                                                             | 500 pedidos de relleno + `ANALYZE` + `enable_seqscan=off` (PP1); **comprobado que el aserto NO es vacío**: con el índice `DROP`eado dentro de una transacción que se revierte, el mismo `EXPLAIN` deja de nombrarlo                                                                           | `src/features/orders/server/pull.db.test.ts` (`npx vitest run` → 5/5) + verificación manual del `DROP`/`ROLLBACK` (abajo)                                                | **LISTO** |
| 8   | «El cursor por negocio esta documentado en docs/sync-contract.md, en Autenticacion y en la seccion de Pedidos.»                                                                                                                                       | `grep` a mano                                                                                                                                                                                                                                                                                 | `grep -n "por negocio" docs/sync-contract.md` → línea 56 (§ Autenticación) y línea 461 (§ ③④ Pedidos); `grep -n "SYNC_TOKEN" docs/sync-contract.md` → vacío              | **LISTO** |
| 9   | «`bash .agent/verify.sh F-018 --full` termina con codigo 0.»                                                                                                                                                                                          | Ejecutado tres veces en este ciclo (antes y después de añadir pruebas nuevas)                                                                                                                                                                                                                 | `bash .agent/verify.sh F-018 --full` → **0** las tres veces, última con las nueve etapas (harness, typecheck, lint, format, test, prisma, build, theme, bundle) en verde | **LISTO** |
| 10  | «Un token valido de un Business con active: false responde 403 en las seis rutas de /api/internal/*, nunca 401 ni 200.»                                                                                                                               | `guard.test.ts` E5 (mock, prueba la propiedad UNA vez para el envoltorio que las seis rutas comparten) + `boundaries.test.ts` (prueba que las seis usan ese envoltorio) + **verificación manual directa contra las seis rutas reales**, con `active=false` puesto y quitado por `docker exec` | Manual (comandos abajo): las seis responden `403 BUSINESS_INACTIVE`; restaurado, las seis vuelven a 200/lo que corresponda                                               | **LISTO** |
| 11  | «GET /api/internal/reconciliation?storeId=<tienda de B> con el token de A responde 404, identico a un storeId inexistente.»                                                                                                                           | Real, ambas direcciones: ajena → `null`/404, propia → hash no nulo/200                                                                                                                                                                                                                        | `tenantScoping.db.test.ts` (E19) + smoke.sh (`C11`, ambas direcciones)                                                                                                   | **LISTO** |
| 12  | «POST /api/internal/sync/availability con el token de A y un item de una tienda de B responde 200 sin ese item en 'confirmed' y sin cambiar la disponibilidad de B.»                                                                                  | Real, ambas direcciones: ajena → `applied:0`, `confirmed:[]`, disponibilidad de B sin tocar; propia → `applied:1`, `confirmed` la incluye (verificado a mano, con restauración del valor original)                                                                                            | `tenantScoping.db.test.ts` (E17) + smoke.sh (`C12`) + `src/app/api/internal/sync/availability/route.test.ts` (nuevo) + manual (abajo)                                    | **LISTO** |
| 13  | «GET /api/internal/slug-availability?storeId=<tienda de B> con el token de A responde storeKnown: false y reason distinto de 'own'.»                                                                                                                  | Real, ambas direcciones: ajena → `storeKnown:false`/`reason≠"own"`; propia → `storeKnown:true`                                                                                                                                                                                                | `tenantScoping.db.test.ts` (E21) + smoke.sh (`C13`)                                                                                                                      | **LISTO** |
| 14  | «Tras aplicar la migracion sobre la base local con pedidos reales, `SELECT count(*) FROM "Order" WHERE "businessId" IS NULL` devuelve 0 y `npx prisma migrate status` no reporta deriva, sin haber ejecutado ninguno de los dos comandos prohibidos.» | Ejecutado a mano contra la base real; además confirmados vivos los dos índices GIN del marketplace (F-015) que la migración podría haberse llevado                                                                                                                                            | Manual (comandos abajo)                                                                                                                                                  | **LISTO** |
| 15  | «`npm run seed` dos veces seguidas deja el mismo syncTokenHash en los dos negocios sembrados y termina con codigo 0 las dos veces.»                                                                                                                   | Ejecutado dos veces seguidas de verdad, hash leído de la base antes/después de cada corrida                                                                                                                                                                                                   | Manual (comandos abajo)                                                                                                                                                  | **LISTO** |
| 16  | «`grep -rn "SYNC_TOKEN" src/ scripts/ .env.example` no devuelve nada.»                                                                                                                                                                                | Ejecutado a mano                                                                                                                                                                                                                                                                              | `grep -rn "SYNC_TOKEN" src/ scripts/ .env.example` → vacío, código 1 + `boundaries.test.ts` (automatizado)                                                               | **LISTO** |

**16/16 LISTO.** Ningún criterio sin cubrir.

## Ejecuciones

### El sensor

```
$ bash .agent/verify.sh F-018 --full
== Verificación F-018 · intento 32 ==
  ✓ harness    1s
  ✓ typecheck  1s
  ✓ lint       3s
  ✓ format     4s
  ✓ test       3s
  ✓ prisma     1s
  ✓ build      4s
  ✓ theme      0s
  ✓ bundle     0s
PASA
```

Corrido 3 veces en este ciclo (antes y después de añadir los dos
`route.test.ts` nuevos); las tres en 0. `npm test` solo: **58 archivos, 525
pruebas** (56/510 al empezar este ciclo — subió con las dos pruebas de ruta que
faltaban, ver «Huecos de cobertura»).

```
$ QAB_BEARER_TOKEN=<token de seed-negocio-1> bash .agent/verify.sh F-018 --smoke
== Verificación F-018 · intento 33 ==
  ✓ typecheck  1s
  ✓ lint       3s
  ✓ format     3s
  ✓ test       4s
  ✓ smoke      4s
PASA
```

Salida completa en `.agent/runs/F-018/033-smoke.log`: 17 aserciones HTTP reales
(C1, C3, C5, C10–C13), **0 fallidas**, con la salida del servidor pegada al
final (ninguna traza de error).

```
$ bash .agent/verify.sh pending F-018
(vacío)
```

### Regresión sobre lo que F-018 tocó

Instruido explícitamente: correr los smokes de F-005/F-007/F-010/F-011/F-017
(F-005/F-006 no tienen `.agent/specs/<ID>/smoke.sh` propio — su cobertura vive
en `npm test`, ya verde arriba).

```
$ unset QAB_BEARER_TOKEN; bash .agent/specs/F-007/smoke.sh   # (vía verify.sh)
SMOKE FAIL QAB_BEARER_TOKEN no está configurado — acúñalo con: npm run mint:token -- seed-negocio-1
exit 1
```

Correcto: falla **ruidosamente** con el comando exacto de acuñación, nunca se
salta en verde (lo mismo repetido y confirmado para F-010, F-011, F-017 —
los cuatro fallan con el mismo mensaje sin la variable). Con el token puesto:

```
$ QAB_BEARER_TOKEN=<token A> bash .agent/verify.sh F-011 --smoke  → PASA (0)
$ QAB_BEARER_TOKEN=<token A> bash .agent/verify.sh F-017 --smoke  → PASA (0)
```

F-007 y F-010, con el token puesto, fallan por **dos bugs reales pero
preexistentes**, no causados por F-018 (detalle en «Fallos encontrados»):
`scripts/pull-orders.mjs` consulta `Store.slug` directo, columna que la
migración de F-017 dejó en `NULL` para `tienda-demo`; y `.agent/specs/F-010/smoke.sh`
asume que `since=0&limit=1` devuelve «el último pedido creado», que se rompe en
una base compartida que lleva miles de pedidos acumulados. Ninguno de los dos
lo tocó el código de F-018 (confirmado con `git diff` — F-018 solo cambió la
variable del token en esos scripts). Fichados en `.agent/playbook/`
(`pull-orders-mjs-store-slug-nulo-tras-f017.md`,
`smoke-asume-since-0-devuelve-el-ultimo-pedido.md`); `bash .agent/verify.sh
pending F-007` y `pending F-010` quedan vacíos porque las fichas los
reconocen.

### C2 — el 403 ocurre antes de escribir nada (manual, HTTP + DB)

```
$ docker exec -i queandabuscando-postgres psql -U postgres -d queandabuscando \
    -Atc 'SELECT count(*) FROM "SyncEvent"'
3

$ curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST http://localhost:3102/api/internal/sync/catalog \
    -H "authorization: Bearer <token A>" -H 'content-type: application/json' \
    -d '{"businessId":"seed-negocio-2","events":[{"eventId":"test-c2-mismatch-…", …}]}'
{"error":"BUSINESS_MISMATCH"}
HTTP_CODE:403

$ docker exec -i queandabuscando-postgres psql … -Atc 'SELECT count(*) FROM "SyncEvent"'
3   ← sin cambio
```

Y la trampa de `AGENTS.md` § «Un evento fallido NO es un duplicado» — probada
retirando el mismo `eventId` con el `businessId` correcto:

```
1er intento (businessId de B, token de A) → 403 BUSINESS_MISMATCH
2º intento  (mismo eventId, businessId de A, token de A) →
  {"ok":["test-c2-retry-…"],"failed":[],"results":[{"eventId":"…","status":"processed"}]}
```

`"processed"`, no `"duplicate"`: ninguna fila sobrevivió al 403, así que el
reintento se procesó de verdad. Si el guard hubiera escrito el inbox antes del
403, este segundo intento habría vuelto `"duplicate"` y la actualización se
habría perdido en silencio.

### C7 — el aserto del EXPLAIN no es vacío (manual)

```
$ docker exec -i queandabuscando-postgres psql -U postgres -d queandabuscando <<'SQL'
BEGIN;
DROP INDEX IF EXISTS "Order_businessId_status_id_idx";
SET enable_seqscan = off;
EXPLAIN SELECT "id" FROM "Order" WHERE "businessId" = (SELECT id FROM "Business" LIMIT 1)
  AND "id" > 0 ORDER BY "id" ASC LIMIT 100;
ROLLBACK;
SQL
```

Sin el índice, el plan es `Index Scan using "Order_pkey" … Filter: ("businessId" = $0)`
— **no** nombra `Order_businessId_status_id_idx`. Confirma que
`pull.db.test.ts`'s `expect(plan).toContain("Order_businessId_status_id_idx")`
fallaría de verdad sin el índice: no es un aserto que pase siempre.
`ROLLBACK` deja la base intacta para el resto de los worktrees.

### C10 — 403 en las seis rutas, no solo en `orders` (manual)

El smoke solo ejercita `/api/internal/orders` para C10. Verificado a mano
contra las seis, con `seed-negocio-2` puesto `active=false` por `docker exec`
y restaurado al final:

```
GET  /api/internal/orders                    → 403 BUSINESS_INACTIVE
GET  /api/internal/reconciliation?storeId=…   → 403 BUSINESS_INACTIVE
GET  /api/internal/slug-availability?…        → 403 BUSINESS_INACTIVE
POST /api/internal/sync/availability          → 403 BUSINESS_INACTIVE
POST /api/internal/sync/catalog               → 403 BUSINESS_INACTIVE
POST /api/internal/orders/status              → 403 BUSINESS_INACTIVE
```

Restaurado (`active=true`): `GET /api/internal/orders` vuelve a `200`.

### C12 — reciprocidad: los items propios sí se confirman (manual)

```
$ curl -s -X POST …/api/internal/sync/availability -H "authorization: Bearer <token A>" \
    -d '{"businessId":"seed-negocio-1","items":[{"storeProductId":"seed-tienda-1-p10","storeId":"seed-tienda-1","availability":"OUT_OF_STOCK"}]}'
{"applied":1,"confirmed":[["seed-tienda-1-p10","seed-tienda-1"]]}
```

(Restaurado a `AVAILABLE` a continuación, mismo comando con el valor
original — no se dejó mutado el seed compartido.)

### C14 — backfill y estado de la migración (manual)

```
$ docker exec -i queandabuscando-postgres psql … -Atc \
    'SELECT count(*) FROM "Order" WHERE "businessId" IS NULL'
0

$ npx prisma migrate status
Database schema is up to date!   (7 migrations found, sin deriva)

$ docker exec -i queandabuscando-postgres psql … -Atc \
    "SELECT indexname FROM pg_indexes WHERE tablename='CanonicalProduct' AND …"
CanonicalProduct_searchVector_idx
CanonicalProduct_name_trgm_idx
```

Los dos índices GIN de F-015 (búsqueda del marketplace) siguen vivos — si la
migración se los hubiera llevado, `npm test` no lo habría notado (están fuera
del control de Prisma) y la búsqueda se habría apagado en silencio. Ningún
`prisma migrate reset` ni `prisma db push` se ejecutó (solo `migrate deploy`,
según `impl.md` § Comandos ejecutados, confirmado con el estado actual sin
deriva).

### C15 — el seed es idempotente sobre los tokens (manual)

```
$ docker exec … -Atc "SELECT \"externalId\",\"syncTokenHash\" FROM \"Business\" WHERE …"
seed-negocio-1|02dfcaef…58033
seed-negocio-2|c25918c7…6066cf

$ npm run seed   → exit 0, no reimprime ningún token
$ npm run seed   → exit 0, no reimprime ningún token

$ docker exec … -Atc "SELECT \"externalId\",\"syncTokenHash\" FROM \"Business\" WHERE …"
seed-negocio-1|02dfcaef…58033   ← sin cambio
seed-negocio-2|c25918c7…6066cf  ← sin cambio
```

## Fallos encontrados

1. **Ninguno en el código de F-018.** Los 16 criterios pasan con evidencia de
   ejecución real; los dos `route.test.ts` que faltaban (`sync/catalog`,
   `sync/availability`) eran un hueco de cobertura, no un bug — el código de
   esas dos rutas ya hacía lo correcto (confirmado manualmente antes de
   escribir la prueba).

2. **`scripts/pull-orders.mjs::pickOrderableProduct()` consulta `"Store".slug`,
   columna que la migración de F-017
   (`prisma/migrations/20260827023801_storefront_slug_registry/migration.sql`)
   deja en `NULL` para toda tienda sin `ownSlug` propio.** Severidad: media —
   rompe la cadena de regresión de F-007, no la aplicación (el checkout público
   resuelve por `Storefront`/`Slug` vía `loadStoreForOrder`, que funciona:
   confirmado con `GET /tienda-demo → 200` en los logs del servidor).
   **No es de F-018**: `git diff` confirma que el implementador solo tocó la
   variable del token en ese archivo. Repro: `QAB_BEARER_TOKEN=<token>
bash .agent/specs/F-007/smoke.sh` → `Error: No orderable product found for
store "tienda-demo"`. `archivo:línea` sospechoso:
   `scripts/pull-orders.mjs:99-113`. Ficha:
   `.agent/playbook/pull-orders-mjs-store-slug-nulo-tras-f017.md`. Destinatario:
   **`sdd-implementer`** (de un ciclo de mantenimiento sobre F-007/F-017, fuera
   del alcance de F-018).

3. **`.agent/specs/F-010/smoke.sh` asume que `GET /api/internal/orders?since=0&limit=1`
   devuelve el pedido que el propio guion acaba de crear.** Severidad: media —
   con `ORDER BY id ASC`, `since=0&limit=1` devuelve el pedido de **menor** id
   del negocio, que en una base compartida y reutilizada durante meses es un
   pedido viejo de otra tienda del mismo negocio (confirmado:
   `id=1`/`67WS9EZZFN` pertenece a `seed-tienda-2`, no a `tienda-demo`).
   **Tampoco es de F-018**: el mismo problema de fondo ya existía antes (un
   único negocio, mismo `ORDER BY id ASC`). `archivo:línea`:
   `.agent/specs/F-010/smoke.sh:137-154`. Ficha:
   `.agent/playbook/smoke-asume-since-0-devuelve-el-ultimo-pedido.md`.
   Destinatario: **`sdd-implementer`** (mantenimiento de F-010, fuera de
   alcance de F-018).

Ninguno de los dos bloquea el veredicto de F-018: no son criterios de este
feature, no los causó este feature, y ambos quedan fichados con `visto_en`
apuntando a este ciclo para que el próximo que los toque no repita el
diagnóstico. `bash .agent/verify.sh pending F-007` y `pending F-010` quedan
vacíos porque las fichas nuevas reconocen la firma exacta del fallo.

## Huecos de cobertura

- **Antes de este ciclo, `POST /api/internal/sync/catalog` y `POST
/api/internal/sync/availability` no tenían NINGÚN `route.test.ts`** — la
  única cobertura de "mismatch → 403" era la función pura
  `findCatalogMismatch`/`findAvailabilityMismatch` en
  `src/features/sync/identity.test.ts`, nunca ejercitada a través de la ruta
  real para probar que `processCatalogBatch`/`applyAvailability` **nunca** se
  llaman. Cerrado: `src/app/api/internal/sync/catalog/route.test.ts` (nuevo,
  9 pruebas) y `src/app/api/internal/sync/availability/route.test.ts` (nuevo,
  6 pruebas).
- **`applyAvailability()` no tenía ninguna prueba de la reciprocidad "un item
  propio SÍ se aplica y confirma" (E18) contra Postgres real** — solo el caso
  ajeno en `tenantScoping.db.test.ts`. Se verificó a mano por HTTP (arriba,
  «C12 — reciprocidad») en vez de añadir una prueba nueva, para no ampliar más
  el proyecto `db` de vitest sin necesidad (el techo declarado es 6 archivos;
  hoy hay 4). Si alguien vuelve a tocar `availability.ts`, vale la pena
  promover esa comprobación manual a un `it()` del mismo `describe` de
  `tenantScoping.db.test.ts`.
- **El cancelamiento cruzado de pedidos (`POST /api/internal/orders/status`
  con el pedido de otro negocio) no es uno de los 16 criterios de
  `features.json`**, pero sí es E12/R6 de `spec.md` y el propio encargo de este
  ciclo lo señaló por nombre. `src/app/api/internal/orders/status/route.test.ts`
  lo prueba mockeando
  `setOrderStatus`; no hay ninguna prueba contra Postgres real de que
  `setOrderStatus` (el `updateMany({ where: { id, businessId } })`) de verdad
  aísla. Se verificó a mano (creando y borrando un pedido real de
  `seed-tienda-7`, ver bitácora de comandos abajo) en vez de escribir una
  prueba nueva, por la misma razón de techo del proyecto `db`. Riesgo residual
  bajo: la implementación es un único `where` de una línea, de lectura trivial,
  y quedó demostrada en vivo.
- **La concurrencia de dos pollers del mismo negocio** sigue sin cerrarse — es
  explícitamente fuera de alcance (spec.md § Fuera, TP1 heredado de F-007), no
  un hueco de este ciclo.

## Verificación manual — comandos completos para reproducir

Todos ejecutados contra `next dev` en un puerto propio (3102/3103, para no
pisar el que usa `verify.sh --smoke`) y Postgres real
(`queandabuscando-postgres`, puerto 5433). Tokens acuñados con
`npx tsx scripts/mint-sync-token.ts seed-negocio-1` / `seed-negocio-2` — cada
acuñación **rota** el token anterior de ese negocio (E24), así que los valores
usados aquí ya no sirven.

- Cancelación cruzada (E12/R6, no es de los 16 pero se pidió por nombre):
  se creó un `Order` real de `seed-tienda-7` (negocio B) directo con Prisma,
  se intentó cancelar con el token de A → `404 UNKNOWN_ORDER`, se confirmó en
  la base que seguía `PENDING` sin `cancelReason`, se canceló con el token de
  B (`200 {"ok":true}`), y se borró la fila de prueba al terminar. La base
  queda exactamente como estaba antes de empezar (salvo los tokens rotados,
  intencional).

## Veredicto

**LISTO.** Los 16 `acceptance_criteria` de F-018 se verificaron ejecutando
algo — test contra Postgres real, petición HTTP con tokens acuñados de
verdad, o comando de `grep`/`psql` a mano — y, para los que tocan el
aislamiento entre inquilinos, en las dos direcciones. `bash .agent/verify.sh
F-018 --full` y `--smoke` terminan en 0, `bash .agent/verify.sh pending F-018`
queda vacío, y los dos bugs reales encontrados durante la regresión
(`scripts/pull-orders.mjs`, `.agent/specs/F-010/smoke.sh`) son preexistentes,
no de este feature, y quedan fichados para que otro ciclo los cierre.

## Preguntas al humano

Ninguna. Los 16 criterios son ejecutables tal como están escritos (regla 3
respetada: no se propuso cambiar ninguno), y ningún fallo encontrado es una
decisión de producto — los dos bugs de regresión son defectos de guiones de
prueba con arreglo claro, no una gravedad a decidir.
