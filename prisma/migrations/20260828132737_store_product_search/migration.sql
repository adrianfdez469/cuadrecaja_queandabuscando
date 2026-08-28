-- HAND-EDITED, not the raw output of `prisma migrate dev`. The generated
-- diff proposed DROPping "CanonicalProduct_name_trgm_idx" and
-- "CanonicalProduct_searchVector_idx" — two GIN indexes created by hand in
-- prisma/migrations/20260825000000_init/migration.sql on an
-- `Unsupported("tsvector")` column, so `schema.prisma` cannot declare them
-- and every unrelated `prisma migrate dev` diff proposes dropping them
-- (.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md).
-- Those two `DROP INDEX` statements were removed by hand before this file
-- was ever applied — F-015's marketplace search would otherwise lose its
-- index silently, only to be found the day the table grew (F-021
-- architecture.md § "El procedimiento, que es donde muerde I8").
--
-- Same style as prisma/migrations/20260828045433_canonical_barcode/migration.sql.

-- AlterTable
ALTER TABLE "StoreProduct" ADD COLUMN     "searchDocument" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "searchVector" tsvector;

-- CreateTable
CREATE TABLE "StoreSearchQuery" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "resultCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreSearchQuery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoreSearchQuery_storeId_createdAt_idx" ON "StoreSearchQuery"("storeId", "createdAt");

-- AddForeignKey
ALTER TABLE "StoreSearchQuery" ADD CONSTRAINT "StoreSearchQuery_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- HAND-WRITTEN, same reason `Unsupported("tsvector")` gave the two indexes
-- above: `schema.prisma` cannot declare a GIN index. Without these two,
-- criterion 8's EXPLAIN would find a Seq Scan on "StoreProduct" no matter
-- what the query does (architecture.md § SQL — Q1, § "El procedimiento").
CREATE INDEX "StoreProduct_searchVector_idx"
  ON "StoreProduct" USING GIN ("searchVector");
CREATE INDEX "StoreProduct_searchDocument_trgm_idx"
  ON "StoreProduct" USING GIN ("searchDocument" gin_trgm_ops);

-- HAND-WRITTEN one-time backfill (architecture.md § "La migración, y cómo
-- esquiva I8", point 4): W3 (src/features/catalog/server/searchIndex.ts)
-- WITHOUT a row selector and WITHOUT the idempotency WHERE — this runs once,
-- over whatever the table holds at the moment this migration applies.
-- 'spanish' and ' · ' are literals, not imports: a .sql file cannot import
-- SEARCH_TS_CONFIG/SEARCH_DOCUMENT_SEPARATOR (src/constants/search.ts). The
-- guard at src/features/marketplace/server/boundaries.test.ts (G7) compares
-- these literals against the constants' own values so the two cannot drift
-- apart silently. Without this, every StoreProduct that existed before this
-- migration would be invisible to search until something else touched it.
UPDATE "StoreProduct" sp
   SET "searchDocument" = d."doc",
       "searchVector"   = setweight(to_tsvector('spanish', unaccent(d."namePart")),  'A')
                       || setweight(to_tsvector('spanish', unaccent(d."aliasPart")), 'B')
                       || setweight(to_tsvector('spanish', unaccent(d."descPart")),  'C')
  FROM (
        SELECT x."id",
               x."localName"                  AS "namePart",
               coalesce(a."texts", '')        AS "aliasPart",
               coalesce(x."description", '')  AS "descPart",
               unaccent(concat_ws(' · ',
                          x."localName",
                          coalesce(a."texts", ''),
                          coalesce(x."description", ''))) AS "doc"
          FROM "StoreProduct" x
          JOIN "Store" s ON s."id" = x."storeId"
          LEFT JOIN LATERAL (
                 SELECT string_agg(DISTINCT al."text", ' · ' ORDER BY al."text") AS "texts"
                   FROM "ProductAlias" al
                  WHERE al."canonicalProductId" = x."canonicalProductId"
                    AND al."businessId"         = s."businessId"
               ) a ON TRUE
       ) d
 WHERE sp."id" = d."id";
