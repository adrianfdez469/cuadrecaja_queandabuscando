-- AlterEnum
ALTER TYPE "SyncEntity" ADD VALUE 'BUSINESS';

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "displayCurrencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "displayCurrenciesSourceUpdatedAt" TIMESTAMP(3);
