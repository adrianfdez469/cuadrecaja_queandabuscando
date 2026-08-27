import { prisma } from "@/lib/prisma";
import { uniqueSlug } from "@/lib/slug";
import type { StorePayload } from "../../schemas";
import { SKIPPED, STALE, type HandlerOutcome } from "./types";

/**
 * A Store row existing IS the business's opt-in for that location. When the POS
 * turns publication off we suspend rather than delete, because orders and
 * products reference the store and a business that re-publishes expects its
 * slug and branding back.
 *
 * HD10-HD15 add a second writer of `status`: the admin panel's público
 * switch (`features/admin/server/mutations.ts::setStoreEnabled`). Three
 * rules keep the two from fighting:
 *
 *   1. Stale-write guard (AP6): `sourceUpdatedAt` mirrors the one
 *      `handleProduct` already has, so a re-delivered STORE event older than
 *      what is stored is `STALE` and never applied — it cannot resurrect a
 *      store the admin just closed by racing an old payload.
 *   2. Opt-in-only writes (AP5, option b): `status`/`publishedAt`/
 *      `disabled*` are only touched when `payload.publishToStore` actually
 *      DIFFERS from the store's own `sourceOptIn`. Editing a phone number in
 *      the POS sends a STORE event too, but with the same `publishToStore`
 *      as before — without this gate, that routine edit would silently
 *      reopen a store closed from the panel for vacation.
 *   3. A real opt-in flip always wins, in either direction: that is HD13
 *      ("gana el último... de verdad") applied on purpose, not a bug.
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
    select: { id: true, slug: true, sourceUpdatedAt: true, sourceOptIn: true },
  });

  const payloadUpdatedAt = new Date(payload.updatedAt);

  if (
    existing?.sourceUpdatedAt &&
    existing.sourceUpdatedAt.getTime() >= payloadUpdatedAt.getTime()
  ) {
    return STALE;
  }

  // DELETE has no meaningful `publishToStore` of its own: treat it exactly
  // like an explicit unpublish.
  const optIn = operation !== "DELETE" && payload.publishToStore;

  if (!optIn) {
    if (!existing) return SKIPPED;
    const optInChanged = existing.sourceOptIn !== false;
    await prisma.store.update({
      where: { id: existing.id },
      data: {
        sourceOptIn: false,
        sourceUpdatedAt: payloadUpdatedAt,
        ...(optInChanged
          ? {
              status: "SUSPENDED",
              publishedAt: null,
              // The POS does not speak our reason vocabulary (HD14's fixed
              // list is a panel-only concept) — only the free-text v3 field
              // travels, when it is sent at all.
              disabledReasonCode: null,
              disabledMessage: payload.unpublishReason ?? null,
              disabledAt: new Date(),
            }
          : {}),
      },
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
        sourceOptIn: true,
        sourceUpdatedAt: payloadUpdatedAt,
        ...common,
      },
      select: { slug: true },
    });
    return { status: "processed", touchedStoreSlug: created.slug };
  }

  const optInChanged = existing.sourceOptIn !== true;
  const updated = await prisma.store.update({
    where: { id: existing.id },
    data: {
      ...common,
      sourceOptIn: true,
      sourceUpdatedAt: payloadUpdatedAt,
      ...(optInChanged
        ? {
            // Re-publishing a suspended store restores it; the slug is
            // preserved. A store that reopened for vacation does not carry
            // vacation's reason forward.
            status: "PUBLISHED",
            publishedAt: new Date(),
            disabledReasonCode: null,
            disabledMessage: null,
            disabledAt: null,
          }
        : {}),
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
