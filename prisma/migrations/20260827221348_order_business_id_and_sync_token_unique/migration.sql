-- F-018: Order.businessId denormalized + Business.syncTokenHash unique.
--
-- Hand-written (not the raw `prisma migrate diff` output): the base has real
-- orders, so "ADD COLUMN ... NOT NULL" fails outright. The column is added
-- nullable, backfilled from the owning Store, and only then tightened.
--
-- The two `DROP INDEX` on CanonicalProduct_name_trgm_idx /
-- CanonicalProduct_searchVector_idx that `prisma migrate diff` proposes here
-- are intentionally OMITTED: those GIN indexes are hand-created (F-015) and
-- not represented in schema.prisma. See
-- .agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md.

-- 1. Nullable first: the local database already has real orders.
ALTER TABLE "Order" ADD COLUMN "businessId" TEXT;

-- 2. Backfill from the store that already owns the order.
UPDATE "Order" o SET "businessId" = s."businessId" FROM "Store" s WHERE s.id = o."storeId";

-- 3. Only now tighten. If any row were left unmatched, this fails and the
--    whole migration rolls back (Postgres runs each migration in a
--    transaction) — no fallback business, no default, no row zero.
ALTER TABLE "Order" ALTER COLUMN "businessId" SET NOT NULL;

-- 4. The rest, exactly as Prisma generated it.
CREATE UNIQUE INDEX "Business_syncTokenHash_key" ON "Business"("syncTokenHash");

CREATE INDEX "Order_businessId_status_id_idx" ON "Order"("businessId", "status", "id");

ALTER TABLE "Order" ADD CONSTRAINT "Order_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
