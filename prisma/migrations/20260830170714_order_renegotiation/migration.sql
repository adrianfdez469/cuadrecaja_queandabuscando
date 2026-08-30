-- CreateEnum
CREATE TYPE "OrderCancelledBy" AS ENUM ('CUSTOMER', 'EXPIRY', 'STORE');

-- CreateEnum
CREATE TYPE "ProposalOutcome" AS ENUM ('APPROVED', 'REJECTED', 'EXPIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'AWAITING_CUSTOMER';
ALTER TYPE "OrderStatus" ADD VALUE 'IN_TRANSIT';
ALTER TYPE "OrderStatus" ADD VALUE 'REJECTED_BY_STORE';

-- NOTE (F-019, AGENTS.md § "Cosas que muerden"): `prisma migrate dev`
-- proposed DROP INDEX for four of the five GIN/partial search indexes that
-- are not represented in prisma/schema.prisma (raw SQL, not visible to
-- Prisma's diff). They have nothing to do with this migration and are
-- removed by hand; applying them would leave search doing sequential scans
-- in production. See ficha
-- prisma-migrate-dev-borra-indices-gin-no-declarados.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cancelledBy" "OrderCancelledBy",
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "previousTotal" DECIMAL(14,2),
ADD COLUMN     "proposalDecidedAt" TIMESTAMP(3),
ADD COLUMN     "proposalMessage" TEXT,
ADD COLUMN     "proposalOutcome" "ProposalOutcome",
ADD COLUMN     "proposedAt" TIMESTAMP(3),
ADD COLUMN     "proposedDeliveryFee" DECIMAL(14,2),
ADD COLUMN     "proposedDiscountTotal" DECIMAL(14,2),
ADD COLUMN     "proposedItems" JSONB,
ADD COLUMN     "proposedSubtotal" DECIMAL(14,2),
ADD COLUMN     "proposedTotal" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "orderExpiryHours" INTEGER NOT NULL DEFAULT 24;
