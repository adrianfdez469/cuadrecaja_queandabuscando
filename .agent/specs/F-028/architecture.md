---
feature: F-028
agente: sdd-architect
actualizado: 2026-08-29T18:59:22Z
estado: listo
---

> Este documento responde, una por una, a las **nueve** decisiones que
> `.agent/specs/F-028/spec.md` § No decidido a propósito me dejó por nombre.
> Todo lo que allí llegaba como «insumo» está aquí confirmado —con la fuente
> consultada hoy— o cambiado con motivo. Las decisiones ya cerradas del humano
> (D2: sin OIDC de mentira; D4: el gateway se renombra con aviso; D5: sin
> diseñador) no se reabren.
>
> No hay preguntas abiertas: **estado: listo**.

## Estado actual relevante

### Lo que ya existe y se reutiliza tal cual

| Pieza                                                                                                | Qué aporta a F-028                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.yml`, servicios `storage-db` / `storage` / `storage-gateway` / `storage-bucket-init` | El **patrón entero**: imagen con versión fijada, base propia con volumen propio, `${VAR:?mensaje}` para fallar con instrucciones, healthchecks, init de un disparo. |
| `docker/storage-gateway.conf`                                                                        | El nginx que ya traduce `/storage/v1/` → `storage:5000/`. Gana una `location` hermana y cambia de nombre (D4).                                                      |
| `docker/storage-roles.sql`                                                                           | El precedente literal de «roles al estilo Supabase creados por `docker-entrypoint-initdb.d`, que **solo corre con el volumen vacío**».                              |
| `scripts/storage-dev-keys.mjs`                                                                       | El secreto HS256 y los dos JWT locales, ya generados por máquina y ya fuera de git. Auth **no añade ninguna clave**: lee los mismos (R2).                           |
| `.agent/init.sh:83-94` (bloque `== Storage ==`)                                                      | La forma exacta del aviso opcional: `warn`, nunca `bad`, con el comando literal.                                                                                    |
| `.agent/verify.sh`                                                                                   | El sensor. `--full` no toca el emulador; `--smoke` levanta `next dev` y ejecuta el guion del feature.                                                               |
| `.github/workflows/ci.yml`                                                                           | Dos jobs (`verify`, `visual`). El patrón de «un job aparte para lo que cuesta minutos» ya está establecido por `visual`.                                            |

### Lo que el código de F-012 exige de Auth, y que por tanto no es negociable

Leído hoy, no supuesto:

- `src/app/api/account/otp/route.ts` → `sendEmailOtp` → `supabase.auth.signInWithOtp({ email })`.
  **Sin `shouldCreateUser: false`**, así que un correo nuevo es un **alta**: GoTrue
  manda la plantilla `confirmation`, no la `magic_link`. Un correo repetido manda la
  `magic_link`. Hay que configurar **las dos**.
- `src/app/api/account/otp/verify/route.ts` → `verifyEmailOtp` →
  `supabase.auth.verifyOtp({ email, token, type: "email" })`.
  Verificado en `internal/api/verify.go` de `supabase/auth` v2.196.0: el tipo `email`
  (`EmailOTPVerification`) prueba **confirmation_token y recovery_token**, así que
  cubre alta y reentrada con la misma llamada. No hace falta tocar nada.
- `src/features/account/schemas.ts` → `token: z.string().trim().length(OTP_CODE_LENGTH).regex(/^\d+$/)`,
  con `OTP_CODE_LENGTH = 6` en `src/constants/account.ts`. **Consecuencia dura**: el
  repliegue «leer el token del enlace» que la spec contempla en su riesgo (a) sirve
  para el criterio 2 pero **no para el criterio 3** — el enlace lleva un `token_hash`
  de 56 caracteres hexadecimales y esa ruta lo rechaza con 400 antes de hablar con
  Auth. El código de 6 dígitos en el cuerpo del correo no es una preferencia: es la
  única forma de cerrar el criterio 3.
- `src/lib/supabase/server.ts` fija `cookieOptions.name` a `qab-shopper-auth`
  (`src/constants/account.ts`). Nada de F-028 cambia eso.
- `src/features/account/server/customers.ts` → `ensureCustomerForUser` hace `upsert`
  por `supabaseUserId` con `update: {}`. Es lo que hace que E6 dé **exactamente +1**
  la primera vez y **+0** las siguientes.

### Lo que hoy falta y produce el bloqueo

`docker/storage-gateway.conf` solo conoce `location /storage/v1/`, así que
`GET http://localhost:54321/auth/v1/user` responde 404 de nginx. No hay contenedor
de Auth, no hay captura de correo, y `.env` ya apunta `NEXT_PUBLIC_SUPABASE_URL`
a ese mismo origen.

## Decisión

**Tres servicios nuevos en `docker-compose.yml` —y ni uno más— más una `location`
en el nginx que ya existe, que pasa a llamarse `supabase-gateway`.** El token de
6 dígitos viaja por **dos** caminos independientes (asunto inline y cuerpo servido
por ese mismo nginx), y un guion de Node cierra el ciclo sin humano.

Los tres servicios son el mínimo que la spec ya había contado: Auth, su base de
datos propia y el capturador de correo. **El cuarto servicio que uno estaría
tentado de añadir —un httpd que sirva la plantilla de correo— no se añade**: lo
sirve el gateway, que ya es un nginx en la misma red y cuyo único trabajo es
servir. Esto es literalmente el criterio de abandono heredado de F-011 aplicado
antes de tropezar con él, no después.

Alternativas descartadas, una línea cada una:

- **Kong en vez de nginx** — es la pieza del stack completo y trae configuración
  desproporcionada; el precedente de F-011 (decisión 3) ya la descartó por lo mismo.
- **Un contenedor propio para servir la plantilla** — cuarto servicio, y el gateway
  ya lo hace con tres líneas.
- **`supabase/gotrue` en vez de `supabase/auth`** — mismo binario, nombre viejo;
  queda como repliegue documentado, no como elección.
- **Inbucket en vez de Mailpit** — también tiene API, pero Mailpit trae además
  borrado por búsqueda (`DELETE /api/v1/search`), que es exactamente lo que R10 pide.
- **Meter el esquema `auth` en la base de la app** — R6 lo prohíbe y el criterio 6
  lo mediría; además `docker-entrypoint-initdb.d` no correría nunca sobre
  `queandabuscando-pgdata`, que ya tiene datos.
- **Un perfil de compose (`profiles:`) para Auth** — haría que `docker compose up -d`
  **no** lo levantara, y el criterio 1 exige justo lo contrario.
- **Una segunda variable de URL para Auth** — sería tocar `src/`, fuera de alcance (R3).

## Las nueve decisiones que la spec me dejó, resueltas

| #     | Decisión                                | Resuelta así                                                                                                                                                                                 |
| ----- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | Imagen y versión de Auth                | `supabase/auth:v2.196.0`. **Confirmado hoy** contra la API de Docker Hub y la de releases de GitHub: es la última **estable** (2026-08-18); lo más nuevo son `v2.197.0-rc.*`, que no entran. |
| **2** | Capturador de correo                    | `axllent/mailpit:v1.31.0` (2026-08-22, confirmado igual). API de lectura, de búsqueda y de borrado por búsqueda; sin volumen, bandeja en memoria.                                            |
| **3** | Servicios, red, volúmenes, `proxy_pass` | `auth-db`, `auth`, `mailpit`; **red por omisión del compose**, sin red nueva; volumen `queandabuscando-auth-pgdata` solo para `auth-db`; `proxy_pass http://auth:9999/;`.                    |
| **4** | `NEXT_PUBLIC_SUPABASE_URL`              | **No cambia**, confirmado. `http://localhost:54321` sirve las dos APIs, como Kong en el Supabase real.                                                                                       |
| **5** | Variables concretas de Auth             | Tabla completa en § Contratos › Configuración de `auth`. Las que importan: `MAILER_OTP_EXP=300`, `RATE_LIMIT_EMAIL_SENT=1000000/1h`, `SMTP_MAX_FREQUENCY=1s`, `URI_ALLOW_LIST` con comodín.  |
| **6** | Cómo llega el token al correo           | **Dos caminos**: asunto inline (`MAILER_SUBJECTS_*`, sin red) y cuerpo servido por el gateway (`MAILER_TEMPLATES_*`, HTTP). El asunto es el **diagnóstico**; el cuerpo es el que se exige.   |
| **7** | Cómo se levanta en CI                   | Un **job nuevo** que escribe `.env` con un heredoc, genera las claves con `node scripts/storage-dev-keys.mjs --write`, hace `docker compose up -d` y corre el smoke. Cero `secrets.`.        |
| **8** | Las claves locales                      | Sin cambios: `scripts/storage-dev-keys.mjs` sigue acuñando las mismas tres. **`STORAGE_JWT_SECRET` no se renombra.** Solo cambia el mensaje final del guion (E15).                           |
| **9** | El guion                                | scripts/auth-otp.mjs (por crear), dos modos (`gotrue` y `app`), salida `clave=valor` o `--json`, seis códigos de salida distintos. Detalle en § Contratos › El guion.                        |

### Por qué la 1 y la 2 se fijan y no se dejan flotar

Es la regla que F-011 ya aplicó con `supabase/storage-api:v1.71.0`: versión exacta,
**nunca `latest`**. Fuentes consultadas hoy, 2026-08-29:

- `https://hub.docker.com/v2/repositories/supabase/auth/tags` → `v2.196.0`
  (2026-08-18) es la última sin sufijo `-rc`; por encima solo hay `v2.197.0-rc.6/7/8`.
- `https://api.github.com/repos/supabase/auth/releases` → `v2.196.0` con
  `prerelease: false`; los `rc2.197.0-*` con `prerelease: true`.
- `https://hub.docker.com/v2/repositories/axllent/mailpit/tags` y las releases de
  `axllent/mailpit` → `v1.31.0` (2026-08-22).
- El compose oficial de Supabase (`supabase/supabase`, `docker/docker-compose.yml`)
  sigue en `supabase/gotrue:v2.189.0`. Ese es el **repliegue** si `v2.196.0` diera
  problemas: mismo proyecto, mismo binario, nombre anterior al renombrado.

## Componentes

Todo es **infra**. Ninguna capa de `AGENTS.md` § Arquitectura se toca: no hay
archivos en `src/`, ni en `prisma/`, ni en `package.json`.

| Componente              | Capa                | Responsabilidad                                                                                                                     | Archivo                                                                          |
| ----------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `auth-db`               | infra (compose)     | Postgres propio de GoTrue. Esquema `auth`, rol `supabase_auth_admin`, volumen propio. **Sin puerto en el host.**                    | `docker-compose.yml`                                                             |
| Roles e inicialización  | infra (SQL de init) | `create role supabase_auth_admin` + `create schema auth`. Solo corre con el volumen vacío, igual que su gemelo de Storage.          | docker/auth-roles.sql (por crear)                                                |
| `auth`                  | infra (compose)     | `supabase/auth:v2.196.0`. Corre sus migraciones y sirve la API. **Sin puerto en el host**: solo por el gateway (R3).                | `docker-compose.yml`                                                             |
| `mailpit`               | infra (compose)     | SMTP en 1025 (interno) + API/UI en 8025, publicada en el host como **54324**. Bandeja en memoria.                                   | `docker-compose.yml`                                                             |
| `supabase-gateway`      | infra (compose)     | El `storage-gateway` de hoy, renombrado (D4). Dos `location` de API más una de plantillas de correo. Sigue publicando **54321:80**. | `docker-compose.yml`                                                             |
| Configuración de nginx  | infra (conf)        | `location /auth/v1/` → `auth:9999/`; `location /storage/v1/` intacta; `location /dev-mail/` sirviendo la plantilla.                 | docker/supabase-gateway.conf (por crear, renombra `docker/storage-gateway.conf`) |
| Plantilla de correo     | infra (HTML)        | HTML mínimo con `{{ .Token }}` y `{{ .ConfirmationURL }}`. Sin nada con forma de clave.                                             | docker/auth-email-otp.html (por crear)                                           |
| Guion del ciclo OTP     | `scripts/`          | Pide el código, lo lee de Mailpit, lo canjea, imprime el `user.id`. Dos modos: contra Auth y contra la app.                         | scripts/auth-otp.mjs (por crear)                                                 |
| Smoke del feature       | `.agent/specs/`     | Criterios 1, 2, 3 y 8, más la observación de Apple (E9) y la limpieza de R12.                                                       | .agent/specs/F-028/smoke.sh (por crear)                                          |
| Aviso de entorno        | infra (arnés)       | Bloque `== Auth ==`, `warn` y **nunca** `bad`; más la detección del contenedor viejo del gateway (E16).                             | `.agent/init.sh`                                                                 |
| Rotación de claves      | `scripts/`          | El mensaje final nombra también los servicios de Auth (E15). Dos líneas.                                                            | `scripts/storage-dev-keys.mjs`                                                   |
| Job de CI               | infra (CI)          | Levanta el emulador y ejecuta los criterios 2 y 3 (I7). Sin ningún `secrets.`.                                                      | `.github/workflows/ci.yml`                                                       |
| Documentación de `.env` | infra               | Corrige «the Storage emulator» (I3) y añade el aviso de `--remove-orphans` (E16).                                                   | `.env.example`                                                                   |

### Retoques de reutilización — cada uno es un paso verificable, ninguno duplica nada

| Archivo existente              | Cambio                                                                                                                                                                                                                                           | Por qué                                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.yml`           | `storage-gateway` → `supabase-gateway` (servicio **y** `container_name`); `depends_on` de `storage-bucket-init`; la URL que ese init hace `curl` pasa a `http://supabase-gateway/storage/v1/bucket`; volumen de la conf apunta al archivo nuevo. | Sin esto el init de bucket queda apuntando a un servicio que ya no existe y el criterio 1b se rompe **en silencio, en la segunda API**. Es la trampa concreta del renombrado. |
| `docker/storage-gateway.conf`  | Se renombra a docker/supabase-gateway.conf (por crear) y gana dos `location`. La de `/storage/v1/` y el `client_max_body_size 10m` **no se tocan**.                                                                                              | Un origen, dos APIs (R3). El `client_max_body_size` sigue siendo el que protege la subida de F-011.                                                                           |
| `scripts/storage-dev-keys.mjs` | El literal de la línea final pasa a `docker compose up -d --force-recreate storage supabase-gateway auth`, y el comentario de cabecera dice lo mismo.                                                                                            | E15: si no, la próxima sesión pierde media hora con 401 opacos en Auth **y** en Storage.                                                                                      |
| `.agent/init.sh`               | Bloque `== Auth ==` nuevo, detrás de `== Storage ==`. Tres `warn` posibles y ningún `bad`.                                                                                                                                                       | R4 y E10; criterio 4.                                                                                                                                                         |
| `.env.example`                 | Solo comentarios: la descripción de `NEXT_PUBLIC_SUPABASE_URL` (I3), el aviso de `--remove-orphans` (E16) y el `--force-recreate` con el nombre nuevo.                                                                                           | **Ninguna variable nueva** y nada con forma de clave (R1, criterio 7).                                                                                                        |
| `.github/workflows/ci.yml`     | Un job nuevo. `verify` y `visual` no se tocan.                                                                                                                                                                                                   | Criterio 9. Aislar el coste de Docker del bucle rápido, igual que hizo `visual` con Chromium.                                                                                 |

## Flujo de datos

### El ciclo del correo, de punta a punta

```mermaid
sequenceDiagram
  participant G as scripts/auth-otp.mjs
  participant N as supabase-gateway (nginx :54321)
  participant A as auth (GoTrue :9999)
  participant M as mailpit (SMTP 1025 / API 8025)
  participant APP as next dev
  participant DB as Postgres de la app

  G->>M: DELETE /api/v1/search?query=to:prueba+<ts>@local.test   (R10)
  G->>N: POST /auth/v1/otp {email}
  N->>A: POST /otp
  A->>N: GET /dev-mail/otp.html            (plantilla, cacheada 10 min)
  A->>M: SMTP: asunto y cuerpo con {{ .Token }}
  A-->>G: 200
  loop cada 250 ms, hasta 15 s
    G->>M: GET /api/v1/search?query=to:<email>
  end
  G->>M: GET /api/v1/message/{ID}
  G->>G: extrae \b\d{6}\b del cuerpo (y, aparte, del asunto)
  alt modo gotrue (criterio 2)
    G->>N: POST /auth/v1/verify {email, token, type:"email"}
    N->>A: POST /verify
    A-->>G: access_token + refresh_token + user.id
  else modo app (criterio 3)
    G->>APP: POST /api/account/otp/verify {email, token}
    APP->>N: verifyOtp(...)
    APP->>DB: upsert Customer by supabaseUserId
    APP-->>G: 200 {signedIn:true, profile} + Set-Cookie qab-shopper-auth
  end
```

Puntos que no son adorno:

1. **La plantilla se pide por HTTP y GoTrue tiene un repliegue silencioso.**
   Verificado en `internal/mailer/templatemailer/template.go` de v2.196.0: si el
   `GET` de la plantilla falla, `loadEntryDefault` carga la plantilla por omisión
   —que **no** trae `{{ .Token }}`— y el correo sale igual, con un enlace y sin
   código. Nada en la respuesta HTTP del `/otp` lo delata. Ese es el riesgo (a)
   de la spec, y por eso el asunto lleva el token también.
2. **El asunto no rescata la prueba, la explica.** El guion **exige** el código en
   el cuerpo (E3). Si el cuerpo no lo trae pero el asunto sí, falla con el
   diagnóstico exacto: la plantilla no se cargó. Aceptar el asunto como carrier
   dejaría el criterio 3 verde contra un correo que en producción sería un enlace.
3. **La bandeja se vacía por destinatario, no entera.** `DELETE /api/v1/search?query=to:<addr>`
   no borra lo que otra corrida o el humano estén mirando. Con destinatario único
   por corrida (R10) normalmente no borra nada; existe para que un `--email` fijo
   repetido siga siendo seguro.
4. **El `Customer` lo crea la ruta de la app, no el guion.** El guion es HTTP puro,
   sin `pg` y sin Prisma. Quien cuenta filas y quien las borra (R12) es
   .agent/specs/F-028/smoke.sh (por crear), que sí tiene `DIRECT_URL`.

### El 302 de salida (criterio 8), y su letra pequeña

`GET /auth/v1/authorize?provider=google&redirect_to=…` → nginx → GoTrue →
302 a `accounts.google.com` con `redirect_uri=http://localhost:54321/auth/v1/callback`
y un `state` firmado.

**Hallazgo que cambia cómo hay que probarlo:** en v2.196.0,
`internal/api/provider/google.go` construye el proveedor con
`cache.GetProvider(ctx, "https://accounts.google.com")`, es decir, **hace
descubrimiento OIDC contra Google en la primera petición de `authorize`**. Facebook
**no**: `internal/api/provider/facebook.go` arma los endpoints con literales. En
consecuencia:

- El criterio 8 para **facebook** es hermético: funciona sin salida a internet.
- El criterio 8 para **google** necesita salida a internet (la tiene el runner de
  GitHub, y normalmente la máquina de desarrollo). Si falla sin red, el smoke lo
  dice con esas palabras en vez de dejar creer que el proveedor está mal configurado.
- **Apple** hace lo mismo que Google contra `appleid.apple.com`. Ningún criterio la
  nombra: se pide, se anota el estado y el cuerpo **literales**, y no se asierta
  nada (E9).

## Contratos

### Configuración de `auth` — las variables concretas (decisión 5)

Nombres verificados en `internal/conf/configuration.go` de v2.196.0 y cruzados con
el compose y el `.env.example` oficiales de Supabase.

| Variable                                                                          | Valor                                                                                                                    | Por qué **este** valor                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GOTRUE_API_HOST` / `GOTRUE_API_PORT`                                             | `0.0.0.0` / `9999`                                                                                                       | El puerto por omisión de la imagen es 8081; 9999 es el que usa todo el ecosistema Supabase y el que el `proxy_pass` va a nombrar.                                                                                                                                                                    |
| `API_EXTERNAL_URL`                                                                | `http://localhost:54321/auth/v1`                                                                                         | **Con el prefijo dentro**, igual que el oficial (`http://localhost:8000/auth/v1`). De aquí sale `redirect_uri = …/auth/v1/callback` (`internal/api/external.go`).                                                                                                                                    |
| `GOTRUE_MAILER_URLPATHS_CONFIRMATION` / `_RECOVERY` / `_INVITE` / `_EMAIL_CHANGE` | `/auth/v1/verify`                                                                                                        | `ResolveReference` con una ruta absoluta **descarta** el path de la base: sin esto el enlace del correo saldría a `http://localhost:54321/verify` y daría 404 de nginx. Es el caso límite «URL externa contra el prefijo del gateway» de la spec, resuelto.                                          |
| `GOTRUE_DB_DRIVER` / `GOTRUE_DB_DATABASE_URL`                                     | `postgres` / `postgres://supabase_auth_admin:postgres@auth-db:5432/auth`                                                 | Base propia (R6). Contraseña literal de desarrollo, como ya hace `postgres` en este mismo compose: no tiene forma de clave y no dispara ningún escáner.                                                                                                                                              |
| `GOTRUE_DB_NAMESPACE`                                                             | `auth` (por omisión, se deja explícito)                                                                                  | Es el esquema que el criterio 6 exige que **no** aparezca en la base de la app.                                                                                                                                                                                                                      |
| `GOTRUE_JWT_SECRET`                                                               | `"${STORAGE_JWT_SECRET:?missing, run node scripts/storage-dev-keys.mjs --write}"`                                        | R2 y criterio 7: un solo secreto local, y `docker compose config` falla nombrando el generador si no está.                                                                                                                                                                                           |
| `GOTRUE_JWT_AUD` / `GOTRUE_JWT_DEFAULT_GROUP_NAME` / `GOTRUE_JWT_ADMIN_ROLES`     | `authenticated` / `authenticated` / `service_role`                                                                       | Lo que hace que un JWT de usuario del Auth local sea, para el Storage local, un `authenticated` (consecuencia buscada de R2).                                                                                                                                                                        |
| `GOTRUE_JWT_ISSUER`                                                               | `http://localhost:54321/auth/v1`                                                                                         | Coherente con `API_EXTERNAL_URL`.                                                                                                                                                                                                                                                                    |
| `GOTRUE_JWT_EXP`                                                                  | `3600`                                                                                                                   | El valor por omisión y el de Supabase. No hay motivo para separarse.                                                                                                                                                                                                                                 |
| `GOTRUE_SITE_URL`                                                                 | `http://localhost:3000`                                                                                                  | El mismo `NEXT_PUBLIC_SITE_URL` de `.env.example`.                                                                                                                                                                                                                                                   |
| `GOTRUE_URI_ALLOW_LIST`                                                           | `http://localhost:3000/**,http://localhost:3100/**,http://localhost:3101/**,http://localhost:*/**,http://127.0.0.1:*/**` | Los tres puertos que este repo usa de verdad (`npm run dev`, `SMOKE_PORT`, `VISUAL_PORT`) **y** un comodín. Los globs se compilan con `.` y `/` como separadores, así que `*` cubre cualquier puerto. Sin esto, `redirect_to` se ignora y R7 de F-012 se probaría contra un camino que nunca ocurre. |
| `GOTRUE_EXTERNAL_EMAIL_ENABLED`                                                   | `"true"`                                                                                                                 | Es el único método que F-028 verifica de punta a punta.                                                                                                                                                                                                                                              |
| `GOTRUE_MAILER_AUTOCONFIRM`                                                       | `"false"`                                                                                                                | **R9.** Con autoconfirmación no se envía correo y el criterio se verificaría contra nada.                                                                                                                                                                                                            |
| `GOTRUE_MAILER_OTP_LENGTH`                                                        | `6`                                                                                                                      | Explícito aunque coincida con el defecto: `OTP_CODE_LENGTH` en `src/constants/account.ts` es 6 y la validación de `src/features/account/schemas.ts` es exacta.                                                                                                                                       |
| `GOTRUE_MAILER_OTP_EXP`                                                           | `300`                                                                                                                    | El defecto son **86400 s (un día)**, que no ejercita nada. 300 s deja el ciclo del guion con margen de sobra (tarda < 5 s) y hace barato provocar a mano el `otp_expired` que `.agent/specs/F-012/impl.md` dejó anotado sin verificar.                                                               |
| `GOTRUE_RATE_LIMIT_EMAIL_SENT`                                                    | `1000000/1h`                                                                                                             | El defecto es **30/hora**: una suite que corra unas cuantas veces al día empieza a ver 429, y `src/app/api/account/otp/route.ts` los traduce a un `RATE_LIMITED` propio que **parece un fallo de la app y no lo es**. Formato verificado en `internal/conf/rate.go`.                                 |
| `GOTRUE_SMTP_MAX_FREQUENCY`                                                       | `1s`                                                                                                                     | El defecto es **1 minuto por destinatario**. Con destinatario nuevo por corrida (R10) no mordería, pero muerde en cuanto alguien reintenta con el mismo `--email` — y el síntoma es otra vez un 429 que no es de la app.                                                                             |
| `GOTRUE_SMTP_HOST` / `_PORT`                                                      | `mailpit` / `1025`                                                                                                       | **R7**: el correo no sale de la máquina. Mailpit no tiene relay.                                                                                                                                                                                                                                     |
| `GOTRUE_SMTP_ADMIN_EMAIL` / `_SENDER_NAME`                                        | `no-reply@queandabuscando.local` / `queandabuscando (local)`                                                             | Dominio inventado, a juego con `local.test` del destinatario.                                                                                                                                                                                                                                        |
| `GOTRUE_SMTP_USER` / `_PASS`                                                      | vacías                                                                                                                   | Mailpit acepta sin autenticación; se acompaña de `MP_SMTP_AUTH_ACCEPT_ANY` por si el cliente insiste.                                                                                                                                                                                                |
| `GOTRUE_MAILER_SUBJECTS_CONFIRMATION` / `_MAGIC_LINK`                             | `{{ .Token }} es tu codigo de acceso`                                                                                    | **Inline, sin red.** Los asuntos se parsean como plantilla Go con el mismo mapa de datos (`loadEntrySubject`), así que el token está garantizado aunque el cuerpo falle. Es el diagnóstico del riesgo (a).                                                                                           |
| `GOTRUE_MAILER_TEMPLATES_CONFIRMATION` / `_MAGIC_LINK`                            | `http://supabase-gateway/dev-mail/otp.html`                                                                              | El cuerpo, que es lo que E3 exige. **Las dos** plantillas porque `signInWithOtp` manda `confirmation` a un correo nuevo y `magic_link` a uno conocido.                                                                                                                                               |
| `GOTRUE_EXTERNAL_GOOGLE_ENABLED` / `_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI`     | `"true"` / `local-dev-inert-client-id` / `local-dev-inert-secret` / `http://localhost:54321/auth/v1/callback`            | **R8.** `ValidateOAuth()` exige los tres no vacíos, `REDIRECT_URI` incluido. Los literales dicen en su propio nombre que no sirven para entrar.                                                                                                                                                      |
| `GOTRUE_EXTERNAL_FACEBOOK_*`                                                      | Igual que Google                                                                                                         | Ídem.                                                                                                                                                                                                                                                                                                |
| `GOTRUE_EXTERNAL_APPLE_*`                                                         | Igual que Google                                                                                                         | **Se habilita** (E9): su construcción no bloquea el arranque —el proveedor se arma por petición, no al inicio— así que habilitarla no pone en riesgo nada. Lo que salga se anota, no se asierta.                                                                                                     |
| `GOTRUE_DISABLE_SIGNUP`                                                           | `"false"`                                                                                                                | `signInWithOtp` sin `shouldCreateUser: false` es un alta: con esto en `true` el criterio 2 fallaría en la primera llamada.                                                                                                                                                                           |

Lo que **no** se configura, dicho para que nadie lo añada: teléfono, SMS, MFA,
SAML, WebAuthn, passkeys, hooks, anónimos, Web3. Todos vienen desactivados por
omisión y todos están fuera de F-012 y de aquí.

### Configuración de `mailpit`

| Variable                      | Valor    | Por qué                                                                                                                                                 |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MP_SMTP_AUTH_ACCEPT_ANY`     | `"true"` | Acepta cualquier usuario y contraseña, incluida ninguna: quita del mapa toda una familia de fallos de SMTP.                                             |
| `MP_SMTP_AUTH_ALLOW_INSECURE` | `"true"` | Sin TLS, que es lo que hay entre dos contenedores de la misma red.                                                                                      |
| `MP_MAX_MESSAGES`             | `"200"`  | Techo bajo a propósito: la bandeja de desarrollo no es un archivo histórico.                                                                            |
| **Sin `MP_DATABASE`**         | —        | Bandeja **en memoria**: un `docker compose restart mailpit` la vacía y ninguna corrida hereda el código de la anterior. Es la mitad estructural de R10. |
| **Sin volumen**               | —        | Lo mismo, por si alguien añadiera `MP_DATABASE` sin pensarlo.                                                                                           |

Puertos: `1025` interno (SMTP) y `54324:8025` en el host (API y UI). **54324 no es
casualidad**: es el puerto que la CLI de Supabase reserva para su capturador de
correo, así que a nadie le sorprende, y está lejos del 8025 genérico que sí choca
con otros proyectos. El healthcheck es el que la propia imagen declara
(`/mailpit readyz`), redeclarado en el compose para poder usar `depends_on:
condition: service_healthy` con intervalos propios.

### docker/supabase-gateway.conf (por crear) — las tres `location`

```nginx
server {
  listen 80;
  client_max_body_size 10m;          # de F-011, no se toca

  location /storage/v1/ { proxy_pass http://storage:5000/; }   # intacta
  location /auth/v1/    { proxy_pass http://auth:9999/;    }   # nueva
  location /dev-mail/   { alias /etc/nginx/dev-mail/;      }   # plantilla de correo
}
```

Tres notas que valen media hora cada una:

1. La barra final del `proxy_pass` es lo que **quita** el prefijo:
   `/auth/v1/health` llega a GoTrue como `/health`. Sin ella llegaría como
   `/auth/v1/health` y respondería 404 — el mismo 404 que hoy bloquea F-012, pero
   ahora desde dentro.
2. `location /auth/v1/` (con barra) **no** casa `/auth/v1` a secas. Nadie llama así:
   `@supabase/ssr` siempre compone `${url}/auth/v1/<recurso>`.
3. `proxy_redirect` se deja en su valor por omisión: reescribe un `Location:
http://auth:9999/…` a `http://localhost:54321/auth/v1/…`, que es lo que hace que
   el `/verify` por enlace funcione desde fuera. **No** toca el 302 hacia
   `accounts.google.com`, que no casa con el destino del `proxy_pass`.

### docker/auth-roles.sql (por crear)

Gemelo exacto de `docker/storage-roles.sql`, y con la misma advertencia en cabecera:
corre **solo** contra el volumen vacío de `auth-db`, nunca contra
`queandabuscando-pgdata`, que ya tiene datos.

```sql
create role supabase_auth_admin login password 'postgres' superuser;
create schema if not exists auth authorization supabase_auth_admin;
```

Dos cosas que **no** están aquí, cada una por un motivo comprobado leyendo las 70
migraciones de v2.196.0:

- **No están `anon`, `authenticated` ni `service_role`.** Ninguna migración de
  GoTrue les concede nada; son roles de Postgres que solo importan del lado de
  PostgREST y de Storage, y aquí solo serían ruido. (En `docker/storage-roles.sql`
  sí hacen falta porque `storage-api` sí les concede.)
- **El `create schema` sí está aquí**, al revés que en Storage. `storage-api` crea
  su esquema en sus propias migraciones; GoTrue **no**: `cmd/migrate_cmd.go` pasa el
  namespace como opción de plantilla y da por hecho que el esquema existe. Sin esta
  línea el primer arranque muere con «schema auth does not exist».

`supabase_auth_admin` es `superuser` por el mismo motivo que `supabase_storage_admin`
lo es: la migración `20240612123726_enable_rls_update_grants` hace `alter table …
enable row level security` y `grant select … to postgres with grant option` sobre
tablas que tiene que poseer. Es una base de datos de desarrollo aislada, sin puerto
publicado.

### docker/auth-email-otp.html (por crear)

```html
<h2>Tu código de acceso</h2>
<p>Escribe este código en la pantalla de acceso:</p>
<p style="font-size: 28px; letter-spacing: 4px"><strong>{{ .Token }}</strong></p>
<p>Caduca en unos minutos y solo sirve una vez.</p>
<p>Correo de desarrollo: lo captura Mailpit y no sale de esta máquina.</p>
<p><a href="{{ .ConfirmationURL }}">Enlace alternativo</a></p>
```

`{{ .Token }}` es el código de 6 dígitos y `{{ .ConfirmationURL }}` el enlace con el
`token_hash`; los dos están en el mapa de datos que
`internal/mailer/templatemailer/templatemailer.go` pasa a `ConfirmationMail` y a
`MagicLinkMail`. El enlace se deja porque no cuesta nada y hace el correo parecido
al real, **pero no es lo que se prueba**: la ruta de la app solo acepta 6 dígitos.

### El guion — scripts/auth-otp.mjs (por crear) (decisión 9)

**Superficie.** Node puro, sin dependencias nuevas (`fetch` y `node:*` bastan; ni
`pg`, ni Prisma, ni `@supabase/*`).

```
node scripts/auth-otp.mjs [opciones]

  --email <addr>     destinatario. Por omisión: prueba+<Date.now()>@local.test
  --mode gotrue|app  gotrue (por omisión) canjea contra /auth/v1/verify;
                     app canjea por /api/account/otp y /api/account/otp/verify
  --app <url>        base de la app en modo app. Por omisión http://localhost:3000
  --cookie-jar <f>   en modo app, escribe ahí las cookies de la respuesta
  --timeout <s>      espera máxima del correo. Por omisión 15
  --json             una sola línea JSON en vez de clave=valor
  --quiet            solo el resultado, sin los pasos
```

**Qué imprime.** En éxito, por salida estándar, una línea por dato:

```
email=prueba+1756494000123@local.test
token=482915
user_id=1f0c1a4e-7c2f-4c0a-9d2b-3f2a1b0c9d8e
mode=gotrue
message_id=<id de Mailpit>
```

Con `--json`, el mismo contenido como objeto. El `user_id` es lo que el criterio 2
pide ver, y en un formato que .agent/specs/F-028/smoke.sh (por crear) puede leer
sin `jq`.

**Cómo falla.** Un código de salida por causa, y un mensaje por salida de error que
dice qué mirar. Esta tabla es la mitad del feature que evita la próxima media hora
perdida:

| Código | Estado                                        | Qué imprime                                                                                                                                                                                                                                                                                                  |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0      | Ciclo completo                                | Las líneas de arriba.                                                                                                                                                                                                                                                                                        |
| 1      | Configuración ausente                         | Cuál de `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` falta en `.env`, y `node scripts/storage-dev-keys.mjs --write`.                                                                                                                                                                         |
| 2      | Emulador inalcanzable                         | **Cuál**: el `/auth/v1/health` o la API de Mailpit, con la URL que probó, y `docker compose up -d`.                                                                                                                                                                                                          |
| 3      | El correo no llegó                            | Cuántos segundos esperó, a qué destinatario, y `http://localhost:54324` para mirar la bandeja. Recuerda comprobar `GOTRUE_SMTP_HOST` y R9.                                                                                                                                                                   |
| 4      | Llegó, pero el **cuerpo** no trae 6 dígitos   | Distingue los dos casos: (a) el **asunto** sí los trae → la plantilla no se cargó; nombra `GOTRUE_MAILER_TEMPLATES_*` y `http://supabase-gateway/dev-mail/otp.html`. (b) tampoco el asunto → nombra `GOTRUE_MAILER_SUBJECTS_*`. En los dos casos imprime el asunto y los primeros 200 caracteres del cuerpo. |
| 5      | El canje falló                                | El estado HTTP y el cuerpo literal de GoTrue o de la ruta de la app, sin interpretarlos. Un `otp_expired` aquí es información, no un adorno.                                                                                                                                                                 |
| 6      | Llegó más de un mensaje para ese destinatario | E2 pide **exactamente uno**. Dice cuántos y sugiere `--email` con marca de tiempo (R10).                                                                                                                                                                                                                     |

**Lo que el guion NO hace, a propósito:** no toca Postgres (el conteo de `Customer`
y su limpieza son del smoke), no lee ni escribe `.agent/`, no usa el token del
asunto para seguir adelante, y no reintenta el envío —un 429 se propaga con su
cuerpo, porque distinguirlo de un fallo de la app es justo lo que hace falta.

**Cómo lee `.env`.** Con `node --env-file=.env` no: el guion tiene que poder
ejecutarse a mano. Lee `.env` con un parseo mínimo propio (o `dotenv`, que ya es
dependencia del repo, igual que hace `.agent/init.sh` con su `node -e`). Solo
necesita `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

**La URL de Mailpit no es una variable de `.env`.** Por omisión
`http://localhost:54324`, sobreescribible con la opción `--mailpit` o con
`MAILPIT_URL` en el entorno del proceso. Añadirla a `.env.example` obligaría a
todo el mundo a rellenarla —el chequeo de `.agent/init.sh:44-56` exige valor a
toda clave que aparezca allí— y le sacaría un `warn` a quien no toca Auth. Eso
contradiría R4, así que no entra.

### .agent/specs/F-028/smoke.sh (por crear)

Sobre `.agent/templates/smoke.sh`, con `SMOKE_BASE_URL` apuntando al `next dev` que
levanta `.agent/verify.sh`. Orden y contenido:

1. **Criterio 1a** — `curl -fsS "$SUPABASE_URL/auth/v1/health"` → 200 y el cuerpo
   nombra el servicio.
2. **Criterio 1b** — `curl -fsS "$SUPABASE_URL/storage/v1/bucket" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | grep -q store-media`.
   Es la no-regresión del renombrado.
3. **Criterio 2** — `node scripts/auth-otp.mjs`, código 0, y el `user_id` casa con
   un UUID.
4. **Criterio 3** — cuenta `select count(*) from "Customer" where "supabaseUserId" is not null`
   antes; `node scripts/auth-otp.mjs --mode app --app "$SMOKE_BASE_URL" --cookie-jar …`;
   cuenta después → diferencia **1**; `curl -b <jar> "$SMOKE_BASE_URL/cuenta"` → 200
   y el HTML trae el correo del perfil.
5. **Criterio 8** — `authorize?provider=google` y `provider=facebook`: 302, dominio
   del `Location`, `redirect_uri` y `state` no vacíos. Si google falla por red, el
   mensaje lo dice con esas palabras (descubrimiento OIDC contra `accounts.google.com`).
6. **E9, Apple** — se pide, se imprime el estado y el cuerpo **literales** con el
   prefijo `apple:` y **no se asierta nada**.
7. **R12, limpieza** — borra los `Customer` creados por esta corrida, por
   `supabaseUserId`, con los ids que el guion imprimió. Sin esto, el aserto de
   conteo del paso 4 deja de ser estable.

Las consultas a Postgres van por `DIRECT_URL` con el `pg` que ya es dependencia,
igual que hace `.agent/init.sh` en su bloque `== Base de datos ==`.

El smoke **falla** si el emulador no está arriba, con el comando para levantarlo.
Eso no contradice R4: `--smoke` es una petición explícita de comprobar el runtime;
la opcionalidad la protegen `--full` y `.agent/init.sh`, no esta etapa.

### El bloque `== Auth ==` de `.agent/init.sh`

Detrás de `== Storage ==`, con la misma estructura y **ningún `bad`**:

```
== Auth ==
✓ emulador de Auth arriba (/auth/v1/health)
✓ capturador de correo arriba (Mailpit, http://localhost:54324)
```

y sus tres avisos posibles:

| Condición                                                      | Aviso                                                                                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Existe un contenedor llamado `queandabuscando-storage-gateway` | `warn` nombrándolo y con el comando literal `docker compose up -d --remove-orphans`. **E16 y R11: sin esto no cumple.**       |
| `/auth/v1/health` no responde                                  | `warn "emulador de Auth no responde — ejecuta: docker compose up -d"`                                                         |
| Mailpit no responde en `http://localhost:54324/readyz`         | `warn` con el puerto, para que un choque de puertos se vea aquí y no como «el correo no llega» (tabla de errores de la spec). |

Detalles que deciden si esto funciona o estorba: la detección del contenedor viejo
usa `docker ps -a --format '{{.Names}}'` y **si `docker` no está o no responde, no
imprime nada** —jamás debe convertir «Docker parado» en ruido—; las llamadas HTTP
llevan `-m 3` como las de Storage; y el bloque entero no puede tocar `FAIL`.

## Modelo de datos y migraciones

**Ninguna migración de Prisma. Ningún campo nuevo. Ningún índice nuevo.**

El esquema `auth` es de GoTrue, lo crean sus 70 migraciones embebidas, y vive en
`auth-db`, que es un contenedor y un volumen distintos de los de la app. `prisma/schema.prisma`
no lo conoce y no debe conocerlo. El criterio 6 —`npx prisma migrate diff
--from-config-datasource --to-schema prisma/schema.prisma --script` sin mencionar
`auth` ni `storage`— es cierto **por construcción**, no por disciplina: la base a la
que apunta `DIRECT_URL` nunca ve ninguno de los dos esquemas.

Sobre la idempotencia que pide el criterio 10: la imagen corre `CMD ["auth"]`, y
`cmd/root_cmd.go` hace `migrate` y después `serve`. El migrador de `pop` lleva su
propia tabla `schema_migrations` dentro del esquema `auth`, así que el segundo
`docker compose up -d` aplica **cero** migraciones y sale 0. No hay que hacer nada
para conseguirlo; hay que **no** hacer nada que lo rompa (por ejemplo, un servicio
de init que reejecute SQL a mano).

## Escalabilidad y límites

No es un feature de producto y no tiene tráfico. Los números que importan son los
del entorno de quien desarrolla y los del CI:

- **Coste en disco.** `supabase/auth:v2.196.0` ≈ 40 MB, `axllent/mailpit:v1.31.0`
  ≈ 30 MB, y `postgres:16-alpine` **ya está descargada** para `postgres` y
  `storage-db`. El volumen `queandabuscando-auth-pgdata` arranca en ~40 MB.
- **Coste en memoria con todo levantado.** Tres contenedores nuevos: GoTrue en
  reposo ~30 MB, Mailpit ~20 MB, el tercer Postgres ~50 MB. Total ≈ 100 MB sobre lo
  de hoy. Quien no toque Auth los para y recupera los 100 MB.
- **Coste en el CI.** Un job nuevo, no un alargamiento del existente. `docker compose up -d`
  - migraciones + seed + `next dev` + el smoke: del orden de 3-5 minutos, en
    paralelo con `verify` y `visual`. Mismo criterio con el que `visual` se separó de
    `verify` para no pagar Chromium en cada bucle.
- **Bandeja de correo.** `MP_MAX_MESSAGES=200` y en memoria: cada corrida deja un
  mensaje, así que 200 corridas sin reiniciar y Mailpit empieza a tirar los viejos
  —que es exactamente lo que queremos.
- **Filas de `Customer`.** Cada corrida del smoke crea una y R12 la borra. Si alguien
  ejecuta el smoke en bucle sin la limpieza, la tabla crece 1 fila por corrida y el
  aserto de conteo sigue siendo correcto (mide la **diferencia**), pero la tabla se
  ensucia. Umbral práctico: irrelevante por debajo de miles de corridas; el arreglo,
  si alguna vez molesta, es un borrado por prefijo `prueba+%@local.test`, que es
  seguro justo porque el dominio es inventado.
- **JavaScript de cliente:** **0 KB.** No hay ni un archivo de `src/`.
- **Round-trips añadidos a la app en producción:** **0.** Nada de esto se despliega.
- **Qué se rompe primero al multiplicar por 100.** No las tiendas ni los pedidos:
  las **corridas**. A ~100 accesos por hora contra el mismo emulador, el primero que
  se queja sería el limitador de envíos de GoTrue —por eso está en `1000000/1h` y
  no en su defecto de 30— y después el `SMTP_MAX_FREQUENCY` por destinatario, que
  por eso está en `1s`. Con esos dos valores, el techo real pasa a ser Mailpit y sus
  200 mensajes en memoria.

## La opcionalidad, demostrada y no prometida

R4 no es una promesa: es lo que hay que poder **ejecutar**. Con `auth`, `auth-db` y
`mailpit` parados (`docker compose stop auth auth-db mailpit`):

| Comprobación                         | Resultado exigido                                                         | Por qué es cierto por construcción                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `bash .agent/init.sh`                | Termina en **ENTORNO LISTO**, código 0, con el `warn` y el comando exacto | El bloque `== Auth ==` no toca `FAIL`; solo `bad` lo incrementa, y aquí no hay ninguno.                                                   |
| `bash .agent/verify.sh F-028 --full` | **0**                                                                     | Ninguna de sus nueve etapas abre un socket contra el emulador; la lista literal está unas líneas más abajo.                               |
| `/tienda-demo` y `/cuenta/entrar`    | **200**                                                                   | Ni una línea de `src/` cambia; `getCustomerUser()` ya devuelve `null` cuando Auth no responde (E11, verificado por el probador de F-012). |
| `npm test`                           | Igual que hoy                                                             | Todas las pruebas de F-012 usan Supabase mockeado; ninguna sale a la red.                                                                 |
| Criterio 6 de F-012                  | Intacto                                                                   | Ese camino se decide en `src/lib/supabase/config.ts` leyendo dos variables vacías, y F-028 no toca ninguna de las dos.                    |

La lista, para que nadie tenga que abrirlo: harness · typecheck · lint · format ·
test · prisma · build · theme · bundle.

El único comando que **sí** necesita el emulador es
`bash .agent/verify.sh F-028 --smoke`, y eso es deliberado: pedirlo es pedir que se
ejercite el runtime.

Y una consecuencia que conviene decir en voz alta: `docker compose up -d` **sí**
levanta los tres servicios nuevos, porque el criterio 1 lo exige. La opcionalidad
consiste en poder pararlos y seguir trabajando, no en que no arranquen.

## Qué NO hace falta, dicho para que nadie lo añada

- **Nada de Kong, Studio, Realtime, PostgREST, Edge Functions, imgproxy ni
  `supabase-vector`.** Solo Auth, su base y la captura de correo. El compose de este
  repo tiene que caber en la cabeza de quien lo abre un martes.
- **Ningún archivo de `src/`.** Ni `src/lib/auth/customerSession.ts`, ni
  `src/lib/supabase/server.ts`, ni las pantallas, ni las rutas. F-012 está
  construido: lo que faltaba era dónde ejecutarlo. Si al ejecutar apareciera un
  fallo real de F-012, **se para y se pregunta** (regla 3).
- **Ninguna migración de Prisma**, ningún cambio en `prisma/schema.prisma`, ningún
  `prisma migrate dev`. Y desde luego ninguno de los dos comandos que `AGENTS.md`
  marca como prohibidos.
- **Ninguna variable nueva en `.env.example`.** Solo comentarios. En particular,
  **`STORAGE_JWT_SECRET` no se renombra**: `.agent/init.sh:44-56` excluye esas tres
  claves de su chequeo de «sin valor», y renombrarla dejaría el `.env` de todo el
  mundo roto **en silencio**.
- **Ningún servidor OIDC de mentira** (D2), ninguna credencial OAuth real ni de
  desarrollo, ninguna clave privada de Apple fabricada.
- **Ningún `.env` en git**, ninguna cadena con forma de JWT en ningún archivo
  versionado. El grep del criterio 7 se ejecuta con la exclusión que la spec ya fijó
  (I6): `git grep -nE 'eyJ[A-Za-z0-9_-]{20,}' -- . ':(exclude)package-lock.json'`.
- **Ninguna edición de `.agent/specs/F-012/`**, incluida su Parte 2 manual (D3).
- **Ninguna cuarta imagen.** Si el montaje pareciera pedirla, es la señal de parada
  que F-011 dejó escrita y que esta arquitectura hereda: se vuelve al humano.

## Patrones a seguir / antipatrones a evitar

- **`${VAR:?mensaje}` en toda variable que venga de `.env`.** Es el patrón que ya
  usa `storage` y lo que hace verdadero el criterio 7: `docker compose config` falla
  nombrando `scripts/storage-dev-keys.mjs` en vez de arrancar un contenedor que
  rechaza todo con 401 opacos.
- **Versión fijada, nunca `latest`.** `AGENTS.md` § Stack pide versiones reales; el
  compose ya lo cumple en sus cuatro servicios.
- **`warn`, nunca `bad`, para lo opcional** (`.agent/init.sh`, bloque `== Storage ==`).
- **Un archivo que todavía no existe se escribe sin comillas invertidas y con
  `(por crear)` detrás.** `AGENTS.md` § Cosas que muerden, y `npm run check:harness`
  lo caza. En este documento aplica a cinco archivos.
- **Antipatrón: `docker compose exec` dentro del smoke.** Ata la prueba a que los
  contenedores se llamen como hoy y a que Docker esté en el PATH del runner. Todo lo
  que el smoke necesita se pide por HTTP o por `DIRECT_URL`.
- **Antipatrón: leer el código del correo con `grep` sobre el HTML crudo del
  mensaje.** Se usa la API de Mailpit, que ya separa `Text` y `HTML`; un `grep`
  sobre el `raw` pescaría dígitos del `Message-ID` o del `Date`.
- **Antipatrón: dar por bueno un criterio leyendo la configuración.** R13. El
  criterio 8 se cierra con la respuesta HTTP real del `authorize`.
- **Antipatrón: medir por HTTP contra un `next dev` de otro worktree.** Ficha
  `.agent/playbook/next-dev-uno-por-directorio.md`, que ya mordió en F-010 y F-018;
  `.agent/verify.sh` ya lo comprueba antes de levantar nada.

## Riesgos y plan B

En orden de probabilidad, con el mismo orden que la spec y una respuesta concreta
para cada uno.

**(a) El código de 6 dígitos no aparece en el cuerpo del correo.** Es el más
probable porque el repliegue de GoTrue es **silencioso**: si el `GET` de la
plantilla falla, manda la plantilla por omisión, que solo trae el enlace. Respuesta,
en tres capas: (1) el asunto lleva el token por una vía que no usa la red, así que
el fallo siempre es diagnosticable; (2) la plantilla la sirve el nginx que ya está
en la misma red y que ya tiene que estar arriba para que cualquier otra cosa
funcione; (3) el guion falla con el código 4 y dice cuál de las dos vías falló.
**Plan B si aun así no llega al cuerpo**: leer el `token_hash` del enlace y canjearlo
contra `/auth/v1/verify?token_hash=…`. Eso **cierra el criterio 2 y no el 3**
—`src/features/account/schemas.ts` exige seis dígitos— y hay que escribirlo así de
claro en `tests.md`, no disimularlo.

**(b) La URL externa contra el prefijo del gateway.** Resuelto antes de tropezar:
`API_EXTERNAL_URL` lleva el `/auth/v1` dentro **y** `GOTRUE_MAILER_URLPATHS_*` vale
`/auth/v1/verify`, porque `url.ResolveReference` con una ruta absoluta descarta el
path de la base. Es exactamente lo que hace el `.env.example` oficial de Supabase, y
por eso lo hace. Se comprueba mirando el enlace del correo capturado, que tiene que
empezar por `http://localhost:54321/auth/v1/verify`.

**(c) El límite de envíos mordiendo en CI.** Dos valores lo desactivan
(`RATE_LIMIT_EMAIL_SENT`, `SMTP_MAX_FREQUENCY`) y R10 lo evita por diseño con un
destinatario nuevo por corrida. Si aun así apareciera un 429, el guion lo propaga
con su cuerpo literal (código 5) para que nadie lo confunda con el `RATE_LIMITED`
propio de `src/app/api/account/otp/route.ts`.

**(d) Nuevo, hallado leyendo el código de v2.196.0: el `authorize` de Google
necesita salida a internet.** `internal/api/provider/google.go` hace descubrimiento
OIDC contra `accounts.google.com` al construir el proveedor. El runner de GitHub la
tiene; una máquina sin red, no. Facebook no lo necesita. El smoke lo dice con esas
palabras si falla, para que nadie busque el error en la configuración del proveedor.

**(e) El renombrado del gateway.** El síntoma sin aviso es «port is already
allocated», que no menciona ni el renombrado ni la solución. Mitigado por E16/R11
—`warn` en `.agent/init.sh` + comentario en `.env.example`— y por el paso, fácil de
olvidar, de cambiar también el `depends_on` y la URL interna de `storage-bucket-init`.

**Criterio de abandono, heredado de F-011 y confirmado.** Si tras **dos** intentos de
arranque el emulador no responde 200 en `/auth/v1/health`, o si hiciera falta un
**cuarto** servicio además de los tres previstos, se para y se vuelve al humano en
vez de hacer crecer un compose que nadie querrá mantener. Este documento ya gasta su
presupuesto de servicios: `auth-db`, `auth` y `mailpit`, y la plantilla de correo
servida por el nginx que ya existía precisamente para no gastar el cuarto.

## ¿Hace falta una ADR?

**No.** No hay decisión estructural nueva: `docs/adr/0005-dos-sistemas-de-auth.md`
ya fijó que el comprador entra por Supabase Auth, y F-011 ya estableció el patrón de
«emulador local en `docker-compose.yml` que habla la API real». F-028 aplica las dos
decisiones existentes a un servicio más; no supera ninguna. Lo que sí conviene, y no
es una ADR, es que el `tests.md` de este feature deje escrito el hallazgo (d) —el
`authorize` de Google no es hermético— porque contradice la intuición de que un
emulador local no sale a la red.

## Preguntas al humano

**Ninguna.** Todas las decisiones que la spec dejó abiertas eran técnicas y están
resueltas arriba con su motivo y su fuente. Las tres que sí eran del humano ya
estaban respondidas antes de empezar (D2, D4, D5) y no se reabren.

Dos cosas que **no** son preguntas pero que el plan debería recoger tal cual, porque
son de él y no mías:

1. El criterio 7 del backlog dice «el grep de cadenas tipo JWT sobre el repo sigue
   sin devolver nada». Tal cual, hoy es falso: hay un `integrity` de
   `package-lock.json` cuyo base64 contiene `eyJ`. La forma que sí sale vacía es la
   que la spec ya fija en I6, con `':(exclude)package-lock.json'`. Aquí se ejecuta
   esa. El texto del criterio es del humano y no se toca.
2. I7: «se ejecuta en CI» no dice qué se ejecuta. Esta arquitectura lo interpreta
   como los criterios **2 y 3** —el mínimo que hace útil el job— más el 1, que sale
   gratis porque el smoke ya lo comprueba de primero. El 8 entra también, por estar
   en el mismo smoke, con la salvedad del riesgo (d). Si el humano quería otra cosa,
   lo dirá al firmar el plan.
