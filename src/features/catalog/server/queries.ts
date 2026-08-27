import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { cached, storeCatalogTag, storeTag } from "@/lib/cache";
import { canonicalSlug, asPublicSlug, type PublicSlug } from "@/lib/publicSlug";
import { presentationContact } from "@/lib/storeContact";
import { indexPromotions, type AppliedPromotion, type PromotionRow } from "@/lib/promotions";
import type { BranchResolution } from "@/features/storefront/server/resolve";

/** Only what these reads actually need: a `BranchResolution` satisfies it,
 *  and so does a lighter object built once for `generateStaticParams`. */
type StoreRef = Pick<BranchResolution, "storeId" | "canonicalSlug">;

/**
 * Read side of the public storefront.
 *
 * Everything here is wrapped in the data cache and tagged, so a sync batch can
 * invalidate exactly the stores it touched. This is the ONLY module the public
 * pages read through.
 *
 * F-017: every read here takes a `BranchResolution` (from
 * `features/storefront/server/resolve.ts`), never a bare slug — the storeId
 * drives the Prisma query, the `canonicalSlug` drives the cache tag. This is
 * what makes it a compile error to tag a page's cache with the URL it
 * happened to be requested by (I5).
 */

export type StoreSummary = {
  id: string;
  /** Replaces `slug`. The rename is deliberate: every call site becomes a
   *  compile error that has to be looked at once. */
  canonicalSlug: PublicSlug;
  /** Of the brand: the HTML does not change yet (R7), but the link and the
   *  future editor need it. */
  storefrontId: string;
  brandName: string;
  name: string;
  description: string | null;
  logoUrl: string | null; // from the brand
  coverUrl: string | null; // from the brand
  themeTokens: unknown; // from the brand
  /** R14 already applied: no component composes this precedence itself. */
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

type StoreSummaryWithoutCanonical = Omit<StoreSummary, "canonicalSlug">;

async function loadStore(storeId: string): Promise<StoreSummaryWithoutCanonical | null> {
  // HD11: no `status` filter here — a SUSPENDED store still has to render
  // its closed notice with a real name and theme, not a bare 404. The
  // catalogue query below keeps the filter; this is the one read that needs
  // to tell "does not exist" apart from "exists and is closed".
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      id: true,
      name: true,
      description: true,
      whatsapp: true,
      phone: true,
      email: true,
      address: true,
      city: true,
      status: true,
      disabledReasonCode: true,
      disabledMessage: true,
      disabledAt: true,
      business: { select: { baseCurrencyCode: true } },
      storefront: {
        select: {
          id: true,
          name: true,
          logoUrl: true,
          coverUrl: true,
          themeTokens: true,
          contactPhone: true,
          contactWhatsapp: true,
          contactEmail: true,
        },
      },
    },
  });
  if (!store) return null;

  const contact = presentationContact({
    brand: {
      contactPhone: store.storefront.contactPhone,
      contactWhatsapp: store.storefront.contactWhatsapp,
      contactEmail: store.storefront.contactEmail,
    },
    branch: { phone: store.phone, whatsapp: store.whatsapp, email: store.email },
  });

  return {
    id: store.id,
    storefrontId: store.storefront.id,
    brandName: store.storefront.name,
    name: store.name,
    description: store.description,
    logoUrl: store.storefront.logoUrl,
    coverUrl: store.storefront.coverUrl,
    themeTokens: store.storefront.themeTokens,
    whatsapp: contact.whatsapp,
    phone: contact.phone,
    address: store.address,
    city: store.city,
    baseCurrencyCode: store.business.baseCurrencyCode,
    status: store.status,
    disabledReasonCode: store.disabledReasonCode,
    disabledMessage: store.disabledMessage,
    disabledAt: store.disabledAt,
  };
}

export function getStoreBySlug(branch: StoreRef): Promise<StoreSummary | null> {
  return cached(loadStore, {
    keyParts: ["store-by-slug"],
    tags: [storeTag(branch.canonicalSlug)],
  })(branch.storeId).then((store) =>
    store ? { ...store, canonicalSlug: branch.canonicalSlug } : null,
  );
}

/**
 * Throws the Next not-found boundary. For use directly in a page.
 *
 * HD10-HD15: only a missing row or a `DRAFT` one 404s — there is no QR
 * pointing at a store that never published, and a closed page for
 * something that never existed would give it a public presence it never
 * had. `SUSPENDED` returns normally: the caller decides catalog vs. the
 * closed notice.
 */
export async function requireStore(branch: StoreRef): Promise<StoreSummary> {
  const store = await getStoreBySlug(branch);
  if (!store || store.status === "DRAFT") notFound();
  return store;
}

async function loadCatalog(storeId: string): Promise<CatalogProduct[]> {
  const [products, promotionRows] = await Promise.all([
    prisma.storeProduct.findMany({
      where: {
        storeId,
        store: { status: "PUBLISHED" },
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
      where: { storeId, active: true },
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

export function getStoreCatalog(branch: StoreRef): Promise<CatalogProduct[]> {
  return cached(loadCatalog, {
    keyParts: ["store-catalog"],
    tags: [storeCatalogTag(branch.canonicalSlug)],
  })(branch.storeId);
}

async function loadRates(storeId: string): Promise<Record<string, string>> {
  const rates = await prisma.exchangeRate.findMany({
    where: { business: { stores: { some: { id: storeId } } } },
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

export function getStoreRates(branch: StoreRef): Promise<Record<string, string>> {
  return cached(loadRates, {
    keyParts: ["store-rates"],
    tags: [storeTag(branch.canonicalSlug)],
  })(branch.storeId);
}

type PublishedBranch = { storeId: string; canonical: PublicSlug; alias: PublicSlug | null };

/**
 * Every published branch, canonical slug plus its live alias if it has one.
 * The ONE query `getPublishedStoreSlugs` (pre-rendering), `getCanonicalStoreSlugs`
 * (`sitemap.ts`, R22) and `getPublishedBranchesForParams` (the product
 * page's `generateStaticParams`) all build on, so none of the three can
 * drift on which brands/branches count — and so a build never resolves the
 * SAME branch twice over (once per slug variant), which is what exhausted
 * the dev database's connection pool the first time this ran (ficha
 * `prisma-p2037-too-many-connections-build-static-params`).
 *
 * A brand with more than one renderable branch (etapa 2) is skipped here —
 * its selector page pre-renders itself, this list is only branch pages.
 *
 * Returns an empty list rather than throwing when the database is
 * unreachable: pre-rendering is a warm-start optimisation, and a build
 * should not fail because the database happened to be down. Anything not
 * pre-rendered is rendered on first request and cached from then on.
 */
async function loadPublishedBranches(): Promise<PublishedBranch[]> {
  try {
    const storefronts = await prisma.storefront.findMany({
      select: {
        slug: true,
        stores: {
          where: { status: { not: "DRAFT" } },
          select: { id: true, slug: true, status: true },
        },
      },
    });

    const branches: PublishedBranch[] = [];
    for (const storefront of storefronts) {
      if (storefront.stores.length !== 1) continue; // etapa 2 territory
      const [store] = storefront.stores;
      if (store.status !== "PUBLISHED") continue;
      branches.push({
        storeId: store.id,
        canonical: canonicalSlug({
          storeSlug: store.slug,
          brandSlug: storefront.slug,
          brandBranchCount: 1,
        }),
        alias: store.slug ? asPublicSlug(store.slug) : null,
      });
    }
    return branches;
  } catch (error) {
    console.warn("[catalog] could not list stores for pre-rendering:", error);
    return [];
  }
}

/** For `generateStaticParams`: canonical slugs AND their live aliases — both
 *  URLs have to pre-render, since both serve the same page (E21). */
export async function getPublishedStoreSlugs(): Promise<PublicSlug[]> {
  const branches = await loadPublishedBranches();
  return branches.flatMap((branch) =>
    branch.alias ? [branch.canonical, branch.alias] : [branch.canonical],
  );
}

/** For `sitemap.ts` (R22): ONE url per branch, the canonical one — an alias
 *  never competes with its own canonical in a search index. */
export async function getCanonicalStoreSlugs(): Promise<PublicSlug[]> {
  const branches = await loadPublishedBranches();
  return branches.map((branch) => branch.canonical);
}

/**
 * For `/[slug]/p/[productSlug]`'s `generateStaticParams`: one entry per
 * branch, with EVERY slug that page has to answer under (canonical + a
 * live alias, if any) — so the caller resolves and fetches the catalogue
 * ONCE per branch, not once per slug variant.
 */
export async function getPublishedBranchesForParams(): Promise<
  { storeId: string; canonicalSlug: PublicSlug; slugs: PublicSlug[] }[]
> {
  const branches = await loadPublishedBranches();
  return branches.map((branch) => ({
    storeId: branch.storeId,
    canonicalSlug: branch.canonical,
    slugs: branch.alias ? [branch.canonical, branch.alias] : [branch.canonical],
  }));
}
