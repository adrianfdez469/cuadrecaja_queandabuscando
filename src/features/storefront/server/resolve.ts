import { cache } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { cached, slugTag } from "@/lib/cache";
import { canonicalSlug, type PublicSlug } from "@/lib/publicSlug";

/**
 * The single resolver `slug → branch | selector | 404` (architecture.md §
 * El resolvedor único, I6). Lives in its own feature — not `catalog`,
 * `orders` or `admin` — because all three consume it and putting it inside
 * any one of them would make the others import across domains.
 *
 * Etapa 1 only ever produces `kind: "branch"`: nothing in this stage can
 * create a brand with more than one renderable store (grouping is etapa
 * 2's `groupStoreIntoBrand`). `kind: "selector"` still has to exist in the
 * type today, though, because the query itself already counts branches —
 * inventing a NARROWER type for stage 1 would make etapa 2 rewrite this
 * file's return type instead of just adding the reader that uses it.
 */

export type BranchRef = {
  storeId: string;
  /** This branch's OWN canonical — what it is linked to and tagged by. */
  canonicalSlug: PublicSlug;
  name: string;
  city: string | null;
  address: string | null;
  status: "PUBLISHED" | "SUSPENDED";
  /** Etapa 2: why a SUSPENDED branch is closed — same columns
   *  `StoreClosedNotice`/`classifyStoreClosure` already read off `Store`,
   *  free on this query (it already selects the row), so `BranchCard` can
   *  show "Cerrada ahora" vs "Suspendida" and the closure headline without a
   *  second round-trip. `null` for a PUBLISHED branch. */
  disabledReasonCode: string | null;
  disabledMessage: string | null;
  disabledAt: Date | null;
};

export type PublicResolution = BranchResolution | SelectorResolution;

export type BranchResolution = {
  kind: "branch";
  storeId: string;
  canonicalSlug: PublicSlug;
  storefrontId: string;
  brandSlug: PublicSlug;
  brandName: string;
  /** Renderable branches of the brand. 1 unless the brand was grouped (etapa 2). */
  branchCount: number;
  /** True when the requested value was not the canonical one (criterio 3). */
  isAlias: boolean;
  /**
   * Every renderable sibling, INCLUDING this one — only when `branchCount >
   * 1` (etapa 2). The query behind this resolution already loaded the whole
   * `storefront.stores` list to count them; carrying it here is what lets
   * `BranchBar` and `/[slug]/sucursales` show the tira and the switch screen
   * without a second query for data this call already paid for.
   */
  branches?: BranchRef[];
};

export type SelectorResolution = {
  kind: "selector";
  storefrontId: string;
  brandSlug: PublicSlug;
  brandName: string;
  branches: BranchRef[];
};

async function loadResolution(requested: string): Promise<PublicResolution | null> {
  const slugRow = await prisma.slug.findUnique({
    where: { value: requested },
    select: {
      kind: true,
      retiredAt: true,
      storefrontId: true,
      storeId: true,
    },
  });

  if (!slugRow || slugRow.retiredAt) return null;

  const storefrontId =
    slugRow.kind === "STOREFRONT"
      ? slugRow.storefrontId
      : slugRow.kind === "STORE"
        ? await storefrontIdOfStore(slugRow.storeId)
        : null;

  if (!storefrontId) return null;

  const storefront = await prisma.storefront.findUnique({
    where: { id: storefrontId },
    select: {
      id: true,
      slug: true,
      name: true,
      stores: {
        where: { status: { not: "DRAFT" } },
        select: {
          id: true,
          slug: true,
          name: true,
          city: true,
          address: true,
          status: true,
          disabledReasonCode: true,
          disabledMessage: true,
          disabledAt: true,
        },
        orderBy: { name: "asc" },
      },
    },
  });

  if (!storefront) return null;

  const brandSlug = storefront.slug as PublicSlug;
  const branchCount = storefront.stores.length;

  if (branchCount === 0) return null;

  const toBranchRef = (store: (typeof storefront.stores)[number]): BranchRef => ({
    storeId: store.id,
    canonicalSlug: canonicalSlug({
      storeSlug: store.slug,
      brandSlug,
      brandBranchCount: branchCount,
    }),
    name: store.name,
    city: store.city,
    address: store.address,
    status: store.status as "PUBLISHED" | "SUSPENDED",
    disabledReasonCode: store.disabledReasonCode,
    disabledMessage: store.disabledMessage,
    disabledAt: store.disabledAt,
  });

  if (branchCount === 1) {
    const store = storefront.stores[0];
    // Criterio 3 / E2: if this row was of kind STORE, the request did not
    // come in through the brand's own slug.
    const isAlias = slugRow.kind === "STORE";
    return {
      kind: "branch",
      storeId: store.id,
      canonicalSlug: canonicalSlug({ storeSlug: store.slug, brandSlug, brandBranchCount: 1 }),
      storefrontId: storefront.id,
      brandSlug,
      brandName: storefront.name,
      branchCount,
      isAlias,
    };
  }

  // Etapa 2 territory: a brand with several renderable branches. The
  // request either named the brand (selector) or one branch by its own
  // slug (branch, canonical = its own slug).
  const branches = storefront.stores.map(toBranchRef);

  if (slugRow.kind === "STORE") {
    const store = storefront.stores.find((candidate) => candidate.id === slugRow.storeId);
    if (!store || !store.slug) return null;
    return {
      kind: "branch",
      storeId: store.id,
      canonicalSlug: canonicalSlug({
        storeSlug: store.slug,
        brandSlug,
        brandBranchCount: branchCount,
      }),
      storefrontId: storefront.id,
      brandSlug,
      brandName: storefront.name,
      branchCount,
      isAlias: false,
      branches,
    };
  }

  return {
    kind: "selector",
    storefrontId: storefront.id,
    brandSlug,
    brandName: storefront.name,
    branches,
  };
}

async function storefrontIdOfStore(storeId: string | null): Promise<string | null> {
  if (!storeId) return null;
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { storefrontId: true },
  });
  return store?.storefrontId ?? null;
}

/**
 * `null` means 404. Cached and tagged by the value that was actually
 * requested (R18: invalidated whenever the registry changes, independently
 * of the branch/catalog tags) — the same "build the wrapper fresh per call,
 * with the tag baked in from the argument" pattern `catalog/server/queries.ts`
 * already uses for `getStoreBySlug`.
 *
 * Wrapped in `React.cache` so a layout and a page in the same request do
 * not pay even a cache HIT twice.
 */
export const resolvePublicSlug = cache((requested: string): Promise<PublicResolution | null> => {
  return cached(loadResolution, { keyParts: ["public-slug"], tags: [slugTag(requested)] })(
    requested,
  );
});

/** Throws Next's not-found boundary. For direct use in a page/layout. */
export async function requireResolution(requested: string): Promise<PublicResolution> {
  const resolution = await resolvePublicSlug(requested);
  if (!resolution) notFound();
  return resolution;
}
