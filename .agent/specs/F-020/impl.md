---
feature: F-020
agente: sdd-implementer
actualizado: 2026-09-01T06:20:00Z
estado: listo
---

## Qué se construyó

Los diez pasos del plan firmado, en orden.

| Archivo                                                            | Qué hace                                                                                                                                                                                                     | Paso |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| `docker-compose.yml`                                               | Tres servicios nuevos (`realtime-db`, `realtime`, `realtime-init`) más `queandabuscando-realtime-pgdata` y el `depends_on` del gateway sobre `realtime`                                                      | 1    |
| `docker/realtime-roles.sql`                                        | Roles Supabase para `realtime-db` (`anon`, `authenticated`, `service_role bypassrls`, `supabase_admin`) + los dos `create schema` que el boot real exige (`_realtime` y `realtime`, hallazgos de ejecutarlo) | 1    |
| `docker/realtime-policies.sql`                                     | La política `negocio_lee_solo_su_canal` sobre `realtime.messages`, idempotente                                                                                                                               | 1    |
| `docker/supabase-gateway.conf`                                     | Dos `location` nuevos: `/realtime/v1/websocket` (reescrito a `/socket/websocket`, hallazgo de ejecutarlo) y `/realtime/v1/` (REST, en la raíz)                                                               | 1    |
| `src/lib/env.ts`                                                   | `SUPABASE_JWT_SECRET`, `optional()`                                                                                                                                                                          | 2    |
| `.env.example`                                                     | Documenta `SUPABASE_JWT_SECRET`                                                                                                                                                                              | 2    |
| `scripts/storage-dev-keys.mjs`                                     | Escribe también `SUPABASE_JWT_SECRET` (mismo valor que `STORAGE_JWT_SECRET`)                                                                                                                                 | 2    |
| `.agent/init.sh`                                                   | Bloque `== Realtime ==`, nunca `bad`                                                                                                                                                                         | 2    |
| `prisma/schema.prisma`                                             | Modelo `OrderBellWindow` (`businessId`, `windowStartedAt`, `pendingSince`) + `bellWindow` en `Business`                                                                                                      | 3    |
| `prisma/migrations/20260901052204_order_bell_window/migration.sql` | `CREATE TABLE` aditivo con su FK; los cinco `DROP INDEX` de la trampa conocida, quitados a mano                                                                                                              | 3    |
| `src/constants/realtime.ts`                                        | Canal, evento, payload, ventana (5000 ms), tope de emisión (1000 ms), TTL de credencial (3600 s) y `REALTIME_BELL_CLOSE_MARGIN_MS` (hallazgo de ejecutarlo, ver § Desviaciones)                              | 4    |
| `src/lib/realtime/broadcast.ts`                                    | `broadcastBell()`/`realtimeAvailability()`, nunca lanza, log de una línea `[realtime]`                                                                                                                       | 4    |
| `src/lib/realtime/broadcast.test.ts`                               | Config-only, URL/apikey/payload exactos, `rejected`/`unreachable`/`timeout`, la línea de log                                                                                                                 | 4    |
| `src/lib/realtime/subscriptionToken.ts`                            | `mintSubscriptionToken()`, `mintRealtimeCredential()`, `subscriptionAvailability()`, `RealtimeCredentialResponse`                                                                                            | 4    |
| `src/lib/realtime/subscriptionToken.test.ts`                       | Claims del JWT, TTL, forma de la credencial                                                                                                                                                                  | 4    |
| `src/features/orders/server/bell.ts`                               | `claimBell()`/`closeBellWindow()`/`ringOrderBell()`, una sentencia cada una, sin `$transaction`                                                                                                              | 5    |
| `src/features/orders/server/bell.test.ts`                          | Guardián estático: sin `new Map(`, `new Set(` ni `let` de módulo                                                                                                                                             | 5    |
| `src/features/orders/server/bell.db.test.ts`                       | Los tres casos del plan (ventana abierta por SQL externo, cierre reclamado por SQL externo, concurrencia con dos `PrismaClient`) + E9 + el camino real de `ringOrderBell` end-to-end                         | 5    |
| `src/features/orders/server/createOrder.ts`                        | `CreateOrderResult.created` lleva `businessId`                                                                                                                                                               | 6    |
| `src/features/orders/server/respond.ts`                            | `RespondToProposalResult.applied` lleva `businessId` (`RETURNING "businessId"` en `approve`/`reject`)                                                                                                        | 6    |
| `src/app/api/orders/route.ts`                                      | `after(() => ringOrderBell(businessId))` solo en `kind === "created"`                                                                                                                                        | 6    |
| `src/app/api/orders/route.test.ts`                                 | El timbre se agenda solo en `created`; nunca en idempotente/4xx; corre después de la respuesta                                                                                                               | 6    |
| `src/app/[slug]/pedido/[code]/respuesta/route.ts`                  | `after(() => ringOrderBell(businessId))` solo en `kind === "applied"`                                                                                                                                        | 6    |
| `src/app/[slug]/pedido/[code]/respuesta/route.test.ts`             | Igual, para aprobar/rechazar/idempotente/409/desconocido                                                                                                                                                     | 6    |
| `src/app/api/internal/realtime/credential/route.ts`                | `POST`, envuelto en `withInternalAuth`; `businessId` del bearer, nunca del cuerpo (no hay cuerpo)                                                                                                            | 7    |
| `src/app/api/internal/realtime/credential/route.test.ts`           | 401/403/503×2/200; criterio 13 (B nunca produce el canal de A, ni con un cuerpo falsificado)                                                                                                                 | 7    |
| `scripts/realtime-bell.mjs`                                        | Suscriptor de pruebas reutilizable (protocolo Phoenix a mano) + nueve modos `--criterioN`                                                                                                                    | 8    |
| `.agent/specs/F-020/smoke.sh`                                      | Invoca el guion de arriba y traduce `FAIL` a `SMOKE FAIL`                                                                                                                                                    | 8    |
| `.github/workflows/ci.yml`                                         | `grep -vxE 'storage-bucket-init\|realtime-init'`; paso que espera `realtime-init`; `bash .agent/verify.sh F-020 --only smoke` al final del job `auth`                                                        | 9    |
| `docs/sync-contract.md`                                            | Sección «El timbre del canal `negocio:` (aclaración aditiva, sin bump de versión)» dentro de § ③④ Pedidos                                                                                                    | 10   |
| `docs/despliegue.md`                                               | Nueva `## 4. El timbre de Realtime (F-020)`; renumeradas las secciones 4-10 a 5-11 y sus referencias cruzadas; fila `SUPABASE_JWT_SECRET` en la tabla de secretos                                            | 10   |
| `.agent/specs/F-020/impl.md`                                       | Este documento                                                                                                                                                                                               | 10   |
| `.agent/specs/F-020/plan.md`, `.agent/specs/F-020/architecture.md` | Solo comillas invertidas a los quince archivos que este ciclo creó (ya no llevan «(por crear)»)                                                                                                              | —    |
| `.agent/playbook/db-test-cross-process-clock-skew.md`              | Lección: no comparar un timestamp de Postgres contra `Date.now()` del proceso de test                                                                                                                        | —    |
| `.agent/playbook/realtime-bell-close-clock-skew.md`                | Lección: el margen de seguridad de § Desviaciones                                                                                                                                                            | —    |

## Desviaciones

Todas dentro del margen que `architecture.md` dejó abierto o son hallazgos de
ejecutar el paso 1 (que el propio plan advierte que «solo se prueba
ejecutándola»). Ninguna cambia el alcance.

- **`docker/realtime-roles.sql` necesitó dos líneas que `architecture.md` no
  anticipaba: `create schema if not exists _realtime` y `create schema if
not exists realtime`.** Encontrado ejecutándolo: `DB_AFTER_CONNECT_QUERY:
"SET search_path TO _realtime"` hace que las migraciones de Realtime
  fallen con «no schema has been selected to create in» si `_realtime` no
  existe ya, y las migraciones del inquilino (`SEED_SELF_HOST`) fallan con
  «schema "realtime" does not exist» por la misma razón. `docker/storage-roles.sql`
  y `docker/auth-roles.sql` no necesitaban esto porque sus servicios sí crean
  su propio esquema en sus migraciones; Realtime asume que ambos ya existen.
- **`docker-compose.yml`: `realtime-db` arranca con `POSTGRES_USER: postgres`,
  no `supabase_admin`.** `architecture.md` no lo especificaba. Con
  `POSTGRES_USER: supabase_admin` el propio `docker-entrypoint.sh` crea ese
  rol al iniciar, y el `create role supabase_admin` de
  `docker/realtime-roles.sql` aborta con «role already exists», dejando el
  resto del script (incluidos los `create schema` de arriba) sin ejecutar.
  Mismo patrón que `storage-roles.sql` ya usa con `supabase_storage_admin`:
  arrancar como `postgres`, crear el rol con nombre de Supabase desde SQL.
- **`realtime` (el servicio, no la base) necesita dos variables que
  `architecture.md` no listaba: `APP_NAME` y `METRICS_JWT_SECRET`.**
  Encontrado ejecutándolo: sin la primera, el boot muere con «APP_NAME not
  available»; sin la segunda, con «could not fetch environment variable
  "METRICS_JWT_SECRET"» — el binario v2.102.3 la exige aunque este feature
  nunca llame a `/metrics`. `METRICS_JWT_SECRET` reutiliza
  `SUPABASE_JWT_SECRET`: solo protege ese endpoint, así que no es una
  credencial nueva que nada más en el repo comprueba.
- **`docker/supabase-gateway.conf` necesita DOS `location` para
  `/realtime/v1/`, no uno.** `architecture.md` describía un solo `location`
  con reescritura de `Host`. Ejecutándolo: el websocket de Realtime vive en
  `/socket/websocket` (no en la raíz), mientras que su API REST —incluida
  `/api/tenants/.../health`, que ya funcionaba con un solo `location`— sí
  vive en la raíz. `/realtime/v1/websocket` necesita reescribirse a
  `/socket/websocket`; el resto de `/realtime/v1/` no. Confirmado con `curl
--http1.1` contra el contenedor directamente (101 Switching Protocols en
  `/socket/websocket`, 404 en `/websocket`) antes de tocar el `.conf`.
- **`docker-compose.yml`: `supabase-gateway` gana `depends_on: realtime:
condition: service_healthy`.** No estaba en `architecture.md` explícitamente,
  pero es la misma razón que ya justifica sus `depends_on` de `storage` y
  `auth`: el `proxy_pass` de un `location` nuevo resuelve el nombre del
  contenedor al cargar la configuración, y ese contenedor tiene que existir.
- **El protocolo Phoenix que habla `scripts/realtime-bell.mjs` necesita el
  topic prefijado con `realtime:` al unirse por websocket** (`realtime:negocio:
{businessId}`, no `negocio:{businessId}` a secas). No documentado en
  `architecture.md` — es lo que hacen las librerías cliente por dentro y algo
  que solo se ve conectando el protocolo a mano. La política RLS y el
  `channel` que devuelve el endpoint de credencial siguen siendo
  `negocio:{businessId}` sin el prefijo: es solo el `topic` del frame
  `phx_join` el que lo necesita.
- **Bug real encontrado por `scripts/realtime-bell.mjs` (no por los tests
  unitarios ni por `bell.db.test.ts` tal como estaba escrito antes de esto):
  `closeBellWindow()` podía no cerrar nunca una ventana `first_defer`.**
  `ringOrderBell()` calculaba el `sleep` con el reloj de Node
  (`claim.closesAt.getTime() - Date.now()`), pero la sentencia SQL de
  `closeBellWindow` decide con el reloj de Postgres. Un desfase de pocos
  milisegundos entre los dos hacía que el despertar llegara un pelo antes de
  que Postgres estuviera de acuerdo en que la ventana venció, la sentencia
  devolvía 0 filas, y **nadie lo reintentaba**: la fila se quedaba con
  `pendingSince` puesto para siempre. Se reprodujo de forma determinista
  corriendo criterio 1 seguido de criterio 2 contra un `next dev` real.
  Arreglo: `REALTIME_BELL_CLOSE_MARGIN_MS = 250` en
  `src/constants/realtime.ts`, sumado al delay del `sleep` en
  `ringOrderBell()` — el SQL sigue siendo la fuente de verdad (I5), el
  margen solo hace que el proceso pregunte un poco más tarde. Ficha
  `.agent/playbook/realtime-bell-close-clock-skew.md`; caso nuevo en
  `bell.db.test.ts` que ejercita `ringOrderBell()` real (no solo
  `claimBell`/`closeBellWindow` con SQL manual) para que no vuelva a colarse
  sin que un test lo note.
- **`claimBell`/`closeBellWindow` ganan un segundo parámetro opcional
  `client: PrismaClient = prisma`.** `architecture.md` § Contratos solo
  mostraba la forma de un argumento; todos los sitios de producción (la
  única llamada real, dentro de `ringOrderBell`) la siguen usando así. El
  parámetro existe únicamente para que el caso 3 de `bell.db.test.ts`
  (concurrencia con dos `PrismaClient` distintos) pueda conducir la MISMA
  sentencia a través de dos conexiones independientes de verdad, que es lo
  que el propio plan pedía verificar.
- **Criterios 3 y 11 de `scripts/realtime-bell.mjs` no apuntan
  `NEXT_PUBLIC_SUPABASE_URL` a `203.0.113.1` (TEST-NET-3), como escribe
  `spec.md`.** Detienen y vuelven a levantar el contenedor `realtime`
  (`docker compose stop/start realtime`) contra el MISMO `next dev` que ya
  está corriendo. Motivo: Next 16 admite un solo `next dev` por directorio, y
  `.agent/verify.sh --smoke` ya tiene el suyo en marcha — no hay forma de
  reiniciarlo con una URL distinta a mitad de la corrida sin un segundo
  servidor, que Next rechaza. Con el contenedor parado, el `fetch` de
  `broadcastBell` se queda esperando (el gateway acepta la conexión TCP pero
  su intento de conectar al upstream tarda ~14 s antes de que nginx
  respondiera 502), así que el `AbortSignal.timeout(REALTIME_BELL_EMIT_TIMEOUT_MS)`
  de la propia app es quien corta — reproduce E6 (una dirección que TRAGA la
  conexión) de verdad, no una imitación. Comprobado con `curl` directo al
  gateway antes de escribir el modo. El comportamiento observable que la
  spec pide (`POST /api/orders` sigue en 201; la mediana no empeora más allá
  del tope de R3) es idéntico.

## Comandos ejecutados

- `npx prisma validate` → válido.
- `npx prisma migrate dev --name order_bell_window --create-only` → generó
  `20260901052204_order_bell_window`; se quitaron a mano los cuatro
  `DROP INDEX` de los GIN no declarados antes de aplicar (la trampa
  conocida).
- `npm run db:deploy` → aplicó la migración sin pendientes;
  `npx prisma migrate status` → "Database schema is up to date!".
- `npx prisma migrate diff --from-config-datasource --to-schema
prisma/schema.prisma --script` → sigue sin mencionar `realtime.`, `auth.`
  ni `storage.`; solo los mismos cinco `DROP INDEX` preexistentes, ajenos a
  este feature (DA4/I3 se sostiene).
- `docker compose up -d` × 2, en frío (volumen de `realtime-db` recién
  creado) → exit 0 las dos veces; `docker wait
queandabuscando-realtime-init` → 0 las dos veces (criterio 12).
- `curl -H "Authorization: Bearer <anon>"
http://localhost:54321/realtime/v1/api/tenants/realtime-dev/health` → 200.
- Sobre `realtime-db`: `select policyname from pg_policies where
schemaname='realtime' and tablename='messages'` → 1 fila,
  `negocio_lee_solo_su_canal` (criterio 6, mitad RLS).
- `npm run typecheck` → limpio.
- `npm run lint` → limpio (el único aviso preexistente,
  `ProfileForm.tsx:109`, es ajeno a este feature).
- `npm run format:check` → limpio tras `prettier --write` puntual sobre los
  archivos que este ciclo tocó (nunca `prettier --write .`).
- `npx vitest run --project server --project db --project ui` → todo en
  verde; `bell.db.test.ts` incluye el caso end-to-end de `ringOrderBell`
  (~5,3 s reales) sin afectar el resto de la suite.
- `bash .agent/verify.sh F-020 --full --smoke` → **0**, con
  `scripts/realtime-bell.mjs` corriendo los nueve modos (1, 2, 3, 4, 8, 9,
  10, 11, 13) contra un `next dev` real y el emulador de Realtime completo.
  Salida y timings literales en `.agent/runs/F-020/`.
- `bash .agent/verify.sh pending F-020` → vacío: los dos fallos de este
  ciclo (el desfase de reloj en un test propio, y el bug real de
  `closeBellWindow`) tienen ficha escrita en `.agent/playbook/`.

## Criterios cubiertos

Los siete de `features.json`, sin tocar su texto (regla 3; el criterio 4 lleva
su aclaración en `notes`, escrita por el humano):

1. `node scripts/realtime-bell.mjs --criterio1` → payload exacto, sin `code`,
   `total`, teléfono, nombre ni correo.
2. `node scripts/realtime-bell.mjs --criterio2` → A recibe 1, B recibe 0.
3. `node scripts/realtime-bell.mjs --criterio3` → `201` y el pedido en el
   pull con Realtime caído.
4. `node scripts/realtime-bell.mjs --criterio4` → 10 pedidos en <5 s,
   1-2 timbres (criterio 17 de `spec.md`, la ráfaga).
5. `grep -rn "CUADRECAJA_API_URL" src/` → sin resultados.
6. `pg_policies` (≥1 fila) + `grep -n "negocio:" docs/sync-contract.md`
   (varias líneas).
7. `bash .agent/verify.sh F-020 --full` → 0.

Los diez `[nuevo]` de `spec.md`: 8, 9, 10, 11 y 13 los cubre
`scripts/realtime-bell.mjs`; 12 lo cubren los dos `docker compose up -d`; 14
lo cubre `npm test` + `npm run check:bundle`; 15 lo cubre `grep -n "Realtime"
docs/despliegue.md`; 16 es `bash .agent/verify.sh F-020 --full --smoke`; 17
es la redacción del criterio 4, ya aplicada arriba.

## Deuda dejada

Ninguna deliberada dentro de § Alcance del plan. El único punto que un
`sdd-tester` no debe redescubrir como hallazgo nuevo: el paso de producción
(aplicar `docker/realtime-policies.sql` en el panel, desactivar «Allow
public access») es manual y ningún sensor lo alcanza — es exactamente lo que
`docs/despliegue.md` § 4 y § 7 (ítem 4) documentan, a propósito.

## Qué necesita quien pruebe

- **Entorno:** `docker compose up -d` (los tres servicios de Realtime se
  suman a los ya existentes de Storage/Auth); `npm run db:deploy`; `npm run
seed`. `node scripts/storage-dev-keys.mjs --write` si `.env` no tiene
  `SUPABASE_JWT_SECRET` todavía — escribe las cuatro claves de golpe.
- **Para correr el smoke a mano:** `PORT=3100 npx next dev -p 3100` en una
  terminal, y en otra `SMOKE_BASE_URL=http://localhost:3100 bash
.agent/specs/F-020/smoke.sh`, o directamente
  `QAB_BASE_URL=http://localhost:3100 node scripts/realtime-bell.mjs` para
  los nueve modos, o `--criterioN` para uno solo.
- **Frágil, a tener en cuenta:** los criterios 3 y 11 paran y vuelven a
  levantar el contenedor `realtime` (`docker compose stop/start realtime`);
  si algo corta el guion a mitad de esos dos modos, el contenedor puede
  quedar parado — `docker compose up -d realtime` lo repone.
- **La fila de `OrderBellWindow` es compartida entre worktrees** que apunten
  a la misma Postgres local, igual que cualquier otra tabla de la base
  compartida: si dos worktrees corren `scripts/realtime-bell.mjs` sobre
  `seed-negocio-1` al mismo tiempo, sus ventanas de coalescencia interfieren
  entre sí (es la propiedad que R10 exige, no un bug del guion).

## Preguntas al humano

Ninguna. El plan no dejó ninguna decisión de alcance pendiente para esta
etapa; los tres hallazgos de ejecutar el paso 1 y el bug del margen de
reloj son desviaciones de implementación, no cambios de alcance.
