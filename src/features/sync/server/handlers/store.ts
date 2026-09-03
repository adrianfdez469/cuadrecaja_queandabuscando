import { prisma } from "@/lib/prisma";
import { canonicalSlug } from "@/lib/publicSlug";
import { createStorefrontWithStore, expandBrandTouch } from "@/features/storefront/server/registry";
import { isDeliveryConfigInconsistent, type DeliveryConfig } from "@/features/orders/deliveryOffer";
import {
  STORE_DELIVERY_CONFIG_INCONSISTENT,
  STORE_OPENING_HOURS_INVALID,
  STORE_TIMEZONE_INVALID,
} from "@/constants/sync";
import { DEFAULT_STORE_TIMEZONE } from "@/constants/storeHours";
import { isCanonicalTimeZone } from "@/lib/timezone";
import { openingHoursSchema } from "@/lib/openingHours";
import {
  effectiveDeliveryConfig,
  NEW_STORE_DELIVERY_BASELINE,
  storeConfigWrite,
  type StoreConfigWrite,
} from "../storeConfig";
import type { StorePayload } from "../../schemas";
import { SKIPPED, STALE, SyncEventFailure, type HandlerOutcome } from "./types";

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
 *
 * F-017 (etapa 2, ALTA — tests.md § Fallos encontrados #3): a ROUTINE event
 * updating a branch that already belongs to a multi-branch brand changes
 * what the brand's selector and every sibling's own `/sucursales` show
 * (name, city, closed Badge inputs) without writing a `Slug` row for any of
 * them. `touchedSlugValues` reports the brand's own slug and every
 * sibling's own slug so `processBatch.ts` busts their cached resolution too
 * — the same "revalida solo lo que se escribe" gap
 * `regroupStoreIntoBrand`/`setStoreEnabled` had, now closed by the single
 * `expandBrandTouch` funnel (ficha
 * `revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado`). Zero
 * extra queries: `existing.storefront.stores` already carried this brand's
 * member list for `brandBranchCount` — it only gained `slug` in the select.
 */
export async function handleStore(
  payload: StorePayload,
  operation: "CREATE" | "UPDATE" | "DELETE",
  businessId: string,
): Promise<HandlerOutcome> {
  // R8/E16: the sync no longer creates a Business — a business is born only
  // when its token is minted (script or seed). `businessId` is the caller's
  // OWN identity, already authenticated; this only ever updates it.
  await prisma.business.update({
    where: { id: businessId },
    data: { name: payload.businessName, baseCurrencyCode: payload.baseCurrency },
    select: { id: true },
  });

  const existing = await prisma.store.findUnique({
    where: { externalId: payload.storeId },
    select: {
      id: true,
      slug: true,
      sourceUpdatedAt: true,
      sourceOptIn: true,
      businessId: true,
      // F-022 R12: read for free here so the republish path can gate
      // `status: "PUBLISHED"` without a second round-trip.
      timezone: true,
      // F-032 (architecture.md § Flujo de datos): the R8 guard's "effective
      // value" (R7) needs the row's OWN config when the payload only touches
      // part of the triad — free on this query, it already reads the row.
      deliveryEnabled: true,
      deliveryFeeMode: true,
      deliveryFee: true,
      storefront: {
        select: {
          slug: true,
          // `slug` here (not just `id`), like `mutations.ts`'s
          // `STORE_CANONICAL_SELECT`, is what lets a routine update revalidate
          // every sibling's own slug tag when the brand is multi-branch —
          // free on this query, it already selects the row.
          stores: { where: { status: { not: "DRAFT" } }, select: { id: true, slug: true } },
        },
      },
    },
  });

  // A store whose externalId collides with another business's is never this
  // handler's to touch — treated exactly like "does not exist yet" (R1, R6).
  if (existing && existing.businessId !== businessId) return SKIPPED;

  const payloadUpdatedAt = new Date(payload.updatedAt);

  if (
    existing?.sourceUpdatedAt &&
    existing.sourceUpdatedAt.getTime() >= payloadUpdatedAt.getTime()
  ) {
    return STALE;
  }

  // R14/E11: a DELETE never configures — the payload's five keys mean
  // nothing on that path, whatever it happens to carry.
  const config: StoreConfigWrite = operation === "DELETE" ? {} : storeConfigWrite(payload);

  // DELETE has no meaningful `publishToStore` of its own: treat it exactly
  // like an explicit unpublish.
  const optIn = operation !== "DELETE" && payload.publishToStore;

  if (!optIn) {
    if (!existing) return SKIPPED;
    // E10: an event that unpublishes still configures — it is data about
    // the store, not about its publication. Called HERE, right before the
    // write it guards, not once at the top: doing it before the SKIPPED
    // above would turn E12 into a failure the spec requires stays skipped.
    assertDeliveryConsistent(config, rowDeliveryConfig(existing));
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
        ...config,
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
      touchedSlugValues: siblingTouch(existing.storefront),
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

  // F-022 E10/SP3: a malformed calendar fails THIS event only, before either
  // write below applies it — the same pattern as `assertDeliveryConsistent`.
  // `storePayloadSchema.openingHours` stays `z.unknown().nullish()`: this
  // check cannot live in the payload's batch-level schema, which would
  // reject the whole batch with a 400 and write no `SyncEvent` at all
  // (`src/app/api/internal/sync/catalog/route.ts:31-37`).
  assertOpeningHoursValid(payload.openingHours);

  if (!existing) {
    // E13: a brand-new store is checked against the DEFAULTS the column
    // would apply, not against nothing — a payload that only sets
    // `deliveryEnabled: true` on a store that does not exist yet is exactly
    // as inconsistent as it would be against `FLAT_RATE`/`NULL` on an
    // existing row.
    assertDeliveryConsistent(config, NEW_STORE_DELIVERY_BASELINE);
    // R12: a brand-new row has not written its own zone yet, so what is
    // ABOUT to publish is the column's default — checked as a constant, kept
    // honest by the caso límite 1 test that the default is itself a value
    // `isCanonicalTimeZone` accepts.
    if (!isCanonicalTimeZone(DEFAULT_STORE_TIMEZONE)) {
      throw new SyncEventFailure(STORE_TIMEZONE_INVALID);
    }
    // E9/HS2: the brand and its first branch are created in ONE nested
    // write. `payload.slug` travels as a DERIVATION SEED, never as a
    // proposal — a sync event must never fail over an unfortunate name
    // (E14, HS7).
    const created = await createStorefrontWithStore({
      businessId,
      brandName: payload.name,
      proposedSlug: null,
      derivedFrom: payload.slug || payload.name,
      store: {
        businessId,
        externalId: payload.storeId,
        status: "PUBLISHED",
        publishedAt: new Date(),
        sourceOptIn: true,
        sourceUpdatedAt: payloadUpdatedAt,
        ...common,
        ...config,
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

  // Called HERE, right before the write it guards (architecture.md
  // § Flujo de datos) — not once at the top of the function, which would
  // turn the SKIPPED/STALE returns above into failures the spec requires
  // stay exactly what they are.
  assertDeliveryConsistent(config, rowDeliveryConfig(existing));
  const optInChanged = existing.sourceOptIn !== true;
  // R12: only checked when `data` below is about to carry
  // `status: "PUBLISHED"` — a routine event (a new phone number) on a store
  // already published with an unreadable zone must NOT fail, same doctrine
  // as `assertDeliveryConsistent` not failing when `config` does not touch
  // the triad.
  if (optInChanged && !isCanonicalTimeZone(existing.timezone)) {
    throw new SyncEventFailure(STORE_TIMEZONE_INVALID);
  }
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
      ...config,
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
    touchedSlugValues: siblingTouch(existing.storefront),
  };
}

/**
 * `undefined` for a single-branch brand (nothing about a selector or a
 * sibling's `/sucursales` exists to go stale — playbook § Cuándo NO es
 * esto), otherwise the brand's own slug plus every sibling's own slug, via
 * the ONE shared funnel (`expandBrandTouch`) — never a hand-rolled
 * `.map()`/`.filter()` here.
 */
function siblingTouch(storefront: { slug: string; stores: { slug: string | null }[] }) {
  return storefront.stores.length > 1
    ? expandBrandTouch(storefront.slug, storefront.stores)
    : undefined;
}

/** R7: the existing row's own delivery config, in the shape
 *  `effectiveDeliveryConfig` mixes against — a `Decimal | null` becomes the
 *  string `DeliveryConfig` already uses, via the column's own `.toString()`
 *  (architecture.md § Contratos internos, punto 3). */
function rowDeliveryConfig(row: {
  deliveryEnabled: boolean;
  deliveryFeeMode: DeliveryConfig["deliveryFeeMode"];
  deliveryFee: { toString(): string } | null;
}): DeliveryConfig {
  return {
    deliveryEnabled: row.deliveryEnabled,
    deliveryFeeMode: row.deliveryFeeMode,
    deliveryFee: row.deliveryFee?.toString() ?? null,
  };
}

/**
 * R9/R10.2: does nothing when `config` does not touch the delivery triad —
 * a row already in violation (a stale hand-written `UPDATE`) must not fail
 * an unrelated event, or "omitir no es apagar" becomes "omitir hace
 * fallar". Otherwise mixes `config` with `fallback` (R7) and throws when
 * the result is the one state the sync must never write (R8). Never writes
 * anything itself — every caller runs this BEFORE its own write, never
 * once at the top of the function (architecture.md § Flujo de datos).
 */
function assertDeliveryConsistent(config: StoreConfigWrite, fallback: DeliveryConfig): void {
  const touchesTriad =
    config.deliveryEnabled !== undefined ||
    config.deliveryFeeMode !== undefined ||
    config.deliveryFee !== undefined;
  if (!touchesTriad) return;
  if (isDeliveryConfigInconsistent(effectiveDeliveryConfig(config, fallback))) {
    throw new SyncEventFailure(STORE_DELIVERY_CONFIG_INCONSISTENT);
  }
}

/**
 * F-022 E10/R9/SP3: `openingHours` is validated by the SAME strict schema
 * the reader tolerates (`src/lib/openingHours.ts`). `null`/`undefined`
 * leaves the column intact (caso límite 9) and is not an error. A value that
 * fails the schema fails THIS event alone, before the write that would apply
 * it — like `assertDeliveryConsistent` above, never at the top of the
 * function.
 */
function assertOpeningHoursValid(value: unknown): void {
  if (value == null) return;
  if (!openingHoursSchema.safeParse(value).success) {
    throw new SyncEventFailure(STORE_OPENING_HOURS_INVALID);
  }
}
