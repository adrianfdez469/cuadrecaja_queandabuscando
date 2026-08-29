---
slug: gotrue-search-path-relation-users-no-existe
sintoma: 'POST /auth/v1/otp (o cualquier ruta de GoTrue) responde 500 {"error_code":"unexpected_failure","msg":"Database error finding user"}, y el log del contenedor auth dice `error finding user: ERROR: relation "users" does not exist (SQLSTATE 42P01)`'
firma: relation "users" does not exist
etapa: smoke
visto_en: F-028
creado: 2026-08-29T23:20:31Z
promovido_a_agents: no
arreglo: en el SQL de init del rol de GoTrue, además de `create schema auth` añade `alter role supabase_auth_admin set search_path = auth;` (docker/auth-roles.sql) — y si el volumen ya existe con el SQL viejo, ejecútalo a mano una vez o recrea el volumen
---

## Qué pasa de verdad

Las 70 migraciones de GoTrue corren limpias (`GoTrue migrations applied
successfully`, se ve en el log) y crean sus tablas dentro del esquema `auth`
— `GOTRUE_DB_NAMESPACE=auth` sí controla ESO. Pero las queries que GoTrue
ejecuta en tiempo de ejecución NO van cualificadas por esquema (`select …
from users`, nunca `auth.users`): dependen de que el `search_path` de la
CONEXIÓN ya apunte a `auth`. Sin eso, `search_path` vale su valor por
omisión de Postgres (`"$user", public`), la tabla `users` no existe ahí, y
toda ruta que toque la base (prácticamente todas) responde 500 aunque
`/auth/v1/health` siga en 200 y las migraciones hayan aplicado perfecto —
así que el fallo no aparece hasta la PRIMERA petición real, no al arrancar.

## Cómo se arregla

En el SQL que corre por `docker-entrypoint-initdb.d` contra la base de
GoTrue (`docker/auth-roles.sql`), junto al `create role` y al
`create schema auth`:

```sql
alter role supabase_auth_admin set search_path = auth;
```

Es exactamente lo que el `docker-compose.yml` oficial de Supabase
self-hosted hace para este mismo rol. Si el volumen de la base YA se creó
sin esta línea (el init script solo corre una vez, contra un volumen
vacío), hay que aplicarlo a mano una vez (`psql … -c "alter role
supabase_auth_admin set search_path = auth;"`) o recrear el volumen desde
cero — lo primero no pierde nada si aún no hay usuarios reales.

## Cuándo NO es esto

Si el error menciona una tabla que SÍ existe en `auth` pero con otro
`SQLSTATE`, o si `/auth/v1/health` tampoco responde (en ese caso el
contenedor ni siquiera arrancó bien — ver el criterio 1, no este), no es
esto. Este síntoma es específico de "las migraciones ya corrieron bien,
pero cualquier request que hable con la base falla".

## Cómo se evita

`GOTRUE_DB_NAMESPACE` solo decide dónde ATERRIZAN las migraciones (les pasa
el esquema como opción de plantilla); no toca el `search_path` de las
conexiones normales de la app. Cualquier Postgres nuevo que reciba un rol
"tipo Supabase" con un esquema no-`public` necesita el `alter role … set
search_path` explícito, exactamente como ya lo tiene el compose oficial —
copiar el patrón de `docker/storage-roles.sql` (que no lo necesita, porque
`storage-api` sí cualifica sus queries por esquema) hace creer que basta con
crear el esquema y el rol, y no basta.
