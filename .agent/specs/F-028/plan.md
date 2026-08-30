---
feature: F-028
agente: orquestador
actualizado: 2026-08-29T22:49:48Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Un **Supabase Auth que corre en tu portátil**, junto al emulador de Storage que
ya está ahí desde F-011. Con él, el acceso por correo de la cuenta del comprador
—pedir el código de seis dígitos, recibirlo, teclearlo, quedar dentro— se puede
probar **ejecutando un comando**, en esta máquina y en CI, sin depender de ningún
proyecto en la nube ni de que nadie custodie unas claves.

Quien no toque Auth no se entera: los contenedores se quedan parados y todo
sigue igual, exactamente como pasa hoy con Storage.

**Lo que no cambia**: ni una línea de `src/`, ni una migración de Prisma, ni una
dependencia nueva. Y lo que este feature **no** puede darte, dicho aquí y no en
letra pequeña: **sólo el acceso por correo queda verificable de punta a punta.**
Google y Facebook llegan hasta el 302 de salida, y Apple ni eso. Son OAuth contra
terceros y no hay forma honesta de emularlos.

## Pasos

Nueve pasos. `bash .agent/verify.sh F-028` tiene que salir 0 al final de cada uno.

| Nº  | Qué se hace                                                                                                                                                      | Archivos                                                                                                 | Criterio que acerca | Cómo se verifica                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **El renombrado, solo y primero**: `storage-gateway` → `supabase-gateway`, servicio y `container_name`, con el `depends_on` y la URL del init de bucket          | `docker-compose.yml` · docker/supabase-gateway.conf (por crear, renombra `docker/storage-gateway.conf`)  | 1                   | `docker compose up -d` y `/storage/v1/bucket` con la clave de servicio **sigue** devolviendo `store-media`. Es la trampa del feature, va aislada       |
| 2   | La base de GoTrue y su init: rol `supabase_auth_admin` y **`create schema auth`**, que las migraciones de GoTrue no crean solas                                  | `docker-compose.yml` · docker/auth-roles.sql (por crear)                                                 | 1                   | `docker compose up -d auth-db` sano, y el esquema `auth` existe. Sin esto el primer arranque muere con «schema auth does not exist»                    |
| 3   | El servicio `auth` con sus variables, sin puerto en el host, y la `location /auth/v1/` del gateway                                                               | `docker-compose.yml` · docker/supabase-gateway.conf (por crear)                                          | 1                   | `curl -fsS http://localhost:54321/auth/v1/health` → 200, y `/storage/v1/bucket` sigue vivo en el mismo origen                                          |
| 4   | Mailpit y **la plantilla de correo con `{{ .Token }}`**, servida por el gateway que ya existe                                                                    | `docker-compose.yml` · docker/auth-email-otp.html (por crear) · docker/supabase-gateway.conf (por crear) | 2                   | Pedir un código y comprobar en la API de Mailpit que el cuerpo trae **seis dígitos**, no un enlace. Es la pieza de la que depende todo lo demás        |
| 5   | El guion del ciclo completo: pide el código, lo lee de Mailpit, lo canjea, imprime el `user.id`. Sin `pg`, sin Prisma, sin `@supabase/*`                         | scripts/auth-otp.mjs (por crear)                                                                         | 2                   | El guion termina en **0** sin intervención humana, y falla con un código de salida distinto por causa                                                  |
| 6   | El ciclo **por las rutas reales de F-012**: `POST /api/account/otp`, `POST /api/account/otp/verify` y `GET /cuenta` con la cookie                                | scripts/auth-otp.mjs (por crear), modo `app`                                                             | 3                   | 200 con `Set-Cookie: qab-shopper-auth`, `/cuenta` en 200 con el perfil, y **exactamente un `Customer` nuevo** con `supabaseUserId` no nulo en Postgres |
| 7   | La opcionalidad, que es requisito y no promesa: bloque `== Auth ==` en el arnés, con `warn` y **nunca** `bad`, más la detección del contenedor viejo del gateway | `.agent/init.sh` · `.env.example` · `scripts/storage-dev-keys.mjs`                                       | 4, 5                | Con el emulador parado, `bash .agent/init.sh` termina en `ENTORNO LISTO`; `verify.sh --full` sale 0; y el criterio 6 de F-012 sigue en pie             |
| 8   | El 302 de salida de OAuth y la observación de Apple, **sin aserto**                                                                                              | .agent/specs/F-028/smoke.sh (por crear)                                                                  | 8                   | `authorize` de `google` y `facebook` → 302 al dominio del proveedor con `redirect_uri` y `state`. Apple se anota, no se asierta                        |
| 9   | El job de CI, aislado del bucle rápido, y el smoke completo del feature                                                                                          | `.github/workflows/ci.yml` · .agent/specs/F-028/smoke.sh (por crear)                                     | 6, 7, 9, 10, 11     | El job pasa **sin ningún `secrets.`**; `docker compose up -d` dos veces seguidas sale 0; `prisma migrate diff` no menciona `auth` ni `storage`         |

## De dónde sale cada paso

| Paso | Sale de                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | D4 (decisión del orquestador sobre SP3) · `architecture.md` § Retoques de reutilización, fila 1 — la trampa del `storage-bucket-init` |
| 2    | `architecture.md` § docker/auth-roles.sql y su hallazgo 4 (las migraciones de GoTrue no crean el esquema)                             |
| 3    | Decisiones 1, 3 y 4 de `architecture.md` · R3 de `spec.md` · criterio 1                                                               |
| 4    | Decisión 6 de `architecture.md` y su hallazgo 1 (el fallback silencioso de `MAILER_TEMPLATES_*`) · E3 de `spec.md`                    |
| 5    | Decisión 9 de `architecture.md` · criterio 2                                                                                          |
| 6    | E5 de `spec.md`, reescrito por el spec para ir por rutas y no por pantallas · criterio 3                                              |
| 7    | R4 y E10, E15, E16 de `spec.md` · D4 · `architecture.md` § La opcionalidad, demostrada y no prometida                                 |
| 8    | Criterio 8 · E9 de `spec.md` · hallazgo 3 de `architecture.md` (el descubrimiento OIDC de Google no es hermético)                     |
| 9    | Decisión 7 de `architecture.md` · I7 · criterios 6, 7, 9, 10 y 11                                                                     |

## Qué queda fuera

- **Emular Google, Facebook o Apple.** No se puede y no se finge. Lo verificable
  es el 302 de salida, y de Apple ni eso.
- **El camino de vuelta de OAuth** (D2, tu decisión): nada de servidor OIDC de
  mentira. El acceso por correo ya produce una sesión real y con ella se cierran
  los mismos huecos.
- **El Supabase autohospedado completo**: sin Kong, sin Studio, sin Realtime, sin
  PostgREST. Tres servicios nuevos y ni uno más.
- **Sustituir el proyecto en la nube para producción.** Esto es para desarrollar
  y verificar.
- **Tocar código de F-012.** Está construido y no necesita más.
- **Contraseñas, SMS, MFA, SAML.**
- **Cerrar F-012.** F-028 desbloquea su verificación; cerrarlo sigue necesitando
  una decisión tuya sobre los tres proveedores que no se pueden probar en local.

## Riesgos y plan B

**No hay migración de datos, no se toca `docs/sync-contract.md`, no se usa ningún
comando prohibido y no se añade ninguna dependencia.** El esquema `auth` es de
GoTrue y vive en **su** base, no en la de la app.

1. **La plantilla de correo no llega y GoTrue manda un enlace mágico.** Es el
   riesgo que mata el feature, y el arquitecto lo encontró leyendo el código:
   `MAILER_TEMPLATES_*` sólo admite `http(s)` y, si el fetch falla, carga la
   plantilla por omisión **en silencio** — un correo sin código, indistinguible
   desde la respuesta HTTP. Mitigado con dos caminos: el asunto va inline (sin
   red) como diagnóstico, y el cuerpo por HTTP. **Plan B**: si aun así falla, el
   criterio 2 se cierra leyendo el `token_hash` del enlace, pero **el criterio 3
   no** — `src/features/account/schemas.ts` valida el código con
   `.length(6).regex(/^\d+$/)` y un `token_hash` son 56 hex. Eso sería volver a
   ti, no una decisión del implementador.
2. **El renombrado del gateway rompe Storage en silencio.** `storage-bucket-init`
   depende del gateway por nombre y le hace `curl`. Por eso el paso 1 va **solo y
   primero**, y se verifica contra la API de Storage, no contra la de Auth.
3. **El criterio 8 no es hermético en su mitad de Google**: GoTrue hace
   descubrimiento OIDC contra `accounts.google.com` al construir el proveedor.
   Facebook sí lo es. Si la red del CI lo estorba, el criterio 8 se verifica con
   Facebook y Google se anota.

**Criterio de abandono, heredado de F-011**: dos intentos de arranque fallidos, o
la necesidad de un **cuarto** servicio, y el implementador para y vuelve a mí.

## Coste

- **Un ciclo de `sdd-implementer`** para los nueve pasos, y después uno de
  `sdd-tester`. Sin diseñador: no hay interfaz.
- **Se toca lo que ya funciona en cinco archivos**: `docker-compose.yml`,
  `docker/storage-gateway.conf` (renombrado), `scripts/storage-dev-keys.mjs`,
  `.agent/init.sh`, `.env.example` y `.github/workflows/ci.yml`. **Cero archivos
  de `src/`.**
- **Dar marcha atrás**: barato en todo salvo el paso 1. Los servicios nuevos se
  quitan del compose y ya está; el renombrado hay que deshacerlo en los tres
  sitios a la vez, y quien lo deshaga a medias romperá el init de bucket.
- **Coste para quien ya tenga el repo levantado**: un `docker compose up -d
--remove-orphans`, una sola vez. Por eso el paso 7 hace que el arnés lo avise.

## Preguntas antes de aprobar

Las dos las respondió el humano el 2026-08-29, **antes** de firmar. Ninguna queda
abierta.

**PP1 — El criterio 7 se queda como está, y se ejecuta con la exclusión.** El
texto del backlog no se toca (regla 3), y la forma ejecutable es
`git grep -nE 'eyJ[A-Za-z0-9_-]{20,}' -- ':(exclude)package-lock.json'`, que hoy
sale vacía. Es la lectura fiel de su intención —que no entre en git nada con
forma de clave—; lo que el grep sin exclusión encuentra es un `integrity`
`sha512-…` de `package-lock.json` que contiene `eyJ`, ajeno al feature. La spec ya
lo ejecuta así y lo deja documentado en su § Incongruencias (I6). **Nadie
«arregla» ese criterio sobre la marcha.**

**PP2 — El job de CI corre los criterios 1, 2, 3 y 8**: salud del gateway con las
dos APIs en el mismo origen, el ciclo OTP completo, el ciclo por las rutas reales
de F-012, y el 302 de salida de OAuth. Con el matiz del riesgo 3: la mitad de
Google del criterio 8 no es hermética —GoTrue hace descubrimiento OIDC contra
`accounts.google.com`—, así que si la red del CI la estorba, esa mitad se
verifica con Facebook y Google se anota.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-028 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-08-29T22:49:48Z — aprobado por el humano: «Aprobado, adelante — los nueve pasos, el «qué queda fuera» y PP1-PP2 tal como quedaron escritas. El criterio 7 se queda como está y se ejecuta con la exclusión de package-lock.json; el job de CI corre los criterios 1, 2, 3 y 8.»
