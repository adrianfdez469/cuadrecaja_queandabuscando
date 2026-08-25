import { prisma } from "@/lib/prisma";
import { uniqueSlug } from "@/lib/slug";
import type { StorePayload } from "../../schemas";
import { SKIPPED, type HandlerOutcome } from "./types";

/**
 * A Store row existing IS the business's opt-in for that location. When the POS
 * turns publication off we suspend rather than delete, because orders and
 * products reference the store and a business that re-publishes expects its
 * slug and branding back.
 */
export async function handleStore(
  payload: StorePayload,
  operation: "CREATE" | "UPDATE" | "DELETE",
): Promise<HandlerOutcome> {
  const business = await prisma.business.upsert({
    where: { externalId: payload.businessId },
    create: {
      externalId: payload.businessId,
      name: payload.businessName,
      slug: await uniqueSlug(payload.businessName, businessSlugTaken, {
        fallback: "negocio",
      }),
      baseCurrencyCode: payload.baseCurrency,
    },
    update: { name: payload.businessName, baseCurrencyCode: payload.baseCurrency },
    select: { id: true },
  });

  const existing = await prisma.store.findUnique({
    where: { externalId: payload.storeId },
    select: { id: true, slug: true, updatedAt: true },
  });

  if (operation === "DELETE" || !payload.publishToStore) {
    if (!existing) return SKIPPED;
    await prisma.store.update({
      where: { id: existing.id },
      data: { status: "SUSPENDED", publishedAt: null },
    });
    return { status: "processed", touchedStoreSlug: existing.slug };
  }

  const common = {
    name: payload.name,
    description: payload.description ?? null,
    address: payload.address ?? null,
    city: payload.city ?? null,
    province: payload.province ?? null,
    latitude: payload.latitude ?? null,
    longitude: payload.longitude ?? null,
    phone: payload.phone ?? null,
    whatsapp: payload.whatsapp ?? null,
    email: payload.email ?? null,
    // Prisma rejects a plain `null` for a nullable Json column, so the key is
    // omitted entirely when there are no hours rather than reaching for DbNull.
    ...(payload.openingHours == null ? {} : { openingHours: payload.openingHours as object }),
  };

  if (!existing) {
    const slug = await uniqueSlug(payload.slug || payload.name, storeSlugTaken, {
      fallback: "tienda",
    });
    const created = await prisma.store.create({
      data: {
        businessId: business.id,
        externalId: payload.storeId,
        slug,
        status: "PUBLISHED",
        publishedAt: new Date(),
        ...common,
      },
      select: { slug: true },
    });
    return { status: "processed", touchedStoreSlug: created.slug };
  }

  const updated = await prisma.store.update({
    where: { id: existing.id },
    data: {
      ...common,
      // Re-publishing a suspended store restores it; the slug is preserved.
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
    select: { slug: true },
  });
  return { status: "processed", touchedStoreSlug: updated.slug };
}

async function businessSlugTaken(candidate: string): Promise<boolean> {
  return (await prisma.business.count({ where: { slug: candidate } })) > 0;
}

async function storeSlugTaken(candidate: string): Promise<boolean> {
  return (await prisma.store.count({ where: { slug: candidate } })) > 0;
}
