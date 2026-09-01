-- F-020 architecture.md DA4 — the ONLY RLS policy in this repository, and it
-- lives on a table that is not ours: `realtime.messages`. Applied by
-- `realtime-init` in local (docker-compose.yml, after `to_regclass
-- ('realtime.messages')` stops being NULL — that table is created by
-- Realtime's own migrations, not by us) and pasted once into the SQL editor
-- of the hosted Supabase project (docs/despliegue.md).
--
-- `drop policy if exists` before `create policy`: idempotent, so a second
-- `docker compose up -d` in local applies the SAME file and stays at exit 0
-- (criterio 12).
drop policy if exists "negocio_lee_solo_su_canal" on realtime.messages;

-- R5: a business can only subscribe to its own channel. Fail-closed by
-- construction (E4): without a `business_id` claim, `current_setting(...)`
-- is NULL, the concatenation is NULL, the predicate is not TRUE, no policy
-- applies, and the subscription is denied — nobody needs to remember to add
-- a negative test for "no credential" because there is no code path that
-- grants access without one.
--
-- No INSERT policy, deliberately (R11): a subscriber can hear its channel
-- and can never publish on it. The emitter does not need one — it presents
-- `service_role`, which has `bypassrls` (docker/realtime-roles.sql).
create policy "negocio_lee_solo_su_canal"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (select realtime.topic()) =
      'negocio:' || ((current_setting('request.jwt.claims', true))::json ->> 'business_id')
);
