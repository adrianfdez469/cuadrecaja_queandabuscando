-- F-024: CanonicalBarcode — every valid barcode of a canonical product.
--
-- Hand-written, NOT the raw `prisma migrate diff` output. Two `DROP INDEX` on
-- CanonicalProduct_searchVector_idx / CanonicalProduct_name_trgm_idx that the
-- diff proposes here are intentionally OMITTED: those GIN indexes are
-- hand-created (F-015) and not represented in schema.prisma. See
-- .agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md.

CREATE TABLE "CanonicalBarcode" (
    "id" TEXT NOT NULL,
    "canonicalProductId" TEXT NOT NULL,
    "ean" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CanonicalBarcode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CanonicalBarcode_ean_idx" ON "CanonicalBarcode"("ean");

CREATE UNIQUE INDEX "CanonicalBarcode_canonicalProductId_ean_key"
    ON "CanonicalBarcode"("canonicalProductId", "ean");

ALTER TABLE "CanonicalBarcode"
    ADD CONSTRAINT "CanonicalBarcode_canonicalProductId_fkey"
    FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill (R13). Idempotent by the unique index created above: applying this
-- against an already-migrated database inserts 0 rows, and so does a second
-- run. `id` has NO database default — Prisma generates uuids client-side — so
-- the INSERT must supply one; gen_random_uuid() is built in from Postgres 13.
INSERT INTO "CanonicalBarcode" ("id", "canonicalProductId", "ean")
SELECT gen_random_uuid()::text, cp."id", cp."ean"
  FROM "CanonicalProduct" cp
 WHERE cp."ean" IS NOT NULL
    ON CONFLICT ("canonicalProductId", "ean") DO NOTHING;
