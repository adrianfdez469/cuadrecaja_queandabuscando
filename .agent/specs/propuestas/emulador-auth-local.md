---
propuesta: emulador-auth-local
agente: sdd-spec
actualizado: 2026-08-29T17:53:19Z
estado: propuesta
---

## Problema

El criterio 1 de F-012 —«Se puede iniciar sesión con Google, Facebook, Apple y
correo»— **no se puede verificar ejecutando nada** en esta máquina ni en CI. No
es un descuido del probador: es que no hay backend de Auth contra el que
ejecutar. `.env` apunta `NEXT_PUBLIC_SUPABASE_URL` al emulador de Storage
(`http://localhost:54321`), cuyo nginx solo conoce `/storage/v1/`, así que
`curl http://localhost:54321/auth/v1/user` responde **404**
(`.agent/specs/F-012/tests.md` § Lo que no se pudo verificar). Y no hay atajo:
`sdd-tester` leyó `@supabase/auth-js` y confirmó que, para un JWT HS256 —el caso
normal de Supabase—, `getClaims()` **siempre** hace una llamada de red real a
`<NEXT_PUBLIC_SUPABASE_URL>/auth/v1/user` para confirmar la firma. No existe
cookie fabricable que produzca una sesión que la app acepte.

El humano confirmó que **no va a haber un proyecto Supabase en la nube a corto
plazo**. Por la regla 1 del backlog, F-012 no puede cerrarse con
`"passes": true` mientras ese criterio no se ejecute, y con él quedan colgados
cuatro huecos más que `tests.md` fichó por la **misma causa raíz**.

Este repo ya resolvió exactamente este problema una vez: F-011 levantó el
**emulador de Storage** en `docker-compose.yml` para que la subida de imágenes
hablara con la API real de Supabase Storage en local. Esta propuesta es el mismo
patrón aplicado a Auth, y la mitad del trabajo (el gateway, el generador de
claves locales, la convención de «opcional, avisado por `.agent/init.sh`») ya
está hecha ahí.

Y no es una idea nueva: `.agent/specs/F-011/architecture.md` § Emulador de
Storage, «Consecuencia aceptada», lo dejó escrito hace dos features —
«**F-012** decidirá si añade el servicio de auth al mismo compose». F-012 no lo
decidió. Esto es esa decisión, con un ciclo de retraso.

## Alcance

### Dentro

- **Tres servicios nuevos** en `docker-compose.yml`, con su versión fijada, más
  la ampliación del gateway nginx que ya existe:

  | Servicio  | Imagen                    | Para qué                                                         | Puerto             |
  | --------- | ------------------------- | ---------------------------------------------------------------- | ------------------ |
  | `auth-db` | `postgres:16-alpine`      | Base propia de Supabase Auth (esquema `auth`). Volumen propio.   | ninguno (interno)  |
  | `auth`    | `supabase/auth:v2.196.0`  | Supabase Auth (GoTrue) de verdad, en local.                      | ninguno (interno)  |
  | `mail`    | `axllent/mailpit:v1.31.0` | Captura **todo** el correo que emite `auth` y lo expone por API. | 8025:8025 (UI+API) |

  El gateway de hoy (`storage-gateway`, nginx) gana una `location /auth/v1/`,
  para que **un solo origen** —el mismo `http://localhost:54321` que ya está en
  `.env`— sirva Auth y Storage, igual que hace Kong en el Supabase real.

- Un guion reutilizable, scripts/auth-otp.mjs (por crear), que hace el ciclo
  completo sin humano: pide el código con `POST /auth/v1/otp`, lo **lee del
  correo capturado** por Mailpit y lo canjea con `POST /auth/v1/verify`,
  imprimiendo el `user.id` de la sesión resultante. Es lo que convierte la
  **Parte 2 (MANUAL)** de `.agent/specs/F-012/smoke.sh` en algo automatizable.

- Un bloque `== Auth ==` en `.agent/init.sh`, con `warn` y **nunca** `bad`,
  exactamente como el bloque `== Storage ==` de hoy.

- El enganche en `.github/workflows/ci.yml`, para que el criterio se ejecute
  también donde nadie mira.

- La plantilla de correo con `{{ .Token }}`, sin la cual llega un enlace y no un
  código de 6 dígitos, y no hay nada que teclear (F-012 D5/R3).

### Fuera (explícito)

- **Emular Google, Facebook o Apple.** No se puede y no se va a fingir. Ver
  § «Los cuatro proveedores del criterio 1», que es el filo de esta propuesta.
- **Credenciales OAuth reales**, ni de desarrollo. No se piden, no se guardan y
  no entran en `.env` ni en git.
- **El Supabase completo autohospedado**: ni Kong, ni Studio, ni Realtime, ni
  PostgREST, ni Edge Functions. Solo Auth y su captura de correo.
- **Sustituir el proyecto en la nube para producción.** Sigue haciendo falta el
  día que se publique; esto es entorno de desarrollo y de CI.
- **Tocar el código de F-012.** Ni `src/lib/auth/customerSession.ts`, ni
  `src/lib/supabase/server.ts`, ni las pantallas. F-012 está construido; lo que
  falta es dónde ejecutarlo. Si al ejecutar apareciera un fallo real de F-012,
  se para y se pregunta (regla 3 del backlog).
- **Contraseñas, SMS, MFA y SAML.** Todos fuera de F-012, todos fuera de aquí.
- **Arreglar los secretos vacíos de `.env.example`.** Es la otra propuesta
  (`.agent/specs/propuestas/env-example-secretos-vacios.md`) y no depende de
  esta, aunque las dos juntas cierran un hueco que ninguna cierra sola (ver
  § Qué desbloquea).
- **Datos de correo de verdad**: Mailpit no reenvía a ningún sitio. Ningún
  mensaje sale de la máquina.

## Actores y precondiciones

**Actor: quien desarrolla o prueba este repo** (persona o agente), en su máquina
o en CI. No hay actor de producto: nada de esto se ve desde la tienda.

Precondiciones, todas ya ciertas hoy salvo la última:

1. Docker corriendo, que ya hace falta para `postgres` y para Storage.
2. `.env` con las claves locales generadas
   (`node scripts/storage-dev-keys.mjs --write`), que ya hace falta para Storage.
3. `NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321"`, que es el valor de hoy y
   **no cambia**.
4. Los puertos 54321 y 8025 libres.

## Comportamiento esperado

### El correo, que es lo que de verdad se desbloquea

- **E1 — Levantar.** Dado un repo con `.env` ya generado, cuando se ejecuta
  `docker compose up -d`, entonces `GET http://localhost:54321/auth/v1/health`
  responde **200** con un cuerpo que nombra el servicio de Auth, y
  `GET http://localhost:54321/storage/v1/bucket` con la clave de servicio sigue
  devolviendo `store-media`. Un origen, dos APIs.
- **E2 — Pedir el código.** Dado el emulador arriba, cuando algo llama a
  `POST /auth/v1/otp` con un correo cualquiera de un dominio inventado, entonces
  responde 200 y Mailpit tiene **un** mensaje nuevo para ese destinatario.
- **E3 — Leer el código.** Dado ese mensaje, cuando se lee por
  `GET http://localhost:8025/api/v1/message/<id>`, entonces su cuerpo contiene un
  **código de 6 dígitos** (no solo un enlace), porque la plantilla que sirve el
  emulador incluye `{{ .Token }}`.
- **E4 — Canjearlo.** Cuando se envía ese código a `POST /auth/v1/verify` con
  `type: "email"`, entonces la respuesta trae `access_token`, `refresh_token` y
  un `user.id`, y a partir de ahí `GET /auth/v1/user` con ese token responde 200.
  Esta es, literalmente, la llamada que hoy devuelve 404 y bloquea F-012.
- **E5 — La app lo acepta.** Dada una sesión obtenida así **por las pantallas de
  F-012** (`/cuenta/entrar`, código, `/cuenta`), entonces `/cuenta` responde 200
  con el perfil, y existe **exactamente un** `Customer` nuevo con
  `supabaseUserId` no nulo.

### Los proveedores, hasta donde llega la honestidad

- **E6 — La salida hacia el proveedor.** Dado `auth` con los tres proveedores
  habilitados con credenciales **inertes** de desarrollo, cuando se pide
  `GET /auth/v1/authorize?provider=google&redirect_to=...`, entonces responde
  **302** hacia el dominio del proveedor, llevando el `redirect_uri` del
  emulador y un `state` no vacío. Ídem `facebook`. Esto demuestra que la app
  sale bien, y **nada más**.
- **E7 — La vuelta del proveedor no se emula.** Dado que el consentimiento
  ocurre en un servidor de Google, Facebook o Apple, entonces **ningún** entorno
  local puede producir un `code` que esos servidores hayan emitido. La vuelta
  (`/auth/callback`, `exchangeCodeForSession`) se sigue verificando **por
  contrato**, con los tests que F-012 ya dejó pasando, y de punta a punta solo
  con cuentas reales el día que exista un proyecto en la nube. Ver SP1.

### Que sea opcional, que es lo que protege al que no toca Auth

- **E8 — Contenedores parados.** Dado `docker compose stop auth auth-db mail`,
  cuando se ejecuta `bash .agent/init.sh`, entonces termina en **ENTORNO LISTO**
  (código 0) con un aviso que dice el comando exacto para levantarlos; y
  `/tienda-demo` y `/cuenta/entrar` siguen respondiendo **200**.
- **E9 — Auth sin configurar (criterio 6 de F-012).** Dado
  `NEXT_PUBLIC_SUPABASE_URL=""` y `NEXT_PUBLIC_SUPABASE_ANON_KEY=""`, cuando se
  construye y se arranca, entonces todo se comporta como el día que se verificó
  el criterio 6, con el mismo comando literal. Esta propuesta **no puede** tocar
  ese camino: es un criterio ya verificado de un feature ajeno.

### Convivencia con lo que ya existe

- **E10 — La base de la app no se contamina.** Cuando el emulador de Auth lleva
  un rato corriendo, entonces
  `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
  **no menciona** `auth` ni `storage`. Es la misma comprobación con la que F-011
  demostró el aislamiento de Storage.
- **E11 — Segundo arranque.** Cuando se ejecuta `docker compose up -d` dos veces
  seguidas, entonces la segunda sale 0 y no crea nada por duplicado: las
  migraciones de Auth son suyas y son idempotentes.
- **E12 — Rotar el secreto.** Cuando alguien vuelve a ejecutar
  `node scripts/storage-dev-keys.mjs --write`, entonces hay que recrear
  **`auth` además de `storage`**, porque las dos leen el mismo secreto; el
  mensaje del guion debe decirlo o la próxima sesión perderá media hora con
  401 opacos.

## Reglas de negocio

- **R1 — Nada con forma de clave entra en git.** Ni el secreto, ni la clave
  anon, ni la de servicio, ni ninguna credencial OAuth. Se sigue el precedente
  literal de `scripts/storage-dev-keys.mjs` y del comentario de `.env.example`
  que explica **por qué** («anything key-shaped committed here teaches the next
  person to paste a real key in the same slot»).
- **R2 — Un solo secreto local, el que ya existe.** `auth` recibe
  `GOTRUE_JWT_SECRET` leyendo `STORAGE_JWT_SECRET` de `.env`, el mismo con el que
  ya están firmadas la clave anon y la de servicio. Consecuencia buscada: un JWT
  de usuario emitido por el Auth local es aceptado por el Storage local como rol
  `authenticated`, que es exactamente cómo se comporta Supabase de verdad. **No
  se renombra la variable**: `.agent/init.sh` excluye esas tres claves de su
  chequeo de «sin valor», así que un renombrado dejaría el `.env` de todo el
  mundo roto **en silencio**. Se cambia el comentario de `.env.example`, no el
  nombre.
- **R3 — Un solo origen.** `NEXT_PUBLIC_SUPABASE_URL` no cambia de valor:
  `http://localhost:54321` pasa a servir `/auth/v1/*` y `/storage/v1/*`. La app
  no puede apuntar a dos sitios porque solo tiene esa variable.
- **R4 — El emulador es opcional.** `.agent/init.sh` avisa con `warn`, nunca con
  `bad`. `bash .agent/verify.sh <ID>` sin banderas no depende de él, y `--full`
  tampoco. Solo `--smoke` del feature que lo use.
- **R5 — Auth nunca corre contra la base de la app.** Contenedor propio, volumen
  propio, por el mismo motivo que F-011 le dio uno a Storage: los guiones de
  `docker-entrypoint-initdb.d` solo corren con el volumen **vacío**, y
  `queandabuscando-pgdata` ya tiene datos.
- **R6 — El correo no sale de la máquina.** Mailpit sin relay. `auth` apunta su
  SMTP al contenedor, con usuario y contraseña vacíos.
- **R7 — Credenciales OAuth inertes.** Los `client_id`/`secret` de los tres
  proveedores son literales de desarrollo cuyo único efecto es que `authorize`
  emita el 302. Nadie debe creer que sirven para entrar.
- **R8 — Sin autoconfirmación.** `GOTRUE_MAILER_AUTOCONFIRM` en falso. Si se
  autoconfirma no hay correo, y el criterio se estaría verificando contra nada.
- **R9 — Correo único por corrida.** Cada ejecución usa un destinatario nuevo
  (`prueba+<timestamp>@local.test`) y vacía la bandeja antes de pedir. Dos
  motivos, los dos ya conocidos: leer el código de una corrida anterior es el
  fallo clásico de toda prueba con captura de correo, y Auth limita los envíos
  por hora (`GOTRUE_RATE_LIMIT_EMAIL_SENT`, 30/h por omisión), así que una
  suite que se ejecute muchas veces al día empezará a ver **429** si reutiliza
  la bandeja o el límite por omisión.
- **R10 — Las filas que crea la prueba se limpian.** El smoke borra al terminar
  el `Customer` que creó, por `supabaseUserId`, o las aserciones de conteo dejan
  de ser estables a la tercera corrida.
- **R11 — Renombrar el gateway obliga a `--remove-orphans`.** Si el servicio
  pasa a llamarse `supabase-gateway`, el contenedor viejo sigue vivo ocupando el
  54321 y el nuevo falla con «port is already allocated». El comando de
  actualización es `docker compose up -d --remove-orphans`, y va escrito donde
  se lea antes de fallar, no después. Ver SP3.

## Casos límite y errores

- **Bandeja con correos viejos** → R9. Sin eso, la prueba pasa leyendo el código
  de ayer y da verde contra nada.
- **Código caducado**: con `GOTRUE_MAILER_OTP_EXP` bajo se puede ejercitar de
  verdad el mapeo `otp_expired → "invalid"` que `.agent/specs/F-012/impl.md`
  dejó anotado sin verificar. Es el único hueco de _comportamiento_ que el
  correo real permite cerrar y los mocks no.
- **429 por límite de envíos** → R9, más subir el límite en el entorno local.
- **Puerto 8025 ocupado** (Mailpit es común en otros proyectos): se fija
  explícitamente y `bash .agent/init.sh` lo dice si no responde.
- **Concurrencia**: dos canjes simultáneos del mismo código. Lo interesante no
  es Auth sino E8 de F-012 (dos primeros logins concurrentes → un solo
  `Customer`), que hoy solo está probado con Prisma directo y aquí se podría
  ejercitar por HTTP real.
- **`GOTRUE_URI_ALLOW_LIST`**: si no incluye `http://localhost:3000/**`, los
  `redirect_to` se ignoran y todo vuelve al `SITE_URL`, con lo que la validación
  de `next` (R7 de F-012) se probaría contra un camino que nunca ocurre.
- **`GOTRUE_API_EXTERNAL_URL` y el prefijo del gateway**: el enlace que Auth
  compone en el correo tiene que pasar por `/auth/v1/`, que es donde el nginx
  reescribe. Es el detalle de configuración con más probabilidad de morder al
  implementar; no bloquea el código de 6 dígitos (que no usa el enlace), pero se
  comprueba explícitamente.

## Datos y contrato

Nada de esto toca `docs/sync-contract.md` ni el POS. No hay migración de Prisma,
no hay campo nuevo, no hay endpoint nuevo de la app. El único contrato que
aparece es el de Supabase Auth, que ya consume `@supabase/ssr` tal cual.

Variables nuevas en `.env.example`, todas **sin valor con forma de clave**:
ninguna. Las que hacen falta las lee `docker-compose.yml` de lo que ya existe
(`STORAGE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) con el mismo patrón `:?` que
hoy usa el servicio `storage` para fallar con un mensaje útil en vez de arrancar
un contenedor que rechaza todo con un 401 opaco.

**Versión fijada, investigada y no supuesta**: la imagen `supabase/gotrue` fue
renombrada a **`supabase/auth`**; las dos se siguen publicando y son
intercambiables mientras viva la v2. Al 2026-08-29 la última estable en Docker
Hub es **`supabase/auth:v2.196.0`** (2026-08-18), mientras que el
`docker-compose.yml` oficial de Supabase todavía pinnea `supabase/gotrue:v2.189.0`.
Se propone **`supabase/auth:v2.196.0`** —nombre vigente, versión estable— con
`supabase/gotrue:v2.189.0` como repliegue si diera problemas, igual que F-011
fijó `supabase/storage-api:v1.71.0`. Mailpit: **`axllent/mailpit:v1.31.0`**
(2026-08-22); su API de lectura es `GET /api/v1/messages` y su vaciado
`DELETE /api/v1/messages`.

## Los cuatro proveedores del criterio 1

Esta es la sección que hay que leer antes de aceptar la propuesta, porque un
criterio de aceptación que prometa probar Apple en local sería mentira.

| Método       | Qué queda verificable **ejecutando algo, en local**                                                                                                                                                                                                                                         | Qué **no** queda verificable nunca en local                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Correo**   | **Todo, de punta a punta y sin humano**: pedir el código, recibirlo por correo, teclearlo, tener sesión, crear el `Customer`.                                                                                                                                                               | Nada.                                                                                                            |
| **Google**   | Que la app sale bien: `authorize` responde 302 hacia el dominio del proveedor con el `redirect_uri` y el `state` correctos.                                                                                                                                                                 | El consentimiento y la vuelta con un `code` real. Lo emite un servidor de Google y no hay forma de fabricarlo.   |
| **Facebook** | Igual que Google.                                                                                                                                                                                                                                                                           | Igual que Google.                                                                                                |
| **Apple**    | Igual que Google, con un matiz: Apple usa OIDC y su `secret` es un JWT firmado, así que **el 302 con credenciales inertes está por confirmar al implementar**. Si no lo emite, lo verificable se reduce a que el proveedor está habilitado (la respuesta **no** es `Unsupported provider`). | Igual que Google, más el hecho de que Apple exige un Team ID y una clave privada reales incluso para configurar. |

En una frase: **de los cuatro métodos del criterio 1, uno queda verificado de
verdad y tres quedan verificados solo hasta la puerta del proveedor.** Eso es
una mejora enorme —hoy no se puede ejecutar ninguno— pero no es el criterio 1
entero, y esta propuesta no finge lo contrario.

Existe un escalón más, honesto pero limitado: montar un **servidor OIDC de
mentira** y configurarlo en Auth como proveedor genérico. Eso permitiría
ejecutar de verdad **nuestro** camino de vuelta (`/auth/callback`,
`exchangeCodeForSession`, `ensureCustomerForUser`, la validación de `next`), y
seguiría **sin** demostrar nada sobre Google, Facebook ni Apple. Está fuera del
alcance de arriba y es la pregunta SP1.

## Criterios de aceptación propuestos

Todos `[nuevo]`: esto no es un feature del backlog todavía. Escritos para
copiarse tal cual a `.agent/features.json` si el humano los acepta.

1. `[nuevo]` `docker compose up -d` deja un único origen sirviendo las dos APIs:
   `curl -fsS http://localhost:54321/auth/v1/health` responde 200, y
   `curl -fsS http://localhost:54321/storage/v1/bucket` con la clave de servicio
   sigue devolviendo `store-media`.
2. `[nuevo]` `node scripts/auth-otp.mjs --email prueba@local.test` sale 0: pide
   el código, lo lee del correo capturado por Mailpit y lo canjea, imprimiendo el
   `user.id` de la sesión. Sin intervención humana y sin ningún proyecto en la
   nube.
3. `[nuevo]` El acceso por correo funciona **por las pantallas de F-012**: tras
   el canje, `GET /cuenta` responde 200 con el perfil y existe exactamente un
   `Customer` nuevo con `supabaseUserId` no nulo, comprobado con una consulta a
   Postgres antes y después.
4. `[nuevo]` Con el emulador parado (`docker compose stop auth auth-db mail`),
   `bash .agent/init.sh` termina en `ENTORNO LISTO` con código 0 e imprime el
   comando para levantarlo, y `/tienda-demo` y `/cuenta/entrar` siguen
   respondiendo 200.
5. `[nuevo]` El criterio 6 de F-012 sigue en pie con su comando literal:
   `NEXT_PUBLIC_SUPABASE_URL="" NEXT_PUBLIC_SUPABASE_ANON_KEY="" npm run build`
   sale 0 y ese build sirve `/tienda-demo` en 200.
6. `[nuevo]` La base de la app no se contamina:
   `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
   no menciona `auth` ni `storage`.
7. `[nuevo]` Nada con forma de clave nueva entra en git: `git grep -nE 'eyJ[A-Za-z0-9_-]{20,}'` sigue
   sin encontrar nada fuera de los lockfiles, y `docker compose config` falla con
   un mensaje que nombra `scripts/storage-dev-keys.mjs` cuando falta el secreto
   en `.env`.
8. `[nuevo]` OAuth, hasta donde llega:
   `curl -si 'http://localhost:54321/auth/v1/authorize?provider=google&redirect_to=http://localhost:3000/auth/callback'`
   responde 302 con `Location` hacia el dominio del proveedor, con `redirect_uri`
   y `state` no vacíos; ídem `facebook`. **El criterio dice explícitamente que
   esto no prueba que se pueda iniciar sesión con Google ni con Facebook**: prueba
   que la app sale correctamente hacia ellos.
9. `[nuevo]` Se ejecuta en CI: el job levanta los contenedores y corre los
   criterios 2 y 3 en GitHub Actions, y el workflow sale 0 **sin ningún secreto
   de repositorio**.
10. `[nuevo]` `docker compose up -d` dos veces seguidas sale 0 las dos veces y
    deja el mismo estado.

## Qué desbloquea exactamente

De `.agent/specs/F-012/tests.md`, que dejó cinco huecos con **una sola causa
raíz**:

| Hueco de `tests.md`                                         | Criterio de F-012 | ¿Lo desbloquea esto?                                                                            |
| ----------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| 1. Correo de punta a punta (1a)                             | 1                 | **Sí, entero.**                                                                                 |
| 2. `Order.customerId` con sesión válida (el positivo de D6) | 2 y 4             | **Sí**: con sesión real se confirma la fila enlazada por HTTP y Postgres.                       |
| 3. Autocompletado del checkout con sesión real              | 3                 | **Sí.**                                                                                         |
| 4. `/cuenta` en 200 a la vez que `/admin`                   | 5                 | **A medias**: la mitad de cliente sí; la de admin necesita la otra propuesta (secretos vacíos). |
| 5. Verificación visual                                      | —                 | No. Es otro asunto y otro mecanismo.                                                            |

Lo que **no** desbloquea: el criterio 1 para Google, Facebook y Apple más allá
del 302 de salida. Esa parte seguirá necesitando un proyecto en la nube y
cuentas reales, y así debería quedar escrito en las `notes` de F-012 el día que
el humano decida cerrarlo.

## Coste estimado, honesto

- **Un feature de tamaño medio, 1 o 2 sesiones.** Comparable al emulador de
  Storage de F-011, con la ventaja de que el patrón, el gateway y el generador
  de claves ya existen y no hay que inventarlos.
- **Archivos tocados**: `docker-compose.yml` (tres servicios y dos volúmenes),
  dos archivos nuevos en `docker/` (roles y plantilla de correo), la conf del
  gateway, scripts/auth-otp.mjs (por crear), `.agent/init.sh`, `.env.example`
  (solo comentarios) y `.github/workflows/ci.yml`. **Cero archivos de `src/`.**
- **Los tres riesgos**, en orden de probabilidad: (a) que `{{ .Token }}` no
  aparezca en el correo con la plantilla servida por URL —repliegue: leer el
  `token_hash` del enlace, que verifica menos y hay que decirlo—; (b) el
  `GOTRUE_API_EXTERNAL_URL` contra el prefijo del gateway; (c) el límite de
  envíos por hora mordiendo en CI.
- **Criterio de abandono, explícito**, siguiendo el precedente de F-011: si tras
  **dos** intentos de arranque el emulador no responde 200 en
  `/auth/v1/health`, o si hace falta un **cuarto** servicio además de los tres
  de arriba, se para y se vuelve al humano en vez de crecer un compose que nadie
  querrá mantener.
- **Coste recurrente**: dos contenedores Postgres en vez de uno y un capturador
  de correo. En reposo, decenas de MB. Y quien no toque Auth los deja parados.

## Incongruencias detectadas

- **I1** — `.agent/specs/F-012/architecture.md` § Escalabilidad afirma «0
  [viajes a Supabase Auth] en el caso normal (`getClaims` verifica en local)».
  `.agent/specs/F-012/tests.md` demuestra lo contrario leyendo
  `@supabase/auth-js`: con HS256, que es el caso normal de Supabase,
  `getClaims()` **siempre** sale a la red. La tabla de coste por checkout de esa
  arquitectura está, por tanto, optimista. Esta propuesta no lo arregla —no toca
  código— pero lo deja escrito: quien planifique latencia de checkout no debe
  confiar en ese cero.
- **I2** — `.agent/specs/F-011/architecture.md` § Emulador de Storage dejó
  encargado a F-012 decidir si el compose ganaba Auth. F-012 no lo decidió y su
  arquitectura no menciona el compose; el resultado fue exactamente el bloqueo
  que hoy impide cerrarlo. La lección, más que la incongruencia: un encargo
  escrito en la arquitectura de un feature cerrado no llega solo al siguiente.
- **I3** — `.env.example` describe `NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321"`
  como «the Storage emulator». En cuanto el gateway sirva `/auth/v1/*`, el
  comentario deja de ser cierto y hay que corregirlo en el mismo cambio.
- **I4** — El criterio 1 de F-012 nombra tres marcas que **ningún** entorno
  local puede verificar de punta a punta. La regla 3 impide tocarlo y esta
  propuesta no lo toca; lo que hace es dejar ejecutable la parte que sí lo es y
  escrito, con precisión, dónde termina.

## Huecos y preguntas al humano

**SP1 — ¿Entra el servidor OIDC de mentira, para ejecutar de verdad el camino de
vuelta de OAuth?**
Qué falta: decidir si el alcance incluye un cuarto contenedor que actúe como
proveedor OIDC genérico.
Por qué importa: es lo único que ejercitaría `/auth/callback` +
`exchangeCodeForSession` + `ensureCustomerForUser` contra un ida y vuelta OAuth
real. No demostraría nada sobre Google, Facebook ni Apple.
Opciones: (a) fuera, solo correo y el 302 de salida; (b) dentro, con su coste
(+medio día, +1 contenedor, +configuración de proveedor genérico); (c) fuera
ahora, propuesta aparte si algún día OAuth da problemas en producción.
**Recomiendo (a)**: el acceso por correo ya produce una **sesión real**, y con
esa sesión se cierran los huecos 2, 3 y 4 de `tests.md` igual de bien. El OIDC de
mentira solo añadiría cubrir el `route.ts` del callback, que ya está probado con
mocks, a cambio de la pieza más frágil de todo el montaje.

**SP2 — ¿Quién reescribe la Parte 2 (MANUAL) de `.agent/specs/F-012/smoke.sh`?**
Qué falta: ese guion es el artefacto de `sdd-tester` en un feature ajeno, y su
Parte 2 es literalmente el procedimiento que esta propuesta vuelve automatizable.
Por qué bloquea: sin decidirlo, o nadie lo reescribe y F-012 se sigue cerrando a
mano, o un agente escribe en el feature de otro, que es justo lo que las reglas
del arnés prohíben.
Opciones: (a) el feature nuevo trae scripts/auth-otp.mjs (por crear) y su propio
smoke, y cuando se reabra F-012 su `sdd-tester` sustituye la Parte 2 por llamadas
a ese guion; (b) el feature nuevo reescribe directamente el smoke de F-012;
(c) se deja manual para siempre.
**Recomiendo (a)**: el guion reutilizable es del repo, el smoke es del feature, y
así ningún agente escribe fuera de su frontera.

**SP3 — ¿Se renombra `storage-gateway` a `supabase-gateway`?**
Qué falta: el gateway va a servir dos APIs y su nombre solo nombrará una.
Por qué importa: renombrarlo cuesta un `docker compose up -d --remove-orphans`
una vez para todo el que tenga contenedores vivos; si no se hace, el contenedor
viejo sigue ocupando el 54321 y el nuevo falla con «port is already allocated»,
que es un mensaje que no dice nada sobre la causa.
Opciones: (a) renombrar servicio y archivo de configuración, con la nota del
`--remove-orphans` donde se lea antes de fallar; (b) dejar los nombres y añadir
solo la `location`, aceptando que el nombre mienta para siempre.
**Recomiendo (a)**: el rename es de un día y el nombre equivocado se lee durante
años.

## No decidido a propósito

- **La versión exacta el día de implementar.** Se propone
  `supabase/auth:v2.196.0` con la investigación hecha hoy; si al implementar hay
  una estable más nueva, la fija `sdd-architect` con el mismo criterio (estable,
  nombre vigente, no `latest`).
- **Si el emulador se levanta en CI con `docker compose` o con `services:` del
  workflow.** Es una decisión de `sdd-architect`; el criterio 9 solo exige que
  se ejecute y salga 0.
- **Si Mailpit se sustituye por Inbucket.** Mailpit está más mantenido y tiene
  API de vaciado, que R9 necesita; Inbucket es lo que usa el CLI de Supabase.
  Cualquiera de los dos cumple los criterios; se propone Mailpit y no se cierra
  la puerta.
- **Qué hacer con las filas de `Customer` que dejen las corridas** más allá de
  R10, si algún día el smoke se ejecuta en bucle.
