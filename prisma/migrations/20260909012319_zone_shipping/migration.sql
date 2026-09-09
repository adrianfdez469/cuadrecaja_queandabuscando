-- CreateEnum
CREATE TYPE "ZoneLevel" AS ENUM ('FIRST_LEVEL', 'MUNICIPALITY');

-- CreateEnum
CREATE TYPE "ZoneTariffRule" AS ENUM ('FEE', 'NOT_SERVED', 'INHERIT');

-- AlterEnum
ALTER TYPE "DeliveryFeeMode" ADD VALUE 'ZONE_BASED';

-- AlterEnum
ALTER TYPE "SyncEntity" ADD VALUE 'ZONE_TARIFF';

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "zoneCode" TEXT;

-- CreateTable
CREATE TABLE "Zone" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" "ZoneLevel" NOT NULL,
    "provinceCode" TEXT,
    "osmRelationId" TEXT NOT NULL,
    "osmName" TEXT NOT NULL,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ZoneCatalogVersion" (
    "version" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "zoneCount" INTEGER NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZoneCatalogVersion_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "ZoneTariff" (
    "storeId" TEXT NOT NULL,
    "zoneCode" TEXT NOT NULL,
    "rule" "ZoneTariffRule" NOT NULL,
    "deliveryFee" DECIMAL(14,2),
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZoneTariff_pkey" PRIMARY KEY ("storeId","zoneCode")
);

-- CreateIndex
CREATE INDEX "Zone_provinceCode_idx" ON "Zone"("provinceCode");

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_zoneCode_fkey" FOREIGN KEY ("zoneCode") REFERENCES "Zone"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_provinceCode_fkey" FOREIGN KEY ("provinceCode") REFERENCES "Zone"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneTariff" ADD CONSTRAINT "ZoneTariff_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneTariff" ADD CONSTRAINT "ZoneTariff_zoneCode_fkey" FOREIGN KEY ("zoneCode") REFERENCES "Zone"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
