import { prisma } from "@/lib/prisma";
import type { AuthorizedStoreId } from "../authorization";

/**
 * F-011 tanda 3 (R43): the ONE read that decides both halves of the
 * branding endpoint — cobertura (HD16) and revalidación (R36). Its result
 * is passed hand-to-hand: `authorizeBrandCoverage` gets the branches array
 * to authorize, and `expandBrandRevalidation` gets the SAME array to
 * project. Two queries here would be two truths that can diverge, which is
 * exactly what R43 forbids.
 *
 * The filter of "renderable branch" (`status != DRAFT`) is written ONCE, in
 * this `where`, never re-derived by either consumer.
 */
const RENDERABLE = { status: { not: "DRAFT" } } as const;

export type BrandingTarget = {
  /** The branch the admin entered from — its own name, for the screen's
   *  "← {nombre de la tienda}" back link. Read in the SAME round-trip as
   *  everything else below: one more column, not one more query. */
  storeName: string;
  storefrontId: string;
  brandSlug: string;
  brandName: string;
  /** As stored, unvalidated: the caller (the endpoint, the screen) decides
   *  what to do with an invalid value — this layer never parses it. */
  themeTokens: unknown;
  /** Renderable branches (`status != DRAFT`), ordered by name. `slug` is
   *  `null` for the sole branch of a single-branch brand. */
  branches: readonly {
    id: string;
    name: string;
    city: string | null;
    status: "PUBLISHED" | "SUSPENDED";
    slug: string | null;
  }[];
};

export async function loadBrandingTarget(
  storeId: AuthorizedStoreId,
): Promise<BrandingTarget | null> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      name: true,
      storefront: {
        select: {
          id: true,
          slug: true,
          name: true,
          themeTokens: true,
          stores: {
            where: RENDERABLE,
            select: { id: true, name: true, city: true, status: true, slug: true },
            orderBy: { name: "asc" },
          },
        },
      },
    },
  });
  if (!store) return null;

  const { storefront } = store;
  return {
    storeName: store.name,
    storefrontId: storefront.id,
    brandSlug: storefront.slug,
    brandName: storefront.name,
    themeTokens: storefront.themeTokens,
    branches: storefront.stores.map((branch) => ({
      id: branch.id,
      name: branch.name,
      city: branch.city,
      status: branch.status as "PUBLISHED" | "SUSPENDED",
      slug: branch.slug,
    })),
  };
}
