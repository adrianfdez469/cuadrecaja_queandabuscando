import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { cached, storeCatalogTag, storeTag } from "@/lib/cache";
import { indexPromotions, type AppliedPromotion, type PromotionRow } from "@/lib/promotions";

/**
 * Read side of the public storefront.
 *
 * Everything here is wrapped in the data cache and tagged, so a sync batch can
 * invalidate exactly the stores it touched. This is the ONLY module the public
 * pages read through.
 */

export type StoreSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  themeTokens: unknown;
  whatsapp: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  baseCurrencyCode: string;
  /** HD10-HD15: DRAFT never renders in public (`requireStore` 404s it);
   *  SUSPENDED renders as the closed notice, never as a 404 (HD11). */
  status: "DRAFT" | "PUBLISHED" | "SUSPENDED";
  disabledReasonCode: string | null;
  disabledMessage: string | null;
  disabledAt: Date | null;
};

export type CatalogProduct = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  imageUrls: string[];
  availability: "OUT_OF_STOCK" | "LOW_STOCK" | "AVAILABLE";
  featured: boolean;
  categoryName: string | null;
  syncedPrice: string;
  syncedPriceCurrency: string;
  priceOverride: string | null;
  priceOverrideCurrency: string | null;
  /** R28: candidates already filtered by vigency and scope, from the SAME
   *  cached read — `resolvePrice` (lib/pricing.ts) picks the winner. */
  promotions: readonly AppliedPromotion[];
};

async function loadStore(slug: string): Promise<StoreSummary | null> {
  // HD11: no `status` filter here — a SUSPENDED store still has to render
  // its closed notice with a real name and theme, not a bare 404. The
  // catalogue query below keeps the filter; this is the one read that needs
  // to tell "does not exist" apart from "exists and is closed".
  const store = await prisma.store.findFirst({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      logoUrl: true,
      coverUrl: true,
      themeTokens: true,
      whatsapp: true,
      phone: true,
      address: true,
      city: true,
      status: true,
      disabledReasonCode: true,
      disabledMessage: true,
      disabledAt: true,
      business: { select: { baseCurrencyCode: true } },
    },
  });
  if (!store) return null;

  const { business, ...rest } = store;
  return { ...rest, baseCurrencyCode: business.baseCurrencyCode };
}

export function getStoreBySlug(slug: string): Promise<StoreSummary | null> {
  return cached(loadStore, {
    keyParts: ["store-by-slug"],
    tags: [storeTag(slug)],
  })(slug);
}

/**
 * Throws the Next not-found boundary. For use directly in a page.
 *
 * HD11: only a missing row or a `DRAFT` one 404s — there is no QR pointing
 * at a store that never published, and a closed page for something that
 * never existed would give it a public presence it never had. `SUSPENDED`
 * returns normally: the caller decides catalog vs. the closed notice.
 */
export async function requireStore(slug: string): Promise<StoreSummary> {
  const store = await getStoreBySlug(slug);
  if (!store || store.status === "DRAFT") notFound();
  return store;
}

async function loadCatalog(slug: string): Promise<CatalogProduct[]> {
  const [products, promotionRows] = await Promise.all([
    prisma.storeProduct.findMany({
      where: {
        store: { slug, status: "PUBLISHED" },
        deletedAt: null,
        visible: true,
      },
      orderBy: [{ featured: "desc" }, { localName: "asc" }],
      select: {
        id: true,
        slug: true,
        localName: true,
        description: true,
        imageUrls: true,
        availability: true,
        featured: true,
        syncedPrice: true,
        syncedPriceCurrency: true,
        priceOverride: true,
        priceOverrideCurrency: true,
        localCategoryId: true,
        localCategory: { select: { name: true } },
        canonicalProduct: { select: { description: true, imageUrl: true } },
      },
    }),
    // R28: read inside the SAME cached function as the products, so a
    // promotion write revalidates this exact tag (R10) — never a second,
    // separately-cached lookup that could drift.
    prisma.promotion.findMany({
      where: { store: { slug }, active: true },
      select: {
        id: true,
        type: true,
        scope: true,
        value: true,
        conditions: true,
        startsAt: true,
        endsAt: true,
        active: true,
      },
    }),
  ]);

  const promotionIndex = indexPromotions(
    promotionRows.map((row): PromotionRow => ({
      id: row.id,
      type: row.type,
      scope: row.scope,
      value: row.value.toString(),
      conditions: row.conditions,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      active: row.active,
    })),
    new Date(),
  );

  return products.map((product) => ({
    id: product.id,
    slug: product.slug,
    name: product.localName,
    // The store's own copy wins; the canonical description is the fallback.
    description: product.description ?? product.canonicalProduct.description,
    imageUrls:
      product.imageUrls.length > 0
        ? product.imageUrls
        : product.canonicalProduct.imageUrl
          ? [product.canonicalProduct.imageUrl]
          : [],
    availability: product.availability,
    featured: product.featured,
    promotions: promotionIndex.forProduct(product.id, product.localCategoryId),
    categoryName: product.localCategory?.name ?? null,
    syncedPrice: product.syncedPrice.toString(),
    syncedPriceCurrency: product.syncedPriceCurrency,
    priceOverride: product.priceOverride?.toString() ?? null,
    priceOverrideCurrency: product.priceOverrideCurrency,
  }));
}

export function getStoreCatalog(slug: string): Promise<CatalogProduct[]> {
  return cached(loadCatalog, {
    keyParts: ["store-catalog"],
    tags: [storeCatalogTag(slug)],
  })(slug);
}

async function loadRates(slug: string): Promise<Record<string, string>> {
  const rates = await prisma.exchangeRate.findMany({
    where: { business: { stores: { some: { slug } } } },
    orderBy: { createdAt: "desc" },
    select: { currencyCode: true, rate: true },
  });

  // Append-only table: the first row per currency is the current rate.
  const latest: Record<string, string> = {};
  for (const rate of rates) {
    if (!(rate.currencyCode in latest)) latest[rate.currencyCode] = rate.rate.toString();
  }
  return latest;
}

export function getStoreRates(slug: string): Promise<Record<string, string>> {
  return cached(loadRates, {
    keyParts: ["store-rates"],
    tags: [storeTag(slug)],
  })(slug);
}

/**
 * Slugs of every published store, for generateStaticParams.
 *
 * Returns an empty list rather than throwing when the database is unreachable:
 * pre-rendering is a warm-start optimisation, and a build should not fail
 * because the database happened to be down. Anything not pre-rendered is
 * rendered on first request and cached from then on.
 */
export async function getPublishedStoreSlugs(): Promise<string[]> {
  try {
    const stores = await prisma.store.findMany({
      where: { status: "PUBLISHED" },
      select: { slug: true },
    });
    return stores.map((store) => store.slug);
  } catch (error) {
    console.warn("[catalog] could not list stores for pre-rendering:", error);
    return [];
  }
}
