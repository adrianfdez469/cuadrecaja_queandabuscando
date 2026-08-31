import { cache } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { cached, storeCatalogTag, storeTag, storefrontTag } from "@/lib/cache";
import { canonicalSlug, asPublicSlug, type PublicSlug } from "@/lib/publicSlug";
import { presentationContact } from "@/lib/storeContact";
import { indexPromotions, type AppliedPromotion, type PromotionRow } from "@/lib/promotions";
import type { BranchResolution, SelectorResolution } from "@/features/storefront/server/resolve";
import {
  deriveStoreCategories,
  productsOfCategory,
  type StoreCategory,
} from "@/features/catalog/storeCategories";
import {
  applyCatalogFilters,
  type CatalogFilterContext,
  type CatalogFilterResult,
  type CatalogFilterState,
} from "@/features/catalog/catalogFilters";

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
  /** F-026: the STABLE identifier of the category in the URL
   *  (`LocalCategory.slug`), `null` when the product has no category (E6).
   *  Sits next to `categoryName` because it comes from the same row and the
   *  same JOIN: zero extra queries (architecture.md § Contratos). */
  categorySlug: string | null;
  syncedPrice: string;
  syncedPriceCurrency: string;
  priceOverride: string | null;
  priceOverrideCurrency: string | null;
  /** R28: candidates already filtered by vigency and scope, from the SAME
   *  cached read — `resolvePrice` (lib/pricing.ts) picks the winner. */
  promotions: readonly AppliedPromotion[];
  /**
   * F-027 (architecture.md § Modelo de datos, ADR 0025): projected in BOTH
   * readers of this type — here and in
   * `src/features/catalog/server/search.ts` — so a recorte that needs a new
   * predicate breaks the compilation of the other reader instead of
   * silently drifting. ISO string, never a `Date`: this type crosses
   * `unstable_cache`, which serializes to JSON, and a string compares
   * chronologically as-is regardless of what the deserializer revives.
   */
  createdAt: string;
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

export type StorefrontBranding = { name: string; themeTokens: unknown };

async function loadStorefrontBranding(storefrontId: string): Promise<StorefrontBranding | null> {
  return prisma.storefront.findUnique({
    where: { id: storefrontId },
    select: { name: true, themeTokens: true },
  });
}

/**
 * Etapa 2: what the selector's layout needs when `/[slug]` resolves to
 * `kind: "selector"` — the brand's own name and theme, tagged by
 * `storefrontTag` (R19: every branding write already fires this tag, from
 * etapa 1 on, precisely so this reader needs nothing new to invalidate).
 */
export function getStorefrontBranding(
  selector: Pick<SelectorResolution, "storefrontId" | "brandSlug">,
): Promise<StorefrontBranding | null> {
  return cached(loadStorefrontBranding, {
    keyParts: ["storefront-branding"],
    tags: [storefrontTag(selector.brandSlug)],
  })(selector.storefrontId);
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
        createdAt: true,
        localCategory: { select: { name: true, slug: true } },
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
    categorySlug: product.localCategory?.slug ?? null,
    syncedPrice: product.syncedPrice.toString(),
    syncedPriceCurrency: product.syncedPriceCurrency,
    priceOverride: product.priceOverride?.toString() ?? null,
    priceOverrideCurrency: product.priceOverrideCurrency,
    createdAt: product.createdAt.toISOString(),
  }));
}

export function getStoreCatalog(branch: StoreRef): Promise<CatalogProduct[]> {
  return cached(loadCatalog, {
    keyParts: ["store-catalog"],
    tags: [storeCatalogTag(branch.canonicalSlug)],
  })(branch.storeId);
}

/**
 * F-026 (RD1): the list for the selector. ZERO new queries and zero new
 * cache entries (docs/adr/0025-recortes-del-catalogo-como-proyeccion.md) —
 * a projection of the same `getStoreCatalog()` read that `/[slug]` already
 * pays for. Wrapped in React's `cache()` so a page's own body and a
 * sibling call in the same request never re-derive the same list twice,
 * same technique `resolvePublicSlug` already uses.
 */
export const getStoreCategories = cache(async (branch: StoreRef): Promise<StoreCategory[]> => {
  const catalog = await getStoreCatalog(branch);
  return deriveStoreCategories(catalog);
});

export type StoreCategoryView = {
  category: StoreCategory;
  /** Same type and same order as `getStoreCatalog` (RD3): `ProductCard`
   *  and the grid are reused untouched. */
  products: CatalogProduct[];
};

/**
 * F-026 (RD3, RD4): the category view's one entry point. `null` means the
 * caller should `notFound()` — a `categorySlug` that does not resolve to
 * any visible product in THIS branch, whether it never existed, belongs to
 * another branch's business (E9), or lost its last visible product (E5).
 * Those three are deliberately the same outcome for the shopper.
 *
 * Envoltorio fino sobre `getStoreCatalog`: no Prisma, no new query, no new
 * cache entry — same ADR 0025 as `getStoreCategories`.
 */
export const getStoreCategoryView = cache(
  async (branch: StoreRef, categorySlug: string): Promise<StoreCategoryView | null> => {
    const catalog = await getStoreCatalog(branch);
    const products = productsOfCategory(catalog, categorySlug);
    if (products.length === 0) return null;

    const category = deriveStoreCategories(catalog).find((c) => c.slug === categorySlug);
    // Unreachable in practice: `products.length > 0` means at least one
    // product carries this `categorySlug`, which is exactly what puts an
    // entry in `deriveStoreCategories`' output. Guarded anyway so the
    // function's return type stays a clean `StoreCategoryView | null`
    // instead of a non-null assertion.
    if (!category) return null;

    return { category, products };
  },
);

/**
 * F-027 (architecture.md § Componentes, § Flujo de datos): the ONE entry
 * point `/[slug]/catalogo` and the filtered path of `/[slug]/buscar` both
 * call. Envoltorio fino sobre `getStoreCatalog` (already cached, already
 * tagged) + `applyCatalogFilters` (pure) — zero new Prisma query and zero
 * new cache entry, same ADR 0025 as `getStoreCategories`/`getStoreCategoryView`.
 * Wrapped in React's `cache()` so a page body and its own `generateMetadata`
 * never redo the same filter/sort/paginate pass within one request.
 */
export const getFilteredStoreCatalog = cache(
  async (
    branch: StoreRef,
    state: CatalogFilterState,
    context: CatalogFilterContext,
  ): Promise<CatalogFilterResult> => {
    const catalog = await getStoreCatalog(branch);
    return applyCatalogFilters(catalog, state, context);
  },
);

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
/** Etapa 2, DP4(a): a brand grouping 2+ branches gets its OWN pre-rendered
 *  page (the selector) — distinct content, distinct slug, never the same
 *  string as one of its branches' canonicals. */
type PublishedBrandSelector = { brandSlug: PublicSlug };

/**
 * Every published branch (canonical slug plus its live alias if it has one)
 * AND every brand whose own slug now serves a selector (etapa 2, 2+
 * renderable branches). The ONE query `getPublishedStoreSlugs`
 * (pre-rendering), `getCanonicalStoreSlugs` (`sitemap.ts`, R22) and
 * `getPublishedBranchesForParams` (the product page's `generateStaticParams`)
 * all build on, so none of the three can drift on which brands/branches
 * count — and so a build never resolves the SAME branch twice over (once
 * per slug variant), which is what exhausted the dev database's connection
 * pool the first time this ran (ficha
 * `prisma-p2037-too-many-connections-build-static-params`).
 *
 * Returns empty rather than throwing when the database is unreachable:
 * pre-rendering is a warm-start optimisation, and a build should not fail
 * because the database happened to be down. Anything not pre-rendered is
 * rendered on first request and cached from then on.
 */
async function loadPublishedStorefronts(): Promise<{
  branches: PublishedBranch[];
  selectors: PublishedBrandSelector[];
}> {
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
    const selectors: PublishedBrandSelector[] = [];

    for (const storefront of storefronts) {
      const branchCount = storefront.stores.length;
      if (branchCount === 0) continue;
      const brandSlug = storefront.slug as PublicSlug;

      // A brand's selector renders 200 as soon as it has 2+ renderable
      // branches, even if every one of them is closed (design.md § 1,
      // "Todas cerradas") — so it pre-renders regardless of their status.
      if (branchCount >= 2) selectors.push({ brandSlug });

      for (const store of storefront.stores) {
        if (store.status !== "PUBLISHED") continue; // pre-render only what is live
        branches.push({
          storeId: store.id,
          canonical: canonicalSlug({
            storeSlug: store.slug,
            brandSlug,
            brandBranchCount: branchCount,
          }),
          // Only a single-branch brand can have a live alias distinct from
          // its canonical (etapa 1, E2) — a grouped branch's own slug IS
          // already its canonical (etapa 2).
          alias: branchCount === 1 && store.slug ? asPublicSlug(store.slug) : null,
        });
      }
    }
    return { branches, selectors };
  } catch (error) {
    console.warn("[catalog] could not list stores for pre-rendering:", error);
    return { branches: [], selectors: [] };
  }
}

/** For `generateStaticParams`: canonical slugs, their live aliases, AND the
 *  brand slugs that now serve a selector (DP4(b)) — both URLs have to
 *  pre-render, since both serve real pages (E21). */
export async function getPublishedStoreSlugs(): Promise<PublicSlug[]> {
  const { branches, selectors } = await loadPublishedStorefronts();
  return [
    ...branches.flatMap((branch) =>
      branch.alias ? [branch.canonical, branch.alias] : [branch.canonical],
    ),
    ...selectors.map((selector) => selector.brandSlug),
  ];
}

/** For `sitemap.ts` (R22): one url per branch (the canonical one — an alias
 *  never competes with its own canonical in a search index) PLUS one url per
 *  grouped brand's selector (DP4(a)): distinct content, so it never competes
 *  with its own branches' entries either. A single-branch brand's selector
 *  URL and its one branch's canonical are the same string, so nothing here
 *  ever duplicates a sitemap entry. */
export async function getCanonicalStoreSlugs(): Promise<PublicSlug[]> {
  const { branches, selectors } = await loadPublishedStorefronts();
  return [...branches.map((branch) => branch.canonical), ...selectors.map((s) => s.brandSlug)];
}

/**
 * For `/[slug]/p/[productSlug]`'s `generateStaticParams`: one entry per
 * branch, with EVERY slug that page has to answer under (canonical + a
 * live alias, if any) — so the caller resolves and fetches the catalogue
 * ONCE per branch, not once per slug variant. A brand's selector slug is
 * DELIBERATELY absent here (DP4(b)): there is no catalogue to iterate under
 * `/[slug]/p/*` for a slug that serves a selector, not a branch.
 */
export async function getPublishedBranchesForParams(): Promise<
  { storeId: string; canonicalSlug: PublicSlug; slugs: PublicSlug[] }[]
> {
  const { branches } = await loadPublishedStorefronts();
  return branches.map((branch) => ({
    storeId: branch.storeId,
    canonicalSlug: branch.canonical,
    slugs: branch.alias ? [branch.canonical, branch.alias] : [branch.canonical],
  }));
}
