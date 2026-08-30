---
feature: F-012
agente: sdd-tester
actualizado: 2026-08-30T03:20:00Z
estado: listo
veredicto: listo
---

> **Resumen de una línea**: tercer ciclo, en dos mitades. Escribí
> `.agent/specs/F-012/visual.mjs` traduciendo los 21 pasos `V1`-`V21` de
> `design.md` § Verificación visual (19 automatizados, `V6`/`V15` excluidos
> con motivo) y lo ejecuté de verdad: encontró **tres defectos reales**
> contra el diseño firmado (`V9`, `V13`, `V17`), así que dejé el
> `veredicto` en `no-listo` y lo mandé a `sdd-implementer` sin tocarlo yo.
> `sdd-implementer` arregló los tres —y de propina el `aria-live="off"`
> menor— sin tocar `visual.mjs`, `tests.md` ni el diseño. **Revalidé los
> tres arreglos yo mismo, con Playwright, contra el código real** (no me fié
> del informe): el patrón de foco de `ProfileForm.tsx` funciona en el primer
> Y en un segundo envío inválido seguido; quitar `maxLength` no dejó
> ningún caso peor (pegar más de 6 dígitos, o teclear más de 6 uno a uno,
> siguen recortando a 6 — el campo es controlado, `value={code}`, así que
> React resincroniza el DOM aunque el estado no cambie); el
> `aria-describedby` compuesto referencia dos ids reales y distintos, sin
> huérfanos. `bash .agent/verify.sh F-012 --visual` → **0**, corrido por mí
> (intento 72). `veredicto` vuelve a **`listo`**.

## Entorno de este ciclo

- **`next dev` propio**, puerto **3100**, cwd confirmado con
  `lsof -a -p <pid> -d cwd -Fn` (ficha `next-dev-uno-por-directorio`: el
  puerto 3000 de esta máquina sigue sirviendo
  `.orca-worktree-trash/wt-1787975564239-8d7709e1`, no este worktree).
- **`.env` de este worktree, confirmado antes de empezar y sin tocar en
  ningún momento** (verificado con `git status`/diff textual al cerrar,
  idéntico byte a byte a como estaba al abrir):
  `NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321"` — ahora sirve
  `/auth/v1/*` **de verdad** (F-028: `supabase-gateway`, no
  `storage-gateway`) — y `NEXT_PUBLIC_SUPABASE_ANON_KEY`/
  `SUPABASE_SERVICE_ROLE_KEY`/`STORAGE_JWT_SECRET` reales. **Novedad de
  este ciclo**: `SSO_JWT_SECRET`/`ADMIN_SESSION_SECRET`/`CRON_SECRET` ya
  vienen rellenos en este `.env` (a diferencia de `.env.example`, que los
  deja en `""` — F-029, sin arreglar, no es asunto de este ciclo): no hizo
  falta mintear temporalmente nada ni revertir después.
- **Docker**: `queandabuscando-auth`, `queandabuscando-auth-db`,
  `queandabuscando-mailpit`, `queandabuscando-supabase-gateway`,
  `queandabuscando-storage(-db)` y `queandabuscando-postgres`, todos `Up`
  y `healthy` al empezar y al terminar (no se tiró ningún contenedor).
- **Postgres**: igual que el ciclo anterior, vía
  `docker exec queandabuscando-postgres psql …` y `node -e` sueltos con
  `pg` (no hay `psql` en el `PATH` de este shell).

## Estrategia

Igual que el ciclo 1, más una capa nueva que antes no existía:

- **`*.test.ts`/`*.test.tsx`**: sin cambios de código de producto en este
  ciclo (no toqué `src/`, `prisma/` ni `package.json`), así que se
  revalidan corriéndolas de nuevo, no se dan por buenas de memoria.
- **HTTP + Postgres real** contra `next dev` (3100), igual que el ciclo 1.
- **Sesiones REALES**, la capa nueva: `node scripts/auth-otp.mjs --mode app`
  hace el ciclo completo de acceso por correo por las rutas **propias** de
  F-012 (`POST /api/account/otp`, `POST /api/account/otp/verify` — las
  mismas que llama `SignInCard`), sin humano, y deja la cookie de sesión en
  un archivo listo para usar con `curl`. Esto es lo que el ciclo 1 no podía
  hacer (I7) y ahora sí: cerrar el criterio 1a, el positivo de D6, el
  segundo login sin duplicar, y la mitad de criterio 5 con `/cuenta` en 200.
- **Un navegador real** (Chrome, vía la extensión MCP), para lo único que
  ni HTTP ni Postgres pueden demostrar: que el DOM del checkout **se ve**
  con los tres campos rellenos. Ejecutado una vez con evidencia (pantallas
  y fila de la base), documentado abajo; no queda en `smoke.sh` porque
  automatizarlo pediría Playwright, que este ciclo no pidió (ver
  `smoke.sh` § PARTE 2 y su razonamiento).
- `.agent/specs/F-012/smoke.sh` **reescrito**: la Parte 2 (MANUAL) del
  ciclo 1 pasa casi entera a la Parte 1 automatizada. Solo queda un
  párrafo de Parte 2, y explica por qué (el DOM del checkout, arriba).

## Mapa criterio → prueba

| #    | Criterio                                                      | Prueba ejecutada                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Comando                                                                                                                                                              | Resultado                                                                                                                                                                                                                                                                                                                                        |
| ---- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1a   | Correo, de punta a punta (D3)                                 | Ciclo completo por las rutas de F-012: pide el código, lo lee de Mailpit, lo canjea contra `POST /api/account/otp/verify`. Repetido **dos veces** en este informe: una vez a mano con `--email` fijo y verificación de conteo antes/después, y una vez **entero por pantallas reales** en un navegador (Chrome, MCP): `/cuenta/entrar` → escribir correo → pedir código → leerlo de Mailpit (API) → teclearlo → aterriza en `/cuenta` con el perfil (correo sembrado, teléfono/nombre vacíos, R9)                                                                                                                                                                                                          | `node scripts/auth-otp.mjs --mode app --app http://localhost:3100 --email <e> --cookie-jar <f> --json` (dos corridas, distintos correos) + navegación real en Chrome | **PASA**, dos veces. Corrida 1: exit 0, `Customer` 0→1 (delta exacto 1), `GET /cuenta` con la cookie → 200 con el correo en el HTML. Corrida por navegador: aterrizó en `/cuenta` con el perfil visible (captura tomada); fila en `Customer` confirmada por `psql`. Ver § Criterio 1a más abajo                                                  |
| 1b   | Google/Facebook/Apple por contrato + callback                 | Sin cambios de código desde el ciclo 1: se revalida corriendo la suite otra vez                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `npx vitest run --project server src/app/api/account/oauth/route.test.ts src/app/auth/callback/route.test.ts`                                                        | **PASA** — 13/13 (igual que el ciclo 1)                                                                                                                                                                                                                                                                                                          |
| 2    | Primer login crea `Customer`, segundo no duplica              | (a) `customers.db.test.ts` contra Postgres real, revalidado; (b) **con sesión real**: primer login de un correo nuevo → 1 fila; se guarda un nombre a mano (`PUT /api/account/profile`); segundo login del **mismo** correo → sigue habiendo 1 fila y el nombre **no** se pisó (E6/R10, E8/R12), ahora contra el backend de Auth real, no mockeado                                                                                                                                                                                                                                                                                                                                                         | `npx vitest run --project db …/customers.db.test.ts`; smoke.sh (bloque criterio 2)                                                                                   | **PASA**. Unit: 4/4. Real: `Customer` 0→1 tras el 1er login, sigue en 1 tras el 2º; `GET /api/account/profile` tras el 2º login sigue devolviendo `"name":"Smoke Segundo Login"` (ver salida abajo)                                                                                                                                              |
| 3    | Autocompletado en el checkout                                 | (a) unit, revalidado sin cambios; (b) **el hueco del ciclo anterior, cerrado**: con una sesión real y un perfil guardado desde `/cuenta` en el mismo navegador, `/tienda-demo/checkout` llega con los tres campos **ya rellenos** — capturado con pantallas, ver § Criterio 3 abajo; (c) lo que sí es automatizable sin navegador: `GET /api/account/profile` con la sesión trae exactamente el perfil guardado (el dato que `CheckoutForm.tsx` consume al hidratar)                                                                                                                                                                                                                                       | `npx vitest run --project ui …/CheckoutForm.autocomplete.test.tsx`; `npx vitest run --project server …/profile/route.test.ts`; navegador real + smoke.sh             | **PASA**. Unit: 5/5 y 7/7. Real (navegador): perfil guardado (`Navegador E2E` / `+5355599911` / `navegador-e2e@local.test`), checkout con los tres campos idénticos sin teclear nada, pedido confirmado (`NQ8XYCMH8N`) — ver captura. `GET /api/account/profile` con sesión: coincide byte a byte con lo guardado                                |
| 4    | Pedido de invitado sigue siendo posible                       | Igual que el ciclo 1, revalidado en este entorno: grep vacío, `place-order.mjs` 201 sin `Cookie`, R14 (inyección) ignorada sin sesión                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `git grep -rn "cookies()" src/features/orders/ "src/app/[slug]/"`; `QAB_BASE_URL=http://localhost:3100 node scripts/place-order.mjs`; smoke.sh                       | **PASA**, sin hueco. grep vacío; `place-order.mjs` 0 fallos; R14 sin sesión: 201, `customerId` NULL                                                                                                                                                                                                                                              |
| 4/D6 | El enlace del pedido con sesión (el hueco del ciclo anterior) | (a) **positivo real**: con la sesión de arriba, `POST /api/orders` (con `customerId` inyectado en cuerpo+query+cabecera) → 201, `Order.customerId` = el `id` real del `Customer` de esa sesión, ninguno de los tres valores inyectados; (b) **sesión CADUCADA de verdad** (no solo ilegible): un JWT HS256 firmado con el mismo secreto que usa el emulador (`STORAGE_JWT_SECRET` = `GOTRUE_JWT_SECRET`), `exp` en el pasado — confirmado que `/auth/v1/user` lo rechaza por «token is expired», no por firma — con esa cookie, el pedido sigue en 201 y `customerId` queda NULL (E17 real); (c) confirmado también de punta a punta en el navegador (checkout confirmado con sesión real, ver criterio 3) | curl directo (ver bloques abajo) + smoke.sh                                                                                                                          | **PASA**, sin hueco. (a): 201, `customerId` = `7d16b2d7-c4e7-491a-a640-0b567d6a154e` (el real), no `11111111…`/`22222222…`/`33333333…`. (b): sanidad `token is expired` confirmada; pedido 201, `customerId` NULL. (c): `Order` `NQ8XYCMH8N`.`customerId` = `d5f14131-de8d-4c0d-9b61-77e41a3b8f6e` = `Customer.id` de `navegador-e2e@local.test` |
| 5    | Cookies de cliente y admin no se pisan                        | (a)/(b)/(c) igual que el ciclo 1, revalidado; (d) **el hueco cerrado**: con una sesión de CLIENTE real (de arriba) y un JWT de admin real (minted con `ADMIN_SESSION_SECRET`, ya relleno en `.env` — no hizo falta revertir nada), `/admin` y `/cuenta` responden **200 a la vez**; tras `POST /api/account/logout`, `/admin` sigue 200 y `/cuenta` pasa a **307** (la sesión de cliente sí se cerró, la de admin no se tocó)                                                                                                                                                                                                                                                                              | `npx vitest run --project server …/customerSession.test.ts …/logout/route.test.ts`; smoke.sh                                                                         | **PASA**, sin hueco. Unit sin cambios. Real: `/admin` 200 y `/cuenta` 200 simultáneas; tras logout, `/admin` 200 y `/cuenta` 307                                                                                                                                                                                                                 |
| 6    | Sin Supabase Auth, tienda y checkout intactos                 | Repetido igual que el ciclo 1 — es el que más fácil se rompe ahora que Auth SÍ está configurado, así que se volvió a vaciar **las dos** variables, no se asumió nada del ciclo anterior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `NEXT_PUBLIC_SUPABASE_URL="" NEXT_PUBLIC_SUPABASE_ANON_KEY="" npm run build`; `npx next start -p 3102` (mismas vars); `place-order.mjs`; `check:bundle`              | **PASA**, sin hueco. Build 0; `/[slug]` sigue `●`, `/[slug]/checkout` sigue `ƒ`; `/tienda-demo` 200, `/cuenta/entrar` 200 con el aviso; pedido de invitado creado igual; `check:bundle` 177,6 KB / 193 KB                                                                                                                                        |

Transversal: `bash .agent/verify.sh F-012 --full` → **0** (harness · typecheck
· lint · format · test · prisma · build · theme · bundle, intento 51).
`bash .agent/verify.sh F-012 --smoke` → **0** (typecheck · lint · format ·
test · smoke, intento 50; log `.agent/runs/F-012/050-smoke.log`, 35
aserciones automatizadas en verde, 0 fallidas). `bash .agent/verify.sh
pending F-012` → vacío.

## Criterio 1a, el que llevaba toda la sesión anterior bloqueado

Dos ejecuciones independientes, ambas por las rutas propias de F-012:

**1 — script, con conteo antes/después:**

```
$ node scripts/auth-otp.mjs --mode app --app http://localhost:3100 \
    --email prueba1a+<epoch>@local.test --cookie-jar <archivo> --json
{"email":"prueba1a+1788047568@local.test","token":"432332","mode":"app",
 "message_id":"0h16BXcF8gqG9wNEzBtjIu",
 "profile":{"name":null,"phone":null,"email":"prueba1a+1788047568@local.test"},
 "cookie":"qab-shopper-auth=base64-…; qab-shopper-hint=1"}
$ echo $?
0
```

`Customer` con `supabaseUserId is not null`: **1 → 2** (delta exacto 1,
confirmado con `select count(*)`). `curl -H "Cookie: $COOKIE" .../cuenta` →
**200**, el correo aparece en el HTML.

**2 — navegador real (Chrome, extensión MCP), pantallas de F-012 tal cual
las vería una persona:**

1. `/cuenta/entrar` → escribir `navegador-e2e@local.test` → «Enviarme un
   código».
2. Código leído de Mailpit por su API (`168157`, asunto «168157 es tu
   codigo de acceso») — no a mano, con `curl http://localhost:54324/api/v1/…`.
3. Teclear el código → «Entrar».
4. **ASERTO** — el navegador aterriza en `/cuenta`, con el formulario de
   perfil (nombre y teléfono vacíos, correo sembrado — R9). Captura tomada.
5. `select count(*) from "Customer" where "supabaseUserId" is not null`:
   sube en exactamente 1 en este flujo también.

Los dos caminos dan el mismo resultado: `sendEmailOtp`/`verifyEmailOtp` y el
`ensureCustomerForUser` que dispara el primer login funcionan contra un
backend de Auth **real**, no mockeado.

## Criterio 3, de punta a punta con sesión real (el otro hueco cerrado)

Mismo navegador, misma sesión de arriba:

1. En `/cuenta`, guardar nombre «Navegador E2E» y teléfono `+5355599911`
   (correo ya venía de la sesión) → «Guardar cambios» → confirmación
   «Guardamos tus datos.».
2. Ir a `/tienda-demo`, agregar «Arroz blanco 1 kg» al carrito.
3. Ir a `/tienda-demo/checkout`.
4. **ASERTO** — los tres campos (`Nombre y apellidos`, `Teléfono`, `Correo
(opcional)`) llegan **ya rellenos** con exactamente lo guardado en el
   paso 1, sin teclear nada, bajo el aviso «Rellenamos tus datos guardados.
   Puedes cambiarlos.» Captura tomada.
5. «Confirmar pedido» → pedido `NQ8XYCMH8N` creado, con los mismos datos de
   contacto.
6. Contra Postgres:

```
$ docker exec -i queandabuscando-postgres psql -U postgres -d queandabuscando -c "
  select o.code, o.\"customerId\", c.id as customer_id, c.email
  from \"Order\" o left join \"Customer\" c on c.id = o.\"customerId\"
  where o.code = 'NQ8XYCMH8N';"
    code    |              customerId               |             customer_id               |          email
------------+----------------------------------------+----------------------------------------+--------------------------
 NQ8XYCMH8N | d5f14131-de8d-4c0d-9b61-77e41a3b8f6e   | d5f14131-de8d-4c0d-9b61-77e41a3b8f6e   | navegador-e2e@local.test
```

Cierra a la vez el criterio 3 (autocompletado real) y el positivo de D6
(el pedido queda enlazado con el `Customer` correcto) en un solo flujo por
pantallas, sin mocks en ningún punto.

## El positivo de D6 y R14 con sesión válida, por HTTP+DB directo

Con otra sesión real (`prueba1a-count+…@local.test`, perfil «Ana Sesion
Real» / `+5355512345`), atacando `POST /api/orders` con `customerId`
inyectado en cuerpo, query **y** cabecera **a la vez**, con la sesión
presente:

```
$ curl -s -w '\n%{http_code}' -X POST \
    'http://localhost:3100/api/orders?customerId=22222222-2222-2222-2222-222222222222' \
    -H 'Content-Type: application/json' \
    -H 'X-Customer-Id: 33333333-3333-3333-3333-333333333333' \
    -H 'Cookie: qab-shopper-auth=<sesión real>; qab-shopper-hint=1' \
    -d '{"storeSlug":"tienda-demo", …, "customerId":"11111111-1111-1111-1111-111111111111"}'
{"code":"Y65KSXEW6A", …}
201

$ docker exec -i queandabuscando-postgres psql -U postgres -d queandabuscando \
    -c "select code, \"customerId\" from \"Order\" where code='Y65KSXEW6A';"
    code    |              customerId
------------+--------------------------------------
 Y65KSXEW6A | 3ce33553-d32c-42cf-8847-2a77bb4bbfad
```

`3ce33553-d32c-42cf-8847-2a77bb4bbfad` es el `id` real de
`Customer` (email `prueba1a-count+…@local.test`) — **ninguno** de los tres
valores inyectados (`11111111…`/`22222222…`/`33333333…`). D6 (el pedido
enlaza con sesión válida) y R14 (la inyección se ignora, ahora **con**
sesión) quedan verificados a la vez, contra Postgres real.

## La sesión CADUCADA de verdad (no solo ilegible)

El ciclo anterior solo pudo probar una cookie **ilegible** (sin backend
que la verificara, cualquier valor no vacío daba el mismo resultado). Ahora
sí hay un backend real, así que se firmó un JWT **genuinamente caducado**
con el mismo secreto que usa el emulador (`STORAGE_JWT_SECRET` en `.env` =
`GOTRUE_JWT_SECRET` en `docker-compose.yml`), `exp` una hora en el pasado:

```
$ curl -s http://localhost:54321/auth/v1/user -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $JWT_CADUCADO"
{"code":403,"error_code":"bad_jwt","msg":"invalid JWT: unable to parse or
 verify signature, token has invalid claims: token is expired"}
```

Confirmado: lo rechaza por **expiración real**, no por firma inválida —
la diferencia exacta que E17 nombra entre «caducada» e «irresoluble». Con
esa cookie, el pedido:

```
$ curl -s -w '\n%{http_code}' -X POST http://localhost:3100/api/orders \
    -H 'content-type: application/json' -H "Cookie: qab-shopper-auth=<caducada>" -d '…'
{"code":"3NPX4ZY6XG", …}
201
$ … select "customerId" from "Order" where code='3NPX4ZY6XG';
(NULL)
```

201, `customerId` NULL — E17 con una sesión genuinamente caducada, no
simulada.

## Criterio 5, con las dos sesiones reales a la vez

```
$ COMBINED="qab-admin-session=$JWT_ADMIN_REAL; qab-shopper-auth=<sesión cliente real>; qab-shopper-hint=1"
$ curl -s -o /dev/null -w '%{http_code}\n' --cookie "$COMBINED" http://localhost:3100/admin
200
$ curl -s -o /dev/null -w '%{http_code}\n' --cookie "$COMBINED" http://localhost:3100/cuenta
200
$ curl -s -o /dev/null -X POST --cookie "$COMBINED" http://localhost:3100/api/account/logout
$ curl -s -o /dev/null -w '%{http_code}\n' --cookie "qab-admin-session=$JWT_ADMIN_REAL" http://localhost:3100/admin
200
$ curl -s -o /dev/null -w '%{http_code}\n' --cookie "qab-shopper-auth=<misma sesión cliente>" http://localhost:3100/cuenta
307
```

`/admin` y `/cuenta` en 200 **a la vez**, con dos sesiones reales y
distintas; tras cerrar la de cliente, `/admin` sigue 200 y `/cuenta` ahora
exige entrar (307): la sesión de cliente **sí** se cerró, la de admin
**no** se tocó. El JWT de admin sigue minted a mano (`jose` +
`ADMIN_SESSION_SECRET`) porque no hay SSO real de cuadrecaja en este
entorno — eso es F-029, no se tocó ni se arregló aquí; a diferencia del
ciclo anterior, esta vez `ADMIN_SESSION_SECRET` ya venía relleno en
`.env`, así que no hizo falta rellenar y revertir nada.

## Criterio 6, revalidado con Auth SÍ configurado en el `.env` normal

Es el que más fácil se rompe ahora que Auth **sí** está configurado (el
ciclo anterior lo cerró con Auth apuntando solo al emulador de Storage, un
entorno distinto). Se repitió exactamente igual, vaciando **las dos**
variables:

```
$ NEXT_PUBLIC_SUPABASE_URL="" NEXT_PUBLIC_SUPABASE_ANON_KEY="" npm run build
… 0
$ NEXT_PUBLIC_SUPABASE_URL="" NEXT_PUBLIC_SUPABASE_ANON_KEY="" npx next start -p 3102
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3102/tienda-demo      # 200
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3102/cuenta/entrar    # 200
$ curl -s http://localhost:3102/cuenta/entrar | grep -io "no está disponible"     # "no está disponible"
$ QAB_BASE_URL=http://localhost:3102 node scripts/place-order.mjs                 # 0 aserciones fallidas
$ npm run check:bundle
✓ Heaviest page: bodega-central/p/agua-natural-500-ml.html — 177.6 KB gzipped (budget 193 KB)
```

`/[slug]` sigue `●` y `/[slug]/checkout` sigue `ƒ` en ese build (tabla
completa capturada). Después de esta prueba se reconstruyó con el `.env`
normal (`npm run build`, 0) para dejar `.next` como el resto del ciclo
esperaba, y se paró el servidor de 3102.

## Qué cambió en `.agent/specs/F-012/smoke.sh`

Reescrito. La Parte 1 (automatizada) pasó de 15 a **35** aserciones: todo
lo que el ciclo 1 dejó en la Parte 2 (MANUAL) ahora corre con
`scripts/auth-otp.mjs --mode app` — criterio 1a completo, el segundo login
sin duplicar (criterio 2), el positivo de D6 y R14 **con** sesión, la
sesión caducada de verdad, y la mitad de criterio 5 con `/cuenta` y
`/admin` reales a la vez.

Queda **una sola cosa** en la Parte 2, y no por pereza: `CheckoutForm.tsx`
rellena los tres campos **en el cliente**, después de hidratar (un
`fetch("/api/account/profile")` en un efecto — confirmado leyendo el
componente). No hay nada de eso en el HTML que `curl` pueda ver; verificarlo
sin ojos humanos pediría Playwright (`.agent/specs/<ID>/visual.mjs`, el
mismo patrón que ya usan F-010/F-011/F-017/F-021/F-023), que **no se pidió
en este ciclo** — `design.md` no estaba en el encargo. Se dejó anotado en
`smoke.sh` que esto YA se verificó, real, en este ciclo (arriba, § Criterio
3), con el procedimiento exacto para repetirlo.

Si el humano quiere que ese último trozo de Parte 2 también se automatice,
el camino es escribir `.agent/specs/F-012/visual.mjs` sobre
`design.md` § Verificación visual (V19–V21 ya cubren exactamente este
caso) — trabajo de un ciclo con `--visual` explícitamente pedido, no de
este.

## Ciclo 3 — `.agent/specs/F-012/visual.mjs`, escrito y ejecutado

Encargo de este ciclo: `design.md` § Verificación visual quedó con 21 pasos
(`V1`-`V21`) escritos y ninguno ejecutado como guion — el ciclo 2 los
verificó una vez a mano por Chrome/MCP (criterio 3 y el positivo de D6) y
dejó el resto sin comprobar de ese modo. `bash .agent/sdd.sh done F-012` se
negaba a cerrar precisamente por eso: interfaz en `design.md` sin
`visual.mjs`.

**Qué quedó automatizado, y qué no:**

| Paso        | Estado                     | Detalle                                                                                                                                                                                                                                                                                                                                      |
| ----------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `V1`-`V5`   | automatizado, **pasa**     | Cabecera: glifo a 360/768, sin JS, sin salto de layout al hidratar (con y sin sesión), contraste WCAG del glifo y del punto en dos tiendas de marca distinta                                                                                                                                                                                 |
| `V6`        | **excluido, con motivo**   | `NEXT_PUBLIC_SUPABASE_URL=""` es una var `NEXT_PUBLIC_*` fijada por proceso (build/dev), no por request — apagarla exige un `next build`+`next start` aparte, con otra `.next`. Ya se hizo, real, con curl+build en tests.md § Criterio 6 (ciclo 2) y en `smoke.sh`; repetirlo con un segundo Chromium no prueba nada que el HTML no diga ya |
| `V7`-`V14`  | automatizado, **3 fallan** | `/cuenta/entrar`: tarjeta a 360, cambio de paso sin navegar, foco, teclado numérico, tres códigos incorrectos, cuenta atrás de 30s del reenvío, avisos `?aviso=*` sin JS. **`V9` y `V13` son los dos fallos reales de abajo**; `V12` tiene uno menor (`aria-live="off"` ausente)                                                             |
| `V15`       | **excluido, con motivo**   | Mismo motivo exacto que `V6` (misma variable, mismo problema de proceso-vs-request)                                                                                                                                                                                                                                                          |
| `V16`-`V18` | automatizado               | `/cuenta`: perfil relleno en el HTML con JS bloqueado, «Guardar cambios» deshabilitado hasta que algo cambia, cerrar sesión con carrito lleno. **`V17` es el tercer fallo real**                                                                                                                                                             |
| `V19`-`V21` | automatizado, **pasa**     | Checkout: invitado de punta a punta hasta el comprobante, perfil aplicado con la red lenta sin pisar lo tecleado ni mover el cursor, el ida-y-vuelta completo de D4 (entra → entrar → volver) con el carrito y los campos intactos, y el aviso de «se pierde lo que escribiste»                                                              |

19 de 21 pasos quedaron con guion ejecutable (16 en verde, 3 en rojo por
defectos reales); 2 (`V6`, `V15`) quedaron fuera con su motivo escrito, no
fingidos.

Corrido dos veces de forma idéntica (una vez a mano contra `next dev`
propio en el puerto 3105, otra vez con `bash .agent/verify.sh F-012
--visual` reutilizando ese mismo servidor — ficha `next-dev-uno-por-
directorio`): mismas 4 líneas `VISUAL FAIL`, ninguna intermitente.

**Un guion previo tropezó con un enfriamiento real de Auth** (pedir un
segundo código para el MISMO correo casi de inmediato → `429
RATE_LIMITED`, no un bug de F-012) — fichado en
`.agent/playbook/otp-mismo-correo-inmediato-429-rate-limited.md` para quien
escriba el próximo guion contra OTP real.

### Los tres hallazgos reales (nuevos este ciclo, no vistos en los ciclos 1-2 porque no había guion que los ejecutara)

**1 — `V9`, el pegado del código pierde un dígito.** `design.md` § 2 dice
literalmente: «pegar `123 456` o `Tu código es 123456` desde el
portapapeles deja `123456`». Comprobado con un pegado **real** (
`navigator.clipboard.writeText` + `Ctrl/Cmd+V`, no `.fill()`): pegar
`"123 456"` deja `"12345"` (**pierde el último dígito**); pegar `"Tu código
es 123456"` deja **la cadena vacía**. Causa: `signin-code` tiene
`maxLength={OTP_CODE_LENGTH}` (6) — el navegador trunca el texto pegado a 6
**caracteres crudos** (contando el espacio o las letras) **antes** de que
`handleCodeChange` filtre los no-dígitos, así que el filtrado nunca ve el
dígito que quedó fuera del corte.
`src/features/account/components/SignInCard.tsx:413-426`. Severidad: media
— el pegado con el formato exacto que Mailpit/el correo suelen producir
(código con espacio, o precedido de texto) no funciona como el diseño
promete; teclear dígito a dígito sigue funcionando siempre.
**→ `sdd-implementer`.**

**2 — `V13`, `id="signin-code-help"` duplicado.** Dos elementos del DOM
comparten ese id a la vez: el párrafo fijo «Te mandamos un código de 6
dígitos a {email}.» (`SignInCard.tsx:381`) y el `<p id={helpId}>` que
genera `Field` para su propio `help="Escribe los 6 dígitos."`
(`src/components/ui/Field.tsx:27,38`) — ambos derivan el mismo id porque
`Field` compone `${id}-help` a partir de `id="signin-code"`. HTML inválido
(un id debe ser único) y `aria-describedby="signin-code-help"` en el
`<input>` queda apuntando a una referencia ambigua: qué texto compone
realmente un lector de pantalla como "descripción" del campo depende de la
implementación del user-agent, no de lo que dice el marcado. Severidad
media — el efecto observado en Chromium (usa el primer nodo, que es el
correcto) puede no ser el mismo en otro navegador/lector. **→
`sdd-implementer`.**

**3 — `V17`, el foco no salta al resumen de errores en `/cuenta`.**
`design.md` V17: «el foco salta al resumen de errores». El resumen
(`<div role="alert" tabIndex={-1}>` en `ProfileForm.tsx:105-124`) se
renderiza bien y con el mensaje correcto, pero **nadie lo enfoca**:
`ProfileForm.tsx` no tiene el `useRef`+`useEffect` que sí tiene el mismo
patrón en `src/features/cart/components/CheckoutForm.tsx:114,125,233`
(`summaryRef.current?.focus()` en un efecto disparado por
`[attempted, fieldErrors]`). Confirmado en el navegador real: tras un envío
inválido, `document.activeElement` se queda en `<body>`. Alguien que
navegue solo con teclado o con un lector de pantalla no se entera de que
el envío falló hasta que tropieza con el resumen por accidente. Severidad
alta — es exactamente el caso de uso que la regla existe para cubrir, y ya
existe el patrón correcto en el mismo repo para copiar. **→
`sdd-implementer`** (el arreglo es replicar el patrón de
`CheckoutForm.tsx`: un ref en el contenedor del resumen + un efecto que lo
enfoque cuando cambian los errores).

Un cuarto hallazgo, de severidad baja y con el efecto observable ya
correcto por casualidad: `design.md` § 2 pide `aria-live="off"` en el
número de la cuenta atrás del reenvío («el segundero no se le lee a
nadie»); el botón de `SignInCard.tsx` no lleva ese atributo. Un `<button>`
sin `aria-live` tampoco es una región activa por defecto, así que el
efecto práctico (nadie escucha el segundero) ya se cumple — pero el
atributo explícito que pide el diseño no está. No lo elevo a
`sdd-implementer` con la misma urgencia que los tres de arriba; lo dejo
anotado por si se quiere alinear el código a la letra del diseño.

## Ciclo 3, segunda mitad — los tres arreglos, revalidados por mí

`sdd-implementer` arregló los tres defectos de arriba **sin tocar
`visual.mjs`, `tests.md`, `design.md` ni `plan.md`** (se lo pidió el
humano expresamente). No me fié del informe: leí el `git diff` de los dos
archivos que sí tocó y volví a ejecutar Playwright a mano contra el código
real, con las preguntas críticas que importan para cada uno — no solo "¿el
síntoma desapareció?", sino "¿la causa quedó resuelta, o solo se tapó un
caso?".

**V17 — `ProfileForm.tsx`.** El diff añade `summaryRef`/
`wantsSummaryFocusRef` y un `useEffect([outcome])` que llama
`summaryRef.current?.focus()` — el MISMO patrón, con los MISMOS nombres,
que `CheckoutForm.tsx:114-125,232-238` (comparado línea por línea). La
diferencia de dependencia (`[outcome]` en vez de `[attempted, fieldErrors]`)
es correcta: `outcome` es un objeto NUEVO en cada `save()` (tanto en la
transición a `"saving"` como a `"invalid"`), así que cambia de identidad en
cada intento — no hace falta más para que el efecto vuelva a correr en
cada fallo, no solo en el primero. Comprobado en el navegador, dos veces
seguidas: primer envío inválido → foco en el `<div role="alert">`; SEGUNDO
envío inválido inmediato (mismo tipo de error) → el foco vuelve a caer ahí,
no se queda en `<body>` ni en el campo. Antes del arreglo, el mismo guion
daba `{"tag":"BODY"}` las dos veces.

**V9 — `SignInCard.tsx`, sin `maxLength`.** Confirmado que quitar el
atributo no deja un caso peor, las tres preguntas que pedía el encargo:

- Pegar `"123 456"` (con espacio) → `"123456"` (antes: `"12345"`, perdía un
  dígito).
- Pegar **más** de 6 dígitos, `"1234567890"` → el valor del campo queda en
  `"123456"` (los primeros 6), no crece sin límite.
- Teclear dígito a dígito **más allá de 6** (`pressSequentially` con 8
  dígitos reales, uno a uno, no `.fill()`) → el valor del campo se queda en
  `"123456"`, 6 caracteres, no `"12345678"`. Esto no es obvio de memoria:
  sin `maxLength`, cuando el 7.º dígito llega, `handleCodeChange` calcula
  `digits = "1234567".replace(/\D/g,"").slice(0,6)` = `"123456"` — el
  MISMO valor que ya tenía `code` — y `setState` con un valor idéntico no
  dispara un re-render por sí solo. Lo que evita que el DOM se quede con el
  carácter de más es que React trackea el valor de un `<input>` controlado
  (`value={code}`) por su cuenta y lo resincroniza en cada evento nativo,
  incluso sin un re-render completo — comprobado empíricamente, no asumido:
  el valor del campo en el DOM real se quedó en 6 caracteres en los tres
  casos, nunca más.
- La comprobación automática al llegar los seis de golpe (`arrivedAllAtOnce`)
  sigue exactamente igual (`V8`/`V9` del guion siguen en verde): pegar 6
  dígitos limpios sigue comprobando solo, teclear uno a uno sigue sin
  comprobar solo.

**V13 — `SignInCard.tsx`, sin tocar `Field.tsx`.** El párrafo del correo
pasó a `id="signin-code-recipient"` (antes compartía `"signin-code-help"`
con el que genera `Field` para su propio `help`). El `<input>` compone
`aria-describedby` con AMBOS ids
(`["signin-code-recipient", props["aria-describedby"]].filter(Boolean).join(" ")`).
Confirmado en el DOM real: cero ids duplicados; `aria-describedby` vale
`"signin-code-recipient signin-code-help"` en el estado normal y
`"signin-code-recipient signin-code-error"` tras un código incorrecto —
los dos ids referenciados existen, cada uno una sola vez, ninguno quedó
huérfano. `Field.tsx` no se tocó, como decía el informe: el primitivo
seguía generando `${id}-help` igual que siempre, la colisión era de
`SignInCard.tsx` reusando ese mismo sufijo para su propio párrafo fijo.

**`aria-live="off"`** en el botón de reenvío: presente, confirmado con
`getAttribute`.

**Los tres arreglan la causa, no el síntoma**: V17 añade el mecanismo de
foco que faltaba (no oculta el fallo con, por ejemplo, un `autoFocus` que
solo funcionara la primera vez); V9 quita la capa que truncaba antes de
filtrar en vez de intentar reordenar o interceptar el evento de paste; V13
le da al párrafo del correo su propia identidad en vez de renombrar el id
que genera `Field` (que habría movido la colisión a cualquier otro sitio
que reusara `Field` con un `help` fijo).

**Verificación final, ejecutada por mí, no leída de ningún informe:**

```
$ bash .agent/verify.sh F-012 --visual   # intento 72
typecheck ✓ · lint ✓ · format ✓ · test ✓ · visual ✓ (74s)
PASA
$ echo $?
0
$ bash .agent/verify.sh F-012 --full     # intento 73
harness ✓ · typecheck ✓ · lint ✓ · format ✓ · test ✓ · prisma ✓ · build ✓ · theme ✓ · bundle ✓
PASA
$ echo $?
0
$ bash .agent/verify.sh F-012 --smoke    # intento 74
typecheck ✓ · lint ✓ · format ✓ · test ✓ · smoke ✓
PASA
$ echo $?
0
$ bash .agent/verify.sh pending F-012
(vacío)
```

Los 19 pasos automatizados de `visual.mjs` en verde, `V6`/`V15` siguen
excluidos con su motivo (sin cambios: siguen necesitando un
`NEXT_PUBLIC_SUPABASE_URL=""` fijado por proceso, no por request). `pending`
vacío de verdad esta vez: la entrada que dejé pendiente a propósito
(`visual:VISUAL FAIL pegar "123 456"…`) la cerró
`sdd-implementer` fichando la lección real
(`.agent/playbook/otp-codigo-paste-truncado-por-maxlength-antes-de-filtrar.md`),
no descartándola.

## Fallos encontrados

**Tres fallos reales, encontrados por `visual.mjs` porque nadie había
ejecutado los pasos `V9`, `V13` y `V17` de `design.md` como guion hasta
este ciclo** — ver § Ciclo 3 arriba para el detalle de cada uno, con su
`archivo:línea`. Los tres ya están arreglados por `sdd-implementer` y
revalidados por mí de forma independiente (§ Ciclo 3, segunda mitad):
`ProfileForm.tsx` (foco al resumen de errores), `SignInCard.tsx` (el
pegado del código, y el id duplicado). Ninguno de los tres tocó el código
que el ciclo 2 verificó (sesiones reales, D6, R14, sesión caducada,
cookies de cliente/admin, criterio 6) — y `--full`/`--smoke` corridos al
final de este ciclo (0 y 0) lo confirman sin dejarlo por sentado.
`bash .agent/verify.sh pending F-012` queda **vacío**: la entrada que dejé
pendiente a propósito (no la dismisseé, porque enseñaba algo real) la
cerró `sdd-implementer` fichando la lección
(`.agent/playbook/otp-codigo-paste-truncado-por-maxlength-antes-de-filtrar.md`),
que es la forma honesta de cerrarla — no descartándola.

## Huecos de cobertura

1. ~~La verificación visual del checkout (`design.md` V19-V21) no se
   automatizó~~ — **cerrado en el ciclo 3**: `.agent/specs/F-012/visual.mjs`
   ahora la ejecuta como guion (V19, V20 y V21 en verde), repetible con
   `bash .agent/verify.sh F-012 --visual`.
2. **`V6`/`V15` de `design.md`** siguen sin automatizar en `visual.mjs`, con
   su motivo escrito (no fingido): ambos necesitan
   `NEXT_PUBLIC_SUPABASE_URL=""`, una variable `NEXT_PUBLIC_*` que Next fija
   por proceso (build o `next dev`), no por request — el único servidor que
   recibe `--visual` ya está arriba con el `.env` normal (Auth configurado).
   Apagarla exigiría un `next build`+`next start` aparte, con otra `.next`,
   dentro del mismo guion — y eso ya se hizo, real, con curl+build (ciclo 2,
   § Criterio 6 / `smoke.sh`): repetirlo con un segundo Chromium no prueba
   nada que el HTML no diga ya. Riesgo bajo.
3. **Google, Facebook y Apple**: por diseño de F-028 (§ «Hasta dónde llega
   esto, y dónde no»), solo llegan al 302 de salida (Apple ni eso, se
   observa sin aserto) — un consentimiento real de un usuario en el
   proveedor no es reproducible en local con ninguna herramienta honesta.
   No es un hueco de este ciclo: es un límite permanente, documentado, y es
   exactamente el tema de § Preguntas al humano.

## Veredicto

**`listo`.** El ciclo 3 pasó por dos mitades: primero `no-listo`, porque
`visual.mjs` (el guion que `design.md` ya exigía y nadie había ejecutado)
encontró tres defectos reales contra el diseño firmado (`V9`, `V13`,
`V17` — § Ciclo 3), y por instrucción de ese mismo ciclo eso no me tocaba
arreglarlo: lo mandé a `sdd-implementer` sin tocarlo yo. `sdd-implementer`
arregló los tres sin tocar `visual.mjs`, `tests.md`, `design.md` ni
`plan.md`. **Yo misma revalidé los tres arreglos** con Playwright contra
el código real, no contra el informe (§ Ciclo 3, segunda mitad): el patrón
de foco de `ProfileForm.tsx` es el mismo de `CheckoutForm.tsx`, línea por
línea, y funciona en el primer envío inválido y en un segundo seguido;
quitar `maxLength` no dejó ningún caso peor de los tres que pedía revisar
(paste con más de 6 dígitos, teclear más de 6 uno a uno, la comprobación
automática al llegar 6 de golpe); el `aria-describedby` compuesto
referencia dos ids reales, ninguno huérfano, sin tocar `Field.tsx`. Volví
a ejecutar `bash .agent/verify.sh F-012 --visual` (→ 0, intento 72),
`--full` (→ 0, intento 73) y `--smoke` (→ 0, intento 74) yo misma, y
`pending F-012` queda vacío.

Los seis `acceptance_criteria` de `features.json` siguen verificados
ejecutando algo, con comando y salida real — nada de eso se tocó ni se
aflojó en ningún momento de este ciclo, y el criterio 1 sigue `listo`
según su propia partición (D3): 1a de punta a punta (dos veces, con y sin
navegador), 1b por contrato (13/13, sin red). Mi reserva sobre si esa
partición basta para la redacción literal del criterio sigue en TP1, sin
cambios, y sigue siendo una decisión del humano, no mía.

## Preguntas al humano

**TP1 — ¿La partición D3 del criterio 1 (correo de punta a punta + los tres
proveedores por contrato/302) basta para marcar `"passes": true`, o la
redacción literal («Se puede iniciar sesión con Google, Facebook, Apple y
correo») exige un login real y completo con las cuatro marcas?**

Mi lectura, sin maquillarla en ninguna dirección: D3 fue una decisión de
`sdd-spec` al escribir la spec (no una reaprobación explícita del humano
sobre el criterio ya escrito en `features.json`), y opera el criterio
como «correo real + los otros tres, verificados hasta donde honestamente se
puede sin cuentas de terceros y sin fingir un backend de OAuth». Ejecuté
exactamente esa partición, las dos mitades, con evidencia real. Pero un
lector nuevo de esa única línea en `features.json` —«Google, Facebook,
Apple y correo»— razonablemente esperaría haber visto un login real con
las cuatro, y **eso nunca va a ser posible en este entorno**: Google y
Facebook exigen el consentimiento de una cuenta real en su propio dominio
(F-028 llega hasta el 302, no más allá, y no hay forma honesta de ir más
allá sin apps de terceros dadas de alta y cuentas reales), y Apple exige
además un Team ID y una clave privada reales incluso para _configurar_ el
proveedor.

Dos caminos, ninguno lo decido yo:

- **(a)** Aceptar `"passes": true` con la partición D3 tal como quedó
  verificada (mi recomendación, si el objetivo es que el feature funcione
  y esté probado hasta donde es razonable probarlo en local) — dejando
  constancia en las `notes` de `features.json` de qué exactamente cubre
  «Google/Facebook/Apple» (302 de salida verificado, no un login completo).
- **(b)** Si se quiere el login completo con las cuatro marcas como
  condición literal de cierre, este criterio **no puede cerrarse nunca**
  desde este repo sin salir a producción con apps de terceros dadas de
  alta y cuentas reales — en cuyo caso habría que reescribir el criterio
  en `features.json` (regla 3, decisión tuya) para reflejar ese límite, o
  aceptar que quede permanentemente fuera del alcance automatizable.

**TP2** (heredada del ciclo anterior, sigue sin resolverse y sigue sin ser
de F-012): `SSO_JWT_SECRET`/`ADMIN_SESSION_SECRET`/`CRON_SECRET` en `""` en
`.env.example` (ficha `env-optional-secreto-vacio-rompe-serverenv`, F-029).
Este ciclo no la sufrió porque el `.env` de este worktree ya las traía
rellenas, pero `.env.example` (lo que ve cualquiera que arranque de cero)
sigue sin arreglar. ¿Sigue en el backlog como mejora de DX, o se descarta?
