---
feature: F-012
agente: sdd-tester
actualizado: 2026-08-29T16:20:00Z
estado: listo
veredicto: no-listo
---

> **Resumen de una línea**: cinco de los seis criterios están verificados
> ejecutando algo, con evidencia real (comando + salida + para varios, la
> fila de la base de datos que quedó). El sexto —**criterio 1, «Se puede
> iniciar sesión con Google, Facebook, Apple y correo»**— está **partido en
> 1a/1b por D3 de la propia spec**, y **1a sigue bloqueado por entorno**: no
> hay un proyecto Supabase con Auth real en `.env` (I7). `veredicto: no-listo`
> es por ese único motivo. No lo simulé ni lo di por bueno.

## Entorno de este ciclo

- **`next dev` propio**: levantado en el puerto **3100**, cwd
  `/Users/adrian/orca/workspaces/queandabuscando/cowrie` (confirmado con
  `lsof -a -p <pid> -d cwd -Fn` antes de usarlo — ficha
  `next-dev-uno-por-directorio`: el puerto 3000 de esta máquina sirve
  `.orca-worktree-trash/wt-1787975564239-8d7709e1`, **no** este worktree).
- **Postgres**: `postgresql://postgres:postgres@localhost:5433/queandabuscando`,
  vía `docker exec queandabuscando-postgres psql …` (no hay `psql` en el
  `PATH` de este shell).
- **`.env` de este worktree**, confirmado antes de empezar:
  `NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321"` (el emulador de
  Storage, **no** Auth) y `NEXT_PUBLIC_SUPABASE_ANON_KEY` no vacía —
  `isSupabaseAuthConfigured()` da **verdadero**, pero no hay ningún backend
  de Auth detrás. Confirmado con
  `curl http://localhost:54321/auth/v1/user` → **404 de nginx** (el gateway
  del emulador solo conoce `/storage/v1/*`). Este es el hecho que bloquea 1a
  y toda sub-verificación que necesite una sesión de Supabase **verificada**
  (ver § Lo que no se pudo verificar).
- **Descubrimiento de este ciclo, fichado**: `.env.example` deja
  `SSO_JWT_SECRET`, `ADMIN_SESSION_SECRET` y `CRON_SECRET` en `""`, y
  `src/lib/env.ts` los declara con `.min(...)` (dos de ellos ni siquiera
  `.optional()`) — `serverEnv()` lanza en cualquier ruta que la llame, y
  como `getAdminSession()` atrapa ese error dentro de un `catch { return
null }`, el síntoma es indistinguible de "no hay sesión de admin". Me
  costó una hora entender por qué un JWT de admin perfectamente firmado
  seguía dando 307. Ficha:
  `.agent/playbook/env-optional-secreto-vacio-rompe-serverenv.md`. Para
  poder ejercitar el criterio 5 con una sesión de admin real, rellené
  temporalmente las tres claves en `.env` con valores de prueba (≥ el
  mínimo declarado), reinicié el `next dev`, hice las pruebas de abajo, y
  **revertí `.env` a `""` en las tres al terminar** — confirmado con
  `git status`/`grep` antes de cerrar (`.env` está gitignored; el estado
  final es idéntico al que tenía este worktree al empezar el ciclo).

## Estrategia

Tres capas, igual que F-010/F-015:

- **`*.test.ts` (proyecto `server`, node)** y **`*.test.tsx` (proyecto `ui`,
  jsdom)**: toda la lógica ya cubierta por los tests que dejó
  `sdd-implementer` — los ejecuté yo, no los di por buenos leyendo el código.
- **`*.db.test.ts` (proyecto `db`, Postgres real)**: `customers.db.test.ts`,
  contra la base local, sin mocks.
- **HTTP real contra `next dev` (puerto 3100)** con `curl`/
  `scripts/place-order.mjs`/consultas a Postgres vía `docker exec … psql`:
  lo que ningún test unitario puede demostrar — el contrato HTTP completo,
  la fila que queda en la base, y los tres ataques que me pidieron ejecutar
  de verdad (R14, el enlace del pedido, el presupuesto+ISR con Auth vacío).
- `.agent/specs/F-012/smoke.sh` (nuevo, sobre la plantilla) automatiza todo
  lo de arriba que **no** necesita una sesión de Supabase verificada —
  que es casi todo, por diseño de D6/R14 (E17: resolver la identidad nunca
  bloquea el pedido)— y deja **marcada como `MANUAL`** la parte que sí la
  necesita: 1a completo, el autocompletado de punta a punta del criterio 3,
  y la mitad de criterio 5 que exige `/cuenta` en 200 con sesión real.
  `bash .agent/verify.sh F-012 --smoke` → **0**, 15/15 aserciones
  automatizadas en verde (log completo en
  `.agent/runs/F-012/042-smoke.log`).

## Mapa criterio → prueba

| #   | Criterio                                                   | Prueba ejecutada                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Comando                                                                                                                                                                                         | Resultado                                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1a  | Correo, de punta a punta (D3)                              | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                                                                                                               | **BLOQUEADO POR ENTORNO** — ver § Lo que no se pudo verificar                                                                                                                                                                                                                                                                                 |
| 1b  | Google/Facebook/Apple por contrato + callback              | `npm test` sobre `src/app/api/account/oauth/route.test.ts` y `src/app/auth/callback/route.test.ts`: cada botón llama a `signInWithOAuth` una vez con el `provider` correcto y `redirectTo` = `<origen>/auth/callback?next=<destino codificado>`; `?code=abc&next=/cuenta` llama a `exchangeCodeForSession("abc")` (vía `exchangeCustomerCode`) y responde 307 a `/cuenta`; con el canje fallando, 307 a `/cuenta/entrar?aviso=caducado` y `ensureCustomerForUser` **no** se llama (E19). Además R7/E27 (4 variantes de `next` hostil → `/cuenta`), aunque ya no sea criterio (D8)                                                            | `npx vitest run --project server src/app/api/account/oauth/route.test.ts src/app/auth/callback/route.test.ts`                                                                                   | **PASA** — 13/13 (incluye 3× el `it.each` de providers + 4 variantes de `next` hostil)                                                                                                                                                                                                                                                        |
| 2   | Primer login crea `Customer` enlazado por `supabaseUserId` | `customers.db.test.ts` contra Postgres real: (i) 1ª llamada → 1 fila con `phone: null` (R9); (ii) 2ª llamada con `full_name` distinto → sigue 1 fila, `name` intacto (E6/R10); (iii) fila vieja con mismo email y `supabaseUserId: null` → queda intacta, se crea una 2ª fila (E7/R8); (iv) `Promise.all([ensure(U), ensure(U)])` → ninguna excepción, `count = 1` (E8/R12)                                                                                                                                                                                                                                                                  | `npx vitest run --project db src/features/account/server/customers.db.test.ts`                                                                                                                  | **PASA** — 4/4 contra Postgres real. `npx prisma migrate status` → "Database schema is up to date!" (0 pendientes)                                                                                                                                                                                                                            |
| 3   | Autocompletado en el checkout                              | jsdom, `CheckoutForm.autocomplete.test.tsx`: E12 (perfil completo rellena los 3 campos), E13 (lo tecleado gana, D4), E14 (perfil sin teléfono deja el campo vacío), E16 (sin sesión, 3 vacíos, sin error), + un campo vaciado a propósito no se rellena. `GET`/`PUT /api/account/profile` con sesión mockeada: E9/E10/E11/R20 (un `id`/`supabaseUserId` en el cuerpo se ignora)                                                                                                                                                                                                                                                              | `npx vitest run --project ui src/features/cart/components/CheckoutForm.autocomplete.test.tsx`; `npx vitest run --project server src/app/api/account/profile/route.test.ts`                      | **PASA** — 5/5 y 7/7. De punta a punta con sesión real: **BLOQUEADO POR ENTORNO** (ver abajo); lo que SÍ se probó real por HTTP: `GET /api/account/profile` sin sesión → `{"signedIn":false,"profile":null}` (200, nunca error) y `/tienda-demo/checkout` responde 200 con una cookie `qab-shopper-auth` presente pero irresoluble (smoke.sh) |
| 4   | Pedido de invitado sigue siendo posible                    | (a) `git grep -rn "cookies()" src/features/orders/ "src/app/[slug]/"` vacío; (b) `POST /api/orders` sin cabecera `Cookie` → 201, vía `place-order.mjs` contra el server real; (c) suite de F-010 en verde **sin tocar sus asertos** (`git diff` sobre sus archivos de test); (d) `npm run build`: `/[slug]` sigue `●`, `/[slug]/checkout` sigue `ƒ`; (e) `grep -n "slug" src/proxy.ts` fuera del `matcher`; (f) D6: sin sesión `Order.customerId` NULL (psql); con cookie de sesión irresoluble, NULL y el pedido se crea igual (E17, HTTP real); **R14 — inyección**: `customerId` en cuerpo+query+cabecera de `POST /api/orders` se ignora | ver bloque de comandos abajo                                                                                                                                                                    | **PASA**, los 6 puntos + R14. Único hueco: el positivo "con sesión VÁLIDA, `customerId` = el de mi `Customer`" — **BLOQUEADO POR ENTORNO** (ver abajo), cubierto solo a nivel de unidad (`orderIdentity.test.ts`, `createOrder.test.ts`, mockeados)                                                                                           |
| 5   | Cookies de cliente y admin no se pisan                     | (a) `customerSession.test.ts`: `CUSTOMER_COOKIE` (`qab-shopper-auth`) vs `ADMIN_COOKIE` (`qab-admin-session`) distintas y ninguna prefijo de la otra (R21); (b) `src/app/api/account/logout/route.test.ts` mockeado; (c) **HTTP real**: `POST /api/account/logout` con `qab-admin-session`+`qab-shopper-auth`+`qab-shopper-hint` en la petición → el `Set-Cookie` de la respuesta borra **solo** las dos de cliente, nunca menciona `qab-admin-session`; (d) con un JWT de admin real (minted a mano, ver más abajo) y `qab-shopper-hint=1` a la vez, `/admin` → 200; tras `POST /api/account/logout`, `/admin` → sigue 200                  | `npx vitest run --project server src/lib/auth/customerSession.test.ts src/app/api/account/logout/route.test.ts`; smoke.sh                                                                       | **PASA** todo lo de arriba. Hueco: `/cuenta` respondiendo 200 A LA VEZ que `/admin` necesita una sesión de cliente REAL — **BLOQUEADO POR ENTORNO** (mismo motivo que 1a)                                                                                                                                                                     |
| 6   | Sin Supabase Auth, tienda y checkout intactos              | `npm run build` con `NEXT_PUBLIC_SUPABASE_URL=""` y `_ANON_KEY=""` (la forma **exacta** que pide la spec, no la del `.env` de hoy que apunta al emulador) → 0; ese build arrancado en :3102 → `/tienda-demo` 200, `/cuenta/entrar` 200 con el aviso; `place-order.mjs` contra ese mismo server → pedido de invitado creado igual; `check:bundle` → 0                                                                                                                                                                                                                                                                                         | `NEXT_PUBLIC_SUPABASE_URL="" NEXT_PUBLIC_SUPABASE_ANON_KEY="" npm run build`; `npx next start -p 3102` (con las mismas vars); `QAB_BASE_URL=http://localhost:3102 node scripts/place-order.mjs` | **PASA**, sin hueco. Único criterio de los seis sin ningún bloqueo de entorno                                                                                                                                                                                                                                                                 |

Transversal: `bash .agent/verify.sh F-012 --full` → **0** — harness ·
typecheck · lint · format · test · prisma · build · theme · bundle, intento 43. `bash .agent/verify.sh F-012 --smoke` → **0** — typecheck · lint ·
format · test · smoke, intento 42; log `.agent/runs/F-012/042-smoke.log`.

## Las tres cosas que me pidieron atacar de verdad

### 1. La frontera de F-010 (criterio 4)

```
$ git grep -rn "cookies()" src/features/orders/ "src/app/[slug]/"
(sin salida, exit 1)
```

`POST /api/orders` sin cabecera `Cookie`, contra el server real (puerto
3100):

```
$ QAB_BASE_URL=http://localhost:3100 node scripts/place-order.mjs
  ok   la cotización responde 200
  ok   la creación responde 201
  ok   la fila existe en la base
  ok   contactName coincide con lo enviado
  ok   contactPhone coincide con lo enviado
  ok   unitPrice coincide con el precio efectivo del momento
  ok   rateSnapshot tiene 'rates'
  ok   no hay lectura de cookies de sesión en el camino del pedido (R24, criterio 4)
0 aserciones fallidas
```

Suite de F-010 en verde, **sin tocar un aserto suyo**:

```
$ npx vitest run --project server --project ui src/features/orders src/features/cart
Test Files  15 passed (15)
     Tests  125 passed (125)
```

`git diff d857ef6 -- <15 archivos de test de F-010>` (`d857ef6` = último
commit del feature F-010): el único cambio es un `describe` **nuevo**,
añadido al final de `createOrder.test.ts` (`customerLink (D6, R14…)`, 50
líneas, 4 tests). Cero líneas tocadas dentro de ningún test preexistente.

Build: `/[slug]` sigue `●`, `/[slug]/checkout` sigue `ƒ` (tabla completa en
`.agent/runs/F-012/043-build.log`). `grep -n "slug" src/proxy.ts` → solo un
comentario fuera del bloque `config` (confirmado leyendo el `matcher`
completo: `/admin/:path…`, `/admin`, `/cuenta/:path*`, `/cuenta`,
`/auth/:path*`, nada de `/[slug]`).

### 2. El enlace del pedido (D6, criterio 2/4)

Contra Postgres real (`docker exec queandabuscando-postgres psql -U
postgres -d queandabuscando`), con pedidos creados vía HTTP:

- **Sin sesión** (pedido de invitado de `place-order.mjs`, código
  `CXAV7YDXRE`): `select "customerId" from "Order" where code = 'CXAV7YDXRE'`
  → **vacío/NULL**.
- **Con sesión caducada/irresoluble** — el único estado producible en este
  entorno para _cualquier_ cookie `qab-shopper-auth` no vacía, porque no hay
  backend de Auth que la verifique (ver § Lo que no se pudo verificar):
  `curl -X POST http://localhost:3100/api/orders -H 'Cookie:
qab-shopper-auth=garbage-not-a-real-session-token' …` → **201** (código
  `JEC5S60HH4`); `select "customerId" … where code = 'JEC5S60HH4'` → **NULL**.
  Esto es exactamente E17 ejecutado de verdad por HTTP: la sesión no se pudo
  verificar y el pedido se creó igual, sin bloquear.
- **Con sesión válida** (el positivo, `customerId` = el `id` del `Customer`):
  **no ejecutable en este entorno** — ver § Lo que no se pudo verificar. Sí
  ejecutado, mockeado: `orderIdentity.test.ts` ("with a valid session:
  resolves to the Customer.id (E28)") y el `describe("customerLink…")` de
  `createOrder.test.ts` ("writes the id the customerLink promise resolves
  to (E28)").

**R14 — inyección de `customerId`** (cuerpo, query y cabecera a la vez),
contra el server real:

```
$ curl -s -w '\n%{http_code}' -X POST \
    'http://localhost:3100/api/orders?customerId=22222222-2222-2222-2222-222222222222' \
    -H 'Content-Type: application/json' \
    -H 'X-Customer-Id: 33333333-3333-3333-3333-333333333333' \
    -d '{"storeSlug":"tienda-demo", …, "customerId":"11111111-1111-1111-1111-111111111111"}'
{"code":"QRCW0AFCA3", …}
201

$ docker exec -i queandabuscando-postgres psql -U postgres -d queandabuscando \
    -c "select code, \"customerId\" from \"Order\" where code='QRCW0AFCA3';"
    code    | customerId
------------+------------
 QRCW0AFCA3 |
```

201, y `customerId` quedó **NULL** — ninguno de los tres vectores de
inyección se coló. Zod (`createOrderRequestSchema`, un `z.object` sin
`.passthrough()`) descarta el campo del cuerpo antes de que exista la
oportunidad; la query y la cabecera nunca se leen en absoluto
(`resolveOrderCustomerId()` solo mira la cookie).

Intenté además exercitar el positivo llamando a `createOrder()` directamente
en un `.db.test.ts` (sin pasar por HTTP), inyectando `customerLink =
Promise.resolve(<id real>)`: **no es posible**. `loadStoreForOrder` usa
`unstable_cache` de Next, que lanza `Invariant: incrementalCache missing in
unstable_cache` fuera de una petición real de un servidor Next en marcha
(confirmado, no supuesto — es el error real que imprimió `npx vitest run
--project db` al intentarlo). Por eso ningún test existente del repo llama a
`createOrder()`/`quoteCart()` directamente contra Postgres; los que necesitan
datos reales (p. ej. `pull.db.test.ts`) insertan filas con Prisma a mano, sin
pasar por esa función. Archivo descartado, no se quedó en el árbol.

### 3. El presupuesto y el ISR (criterio 6, R11)

```
$ NEXT_PUBLIC_SUPABASE_URL="" NEXT_PUBLIC_SUPABASE_ANON_KEY="" npm run build
… (0)
$ NEXT_PUBLIC_SUPABASE_URL="" NEXT_PUBLIC_SUPABASE_ANON_KEY="" npx next start -p 3102
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3102/tienda-demo      # 200
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3102/cuenta/entrar    # 200
$ curl -s http://localhost:3102/cuenta/entrar | grep -io "no está disponible"     # "no está disponible"
$ QAB_BASE_URL=http://localhost:3102 node scripts/place-order.mjs
… 0 aserciones fallidas (pedido de invitado creado igual)
$ npm run check:bundle
✓ Heaviest page: bodega-central/p/agua-natural-500-ml.html — 177.6 KB gzipped (budget 193 KB)
```

Esta es la forma **exacta** que pide la spec (`NEXT_PUBLIC_SUPABASE_URL=""`,
literal, no "apuntando a otro sitio"), y es distinta del estado del `.env`
de hoy — lo hice explícito porque confundir ambos habría sido dar por
verificado algo que no se probó. Después de esta prueba reconstruí con el
`.env` normal (`npm run build`, 0) para dejar `.next` en el estado que el
resto del ciclo esperaba.

## El criterio 5 con la app en pie

Cookies fabricadas (no necesitan ser sesiones reales — `signOutCustomer()`
borra por **nombre** de cookie, no por identidad, R19):

```
$ curl -s -i -X POST http://localhost:3100/api/account/logout \
    -H 'Cookie: qab-admin-session=fake-admin-value; qab-shopper-auth=fake-shopper-value; qab-shopper-hint=1' \
    | grep -i '^set-cookie\|^HTTP'
HTTP/1.1 303 See Other
set-cookie: qab-shopper-auth=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT
set-cookie: qab-shopper-hint=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT
```

Ninguna mención a `qab-admin-session` en el `Set-Cookie` de la respuesta.

Con una sesión de admin **real** (JWT HS256 firmado con
`ADMIN_SESSION_SECRET`, minted a mano con `jose` — necesitó rellenar
temporalmente `ADMIN_SESSION_SECRET`/`SSO_JWT_SECRET`/`CRON_SECRET` en
`.env`, ver § Entorno; revertido al terminar):

```
$ curl -s -o /dev/null -w '%{http_code}\n' --cookie "qab-admin-session=$JWT; qab-shopper-hint=1" \
    http://localhost:3100/admin
200
$ curl -s -i -X POST --cookie "qab-admin-session=$JWT; qab-shopper-hint=1" \
    http://localhost:3100/api/account/logout | grep -i '^set-cookie'
set-cookie: qab-shopper-hint=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT
$ curl -s -o /dev/null -w '%{http_code}\n' --cookie "qab-admin-session=$JWT" http://localhost:3100/admin
200
```

`/admin` en 200 con una cookie de cliente coexistiendo, y sigue en 200 tras
cerrar la sesión de cliente. Lo que falta —`/cuenta` en 200 a la vez— necesita
una sesión de **cliente** real, que es exactamente lo bloqueado (ver abajo).

## Lo que no se pudo verificar, y por qué (I7)

Un solo hecho de entorno explica los cuatro huecos de arriba (1a completo;
el positivo de D6 en criterio 2/4; el autocompletado de punta a punta y la
mitad de criterio 5 con sesión de cliente real): **este worktree no tiene un
proyecto Supabase con Auth real**. `NEXT_PUBLIC_SUPABASE_URL` apunta al
emulador de Storage (`http://localhost:54321`), que **no** sirve
`/auth/v1/*` — confirmado, no supuesto:

```
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:54321/auth/v1/user
404
```

Y no es un detalle esquivable con una cookie fabricada: leí
`node_modules/@supabase/auth-js/dist/module/GoTrueClient.js`, función
`getClaims()` — para un JWT firmado con secreto simétrico (HS256, el caso
normal de Supabase) el código **siempre** hace una llamada de red real a
`getUser()` (`<NEXT_PUBLIC_SUPABASE_URL>/auth/v1/user`) para confirmar la
firma; no hay verificación local posible. Contra un JWT RS256 intentaría
`fetchJwk()`, también red, también contra un endpoint que no existe aquí.
No hay ningún truco de cookie que sustituya esto sin un backend de Auth de
verdad — y fabricar uno (un servidor falso que conteste `/auth/v1/user`)
sería _simular_ el criterio, que es exactamente lo que me pidieron no hacer.

Lo que **sí** demuestra por HTTP real, sin necesitar ese backend: que una
cookie de sesión _presente pero no verificable_ (el único estado que este
entorno puede producir) hace que la identidad se resuelva a `null` y el
pedido/perfil/checkout sigan funcionando sin bloquear — que es literalmente
E17, el camino de "sesión irresoluble", ejercitado de verdad.

**Qué falta exactamente para desbloquear** (ya anotado en
`.agent/progress/F-012.md` § Bloqueado por, PP3): `NEXT_PUBLIC_SUPABASE_URL`
y `NEXT_PUBLIC_SUPABASE_ANON_KEY` de un proyecto Supabase de **desarrollo**
con Auth habilitado, los tres providers OAuth activados, la plantilla de
correo con `{{ .Token }}`, y `<NEXT_PUBLIC_SITE_URL>/auth/callback` en las
Redirect URLs.

## Fallos encontrados

Ninguno en el código de F-012. Lo único que encontré es el hueco de entorno
de arriba (`env-optional-secreto-vacio-rompe-serverenv`), que es anterior a
este feature y no lo toca: `SSO_JWT_SECRET`/`ADMIN_SESSION_SECRET`/
`CRON_SECRET` ya venían en `""` en `.env.example` desde antes de F-012.
Fichado, no vuelve a ningún agente de este feature — es una nota para quien
configure el entorno de desarrollo de admin/SSO, y ya lo dice
`bash .agent/sdd.sh playbook`.

## Huecos de cobertura

1. **Criterio 1a** (correo de punta a punta): sin ejecutar. Riesgo: ninguno
   de código nuevo — el flujo entero (`sendEmailOtp`/`verifyEmailOtp`,
   `mapEmailOtpError`) está probado con Supabase mockeado; lo no verificado
   es la integración real con GoTrue, en particular si el mapeo de
   `otp_expired → "invalid"` (impl.md § Notas) se siente correcto con un
   código caducado de verdad.
2. **D6 positivo** (Order.customerId enlazado con sesión válida, a nivel de
   HTTP+DB real): sin ejecutar. Riesgo: bajo — la pieza que decide el valor
   escrito (`createOrder()`'s `customerId = await customerLink`) está
   probada exhaustivamente mockeada, y la pieza que resuelve la sesión
   (`resolveOrderCustomerId`) también; lo no verificado es la integración
   entre "Supabase dice que el JWT es válido" y "se escribe la fila
   correcta", que no tiene ninguna lógica de F-012 en medio.
3. **Autocompletado de punta a punta con sesión real**: sin ejecutar.
   Riesgo bajo por el mismo motivo — la lógica de merge (`lo tecleado ?? lo
del perfil`) está probada en jsdom con un perfil mockeado idéntico en
   forma al que devolvería un `GET /api/account/profile` real.
4. **Criterio 5, `/cuenta` en 200 con sesión de cliente real, a la vez que
   `/admin`**: sin ejecutar. Riesgo mínimo — ambas mitades (admin en pie,
   logout de cliente sin tocar admin) están probadas reales; falta solo el
   otro lado del espejo.
5. **Verificación visual** (`design.md`, si trae pasos `V1..Vn` — no se pidió
   explícitamente en este ciclo y no se ejecutó; si el próximo ciclo lo
   pide, que quede como encargo explícito).

Los cinco huecos comparten la misma causa raíz (I7) y ninguno es un fallo de
código: son exactamente lo que el encargo de este ciclo anticipó.

## Veredicto

**`no-listo`** — únicamente por el criterio 1 (1a bloqueado por entorno,
D3). Los otros cinco criterios están verificados ejecutando algo, con su
comando y su salida real. En cuanto el humano deje el proyecto Supabase de
desarrollo con Auth (PP3), la ruta para cerrar 1a y los cuatro huecos
derivados está completamente escrita en
`.agent/specs/F-012/smoke.sh` § MANUAL, paso a paso, con sus asertos.

## Preguntas al humano

**TP1** — ¿Confirmas que el proyecto Supabase de desarrollo (PP3: Auth
habilitado, providers google/facebook/apple, plantilla de correo con
`{{ .Token }}`, `<NEXT_PUBLIC_SITE_URL>/auth/callback` en las Redirect
URLs) sigue pendiente de tu lado, o ya existe y solo falta que `.env` lo
apunte? Si ya existe, dame la URL/anon key (o dime dónde están) y repito
este ciclo completo hoy mismo — la mitad manual de `smoke.sh` queda escrita
paso a paso justamente para eso.

**TP2** — `SSO_JWT_SECRET`/`ADMIN_SESSION_SECRET`/`CRON_SECRET` en `""` en
`.env.example` (ficha `env-optional-secreto-vacio-rompe-serverenv`) es
anterior a F-012 y no depende de él. ¿Quieres que quede en el backlog como
mejora de DX (rellenar `.env.example` con placeholders válidos, o
documentar el paso en el README de desarrollo), o lo dejamos tal cual
porque nunca ha bloqueado nada hasta que alguien necesitó probar `/admin`
de verdad?
