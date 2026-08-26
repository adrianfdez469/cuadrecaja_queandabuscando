-- Roles `supabase/storage-api` expects to exist, Supabase-style.
--
-- Only runs against `storage-db`'s OWN, fresh volume: `docker-entrypoint-initdb.d`
-- scripts run once, the first time a container starts with an EMPTY data
-- directory. The app's `postgres` service already has data in
-- `queandabuscando-pgdata`, so this could never run there — which is exactly
-- why `storage-db` is its own container with its own volume
-- (architecture.md § Emulador de Storage, decisión 2).
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role supabase_storage_admin login password 'postgres' superuser;

grant anon, authenticated, service_role to postgres;
grant anon, authenticated, service_role to supabase_storage_admin;

-- What is NOT here on purpose: `grant usage on schema storage`. This script
-- runs once, against an EMPTY volume, before `storage-api` even starts — the
-- `storage` schema does not exist yet (it is created by storage-api's own
-- migrations), so that grant would fail with "schema storage does not
-- exist" and abort the rest of this file. It runs instead in
-- `storage-bucket-init`, after `storage` is healthy (docker-compose.yml).
