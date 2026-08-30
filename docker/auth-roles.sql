-- Role and schema `supabase/auth` (GoTrue) expects to exist.
--
-- Only runs against `auth-db`'s OWN, fresh volume: `docker-entrypoint-initdb.d`
-- scripts run once, the first time a container starts with an EMPTY data
-- directory. The app's `postgres` service already has data in
-- `queandabuscando-pgdata`, so this could never run there — which is exactly
-- why `auth-db` is its own container with its own volume, the same reasoning
-- `docker/storage-roles.sql` already documents for Storage
-- (architecture.md § docker/auth-roles.sql).
create role supabase_auth_admin login password 'postgres' superuser;
create schema if not exists auth authorization supabase_auth_admin;

-- GoTrue's queries are NOT schema-qualified (`select … from users`, not
-- `auth.users`): it relies on the CONNECTION's search_path already pointing
-- at `auth`. Without this, every request past migrations answers 500
-- "relation \"users\" does not exist" — found running the emulator end to
-- end, not by reading `GOTRUE_DB_NAMESPACE`'s doc comment, which only
-- controls where MIGRATIONS themselves land. This is the same fix the
-- official Supabase self-hosting init SQL applies to this same role.
alter role supabase_auth_admin set search_path = auth;

-- What is NOT here, on purpose, unlike its Storage twin: `anon`,
-- `authenticated` and `service_role`. No migration of GoTrue v2.196.0 grants
-- them anything — those roles only matter to PostgREST and to Storage — so
-- creating them here would just be noise.
--
-- What IS here, unlike its Storage twin: `create schema auth`. `storage-api`
-- creates its own `storage` schema in its own migrations; GoTrue does not —
-- `cmd/migrate_cmd.go` passes the namespace as a template option and assumes
-- the schema already exists. Without this line the first boot dies with
-- "schema auth does not exist" (architecture.md § docker/auth-roles.sql,
-- hallazgo 4).
--
-- `supabase_auth_admin` is `superuser` for the same reason
-- `supabase_storage_admin` is: migration `20240612123726_enable_rls_update_grants`
-- runs `alter table … enable row level security` and
-- `grant select … to postgres with grant option` on tables it has to own.
-- A development-only database, no port published on the host.
