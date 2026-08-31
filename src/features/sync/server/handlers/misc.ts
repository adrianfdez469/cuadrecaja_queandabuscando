import { prisma } from "@/lib/prisma";
import { uniqueSlug } from "@/lib/slug";
import { canonicalSlug, type PublicSlug } from "@/lib/publicSlug";
import { isUniqueViolation } from "@/features/orders/server/prismaErrors";
import { CATEGORY_SLUG_FALLBACK } from "@/constants/catalog";
import type { CategoryPayload, CurrencyPayload, ExchangeRatePayload } from "../../schemas";
import { PROCESSED, SKIPPED, STALE, type HandlerOutcome } from "./types";

// Mirrors `MAX_SLUG_RETRIES` in `features/storefront/server/registry.ts`'s
// `createStorefrontWithStore`: a race between two events deriving the same
// candidate is rare but possible, and a sync event must not fail on an
// unlucky name.
const MAX_CATEGORY_SLUG_RETRIES = 3;

/**
 * F-026 (architecture.md § La invalidación). Resolves every branch of this
 * business with at least one non-deleted product in `localCategoryId`,
 * converted to its CANONICAL slug. Called BEFORE writing — and, on a
 * `DELETE`, before deleting — because `StoreProduct.localCategoryId` is
 * `ON DELETE SET NULL`: after the row is gone, no product points at the
 * category any more and the query would return nothing.
 *
 * One round trip, served by `StoreProduct_localCategoryId_idx` (already
 * exists). A `CREATE` naturally returns zero rows here, with no special
 * case: a category that was just created has no product in it yet (R1).
 */
async function affectedStoreSlugs(businessId: string, localCategoryId: string) {
  const stores = await prisma.store.findMany({
    where: { businessId, products: { some: { localCategoryId, deletedAt: null } } },
    select: {
      slug: true,
      storefront: {
        select: {
          slug: true,
          stores: { where: { status: { not: "DRAFT" } }, select: { id: true } },
        },
      },
    },
  });

  return stores.map((store) =>
    canonicalSlug({
      storeSlug: store.slug,
      brandSlug: store.storefront.slug,
      brandBranchCount: store.storefront.stores.length,
    }),
  );
}

function outcomeOf(touchedStoreSlugs: readonly PublicSlug[]): HandlerOutcome {
  return touchedStoreSlugs.length > 0 ? { status: "processed", touchedStoreSlugs } : PROCESSED;
}

/**
 * Generates a slug scoped to this business, never landing on
 * `RESERVED_SLUGS` protection: a category lives one level BELOW the first
 * one (`/[slug]/c/[categorySlug]`), so `honorReserved: false` — a category
 * named "Buscar" keeps the slug `buscar` instead of the permanently-frozen
 * `buscar-tienda` (R11).
 */
function generateCategorySlug(name: string, businessId: string): Promise<string> {
  return uniqueSlug(
    name,
    async (candidate) =>
      (await prisma.localCategory.count({ where: { businessId, slug: candidate } })) > 0,
    { fallback: CATEGORY_SLUG_FALLBACK, honorReserved: false },
  );
}

/**
 * The `CREATE` branch of the upsert, split out from `handleCategory` because
 * the slug is only generated here — see the comment on `handleProduct`'s own
 * explicit create/update split for why this is not a single `upsert`.
 */
async function createCategory(
  payload: CategoryPayload,
  businessId: string,
  sourceUpdatedAt: Date,
): Promise<string> {
  let slug = await generateCategorySlug(payload.name, businessId);

  for (let attempt = 0; attempt < MAX_CATEGORY_SLUG_RETRIES; attempt += 1) {
    try {
      const created = await prisma.localCategory.create({
        data: {
          businessId,
          externalId: payload.categoryId,
          name: payload.name,
          slug,
          color: payload.color ?? null,
          sourceUpdatedAt,
        },
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      if (!isUniqueViolation(error, "slug")) throw error;
      // Lost a race against another event deriving the same candidate: the
      // DB now knows it is taken, so asking again (a fresh query) finds the
      // next free one.
      slug = await generateCategorySlug(payload.name, businessId);
    }
  }

  throw new Error(`handleCategory: could not find a free slug for "${payload.name}"`);
}

export async function handleCategory(
  payload: CategoryPayload,
  operation: "CREATE" | "UPDATE" | "DELETE",
  businessId: string,
): Promise<HandlerOutcome> {
  const existing = await prisma.localCategory.findUnique({
    where: { businessId_externalId: { businessId, externalId: payload.categoryId } },
    select: { id: true, sourceUpdatedAt: true },
  });

  const payloadUpdatedAt = new Date(payload.updatedAt);

  // Stale-write guard (I8), calcada de `handleProduct`. Nullable on purpose:
  // rows that predate this migration have no origin mark, so they accept
  // the first delivery after it and are protected from the second one on.
  if (
    existing?.sourceUpdatedAt &&
    existing.sourceUpdatedAt.getTime() >= payloadUpdatedAt.getTime()
  ) {
    return STALE;
  }

  if (operation === "DELETE") {
    if (!existing) return PROCESSED;

    // Resolved BEFORE deleting: `StoreProduct.localCategoryId` is
    // `ON DELETE SET NULL`, so after the delete no product points here any
    // more and this query would return nothing.
    const touchedStoreSlugs = await affectedStoreSlugs(businessId, existing.id);

    // Products keep their categoryId pointing at nothing rather than being
    // reassigned; detaching them is a product-level decision the POS will send.
    await prisma.localCategory.delete({ where: { id: existing.id } });

    return outcomeOf(touchedStoreSlugs);
  }

  // The `UPDATE` branch never touches `slug` (R8/E7): renaming in the POS
  // changes `name`, never the URL.
  const localCategoryId = existing
    ? await prisma.localCategory
        .update({
          where: { id: existing.id },
          data: {
            name: payload.name,
            color: payload.color ?? null,
            sourceUpdatedAt: payloadUpdatedAt,
          },
          select: { id: true },
        })
        .then((row) => row.id)
    : await createCategory(payload, businessId, payloadUpdatedAt);

  const touchedStoreSlugs = await affectedStoreSlugs(businessId, localCategoryId);
  return outcomeOf(touchedStoreSlugs);
}

export async function handleCurrency(payload: CurrencyPayload): Promise<HandlerOutcome> {
  await prisma.currency.upsert({
    where: { code: payload.code },
    create: {
      code: payload.code,
      name: payload.name,
      symbol: payload.symbol,
      active: payload.active,
    },
    update: { name: payload.name, symbol: payload.symbol, active: payload.active },
  });
  return PROCESSED;
}

/**
 * Rates are append-only, mirroring cuadrecaja. `rate` is CUP per 1 unit and CUP
 * itself never has a row — writing one would make the anchor ambiguous.
 */
export async function handleExchangeRate(
  payload: ExchangeRatePayload,
  businessId: string,
): Promise<HandlerOutcome> {
  if (payload.currency === "CUP") return SKIPPED;

  await prisma.currency.upsert({
    where: { code: payload.currency },
    create: { code: payload.currency, name: payload.currency, symbol: payload.currency },
    update: {},
  });

  await prisma.exchangeRate.create({
    data: {
      businessId,
      currencyCode: payload.currency,
      rate: payload.rate.toFixed(6),
    },
  });

  return PROCESSED;
}
