-- F-017: Storefront (the brand) above Store (the branch), and the Slug
-- registry that makes a value unique across both tables plus the reserved
-- words, enforced by Postgres rather than by a SELECT in application code.
--
-- Generated with `prisma migrate diff --from-config-datasource --to-schema
-- prisma/schema.prisma --script` and then rewritten by hand for THREE
-- reasons the raw diff cannot know about (ficha
-- prisma-migrate-dev-checksum-drift-bd-compartida is why this is
-- `migrate diff` + a hand-written folder + `migrate deploy`, never
-- `migrate dev`):
--
--   1. Two DROP INDEX statements were in the raw diff and are DELETED here
--      on purpose (ficha prisma-migrate-dev-borra-indices-gin-no-declarados):
--      CanonicalProduct_name_trgm_idx and CanonicalProduct_searchVector_idx
--      are real GIN indexes Prisma does not declare in schema.prisma.
--   2. The raw diff adds Store.storefrontId as NOT NULL in one step, which
--      fails against the three existing rows. It has to arrive nullable,
--      get backfilled, and only THEN turn NOT NULL (steps 2 and 8 below).
--   3. The CHECK constraint that keeps Slug.kind honest has no Prisma
--      syntax (`@@check` does not exist) and has to be written here (1b).
--
-- Order matters — architecture.md § Migración § El archivo, en orden. Three
-- steps abort the whole (transactional) migration if taken out of order:
-- reserved words BEFORE any brand exists (3), so a live store with a
-- reserved slug aborts loudly instead of creating an unreachable brand; the
-- NOT NULL on Store.slug is dropped BEFORE it is set to NULL (7); and
-- Store.storefrontId only becomes NOT NULL AFTER every row has one (8).

-- 1. Tables and enum, straight from the diff.
CREATE TYPE "SlugKind" AS ENUM ('STOREFRONT', 'STORE', 'RESERVED');

CREATE TABLE "Storefront" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "themeTokens" JSONB,
    "logoUrl" TEXT,
    "coverUrl" TEXT,
    "contactPhone" TEXT,
    "contactWhatsapp" TEXT,
    "contactEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Storefront_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Slug" (
    "value" TEXT NOT NULL,
    "kind" "SlugKind" NOT NULL,
    "storefrontId" TEXT,
    "storeId" TEXT,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Slug_pkey" PRIMARY KEY ("value")
);

CREATE UNIQUE INDEX "Storefront_slug_key" ON "Storefront"("slug");
CREATE INDEX "Storefront_businessId_idx" ON "Storefront"("businessId");
CREATE UNIQUE INDEX "Slug_storefrontId_key" ON "Slug"("storefrontId");
CREATE UNIQUE INDEX "Slug_storeId_key" ON "Slug"("storeId");

ALTER TABLE "Storefront" ADD CONSTRAINT "Storefront_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Slug" ADD CONSTRAINT "Slug_storefrontId_fkey"
  FOREIGN KEY ("storefrontId") REFERENCES "Storefront"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Slug" ADD CONSTRAINT "Slug_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 1b. The restriction Prisma cannot declare (criterio 4, R9). Permits
-- `kind = 'STOREFRONT'` with `storefrontId IS NULL` on purpose: that IS the
-- retired state (R13) that ON DELETE SET NULL produces, and it is what lets
-- a duplicate INSERT reach the primary key instead of being rejected earlier
-- by a stricter CHECK with a less honest error message.
ALTER TABLE "Slug" ADD CONSTRAINT "Slug_owner_matches_kind" CHECK (
     ("kind" = 'RESERVED'   AND "storefrontId" IS NULL AND "storeId" IS NULL)
  OR ("kind" = 'STOREFRONT' AND "storeId" IS NULL)
  OR ("kind" = 'STORE'      AND "storefrontId" IS NULL)
);

-- 2. Store gains the pointer, NULLABLE for now, and its index.
ALTER TABLE "Store" ADD COLUMN "storefrontId" TEXT;
CREATE INDEX "Store_storefrontId_idx" ON "Store"("storefrontId");

-- 3. Reserved words FIRST, while the registry is still empty: nothing can
-- collide with them yet, and if a live store somehow had one of these as its
-- slug, step 6 aborts the whole migration instead of silently creating an
-- unreachable brand.
INSERT INTO "Slug" ("value", "kind") VALUES
  ('admin', 'RESERVED'),
  ('api', 'RESERVED'),
  ('app', 'RESERVED'),
  ('auth', 'RESERVED'),
  ('buscar', 'RESERVED'),
  ('carrito', 'RESERVED'),
  ('checkout', 'RESERVED'),
  ('cuenta', 'RESERVED'),
  ('login', 'RESERVED'),
  ('logout', 'RESERVED'),
  ('pedido', 'RESERVED'),
  ('public', 'RESERVED'),
  ('static', 'RESERVED'),
  ('_next', 'RESERVED'),
  ('sesion-cerrada', 'RESERVED'),
  ('sucursales', 'RESERVED');

-- 4. One brand per existing Store, carrying over its name and branding.
INSERT INTO "Storefront" ("id", "businessId", "name", "slug", "themeTokens", "logoUrl", "coverUrl", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s."businessId", s."name", s."slug",
       s."themeTokens", s."logoUrl", s."coverUrl", now(), now()
FROM "Store" s;

-- 5. Link. The slug is unique across BOTH tables at this exact instant
-- (Store.slug still has its old unique constraint, Storefront.slug is
-- fresh), so joining by slug is exact — no temporary column needed.
UPDATE "Store" s SET "storefrontId" = sf."id"
FROM "Storefront" sf
WHERE sf."slug" = s."slug";

-- 6. Register every brand's slug. Aborts the whole migration (Prisma wraps
-- every migration file in one transaction) if a slug collides with a
-- reserved word from step 3 — the vuelo previo before this migration ran
-- already proved that is not the case today.
INSERT INTO "Slug" ("value", "kind", "storefrontId")
SELECT sf."slug", 'STOREFRONT', sf."id" FROM "Storefront" sf;

-- 7. Move the slug from the branch to the brand. The NOT NULL has to go
-- BEFORE the UPDATE, or the UPDATE itself fails.
ALTER TABLE "Store" ALTER COLUMN "slug" DROP NOT NULL;
-- The exact same string is now the BRAND's slug: the URL that was already
-- printed on a QR keeps answering 200 with no redirect (HS4), and the
-- namespace ends up with one row per branch instead of two.
UPDATE "Store" SET "slug" = NULL;

-- 8. Close the model. The three DROP COLUMN statements are the only
-- irreversible step of this migration (see plan.md § Riesgos — a volcado
-- was taken before this ran).
ALTER TABLE "Store" ALTER COLUMN "storefrontId" SET NOT NULL;
ALTER TABLE "Store" DROP COLUMN "themeTokens";
ALTER TABLE "Store" DROP COLUMN "logoUrl";
ALTER TABLE "Store" DROP COLUMN "coverUrl";
ALTER TABLE "Store" ADD CONSTRAINT "Store_storefrontId_fkey"
  FOREIGN KEY ("storefrontId") REFERENCES "Storefront"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Business" ALTER COLUMN "slug" DROP NOT NULL;
