-- HD10-HD15: the store's public on/off switch.
--
-- Generated with `prisma migrate diff --from-config-datasource --to-schema
-- prisma/schema.prisma --script` rather than `prisma migrate dev`, because
-- an earlier migration's checksum had already drifted from what is recorded
-- in `_prisma_migrations` in this shared dev database (unrelated to this
-- feature) and `migrate dev` refuses to proceed without `migrate reset` —
-- forbidden by AGENTS.md. `migrate deploy` does not re-validate old
-- checksums, so this migration is applied with `npx prisma migrate deploy`.
--
-- Two DROP INDEX statements were in the raw diff and are DELETED here on
-- purpose (ficha prisma-migrate-dev-borra-indices-gin-no-declarados):
-- CanonicalProduct_name_trgm_idx and CanonicalProduct_searchVector_idx are
-- real GIN indexes Prisma does not declare in schema.prisma, and dropping
-- them would silently remove F-015's search.

-- 1. Columns of the switch. Nullable, no DEFAULT: Postgres >= 11 does not
--    rewrite the table for a nullable column with no default.
ALTER TABLE "Store" ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "disabledMessage" TEXT,
ADD COLUMN     "disabledReasonCode" TEXT,
ADD COLUMN     "sourceOptIn" BOOLEAN,
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- 2. HD12 -- retroactive to every store already readable in public. Only the
--    PUBLISHED ones: a store already SUSPENDED keeps whatever it had (NULL).
UPDATE "Store"
   SET "status"             = 'SUSPENDED',
       "disabledReasonCode" = 'PLATFORM_ROLLOUT',
       "disabledAt"         = now()
 WHERE "status" = 'PUBLISHED';
