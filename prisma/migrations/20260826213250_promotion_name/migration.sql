-- PP3: an optional, admin-only label on Promotion (design.md § 5/§ 6).
--
-- Generated with `prisma migrate diff` rather than `prisma migrate dev` —
-- same reason as the store-switch migration: this shared dev database has
-- an unrelated pre-existing checksum drift that makes `migrate dev` refuse
-- and offer `migrate reset` (forbidden by AGENTS.md). Applied with
-- `npx prisma migrate deploy`.
--
-- Two DROP INDEX statements were in the raw diff and are deleted here on
-- purpose (ficha prisma-migrate-dev-borra-indices-gin-no-declarados):
-- CanonicalProduct_name_trgm_idx and CanonicalProduct_searchVector_idx.

ALTER TABLE "Promotion" ADD COLUMN "name" TEXT;
