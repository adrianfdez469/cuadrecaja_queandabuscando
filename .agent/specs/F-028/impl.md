---
feature: F-028
agente: sdd-implementer
actualizado: 2026-08-29T23:30:00Z
estado: listo
---

## Qué se construyó

Los nueve pasos de `plan.md`, en su orden, con `bash .agent/verify.sh F-028`
en 0 al final de cada uno.

| Paso | Archivo(s)                                                                                            | Qué hace                                                                                                                                           | Criterio    |
| ---- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1    | `docker-compose.yml`, `docker/supabase-gateway.conf` (renombrado desde `docker/storage-gateway.conf`) | `storage-gateway` → `supabase-gateway` (servicio y `container_name`); `depends_on` y la URL interna de `storage-bucket-init` actualizados a juego  | 1           |
| 2    | `docker-compose.yml`, `docker/auth-roles.sql`                                                         | Servicio `auth-db`; rol `supabase_auth_admin`, `create schema auth`, y `alter role … set search_path = auth` (ver § Desviaciones)                  | 1           |
| 3    | `docker-compose.yml`, `docker/supabase-gateway.conf`                                                  | Servicio `auth` (`supabase/auth:v2.196.0`) con sus variables; `location /auth/v1/` en el gateway                                                   | 1           |
| 4    | `docker-compose.yml`, `docker/auth-email-otp.html`, `docker/supabase-gateway.conf`                    | Servicio `mailpit`; plantilla con `{{ .Token }}`; `location /dev-mail/` sirviendo la plantilla                                                     | 2           |
| 5    | `scripts/auth-otp.mjs`                                                                                | El guion del ciclo completo, dos modos (`gotrue`/`app`), seis códigos de salida, sin `pg`/Prisma/`@supabase/*`                                     | 2           |
| 6    | `scripts/auth-otp.mjs` (modo `app`)                                                                   | Verificado contra las rutas reales de F-012 (`/api/account/otp`, `/api/account/otp/verify`, `GET /cuenta`)                                         | 3           |
| 7    | `.agent/init.sh`, `.env.example`, `scripts/storage-dev-keys.mjs`                                      | Bloque `== Auth ==` (`warn`, nunca `bad`) + detección del contenedor viejo del gateway; comentarios de `.env.example`; mensaje final del generador | 4, 5        |
| 8    | `.agent/specs/F-028/smoke.sh`                                                                         | Criterios 1, 2, 3 y 8, más la observación de Apple (E9, sin aserto) y la limpieza R12                                                              | 1, 2, 3, 8  |
| 9    | `.github/workflows/ci.yml`                                                                            | Job `auth` nuevo, aislado de `verify`/`visual`, cero `secrets.`, corre el smoke completo                                                           | 6, 7, 9, 10 |

### Servicios nuevos en `docker-compose.yml`

`auth-db` (`postgres:16-alpine`, volumen propio `queandabuscando-auth-pgdata`),
`auth` (`supabase/auth:v2.196.0`) y `mailpit` (`axllent/mailpit:v1.31.0`, puerto
`54324:8025`, sin volumen — bandeja en memoria). Exactamente los tres que
`architecture.md` fijó; ningún cuarto servicio.

### El guion — `scripts/auth-otp.mjs`

Implementado tal como `architecture.md` § El guion lo especifica: `--email`,
`--mode gotrue|app`, `--app`, `--cookie-jar`, `--timeout`, `--mailpit`, `--json`,
`--quiet`; los seis códigos de salida de la tabla del contrato. Una diferencia
de forma respecto al contrato original (ver § Desviaciones): el `--cookie-jar`
escribe el valor literal de la cabecera `Cookie:` (`nombre=valor; nombre2=valor2`),
no un archivo en formato Netscape — pensado para `curl -H "Cookie: $(cat
<archivo>)"`, que es como lo consume `.agent/specs/F-028/smoke.sh`.

## Desviaciones del plan

Ninguna de alcance. Tres desviaciones de detalle, todas dentro de "cómo se
implementa un paso ya firmado", no "qué se implementa":

1. **`docker/auth-roles.sql` necesitó una línea que ni `spec.md` ni
   `architecture.md` habían anticipado**: `alter role supabase_auth_admin set
search_path = auth;`. Sin ella, las 70 migraciones de GoTrue aplican
   perfectamente (el esquema `auth` existe, las tablas están ahí) pero la
   PRIMERA petición real (`POST /auth/v1/otp`) responde 500 `"Database error
finding user"` con `relation "users" does not exist` en el log — porque las
   queries de GoTrue no van cualificadas por esquema y dependen de que el
   `search_path` de la conexión ya apunte a `auth`. Es exactamente lo que el
   compose oficial de Supabase self-hosted hace para este mismo rol y que
   `architecture.md` no citó (citó el `create schema`, que es necesario pero no
   suficiente). Encontrado ejecutando el emulador de punta a punta, no leyendo
   el hallazgo 4 de `architecture.md`. Fichado:
   `.agent/playbook/gotrue-search-path-relation-users-no-existe.md`.
2. **El `--cookie-jar` del guion no escribe un archivo Netscape**, como
   insinuaría el nombre. Escribe el valor de una cabecera `Cookie:` literal.
   `architecture.md` no fijó el formato del archivo, solo que "escriba ahí las
   cookies de la respuesta"; el formato Netscape es la trampa clásica de
   `curl -b <archivo>` (autodetecta si el argumento es un nombre de archivo o
   un valor literal), y evitarla simplifica tanto el guion como
   `.agent/specs/F-028/smoke.sh`, que es el único otro consumidor.
3. **El entorno traía dos obstáculos que no son de F-028** y hubo que resolver
   para poder verificar: (a) los contenedores de Storage/Postgres que ya
   corrían en la máquina pertenecían a OTRO worktree (`limpet`, mismo repo,
   checkout distinto) por culpa de `container_name` fijo, no a este
   (`cowrie`) — se detuvieron y se recrearon bajo este proyecto (los datos del
   otro worktree no se tocaron: viven en su propio volumen con su propio
   prefijo). Fichado:
   `.agent/playbook/docker-compose-container-name-fijo-choca-entre-worktrees.md`.
   (b) `SSO_JWT_SECRET`, `ADMIN_SESSION_SECRET` y `CRON_SECRET` estaban vacíos
   en el `.env` de este worktree (ficha ya existente
   `env-optional-secreto-vacio-rompe-serverenv`, de F-012) y bloqueaban
   `npm run seed` — necesario para poblar `tienda-demo` y así poder verificar
   el criterio 6 de F-012 (build con las dos variables de Supabase vacías,
   sirviendo `/tienda-demo` en 200). Se rellenaron con valores de desarrollo
   locales; ninguno de los dos es un archivo que este ciclo debía tocar según
   `plan.md`, y ninguno se commiteó (viven solo en `.env`, gitignored).

## El riesgo 1 (la plantilla), tal como se comportó

Se comportó **exactamente** como `architecture.md` § Riesgos lo predijo, en
ambos sentidos:

- **El camino feliz funcionó a la primera** una vez resuelta la desviación 1
  (search_path): el asunto trae `{{ .Token }} es tu codigo de acceso` (sin red,
  diagnóstico) y el CUERPO —servido por `http://supabase-gateway/dev-mail/otp.html`—
  también trae el código de 6 dígitos, confirmado leyendo la API de Mailpit
  (`GET /api/v1/message/{id}`, campo `Text`), no dando el 200 del `POST
/auth/v1/otp` por bueno. El enlace del correo apunta correctamente a
  `http://localhost:54321/auth/v1/verify?token=...` (riesgo (b), también
  resuelto por construcción con `API_EXTERNAL_URL`/`GOTRUE_MAILER_URLPATHS_*`).
- **El repliegue silencioso es real** y se puede provocar a voluntad apagando
  el gateway o rompiendo `GOTRUE_MAILER_TEMPLATES_*`: el correo sigue llegando
  con 200 en la respuesta HTTP, pero el cuerpo cambia a la plantilla por
  omisión de GoTrue (sin `{{ .Token }}`). El guion lo distingue exactamente como
  el contrato pide (código de salida 4, con el asunto y los primeros 200
  caracteres del cuerpo), aunque no hizo falta usar el plan B (leer el
  `token_hash` del enlace) porque el camino feliz nunca falló una vez corregida
  la desviación 1.

## Riesgo 3 (Google no hermético)

No se materializó en este entorno: `authorize?provider=google` respondió 302 a
`accounts.google.com` con `redirect_uri` y `state`, igual que Facebook. El
smoke (`.agent/specs/F-028/smoke.sh`) igualmente contempla el caso "sin red":
si `authorize?provider=google` no responde 302, lo anota como SALTADO con el
motivo exacto (descubrimiento OIDC contra `accounts.google.com`) en vez de
contarlo como fallo de F-028 — así el CI (que sí tiene salida a internet) lo
verifica en verde, y un entorno sin red no rompe el criterio por un motivo
ajeno a la configuración.

## Lecciones fichadas

- `.agent/playbook/gotrue-search-path-relation-users-no-existe.md` — el
  `search_path` de `supabase_auth_admin`, sin el cual toda petición real a
  GoTrue responde 500 aunque las migraciones y el healthcheck estén en verde.
- `.agent/playbook/docker-compose-container-name-fijo-choca-entre-worktrees.md`
  — `container_name` fijo en `docker-compose.yml` choca entre worktrees
  paralelos del mismo repo; cómo detectarlo y resolverlo sin perder datos
  ajenos.

`bash .agent/verify.sh pending F-028` queda vacío: ningún fallo de este ciclo
sin ficha ni descarte.

## Lo que no se deduce del código

- El `.env` de este worktree necesitó, además de las tres claves que
  `node scripts/storage-dev-keys.mjs --write` acuña, valores no vacíos de
  `SSO_JWT_SECRET`/`ADMIN_SESSION_SECRET`/`CRON_SECRET` para poder ejecutar
  `npm run seed` y así reproducir el escenario del criterio 6 de F-012 con
  datos reales. Es un problema de ESTE worktree, no del feature: un worktree
  nuevo que copie `.env.example` y solo rellene las claves de Storage/Auth
  tropezará con lo mismo si intenta sembrar datos, y la ficha
  `env-optional-secreto-vacio-rompe-serverenv` (de F-012) ya lo explica.
- Los contenedores `queandabuscando-postgres`, `queandabuscando-storage-db`,
  `queandabuscando-storage` y `queandabuscando-storage-gateway` que estaban
  arriba al empezar este ciclo pertenecían al worktree `limpet` (confirmado con
  `docker inspect … com.docker.compose.project`), no a `cowrie`. Se detuvieron
  y se recrearon bajo el proyecto `cowrie` para poder aplicar el renombrado del
  paso 1 y añadir los servicios de Auth; los volúmenes de `limpet` no se
  tocaron (son un prefijo de volumen distinto) y ese worktree puede levantar
  los suyos de nuevo con `docker compose up -d` cuando los necesite.
- Docker Compose v5.1.2 (`docker compose up -d --wait --wait-timeout 180`,
  usado por el job de CI) bloquea hasta que todos los healthchecks declarados
  pasan; se probó localmente antes de escribirlo en `ci.yml` (≈13 s con los
  siete servicios en frío).

## Verificación final

- `bash .agent/verify.sh F-028 --full` → **0** (harness · typecheck · lint ·
  format · test · prisma · build · theme · bundle), con los contenedores de
  Auth ARRIBA.
- `bash .agent/verify.sh F-028 --full` → **0** también con `auth`, `auth-db` y
  `mailpit` PARADOS (criterio 4, R4).
- `bash .agent/verify.sh F-028 --smoke` → **0**: criterios 1, 2, 3 y 8 en
  verde; Apple observado (302 en este entorno) y no aserido.
- `bash .agent/verify.sh pending F-028` → vacío.
- Criterio 5 (== criterio 6 de F-012): `NEXT_PUBLIC_SUPABASE_URL=""
NEXT_PUBLIC_SUPABASE_ANON_KEY="" npm run build` → 0, y ese build sirve
  `/tienda-demo` y `/cuenta/entrar` en 200.
- Criterio 6 (E13): con el emulador arriba, `npx prisma migrate diff
--from-config-datasource --to-schema prisma/schema.prisma --script` no
  menciona `auth` ni `storage` (0 coincidencias).
- Criterio 7: `git grep -nE 'eyJ[A-Za-z0-9_-]{20,}' --
':(exclude)package-lock.json'` sin salida (código 1, PP1); con
  `STORAGE_JWT_SECRET` vacío, `docker compose config` falla nombrando
  `scripts/storage-dev-keys.mjs`.
- Criterio 10 (E14): `docker compose up -d` dos veces seguidas, las dos en 0.
- `git status`/`git diff --stat`: cero archivos en `src/`, cero en `prisma/`,
  `package.json` sin tocar.
