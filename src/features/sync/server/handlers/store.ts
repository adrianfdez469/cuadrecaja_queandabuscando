import { prisma } from "@/lib/prisma";
import { canonicalSlug } from "@/lib/publicSlug";
import { createStorefrontWithStore } from "@/features/storefront/server/registry";
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
 *
 * F-017 (E9, HS2): the FIRST time a `Store` publishes, this handler creates
 * its brand (`Storefront`) in the SAME event, through the registry — the
 * only writer of `Slug`/`Storefront`. `Business.slug` no longer exists to
 * write (I1): a business's name never resolves a URL, so it never entered
 * the registry.
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
      baseCurrencyCode: payload.baseCurrency,
    },
    update: { name: payload.businessName, baseCurrencyCode: payload.baseCurrency },
    select: { id: true },
  });

  const existing = await prisma.store.findUnique({
    where: { externalId: payload.storeId },
    select: {
      id: true,
      slug: true,
      sourceUpdatedAt: true,
      sourceOptIn: true,
      storefront: {
        select: {
          slug: true,
          stores: { where: { status: { not: "DRAFT" } }, select: { id: true } },
        },
      },
    },
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
    const canonical = canonicalSlug({
      storeSlug: existing.slug,
      brandSlug: existing.storefront.slug,
      brandBranchCount: existing.storefront.stores.length,
    });
    return {
      status: "processed",
      touchedStoreSlug: canonical,
      touchedBrandSlug: existing.storefront.slug,
    };
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
    // E9/HS2: the brand and its first branch are created in ONE nested
    // write. `payload.slug` travels as a DERIVATION SEED, never as a
    // proposal — a sync event must never fail over an unfortunate name
    // (E14, HS7).
    const created = await createStorefrontWithStore({
      businessId: business.id,
      brandName: payload.name,
      proposedSlug: null,
      derivedFrom: payload.slug || payload.name,
      store: {
        businessId: business.id,
        externalId: payload.storeId,
        status: "PUBLISHED",
        publishedAt: new Date(),
        sourceOptIn: true,
        sourceUpdatedAt: payloadUpdatedAt,
        ...common,
      },
    });
    // The registry only rejects an EXPLICIT proposal; `proposedSlug: null`
    // always derives and never returns `ok: false` (E14).
    if (!created.ok) {
      throw new Error(
        `handleStore: unexpected slug rejection deriving from a name: ${created.error}`,
      );
    }
    return {
      status: "processed",
      touchedStoreSlug: created.canonicalSlug,
      touchedBrandSlug: created.canonicalSlug,
    };
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
  const canonical = canonicalSlug({
    storeSlug: updated.slug,
    brandSlug: existing.storefront.slug,
    brandBranchCount: existing.storefront.stores.length,
  });
  return {
    status: "processed",
    touchedStoreSlug: canonical,
    touchedBrandSlug: existing.storefront.slug,
  };
}
