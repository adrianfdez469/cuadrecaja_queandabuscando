import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * Hash the published catalogue of one store.
 *
 * The input is deliberately the source-side identity, price and availability —
 * exactly the fields the sync is responsible for. Admin-owned fields
 * (description, images, overrides) are excluded, because they legitimately
 * differ between the two systems and would make every store look divergent.
 */
export async function storeReconciliationHash(
  businessId: string,
  storeExternalId: string,
): Promise<{ products: number; hash: string } | null> {
  const store = await prisma.store.findFirst({
    where: { externalId: storeExternalId, businessId },
    select: { id: true },
  });
  if (!store) return null;

  const products = await prisma.storeProduct.findMany({
    where: { storeId: store.id, deletedAt: null },
    orderBy: { externalId: "asc" },
    select: {
      externalId: true,
      syncedPrice: true,
      syncedPriceCurrency: true,
      availability: true,
    },
  });

  const digest = createHash("md5");
  for (const product of products) {
    digest.update(
      `${product.externalId}:${product.syncedPrice.toString()}:${product.syncedPriceCurrency}:${product.availability}|`,
    );
  }

  return { products: products.length, hash: digest.digest("hex") };
}
