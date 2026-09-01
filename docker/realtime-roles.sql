-- Roles `supabase/realtime` expects to exist, Supabase-style.
--
-- Only runs against `realtime-db`'s OWN, fresh volume: `docker-entrypoint-initdb.d`
-- scripts run once, the first time a container starts with an EMPTY data
-- directory. The app's `postgres` service already has data in
-- `queandabuscando-pgdata`, so this could never run there — which is exactly
-- why `realtime-db` is its own container with its own volume, the same
-- reasoning `docker/storage-roles.sql` and `docker/auth-roles.sql` already
-- document (architecture.md DA4, "Realtime no ve la base de la app").
create role anon nologin noinherit;
create role authenticated nologin noinherit;
-- `bypassrls`: the emitter presents this role via the service key, and R11
-- ("the channel is not a delivery path") depends on there being NO insert
-- policy at all — the emitter does not need one because it bypasses RLS
-- entirely, the same pattern `docker/storage-roles.sql` already uses.
create role service_role nologin noinherit bypassrls;
create role supabase_admin login password 'postgres' superuser;

grant anon, authenticated, service_role to postgres;
grant anon, authenticated, service_role to supabase_admin;

-- `DB_AFTER_CONNECT_QUERY: "SET search_path TO _realtime"` (docker-compose.yml)
-- means Ecto's OWN migrations run against a schema that has to exist
-- already, or the very first migration (creating its own migration-tracking
-- table) fails with "no schema has been selected to create in" — found
-- running it, not documented anywhere. The official Supabase self-hosting
-- init SQL creates this same schema for the same reason.
create schema if not exists _realtime authorization supabase_admin;

-- The TENANT's own schema (SEED_SELF_HOST's "realtime-dev" tenant, whose
-- Postgres connection is this SAME database): Realtime's per-tenant
-- migrations create `realtime.messages` and friends INSIDE this schema, but
-- assume the schema itself already exists rather than creating it — without
-- this line boot fails with "schema \"realtime\" does not exist" while
-- "Applying migrations to realtime-db" (found running it). What is NOT
-- granted here: `usage` on it, or anything about `realtime.messages` itself
-- — that TABLE is what `realtime-init` (docker-compose.yml) waits for
-- (`to_regclass('realtime.messages')`) before applying the policy in
-- docker/realtime-policies.sql, same shape as `storage-bucket-init`.
create schema if not exists realtime authorization supabase_admin;
