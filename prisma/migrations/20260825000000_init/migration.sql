-- queandabuscando — initial schema.
--
-- Extensions are created here rather than through Prisma's `postgresqlExtensions`
-- preview feature, which is deprecated.
--
--   unaccent  — accent-insensitive search, same as cuadrecaja uses
--   pg_trgm   — fuzzy matching on product names
--
-- postgis is deliberately absent: proximity search for the marketplace is not
-- built yet, and requiring it would mean every local database needs a
-- postgis-enabled image. Store.latitude/longitude capture the data meanwhile.

CREATE EXTENSION IF NOT EXISTS "unaccent";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('OUT_OF_STOCK', 'LOW_STOCK', 'AVAILABLE');

-- CreateEnum
CREATE TYPE "CheckoutMode" AS ENUM ('WHATSAPP', 'ONSITE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PULLED', 'CONFIRMED', 'READY', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "PromotionScope" AS ENUM ('PRODUCT', 'CATEGORY', 'ORDER');

-- CreateEnum
CREATE TYPE "SyncEntity" AS ENUM ('STORE', 'CATEGORY', 'PRODUCT', 'CURRENCY', 'EXCHANGE_RATE');

-- CreateEnum
CREATE TYPE "SyncOperation" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "SyncEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "baseCurrencyCode" TEXT NOT NULL DEFAULT 'CUP',
    "syncTokenHash" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "StoreStatus" NOT NULL DEFAULT 'DRAFT',
    "logoUrl" TEXT,
    "coverUrl" TEXT,
    "themeTokens" JSONB,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "province" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "openingHours" JSONB,
    "checkoutMode" "CheckoutMode" NOT NULL DEFAULT 'WHATSAPP',
    "deliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "deliveryFee" DECIMAL(14,2),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,

    CONSTRAINT "GlobalCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalCategory" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "color" TEXT,
    "globalCategoryId" TEXT,

    CONSTRAINT "LocalCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalProduct" (
    "id" TEXT NOT NULL,
    "ean" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "globalCategoryId" TEXT,
    "isExclusive" BOOLEAN NOT NULL DEFAULT false,
    "searchDocument" TEXT NOT NULL DEFAULT '',
    "searchVector" tsvector,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAlias" (
    "id" TEXT NOT NULL,
    "canonicalProductId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "useCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreProduct" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "canonicalProductId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "localName" TEXT NOT NULL,
    "syncedPrice" DECIMAL(14,2) NOT NULL,
    "syncedPriceCurrency" TEXT NOT NULL,
    "availability" "Availability" NOT NULL DEFAULT 'AVAILABLE',
    "localCategoryId" TEXT,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "description" TEXT,
    "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priceOverride" DECIMAL(14,2),
    "priceOverrideCurrency" TEXT,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Currency" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "type" "PromotionType" NOT NULL,
    "scope" "PromotionScope" NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "conditions" JSONB,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "supabaseUserId" TEXT,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "notes" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" BIGSERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "customerId" TEXT,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactEmail" TEXT,
    "deliveryAddress" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "cancelReason" TEXT,
    "currencyCode" TEXT NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deliveryFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "rateSnapshot" JSONB NOT NULL,
    "notes" TEXT,
    "pulledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" BIGINT NOT NULL,
    "storeProductId" TEXT,
    "name" TEXT NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "businessId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminStoreAccess" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "AdminStoreAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SsoTokenUse" (
    "jti" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SsoTokenUse_pkey" PRIMARY KEY ("jti")
);

-- CreateTable
CREATE TABLE "SyncEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "entity" "SyncEntity" NOT NULL,
    "operation" "SyncOperation" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "SyncEventStatus" NOT NULL DEFAULT 'PENDING',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "SyncEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Business_externalId_key" ON "Business"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");

-- CreateIndex
CREATE INDEX "Business_active_idx" ON "Business"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Store_externalId_key" ON "Store"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Store_slug_key" ON "Store"("slug");

-- CreateIndex
CREATE INDEX "Store_businessId_idx" ON "Store"("businessId");

-- CreateIndex
CREATE INDEX "Store_status_idx" ON "Store"("status");

-- CreateIndex
CREATE UNIQUE INDEX "GlobalCategory_slug_key" ON "GlobalCategory"("slug");

-- CreateIndex
CREATE INDEX "GlobalCategory_parentId_idx" ON "GlobalCategory"("parentId");

-- CreateIndex
CREATE INDEX "LocalCategory_globalCategoryId_idx" ON "LocalCategory"("globalCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "LocalCategory_businessId_externalId_key" ON "LocalCategory"("businessId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalProduct_ean_key" ON "CanonicalProduct"("ean");

-- CreateIndex
CREATE INDEX "CanonicalProduct_globalCategoryId_idx" ON "CanonicalProduct"("globalCategoryId");

-- CreateIndex
CREATE INDEX "CanonicalProduct_isExclusive_idx" ON "CanonicalProduct"("isExclusive");

-- CreateIndex
CREATE INDEX "ProductAlias_businessId_idx" ON "ProductAlias"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAlias_canonicalProductId_text_businessId_key" ON "ProductAlias"("canonicalProductId", "text", "businessId");

-- CreateIndex
CREATE INDEX "StoreProduct_storeId_deletedAt_visible_idx" ON "StoreProduct"("storeId", "deletedAt", "visible");

-- CreateIndex
CREATE INDEX "StoreProduct_canonicalProductId_idx" ON "StoreProduct"("canonicalProductId");

-- CreateIndex
CREATE INDEX "StoreProduct_localCategoryId_idx" ON "StoreProduct"("localCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreProduct_storeId_canonicalProductId_key" ON "StoreProduct"("storeId", "canonicalProductId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreProduct_storeId_externalId_key" ON "StoreProduct"("storeId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreProduct_storeId_slug_key" ON "StoreProduct"("storeId", "slug");

-- CreateIndex
CREATE INDEX "ExchangeRate_businessId_currencyCode_createdAt_idx" ON "ExchangeRate"("businessId", "currencyCode", "createdAt");

-- CreateIndex
CREATE INDEX "Promotion_storeId_active_idx" ON "Promotion"("storeId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_supabaseUserId_key" ON "Customer"("supabaseUserId");

-- CreateIndex
CREATE INDEX "CustomerAddress_customerId_idx" ON "CustomerAddress"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_code_key" ON "Order"("code");

-- CreateIndex
CREATE INDEX "Order_storeId_createdAt_idx" ON "Order"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_id_idx" ON "Order"("status", "id");

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_storeProductId_idx" ON "OrderItem"("storeProductId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_externalId_key" ON "AdminUser"("externalId");

-- CreateIndex
CREATE INDEX "AdminUser_businessId_idx" ON "AdminUser"("businessId");

-- CreateIndex
CREATE INDEX "AdminStoreAccess_storeId_idx" ON "AdminStoreAccess"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminStoreAccess_adminUserId_storeId_key" ON "AdminStoreAccess"("adminUserId", "storeId");

-- CreateIndex
CREATE INDEX "SsoTokenUse_expiresAt_idx" ON "SsoTokenUse"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncEvent_eventId_key" ON "SyncEvent"("eventId");

-- CreateIndex
CREATE INDEX "SyncEvent_status_receivedAt_idx" ON "SyncEvent"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "SyncEvent_businessId_idx" ON "SyncEvent"("businessId");

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlobalCategory" ADD CONSTRAINT "GlobalCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "GlobalCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalCategory" ADD CONSTRAINT "LocalCategory_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalCategory" ADD CONSTRAINT "LocalCategory_globalCategoryId_fkey" FOREIGN KEY ("globalCategoryId") REFERENCES "GlobalCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalProduct" ADD CONSTRAINT "CanonicalProduct_globalCategoryId_fkey" FOREIGN KEY ("globalCategoryId") REFERENCES "GlobalCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAlias" ADD CONSTRAINT "ProductAlias_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAlias" ADD CONSTRAINT "ProductAlias_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreProduct" ADD CONSTRAINT "StoreProduct_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreProduct" ADD CONSTRAINT "StoreProduct_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreProduct" ADD CONSTRAINT "StoreProduct_localCategoryId_fkey" FOREIGN KEY ("localCategoryId") REFERENCES "LocalCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_storeProductId_fkey" FOREIGN KEY ("storeProductId") REFERENCES "StoreProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminStoreAccess" ADD CONSTRAINT "AdminStoreAccess_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminStoreAccess" ADD CONSTRAINT "AdminStoreAccess_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Indexes Prisma cannot express (Unsupported columns and partial indexes)
-- ---------------------------------------------------------------------------

-- Full-text search over the canonical product's search document.
CREATE INDEX "CanonicalProduct_searchVector_idx"
  ON "CanonicalProduct" USING GIN ("searchVector");

-- Fuzzy matching for typo-tolerant search.
CREATE INDEX "CanonicalProduct_name_trgm_idx"
  ON "CanonicalProduct" USING GIN ("name" gin_trgm_ops);

-- The catalog listing hits this constantly: published, visible, not deleted.
CREATE INDEX "StoreProduct_visible_catalog_idx"
  ON "StoreProduct" ("storeId", "featured" DESC, "localName")
  WHERE "deletedAt" IS NULL AND "visible" = true;
