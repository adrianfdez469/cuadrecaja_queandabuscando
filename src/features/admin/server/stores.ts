import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { AdminSession } from "@/lib/auth/adminSession";
import { canonicalSlug, type PublicSlug } from "@/lib/publicSlug";
import { previewSlug } from "@/features/storefront/server/registry";
import type { AuthorizedStoreId } from "../authorization";
import type { AdminStoreListItem, BrandBranch, GroupCandidate } from "../types";

/**
 * Read side of the panel's tienda scope.
 *
 * `listManagedStores` filters strictly by `session.storeIds` (never
 * `businessId` — criterio 1) and does zero queries for an empty session.
 *
 * F-017: the public URL a store exposes is now the CANONICAL slug, resolved
 * from its brand — `Store.slug` alone is nullable and, for a brand-new
 * store, always empty.
 */

const STOREFRONT_SELECT = {
  id: true,
  slug: true,
  name: true,
  stores: { where: { status: { not: "DRAFT" as const } }, select: { id: true } },
} as const;

export async function listManagedStores(session: AdminSession): Promise<AdminStoreListItem[]> {
  if (session.storeIds.length === 0) return [];

  const stores = await prisma.store.findMany({
    where: { id: { in: session.storeIds } },
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      city: true,
      address: true,
      disabledReasonCode: true,
      disabledMessage: true,
      disabledAt: true,
      storefront: { select: STOREFRONT_SELECT },
    },
    orderBy: { name: "asc" },
  });

  return stores.map(({ slug, storefront, ...rest }) => ({
    ...rest,
    canonicalSlug: canonicalSlug({
      storeSlug: slug,
      brandSlug: storefront.slug,
      brandBranchCount: storefront.stores.length,
    }),
    disabledAt: rest.disabledAt ? rest.disabledAt.toISOString() : null,
  }));
}

export type ManagedStoreDetail = AdminStoreListItem & {
  description: string | null;
  province: string | null;
  whatsapp: string | null;
  phone: string | null;
  /** HD3: the currency a FIXED promotion's `value` is denominated in (R27). */
  baseCurrencyCode: string;
  /** Etapa 2: for the hub's «Tu marca» card. */
  storefrontId: string;
  branchCount: number;
  brandSlug: PublicSlug;
  brandName: string;
};

async function findManagedStore(storeId: AuthorizedStoreId): Promise<ManagedStoreDetail | null> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      city: true,
      address: true,
      description: true,
      province: true,
      whatsapp: true,
      phone: true,
      disabledReasonCode: true,
      disabledMessage: true,
      disabledAt: true,
      business: { select: { baseCurrencyCode: true } },
      storefront: { select: STOREFRONT_SELECT },
    },
  });
  if (!store) return null;
  const { business, slug, storefront, ...rest } = store;
  return {
    ...rest,
    canonicalSlug: canonicalSlug({
      storeSlug: slug,
      brandSlug: storefront.slug,
      brandBranchCount: storefront.stores.length,
    }),
    disabledAt: store.disabledAt ? store.disabledAt.toISOString() : null,
    baseCurrencyCode: business.baseCurrencyCode,
    storefrontId: storefront.id,
    branchCount: storefront.stores.length,
    brandSlug: storefront.slug as PublicSlug,
    brandName: storefront.name,
  };
}

/**
 * Gemelo of `catalog/server/queries.ts::requireStore`: throws the Next
 * not-found boundary. The caller already authorized `storeId` — this only
 * covers the row disappearing between two logins (spec § Casos límite).
 */
export async function requireManagedStore(storeId: AuthorizedStoreId): Promise<ManagedStoreDetail> {
  const store = await findManagedStore(storeId);
  if (!store) notFound();
  return store;
}

/**
 * HS8, etapa 2: candidatas para agrupar bajo la marca de `primaryStoreId` —
 * tiendas que el admin YA administra (`session.storeIds`, criterio 1 de
 * F-011), del mismo negocio, que no estén ya en esa marca. El filtro por
 * negocio y por marca aquí es lo que hace que los 409 del endpoint sean
 * casos de carrera y no el camino normal (architecture.md § `<fieldset>`).
 */
export async function listGroupCandidates(
  session: AdminSession,
  primaryStoreId: AuthorizedStoreId,
): Promise<GroupCandidate[]> {
  if (session.storeIds.length === 0) return [];

  const primary = await prisma.store.findUnique({
    where: { id: primaryStoreId },
    select: { businessId: true, storefrontId: true },
  });
  if (!primary) return [];

  const stores = await prisma.store.findMany({
    where: {
      id: { in: session.storeIds, not: primaryStoreId },
      businessId: primary.businessId,
      storefrontId: { not: primary.storefrontId },
    },
    select: {
      id: true,
      name: true,
      city: true,
      slug: true,
      storefront: { select: STOREFRONT_SELECT },
    },
    orderBy: { name: "asc" },
  });

  return stores.map(({ slug, storefront, ...rest }) => ({
    ...rest,
    canonicalSlug: canonicalSlug({
      storeSlug: slug,
      brandSlug: storefront.slug,
      brandBranchCount: storefront.stores.length,
    }),
  }));
}

export type GroupPreview = {
  primaryBrandSlug: PublicSlug;
  primaryBranchSlug: PublicSlug;
  /**
   * `true` when `primaryBranchSlug` is ALREADY a live URL today — either a
   * criterio-3 alias (like `bodega-central-vedado`) or a slug left over
   * from a previous grouping. The "Qué va a cambiar" screen must not claim
   * "Todavía no existe" for a URL that already answers 200 (found by
   * screenshotting `bodega-central`, which has exactly this shape: its own
   * `Store.slug` is non-null from the seed's alias fixture, not from this
   * call minting anything).
   */
  primaryBranchAlreadyExists: boolean;
};

/**
 * HS8/DP5: qué URL va a estrenar `primaryStoreId` si agrupa — calculado con
 * `previewSlug()`, la MISMA función que `regroupStoreIntoBrand` usa para
 * aplicar de verdad (architecture.md § De dónde sale el string), así que
 * esta pantalla no puede prometer un slug distinto del que el `POST` crea.
 * `null` solo si la tienda desapareció entre el guard y esta lectura.
 */
export async function previewGrouping(
  primaryStoreId: AuthorizedStoreId,
): Promise<GroupPreview | null> {
  const store = await prisma.store.findUnique({
    where: { id: primaryStoreId },
    select: {
      name: true,
      slug: true,
      businessId: true,
      storefront: { select: { slug: true } },
    },
  });
  if (!store) return null;

  const primaryBranchSlug = store.slug
    ? (store.slug as PublicSlug)
    : ((
        await previewSlug({
          slug: null,
          name: store.name,
          storeExternalId: null,
          businessId: store.businessId,
        })
      ).resolvedSlug as PublicSlug);

  return {
    primaryBrandSlug: store.storefront.slug as PublicSlug,
    primaryBranchSlug,
    primaryBranchAlreadyExists: store.slug !== null,
  };
}

/**
 * DP2/HS12: las hermanas de la marca de `storefrontId`, nombre y ciudad,
 * SIN `storeId` — la condición (b) de HS12, para que la tarjeta «Tu marca»
 * no pueda construir un enlace ni un formulario con esto aunque alguien lo
 * intente después. `listManagedStores` no cambia: quién administra qué sigue
 * decidiéndose solo ahí, y esta lectura nueva se autoriza por pertenecer a
 * la marca de una tienda que el admin SÍ administra (el llamador ya lo probó
 * antes de pedir este `storefrontId`).
 */
export async function listBrandBranches(storefrontId: string): Promise<BrandBranch[]> {
  const storefront = await prisma.storefront.findUnique({
    where: { id: storefrontId },
    select: {
      slug: true,
      stores: {
        where: { status: { not: "DRAFT" } },
        select: { name: true, city: true, slug: true, status: true },
        orderBy: { name: "asc" },
      },
    },
  });
  if (!storefront) return [];

  const branchCount = storefront.stores.length;
  return storefront.stores.map((store) => ({
    name: store.name,
    city: store.city,
    status: store.status,
    canonicalSlug: canonicalSlug({
      storeSlug: store.slug,
      brandSlug: storefront.slug,
      brandBranchCount: branchCount,
    }),
  }));
}
