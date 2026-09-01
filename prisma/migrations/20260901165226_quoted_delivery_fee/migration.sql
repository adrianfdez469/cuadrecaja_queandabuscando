-- CreateEnum
CREATE TYPE "DeliveryFeeMode" AS ENUM ('FLAT_RATE', 'QUOTED_PER_ORDER');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "deliveryFeeMode" "DeliveryFeeMode" NOT NULL DEFAULT 'FLAT_RATE';

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "deliveryFee" DROP NOT NULL;
