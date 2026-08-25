import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { cached, storeCatalogTag, storeTag } from "@/lib/cache";

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
};

async function loadStore(slug: string): Promise<StoreSummary | null> {
  const store = await prisma.store.findFirst({
    where: { slug, status: "PUBLISHED" },
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

/** Throws the Next not-found boundary. For use directly in a page. */
export async function requireStore(slug: string): Promise<StoreSummary> {
  const store = await getStoreBySlug(slug);
  if (!store) notFound();
  return store;
}

async function loadCatalog(slug: string): Promise<CatalogProduct[]> {
  const products = await prisma.storeProduct.findMany({
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
      localCategory: { select: { name: true } },
      canonicalProduct: { select: { description: true, imageUrl: true } },
    },
  });

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
