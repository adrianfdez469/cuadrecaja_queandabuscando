---
feature: F-028
agente: sdd-spec
actualizado: 2026-08-29T18:42:09Z
estado: listo
---

> Trasladado de `.agent/specs/propuestas/emulador-auth-local.md` el 2026-08-29,
> cuando el humano la aceptó y la convirtió en feature (D1). Los **once**
> `acceptance_criteria` de F-028 ya están en `.agent/features.json` y aquí van
> marcados `[ya]`, **literales**: la regla 3 prohíbe cambiarlos, así que lo que
> este documento hace con ellos es decir con qué comando se ejecuta cada uno.
> Donde la redacción del backlog me chirría, va en § Incongruencias, no en el
> criterio.
>
> Las tres preguntas de la propuesta están **resueltas** (D2, D3, D4) y quedan
> anotadas en § Huecos y preguntas al humano, no borradas. Sin `sdd-designer`
> (D5): F-028 no tiene interfaz.

## Problema

El criterio 1 de F-012 —«Se puede iniciar sesión con Google, Facebook, Apple y
correo»— **no se puede verificar ejecutando nada** en esta máquina ni en CI. No
es un descuido del probador: no hay backend de Auth contra el que ejecutar.
`.env` apunta `NEXT_PUBLIC_SUPABASE_URL` al emulador de Storage
(`http://localhost:54321`), cuyo nginx solo conoce `/storage/v1/`
(`docker/storage-gateway.conf`), así que `curl http://localhost:54321/auth/v1/user`
responde **404** (`.agent/specs/F-012/tests.md` § Lo que no se pudo verificar).

Y no hay atajo: `sdd-tester` leyó `@supabase/auth-js` y confirmó que, para un JWT
HS256 —el caso normal de Supabase—, `getClaims()` **siempre** hace una llamada de
red real a `<NEXT_PUBLIC_SUPABASE_URL>/auth/v1/user` para confirmar la firma. No
existe cookie fabricable que produzca una sesión que la app acepte, y fabricar un
servidor que conteste que sí sería **simular** el criterio.

El humano confirmó que **no va a haber un proyecto Supabase en la nube a corto
plazo**. Por la regla 1 del backlog, F-012 no puede cerrarse con `"passes": true`
mientras ese criterio no se ejecute, y con él quedan colgados cuatro huecos más
que `.agent/specs/F-012/tests.md` fichó por la **misma causa raíz**.

Este repo ya resolvió exactamente este problema una vez: F-011 levantó el
**emulador de Storage** en `docker-compose.yml` para que la subida de imágenes
hablara con la API real de Supabase Storage en local. F-028 es el mismo patrón
aplicado a Auth, y la mitad del trabajo —el gateway nginx, el generador de claves
locales (`scripts/storage-dev-keys.mjs`), la convención de «opcional, avisado por
`.agent/init.sh` con `warn` y nunca con `bad`»— ya está hecha ahí.

No es una idea nueva, y esa es su lección: `.agent/specs/F-011/architecture.md`
§ Emulador de Storage › «Consecuencia aceptada» dejó escrito hace dos features
que «**F-012** decidirá si añade el servicio de auth al mismo compose». F-012 no
lo decidió, y el resultado fue el bloqueo de hoy.

## Hasta dónde llega esto, y dónde no

Esta sección va antes del alcance a propósito. Es la parte del feature que se
puede malinterpretar en la dirección cara: creer que con F-028 cerrado el
criterio 1 de F-012 queda verificado.

**No queda.** De los cuatro métodos que nombra ese criterio, **uno** queda
verificado de verdad y **tres** quedan verificados solo hasta la puerta del
proveedor:

| Método       | Qué queda verificable **ejecutando algo, en local**                                                                                                                                                                                                                     | Qué **no** queda verificable nunca en local                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Correo**   | **Todo, de punta a punta y sin humano**: pedir el código, recibirlo por correo, canjearlo, tener sesión, crear el `Customer`.                                                                                                                                           | Nada.                                                                                                                 |
| **Google**   | Que la app **sale** bien: `GET /auth/v1/authorize?provider=google` responde 302 hacia el dominio del proveedor, con `redirect_uri` y `state` no vacíos.                                                                                                                 | El consentimiento y la vuelta con un `code` real. Lo emite un servidor de Google; no hay forma de fabricarlo.         |
| **Facebook** | Igual que Google.                                                                                                                                                                                                                                                       | Igual que Google.                                                                                                     |
| **Apple**    | Igual que Google **con un matiz que lo deja fuera de todo criterio**: Apple usa OIDC y su `secret` es un JWT firmado con una clave privada real, así que ni siquiera el 302 está garantizado con credenciales inertes. Ver E9 y R8: se observa y se anota, no se exige. | Igual que Google, más que Apple exige un Team ID y una clave privada reales incluso para **configurar** el proveedor. |

En una frase, y sin suavizarla: **el criterio 1 de F-012 no podrá marcarse
verificado al 100% ni con F-028 cerrado.** Lo que F-028 consigue es que la parte
verificable —el correo entero, más el 302 de salida de Google y Facebook— pase de
«no se puede ejecutar nada» a «se ejecuta sola, también en CI»; y que la parte no
verificable quede **escrita con precisión** en vez de quedar en la ambigüedad de
un criterio que nombra tres marcas.

Consecuencia práctica, para el día que se reabra F-012: cerrarlo exigirá o bien
un proyecto en la nube con cuentas reales, o bien que el humano acepte
explícitamente en sus `notes` que el criterio 1 se cierra con el correo verificado
y los tres proveedores verificados solo hasta el 302. **Esa decisión no es de
F-028** y aquí no se toma.

## Alcance

### Dentro

1. **Un backend de Supabase Auth de verdad, en local**, levantado por
   `docker-compose.yml` junto a lo que ya hay, con su versión fijada (nunca
   `latest`). Necesita tres piezas: el propio servicio de Auth, una **base de
   datos propia** para su esquema `auth`, y un **capturador de correo** que
   reciba todo lo que Auth emita y lo exponga por una API de lectura.

2. **Un solo origen para las dos APIs.** El gateway nginx que hoy existe
   (`docker/storage-gateway.conf`, servicio `storage-gateway`) gana una
   `location /auth/v1/` y **se renombra a `supabase-gateway`** (D4), porque va a
   servir dos APIs y el nombre viejo miente. `NEXT_PUBLIC_SUPABASE_URL` **no
   cambia de valor**: `http://localhost:54321` pasa a servir `/auth/v1/*` y
   `/storage/v1/*`, igual que hace Kong en el Supabase real (R3).

3. **El aviso del renombrado donde la gente lo vea, antes de fallar** (D4). El
   contenedor viejo sigue vivo ocupando el 54321 y el nuevo falla con «port is
   already allocated», que no dice nada de la causa. El aviso —con el comando
   literal `docker compose up -d --remove-orphans`— va en la salida de
   `.agent/init.sh` **cuando detecte el contenedor viejo** y en `.env.example`.
   Es requisito, no cortesía: ver E16 y R11.

4. **Un guion reutilizable del repo**, scripts/auth-otp.mjs (por crear), que hace
   el ciclo completo sin humano: pide el código, lo **lee del correo capturado** y
   lo canjea, imprimiendo el `user.id` de la sesión resultante. Es lo que hace
   ejecutable el criterio 2.

5. **Un smoke propio del feature**, .agent/specs/F-028/smoke.sh (por crear), que
   automatiza los criterios 2 y 3 contra la app en pie. Cuando se reabra F-012, su
   `sdd-tester` sustituirá la Parte 2 (MANUAL) de `.agent/specs/F-012/smoke.sh` por
   llamadas al guion del punto 4 (D3). **F-028 no toca nada de
   `.agent/specs/F-012/`.**

6. **Un bloque `== Auth ==` en `.agent/init.sh`**, con `warn` y **nunca** `bad`,
   exactamente como el bloque `== Storage ==` de hoy (`.agent/init.sh:83-94`).

7. **El enganche en `.github/workflows/ci.yml`**, para que esto se ejecute también
   donde nadie mira, y **sin ningún secreto de repositorio** (criterio 9).

8. **La plantilla de correo con el código de 6 dígitos.** Sin ella llega un enlace
   y no un código, y no hay nada que canjear por la vía que F-012 construyó
   (`.agent/specs/F-012/spec.md` R3: código de un solo uso de 6 dígitos).

9. **Los tres proveedores OAuth habilitados con credenciales inertes**, con el
   único efecto de que `authorize` emita el 302 del criterio 8.

### Fuera (explícito)

- **Emular Google, Facebook o Apple.** No se puede y no se va a fingir. Ver
  § Hasta dónde llega esto.
- **Un servidor OIDC de mentira** para ejercitar el camino de vuelta de OAuth.
  **Resuelto por el humano (D2/SP1): NO entra.** El acceso por correo ya produce
  una sesión **real** y con ella se cierran igual los huecos derivados; el OIDC
  falso solo cubriría `src/app/auth/callback/route.ts`, ya probado con mocks, a
  cambio de la pieza más frágil del montaje, y no demostraría nada sobre Google,
  Facebook ni Apple.
- **Credenciales OAuth reales**, ni de desarrollo. No se piden, no se guardan y no
  entran en `.env` ni en git.
- **El Supabase completo autohospedado**: ni Kong, ni Studio, ni Realtime, ni
  PostgREST, ni Edge Functions. Solo Auth y su captura de correo.
- **Sustituir el proyecto en la nube para producción.** Sigue haciendo falta el día
  que se publique; esto es entorno de desarrollo y de CI.
- **Tocar el código de F-012.** Ni `src/lib/auth/customerSession.ts`, ni
  `src/lib/supabase/server.ts`, ni las pantallas. F-012 está construido; lo que
  faltaba era dónde ejecutarlo. Si al ejecutar apareciera un fallo real de F-012,
  **se para y se pregunta** (regla 3 del backlog).
- **Tocar `.agent/specs/F-012/`** en cualquier forma, incluida su Parte 2 MANUAL
  (D3).
- **Contraseñas, SMS, MFA y SAML.** Todos fuera de F-012, todos fuera de aquí.
- **Los secretos vacíos de `.env.example`** (`SSO_JWT_SECRET`,
  `ADMIN_SESSION_SECRET`, `CRON_SECRET`). Eso es **F-029** y no depende de esto,
  aunque las dos juntas cierran un hueco que ninguna cierra sola (§ Qué desbloquea,
  hueco 4).
- **Ningún archivo de `src/`, `prisma/` ni `package.json`.** Cero migraciones, cero
  campos nuevos, cero endpoints nuevos de la app.
- **Correo que salga de la máquina.** El capturador no reenvía a ningún sitio.

## Actores y precondiciones

**Actor: quien desarrolla o prueba este repo** (persona o agente), en su máquina o
en CI. **No hay actor de producto**: nada de esto se ve desde la tienda, y quien
compra no nota diferencia alguna.

Precondiciones, todas ya ciertas hoy salvo la última:

1. Docker corriendo, que ya hace falta para `postgres` y para el emulador de
   Storage.
2. `.env` con las claves locales generadas
   (`node scripts/storage-dev-keys.mjs --write`), que ya hace falta para Storage.
3. `NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321"`, que es el valor de hoy y
   **no cambia**.
4. El puerto 54321 libre —o el contenedor viejo `queandabuscando-storage-gateway`
   retirado con `--remove-orphans`, ver E16— y libre el puerto del capturador de
   correo.

## Comportamiento esperado

### El correo, que es lo que de verdad se desbloquea

- **E1 — Levantar.** Dado un repo con `.env` ya generado, **cuando** se ejecuta
  `docker compose up -d`, **entonces** `GET http://localhost:54321/auth/v1/health`
  responde **200** con un cuerpo que nombra el servicio de Auth, y
  `GET http://localhost:54321/storage/v1/bucket` con la clave de servicio sigue
  devolviendo `store-media`. Un origen, dos APIs, ninguna regresión.

- **E2 — Pedir el código.** Dado el emulador arriba, **cuando** algo llama a
  `POST /auth/v1/otp` con un correo de un dominio inventado, **entonces** responde
  200 y el capturador de correo tiene **exactamente un** mensaje nuevo para ese
  destinatario.

- **E3 — Leer el código.** Dado ese mensaje, **cuando** se lee por la API del
  capturador, **entonces** su cuerpo contiene un **código de 6 dígitos**, no solo
  un enlace, porque la plantilla que sirve el emulador incluye el token.

- **E4 — Canjearlo.** **Cuando** se envía ese código a `POST /auth/v1/verify` con
  `type: "email"`, **entonces** la respuesta trae `access_token`, `refresh_token` y
  un `user.id`, y a partir de ahí `GET /auth/v1/user` con ese token responde
  **200**. Esta es, literalmente, la llamada que hoy devuelve 404 y bloquea F-012.

- **E5 — La app lo acepta, por sus propias rutas.** Dado el emulador arriba y un
  `next dev` de **este** worktree, **cuando** se hace
  `POST /api/account/otp` con `{ "email": … }` → 200 `{"sent":true}`, se lee el
  código del correo capturado y se hace `POST /api/account/otp/verify` con
  `{ "email": …, "token": … }`, **entonces** la respuesta es **200** con
  `{"signedIn":true,"profile":{…}}` y un `Set-Cookie` de `qab-shopper-auth`; y con
  esa cookie, `GET /cuenta` responde **200** con el perfil. Son exactamente las
  dos rutas a las que hacen POST las pantallas de F-012
  (`src/app/api/account/otp/route.ts`, `src/app/api/account/otp/verify/route.ts`),
  así que el criterio 3 se ejecuta sin navegador.

- **E6 — La fila que queda.** Dado E5, **cuando** se cuenta
  `select count(*) from "Customer" where "supabaseUserId" is not null` **antes** y
  **después**, **entonces** la diferencia es **exactamente 1**, y la fila nueva
  tiene `supabaseUserId` no nulo. Contado con una consulta a Postgres, no leyendo
  la respuesta HTTP.

### Los proveedores, hasta donde llega la honestidad

- **E7 — La salida hacia el proveedor.** Dado Auth con Google y Facebook
  habilitados con credenciales **inertes**, **cuando** se pide
  `GET /auth/v1/authorize?provider=google&redirect_to=http://localhost:3000/auth/callback`,
  **entonces** responde **302** con `Location` hacia el dominio del proveedor,
  llevando un `redirect_uri` que apunta al emulador y un `state` no vacío. Ídem
  `facebook`. Esto demuestra que la app **sale** bien, y **nada más**.

- **E8 — La vuelta del proveedor no se emula.** Dado que el consentimiento ocurre
  en un servidor de Google o de Facebook, **entonces** ningún entorno local puede
  producir un `code` que esos servidores hayan emitido. La vuelta
  (`src/app/auth/callback/route.ts`, `exchangeCodeForSession`) se sigue verificando
  **por contrato**, con los tests que F-012 ya dejó pasando, y de punta a punta
  solo con cuentas reales el día que exista un proyecto en la nube (D2).

- **E9 — Apple se observa, no se exige.** **Cuando** se pida
  `authorize?provider=apple`, **entonces** puede ocurrir cualquiera de dos cosas y
  **las dos son resultado válido de F-028**: (a) responde 302, y se anota; (b)
  responde un error porque el `secret` de Apple tiene que ser un JWT firmado con
  una clave privada real, y **también se anota, con su cuerpo literal**. Lo que
  **no** se hace es inventar una clave privada ni dar por bueno el criterio 1 de
  F-012 para Apple. Ningún `acceptance_criteria` de F-028 nombra a Apple, y eso es
  deliberado.

### Que sea opcional, que es lo que protege al que no toca Auth

- **E10 — Contenedores parados.** Dado el emulador de Auth detenido, **cuando** se
  ejecuta `bash .agent/init.sh`, **entonces** termina en **ENTORNO LISTO** (código
  **0**) con un aviso `warn` que dice el comando exacto para levantarlo; y
  `/tienda-demo` y `/cuenta/entrar` siguen respondiendo **200**.

- **E11 — Emulador caído con la URL configurada.** Dado
  `NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321"` y los contenedores de Auth
  parados, **cuando** llega una petición con o sin cookie de cliente, **entonces**
  `getCustomerUser()` devuelve `null` —nunca lanza— y la tienda, el checkout y el
  pedido de invitado funcionan igual. Es el camino «sesión irresoluble» que F-012
  llama E17 y que su `sdd-tester` ya ejecutó de verdad; F-028 **no puede**
  cambiarlo.

- **E12 — Auth sin configurar (criterio 6 de F-012).** Dado
  `NEXT_PUBLIC_SUPABASE_URL=""` y `NEXT_PUBLIC_SUPABASE_ANON_KEY=""`, **cuando** se
  construye y se arranca, **entonces** todo se comporta como el día que se verificó
  el criterio 6, con el mismo comando literal. F-028 **no puede** tocar ese camino:
  es un criterio ya verificado de un feature ajeno.

### Convivencia con lo que ya existe

- **E13 — La base de la app no se contamina.** **Cuando** el emulador de Auth lleva
  un rato corriendo, **entonces**
  `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
  **no menciona** `auth` ni `storage`. Es la misma comprobación con la que F-011
  demostró el aislamiento de Storage.

- **E14 — Segundo arranque.** **Cuando** se ejecuta `docker compose up -d` dos
  veces seguidas, **entonces** la segunda sale **0** y no crea nada por duplicado:
  las migraciones de Auth son suyas y son idempotentes.

- **E15 — Rotar el secreto.** **Cuando** alguien vuelve a ejecutar
  `node scripts/storage-dev-keys.mjs --write`, **entonces** el mensaje final del
  guion nombra **también** los servicios de Auth entre los que hay que recrear,
  porque leen el mismo secreto que Storage (R2). Hoy ese mensaje solo dice
  `docker compose up -d --force-recreate storage storage-gateway`
  (`scripts/storage-dev-keys.mjs:70`); si no se actualiza, la próxima sesión pierde
  media hora con 401 opacos.

- **E16 — El renombrado del gateway avisa antes de morder.** Dado un worktree con
  el contenedor `queandabuscando-storage-gateway` todavía vivo, **cuando** se
  ejecuta `bash .agent/init.sh`, **entonces** imprime un `warn` que nombra el
  contenedor viejo y da el comando literal
  `docker compose up -d --remove-orphans`; y `.env.example` lo dice también, en el
  bloque de Supabase. **Sin esto, el síntoma es «port is already allocated», que no
  menciona ni el renombrado ni el comando** (D4).

- **E17 — Se ejecuta donde nadie mira.** **Cuando** corre el CI de un PR,
  **entonces** el emulador se levanta, el ciclo de correo de E2–E6 se ejecuta y el
  workflow sale **0**, sin ningún secreto de repositorio: las claves las genera el
  propio job con `node scripts/storage-dev-keys.mjs --write`, igual que en local.

## Reglas de negocio

- **R1 — Nada con forma de clave entra en git.** Ni el secreto, ni la clave anon,
  ni la de servicio, ni ninguna credencial OAuth, ni de demostración. Se sigue el
  precedente literal de `scripts/storage-dev-keys.mjs` y del comentario de
  `.env.example` que explica **por qué**: «anything key-shaped committed here
  teaches the next person to paste a real key in the same slot». Es la ficha
  `.agent/playbook/secretos-de-desarrollo-en-env-example.md`, que ya mordió en
  F-011.

- **R2 — Un solo secreto local, el que ya existe.** El servicio de Auth recibe su
  secreto JWT leyendo `STORAGE_JWT_SECRET` de `.env`, el mismo con el que ya están
  firmadas la clave anon y la de servicio. Consecuencia buscada: un JWT de usuario
  emitido por el Auth local es aceptado por el Storage local como rol
  `authenticated`, que es exactamente cómo se comporta Supabase de verdad. **No se
  renombra la variable**: `.agent/init.sh:53` excluye esas tres claves de su chequeo
  de «sin valor», así que un renombrado dejaría el `.env` de todo el mundo roto **en
  silencio**. Se cambia el comentario de `.env.example`, no el nombre.

- **R3 — Un solo origen.** `NEXT_PUBLIC_SUPABASE_URL` no cambia de valor. La app no
  puede apuntar a dos sitios porque solo tiene esa variable, y añadir una segunda
  sería tocar `src/`, que está fuera de alcance.

- **R4 — El emulador es opcional, y eso es un requisito duro.** `.agent/init.sh`
  avisa con `warn`, **nunca** con `bad`. `bash .agent/verify.sh F-028` sin banderas
  no depende de él, y **`--full` tampoco** —sus etapas son
  harness · typecheck · lint · format · test · prisma · build · theme · bundle, y
  ninguna toca el emulador—, así que el criterio 11 se cumple igual con los
  contenedores parados. Solo `--smoke` lo necesita. Quien no toque Auth trabaja con
  todo esto detenido, igual que hoy con Storage.

- **R5 — El criterio 6 de F-012 no se puede romper.** Es de otro feature y ya está
  verificado. Cualquier cambio de F-028 que lo altere es un fallo de F-028, no una
  actualización del criterio.

- **R6 — Auth nunca corre contra la base de la app.** Contenedor propio, volumen
  propio, por el mismo motivo que F-011 le dio uno a Storage: los guiones de
  `docker-entrypoint-initdb.d` solo corren con el volumen **vacío**, y
  `queandabuscando-pgdata` ya tiene datos (`docker/storage-roles.sql`, cabecera).

- **R7 — El correo no sale de la máquina.** El capturador no tiene relay; el
  servicio de Auth apunta su SMTP al contenedor. Ningún mensaje llega a una bandeja
  real de nadie.

- **R8 — Credenciales OAuth inertes, y dichas como tales.** Los `client_id` y
  `secret` de los proveedores son literales de desarrollo cuyo único efecto es que
  `authorize` emita el 302. Van con un comentario que impida que alguien crea que
  sirven para entrar. Apple queda sujeta a E9.

- **R9 — Sin autoconfirmación.** La autoconfirmación de correo queda **desactivada**.
  Si se autoconfirma no se envía correo, y el criterio se estaría verificando contra
  nada.

- **R10 — Correo único por corrida, y bandeja vacía antes de pedir.** Cada ejecución
  usa un destinatario nuevo (por ejemplo `prueba+<marca de tiempo>@local.test`) y
  vacía la bandeja antes de pedir el código. Dos motivos conocidos: leer el código
  de una corrida anterior es el fallo clásico de toda prueba con captura de correo
  —y da **verde contra nada**—, y Auth limita los envíos por hora, así que una suite
  que corra muchas veces al día empezará a ver **429**.

- **R11 — Renombrar el gateway obliga a `--remove-orphans`, y el aviso es parte del
  feature.** El contenedor viejo sigue ocupando el 54321 y el nuevo falla con «port
  is already allocated». El aviso va en `.agent/init.sh` y en `.env.example`
  (E16). Un renombrado sin ese aviso **no cumple** este feature.

- **R12 — Las filas que crea la prueba se limpian.** El smoke borra al terminar el
  `Customer` que creó, por `supabaseUserId`, o las aserciones de conteo de E6 dejan
  de ser estables a la tercera corrida.

- **R13 — Ningún criterio de F-028 se da por bueno leyendo código.** Regla 1 del
  backlog. En particular, el criterio 8 se cierra con la respuesta HTTP real del
  `authorize`, no con la configuración del proveedor.

## Casos límite y errores

### Los estados de error de quien monta esto

Cada fila es un estado que va a ocurrir. La columna de la derecha es requisito: si
el sistema no dice eso, el feature no está terminado.

| Estado                                                        | Qué se ve si nadie lo previó                                                                             | Qué tiene que decir                                                                                                                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Emulador de Auth parado** (opción legítima, R4)             | La app trata toda sesión como inexistente, sin explicación: idéntico a «no he entrado»                   | `bash .agent/init.sh` imprime un `warn` con el comando exacto para levantarlo, y termina en ENTORNO LISTO igualmente (E10)                                               |
| **Puerto 54321 ocupado por el contenedor viejo del gateway**  | `Bind for 0.0.0.0:54321 failed: port is already allocated` — no menciona ni el renombrado ni la solución | El `warn` de `.agent/init.sh` que detecta el contenedor viejo, y el comentario de `.env.example`, los dos con `docker compose up -d --remove-orphans` (E16, R11)         |
| **Secreto sin generar en `.env`**                             | Un contenedor que arranca y rechaza todo con 401 opacos                                                  | `docker compose config` y `docker compose up` fallan con el mensaje `${VAR:?…}` que **nombra `scripts/storage-dev-keys.mjs`**, igual que hoy hace `storage` (criterio 7) |
| **El correo no llega** (SMTP mal apuntado, o R9 incumplida)   | El guion se cuelga o falla con un `undefined`                                                            | El guion falla con un mensaje que dice cuántos segundos esperó, a qué destinatario, y dónde mirar la bandeja capturada                                                   |
| **Llega un enlace y no un código de 6 dígitos**               | El canje falla con «token inválido» y parece un fallo de Auth                                            | El guion distingue los dos casos y dice que falta el token en la plantilla de correo (riesgo (a) de § Riesgos)                                                           |
| **Puerto del capturador de correo ocupado** por otro proyecto | `port is already allocated`, otra vez sin causa                                                          | El puerto se fija explícitamente y `.agent/init.sh` avisa si no responde                                                                                                 |
| **Claves rotadas sin recrear los contenedores**               | 401 opacos en Auth **y** en Storage, sin relación aparente con lo que se acaba de hacer                  | El mensaje final de `scripts/storage-dev-keys.mjs` nombra también los servicios de Auth (E15)                                                                            |

### Los casos límite del comportamiento

- **Bandeja con correos viejos** → R10. Sin eso, la prueba pasa leyendo el código de
  ayer y da verde contra nada. Es el fallo más caro de esta familia porque **no se
  ve**: sale verde.
- **Código caducado.** Con una expiración corta se puede ejercitar de verdad el
  mapeo `otp_expired → "invalid"` que `.agent/specs/F-012/impl.md` dejó anotado sin
  verificar. Es el único hueco de **comportamiento** que el correo real permite
  cerrar y los mocks no; no es criterio de F-028, pero sí una observación que vale
  la pena dejar en su `tests.md`.
- **429 por límite de envíos** → R10, más subir el límite en el entorno local.
  Distinguirlo importa: `src/app/api/account/otp/route.ts` ya traduce ese caso a un
  **429 `RATE_LIMITED`** propio, así que una corrida que lo dispare se parece a un
  fallo de la app y no lo es.
- **Concurrencia.** Dos canjes simultáneos del mismo código. Lo interesante no es
  Auth sino E8 de F-012 (dos primeros logins concurrentes → un solo `Customer`), hoy
  probado solo con Prisma directo y que aquí se podría ejercitar por HTTP real. No es
  criterio; es una posibilidad que se abre.
- **Lista de redirecciones permitidas.** Si no incluye el origen local de la app, los
  `redirect_to` se ignoran y todo vuelve al sitio por omisión, con lo que la
  validación de `next` (R7 de F-012) se probaría contra un camino que nunca ocurre.
- **La URL externa de Auth contra el prefijo del gateway.** El enlace que Auth compone
  en el correo tiene que pasar por `/auth/v1/`, que es donde nginx reescribe. Es el
  detalle de configuración con más probabilidad de morder al implementar; no bloquea
  el código de 6 dígitos —que no usa el enlace— pero se comprueba explícitamente.
- **`next dev` del worktree equivocado.** Antes de dar por buena cualquier medición
  por HTTP hay que confirmar de qué directorio es el servidor: ficha
  `.agent/playbook/next-dev-uno-por-directorio.md`, que ya mordió en F-010 y F-018.

## Datos y contrato

Nada de esto toca `docs/sync-contract.md` ni el POS. **No hay migración de Prisma,
no hay campo nuevo, no hay endpoint nuevo de la app.** El único contrato que aparece
es el de Supabase Auth, que ya consume `@supabase/ssr` tal cual, y la API de lectura
del capturador de correo, que solo usa el guion del punto 4.

**Variables nuevas en `.env.example` con forma de clave: ninguna.** Las que hacen
falta las lee `docker-compose.yml` de lo que ya existe (`STORAGE_JWT_SECRET`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) con el mismo patrón
`${VAR:?mensaje}` que hoy usa el servicio `storage` para fallar con un mensaje útil
en vez de arrancar un contenedor que rechaza todo con un 401 opaco. Lo que **sí**
cambia en `.env.example` son **comentarios**: el que describe
`NEXT_PUBLIC_SUPABASE_URL` como «the Storage emulator» (I3) y el aviso de
`--remove-orphans` (E16).

Formas de datos que el guion y el smoke necesitan, para que dos personas escriban lo
mismo:

| Dato                      | Forma                                                                 | Dónde se usa                            |
| ------------------------- | --------------------------------------------------------------------- | --------------------------------------- |
| Destinatario de prueba    | `prueba+<marca de tiempo>@local.test` — dominio inventado, nunca real | R10, criterio 2                         |
| Código de acceso          | **6 dígitos**, un solo uso                                            | E3, E4, `.agent/specs/F-012/spec.md` R3 |
| `user.id`                 | UUID, impreso por el guion en su salida estándar                      | Criterio 2                              |
| `Customer.supabaseUserId` | El mismo UUID, no nulo, exactamente una fila nueva                    | E6, criterio 3                          |
| Cookie de sesión          | `qab-shopper-auth` (más sus trozos `.0`, `.1`, … del chunker)         | E5                                      |

## Qué desbloquea exactamente, hueco por hueco

`.agent/specs/F-012/tests.md` § Huecos de cobertura dejó **cinco** huecos numerados,
cuatro de ellos con una sola causa raíz. Esto es lo que F-028 hace con cada uno:

| Hueco de `.agent/specs/F-012/tests.md`                         | Criterio de F-012 | ¿Lo desbloquea F-028?                                                                                                                     |
| -------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **1.** Criterio 1a: correo de punta a punta                    | 1                 | **Sí, entero** — E2–E6, sin humano y también en CI                                                                                        |
| **2.** El positivo de D6: `Order.customerId` con sesión válida | 2 y 4             | **Sí**: con la sesión real de E5 se confirma por HTTP + Postgres la fila enlazada                                                         |
| **3.** Autocompletado del checkout con sesión real             | 3                 | **Sí**                                                                                                                                    |
| **4.** `/cuenta` en 200 **a la vez que** `/admin`              | 5                 | **A medias**: la mitad de cliente sí (E5); la de admin necesita una sesión de admin sin tocar `.env` a mano, que es **F-029**, criterio 7 |
| **5.** Verificación visual                                     | —                 | **No.** Es otro asunto y otro mecanismo                                                                                                   |

Y lo que **no** desbloquea, dicho una vez más porque es donde se pierde la
honestidad: **el criterio 1 de F-012 para Google, Facebook y Apple más allá del 302
de salida.** Esa parte seguirá necesitando un proyecto en la nube y cuentas reales.

## Criterios de aceptación propuestos

Los **once** están ya en `.agent/features.json` bajo F-028, así que van `[ya]` y
**citados literalmente**. Lo que añade esta sección es con qué se ejecuta cada uno.
Ninguno se modifica (regla 3); lo que me chirría va en § Incongruencias.

1. `[ya]` «`docker compose up -d` deja un solo origen sirviendo las dos APIs:
   `curl -fsS http://localhost:54321/auth/v1/health` responde 200, y
   `/storage/v1/bucket` con la clave de servicio sigue devolviendo store-media.»
   → E1. Dos `curl`, el segundo con
   `-H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"` y `grep -q store-media`.

2. `[ya]` «El guion de acceso por correo termina con codigo 0 sin intervencion
   humana: pide el codigo, lo lee del correo capturado, lo canjea e imprime el
   user.id.»
   → E2–E4. `node scripts/auth-otp.mjs --email prueba+<ts>@local.test; echo $?` →
   **0**, con un UUID en la salida (scripts/auth-otp.mjs, por crear).

3. `[ya]` «El acceso por correo funciona por las pantallas de F-012: /cuenta
   responde 200 con el perfil, y la consulta a Postgres antes y despues muestra
   exactamente un Customer nuevo con supabaseUserId no nulo.»
   → E5 + E6. `POST /api/account/otp`, `POST /api/account/otp/verify`,
   `GET /cuenta` con la cookie devuelta, y el `select count(*)` antes/después.

4. `[ya]` «Con el emulador parado, `bash .agent/init.sh` termina en ENTORNO LISTO e
   imprime el comando para levantarlo; /tienda-demo y /cuenta/entrar siguen
   respondiendo 200.»
   → E10. Parar los servicios de Auth, `bash .agent/init.sh; echo $?` → **0** con la
   línea ENTORNO LISTO, y dos `curl -o /dev/null -w '%{http_code}'`.

5. `[ya]` «El criterio 6 de F-012 sigue en pie: con NEXT_PUBLIC_SUPABASE_URL vacio,
   `npm run build` termina en 0 y ese build sirve /tienda-demo en 200.»
   → E12. Con la forma **literal** que ejecutó el `sdd-tester` de F-012, que vacía
   **las dos** variables:
   `NEXT_PUBLIC_SUPABASE_URL="" NEXT_PUBLIC_SUPABASE_ANON_KEY="" npm run build`, y
   ese build arrancado en un puerto propio sirviendo `/tienda-demo` en 200 (I5).

6. `[ya]` «`npx prisma migrate diff --from-config-datasource --to-schema
prisma/schema.prisma --script` no menciona los esquemas auth ni storage.»
   → E13. El comando, con el emulador **arriba**, y `grep -c` de `auth`/`storage`
   sobre su salida.

7. `[ya]` «No entra en git nada con forma de clave: el grep de cadenas tipo JWT sobre
   el repo sigue sin devolver nada, y `docker compose config` falla nombrando el
   generador de claves si falta el secreto.»
   → R1. El grep, con la exclusión que hoy hace falta para que salga vacío de verdad:
   `git grep -nE 'eyJ[A-Za-z0-9_-]{20,}' -- . ':(exclude)package-lock.json'` → sin
   salida (código 1). Y, con el secreto ausente, `docker compose config` fallando con
   un mensaje que nombra `scripts/storage-dev-keys.mjs` (I6).

8. `[ya]` «El authorize de google y de facebook responde 302 al dominio del proveedor
   con redirect_uri y state correctos. Esto NO prueba que se pueda iniciar sesion con
   ellos: el consentimiento y la vuelta con un code real los emite un servidor de
   Google o Facebook y no se pueden fabricar en local.»
   → E7 + E8. `curl -si 'http://localhost:54321/auth/v1/authorize?provider=google&redirect_to=http://localhost:3000/auth/callback'`
   y su gemelo con `provider=facebook`, comprobando el 302, el dominio del `Location`,
   y que `redirect_uri` y `state` no van vacíos.

9. `[ya]` «El emulador se levanta y se ejecuta en CI sin ningun secreto de
   repositorio.»
   → E17. Un job de `.github/workflows/ci.yml` que genera las claves con
   `node scripts/storage-dev-keys.mjs --write`, levanta el emulador y ejecuta al menos
   los criterios 2 y 3; el workflow sale **0** y `grep -c 'secrets\.'` sobre el job
   nuevo da **0** (I7).

10. `[ya]` «`docker compose up -d` dos veces seguidas termina con codigo 0 las dos
    veces.»
    → E14. Las dos ejecuciones y sus dos `echo $?`.

11. `[ya]` «`bash .agent/verify.sh F-028 --full` termina con codigo 0.»
    → El sensor completo: harness · typecheck · lint · format · test · prisma ·
    build · theme · bundle. Por R4 tiene que salir 0 **también con el emulador
    parado**; el smoke va aparte, con `bash .agent/verify.sh F-028 --smoke`.

## Incongruencias detectadas

- **I1 — La arquitectura de F-012 dice que `getClaims()` verifica en local, y el
  código repite la misma afirmación; las dos son falsas para HS256.**
  `.agent/specs/F-012/architecture.md:715` promete «0 en el caso normal (`getClaims`
  verifica en local)», y `src/lib/auth/customerSession.ts:114` lo dice otra vez en un
  comentario: «verified locally against the cached JWKS». `.agent/specs/F-012/tests.md`
  demuestra lo contrario leyendo `@supabase/auth-js`: con secreto simétrico —el caso
  normal de Supabase— **siempre** sale a la red. La tabla de coste por checkout de esa
  arquitectura está, por tanto, optimista, y el comentario del código induce al error.
  F-028 **no lo arregla** (no toca `src/`), pero lo deja escrito: quien planifique
  latencia de checkout no debe confiar en ese cero. Corregir el comentario es un
  cambio de una línea que **le corresponde a F-012** cuando se reabra.

- **I2 — Un encargo escrito en la arquitectura de un feature cerrado no llega solo al
  siguiente.** `.agent/specs/F-011/architecture.md` § Emulador de Storage dejó a F-012
  la decisión de añadir Auth al compose. F-012 no la tomó y su arquitectura ni menciona
  el compose; el resultado fue exactamente el bloqueo de hoy. Más que incongruencia es
  la lección de por qué existe F-028.

- **I3 — `.env.example` va a mentir en cuanto exista la `location /auth/v1/`.** Hoy
  describe `NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321"` como «the Storage
  emulator». Se corrige en el mismo cambio, no después.

- **I4 — El criterio 1 de F-012 nombra tres marcas que ningún entorno local puede
  verificar de punta a punta.** La regla 3 impide tocarlo y F-028 no lo toca; lo que
  hace es dejar ejecutable la parte que sí lo es y escrito, con precisión, dónde
  termina (§ Hasta dónde llega esto).

- **I5 — El criterio 5 de F-028 vacía una variable; el criterio 6 de F-012 se verificó
  vaciando dos.** El backlog dice «con NEXT_PUBLIC_SUPABASE_URL vacio»;
  `.agent/specs/F-012/tests.md` § Mapa criterio → prueba ejecutó
  `NEXT_PUBLIC_SUPABASE_URL="" NEXT_PUBLIC_SUPABASE_ANON_KEY="" npm run build` y dejó
  dicho a propósito que esa es «la forma exacta que pide la spec». Vaciar las dos
  **cumple** el criterio del backlog y además reproduce lo ya verificado, así que no
  hay conflicto: se ejecuta con las dos vacías. Lo anoto para que nadie lo verifique
  con una sola y crea que ha comprobado el criterio 6 de F-012.

- **I6 — «el grep de cadenas tipo JWT sobre el repo sigue sin devolver nada» no es
  cierto hoy, literalmente.** Ejecutado ahora mismo,
  `git grep -nE 'eyJ[A-Za-z0-9_-]{20,}'` devuelve **un** resultado:
  `package-lock.json:7975`, un hash `integrity` en base64 que por casualidad contiene
  `eyJ`. Con `':(exclude)package-lock.json'` sale vacío (código 1). El criterio se
  ejecuta con esa exclusión; si se ejecutara sin ella, fallaría por un motivo que no
  tiene nada que ver con este feature.

- **I7 — «se ejecuta en CI» no dice qué se ejecuta.** El criterio 9 exige que el
  emulador «se levante y se ejecute» sin secretos de repositorio, pero no nombra qué
  comprobación corre allí. Lo interpreto como el mínimo que hace útil el job: los
  criterios 2 y 3. Si el humano quería más (por ejemplo el 8), lo dirá al aprobar el
  plan; interpretarlo a lo grande sin decirlo sería inventarme alcance.

## Huecos y preguntas al humano

**Ninguna abierta.** Las tres de la propuesta están resueltas y quedan aquí, no se
borran:

**SP1 — ¿Entra un servidor OIDC de mentira, para ejecutar de verdad el camino de
vuelta de OAuth? RESUELTO por el humano el 2026-08-29 (D2): opción (a), NO entra.**
Solo correo de punta a punta más el 302 de salida. El acceso por correo ya produce
una sesión real y con ella se cierran igual los huecos 2, 3 y 4 de
`.agent/specs/F-012/tests.md`; el OIDC falso solo cubriría
`src/app/auth/callback/route.ts`, ya probado con mocks, a cambio de la pieza más
frágil del montaje, y no demostraría nada sobre Google, Facebook ni Apple.

**SP2 — ¿Quién reescribe la Parte 2 (MANUAL) de `.agent/specs/F-012/smoke.sh`?
RESUELTO por el orquestador el 2026-08-29 (D3): opción (a).** F-028 trae su guion
reutilizable —scripts/auth-otp.mjs (por crear)— y su propio smoke
—.agent/specs/F-028/smoke.sh (por crear)—. Cuando se reabra F-012, **su**
`sdd-tester` sustituirá esa Parte 2 por llamadas al guion. Ningún agente escribe en
el artefacto de otro feature.

**SP3 — ¿Se renombra `storage-gateway` a `supabase-gateway`? RESUELTO por el
orquestador el 2026-08-29 (D4): opción (a), sí se renombra**, con una condición que
es requisito de esta spec: el aviso del `docker compose up -d --remove-orphans` va
donde la gente lo vea —la salida de `.agent/init.sh` cuando detecte el contenedor
viejo, y `.env.example`—, porque el fallo sin él es «port is already allocated», que
no dice nada de la causa. Ver E16 y R11.

## No decidido a propósito

Todo lo de esta sección es **insumo** para `sdd-architect`, no decisión cerrada de la
spec. La propuesta llegó con investigación hecha el 2026-08-29 y verificada contra
Docker Hub y el compose oficial de Supabase; se pasa tal cual, para que el arquitecto
la confirme o la cambie con criterio, no para que la copie.

- **Qué imagen y qué versión.** La imagen `supabase/gotrue` fue **renombrada a
  `supabase/auth`**; las dos se siguen publicando y son intercambiables mientras viva
  la v2. Al 2026-08-29, la última estable en Docker Hub es **`supabase/auth:v2.196.0`**
  (2026-08-18), mientras el compose oficial de Supabase todavía fija
  `supabase/gotrue:v2.189.0`. Insumo: `supabase/auth:v2.196.0`, con
  `supabase/gotrue:v2.189.0` como repliegue, igual que F-011 fijó
  `supabase/storage-api:v1.71.0`. Si al implementar hay una estable más nueva, la fija
  el arquitecto con el mismo criterio: estable, nombre vigente, **nunca `latest`**.

- **Qué capturador de correo.** Insumo: **`axllent/mailpit:v1.31.0`** (2026-08-22),
  con API de lectura y de vaciado —que R10 necesita—. La alternativa es Inbucket, que
  es lo que usa la CLI de Supabase. Cualquiera de los dos cumple los criterios.

- **Qué servicios exactamente, cómo se llaman, en qué red y con qué volúmenes.**
  Insumo: tres servicios (Auth, su Postgres, el capturador), base y volumen propios
  para Auth por R6, y la `location /auth/v1/` en el gateway renombrado. Los nombres de
  servicio y de contenedor, el `depends_on`, los healthcheck y el `proxy_pass` son del
  arquitecto.

- **Cómo se levanta el emulador en CI**: con `docker compose` dentro del job o con
  `services:` del workflow. El criterio 9 solo exige que se ejecute y salga 0.

- **Cómo llega la plantilla de correo con el token** (archivo montado, URL servida por
  un contenedor, o variable de entorno con el cuerpo). Es el **riesgo (a)** de abajo y
  el arquitecto debe elegir la forma que menos dependa de servir un archivo por HTTP
  desde otro contenedor.

- **Las variables de configuración concretas de Auth** —expiración del código, límite
  de envíos por hora, lista de redirecciones permitidas, URL externa, SMTP— con sus
  valores. La spec dice qué comportamiento tienen que producir (R7, R9, R10, § Casos
  límite); los nombres y números son del arquitecto.

- **Si el proveedor Apple se habilita o no.** E9 acepta las dos salidas. Si habilitarlo
  con credenciales inertes impide arrancar el servicio de Auth, se deja deshabilitado y
  se anota en `tests.md` con el error literal. Lo que no se hace es fabricar una clave
  privada.

- **Qué se hace con las filas de `Customer` que dejen las corridas**, más allá de R12,
  si algún día el smoke se ejecuta en bucle.

### Riesgos conocidos y criterio de abandono, como insumo

Tres riesgos, en orden de probabilidad: **(a)** que el código de 6 dígitos no aparezca
en el correo con la plantilla servida —repliegue: leer el token del enlace, que
verifica menos y hay que decirlo en `tests.md`—; **(b)** la URL externa de Auth contra
el prefijo `/auth/v1/` del gateway; **(c)** el límite de envíos por hora mordiendo en
CI.

**Criterio de abandono, explícito** y con el precedente de F-011: si tras **dos**
intentos de arranque el emulador no responde 200 en `/auth/v1/health`, o si hace falta
un **cuarto** servicio además de los tres previstos, se para y se vuelve al humano en
vez de hacer crecer un compose que nadie querrá mantener. El coste esperado es de un
feature medio, una o dos sesiones, con la ventaja de que el patrón, el gateway y el
generador de claves ya existen.
