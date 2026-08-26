-- Aditiva: tres columnas nullables sin DEFAULT y un índice único. No reescribe
-- ninguna fila existente.
--
-- Nota: `prisma migrate dev` propuso también DROP INDEX de
-- "CanonicalProduct_searchVector_idx" y "CanonicalProduct_name_trgm_idx" —
-- son índices GIN creados a mano en la migración `20260825000000_init`
-- (sobre un campo `Unsupported("tsvector")` y con `gin_trgm_ops`, que Prisma
-- no puede representar declarativamente) y por eso el diff automático los ve
-- como "no declarados" y quiere borrarlos. Eso no tiene nada que ver con
-- F-010: se quitó del diff generado y los dos índices se restauraron a mano
-- en la base local antes de que esta migración se aplicara.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "originalCurrencyCode" TEXT,
ADD COLUMN     "originalUnitPrice" DECIMAL(14,2);

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");
