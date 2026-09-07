-- DropIndex
DROP INDEX "ExchangeRate_businessId_currencyCode_createdAt_idx";

-- AlterTable
ALTER TABLE "ExchangeRate" ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ExchangeRate_current_rate_idx" ON "ExchangeRate"("businessId", "currencyCode", "sourceUpdatedAt" DESC, "createdAt" DESC, "id" DESC, "rate");
