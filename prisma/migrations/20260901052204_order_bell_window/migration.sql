-- CreateTable
CREATE TABLE "OrderBellWindow" (
    "businessId" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pendingSince" TIMESTAMP(3),

    CONSTRAINT "OrderBellWindow_pkey" PRIMARY KEY ("businessId")
);

-- AddForeignKey
ALTER TABLE "OrderBellWindow" ADD CONSTRAINT "OrderBellWindow_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
