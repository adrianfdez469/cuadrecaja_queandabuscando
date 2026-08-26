import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { ADMIN_PRODUCTS_PAGE_SIZE } from "@/constants/admin";
import type { AuthorizedStoreId } from "../authorization";
import type { AdminProductRow } from "../types";

/**
 * Read side of the panel's product screens. Writes live exclusively in
 * `server/mutations.ts` — this module never mutates.
 */

/** Shared with `server/mutations.ts`, which returns the same shape after a write. */
export const PRODUCT_ROW_SELECT = {
  id: true,
  slug: true,
  localName: true,
  localCategory: { select: { name: true } },
  availability: true,
  syncedAt: true,
  deletedAt: true,
  syncedPrice: true,
  syncedPriceCurrency: true,
  description: true,
  imageUrls: true,
  priceOverride: true,
  priceOverrideCurrency: true,
  visible: true,
  featured: true,
} satisfies Prisma.StoreProductSelect;

type ProductRowRecord = Prisma.StoreProductGetPayload<{ select: typeof PRODUCT_ROW_SELECT }>;

export function toAdminProductRow(row: ProductRowRecord): AdminProductRow {
  return {
    id: row.id,
    slug: row.slug,
    localName: row.localName,
    categoryName: row.localCategory?.name ?? null,
    availability: row.availability,
    syncedAt: row.syncedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    syncedPrice: row.syncedPrice.toString(),
    syncedPriceCurrency: row.syncedPriceCurrency,
    description: row.description,
    imageUrls: row.imageUrls,
    priceOverride: row.priceOverride?.toString() ?? null,
    priceOverrideCurrency: row.priceOverrideCurrency,
    visible: row.visible,
    featured: row.featured,
  };
}

export type StoreProductsPage = {
  items: AdminProductRow[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * E14: includes `deletedAt` rows (marked, not editable) and `visible: false`
 * rows. Soft-deleted rows always sort last — Postgres treats `NULL` as
 * larger than any value by default, so ordering `deletedAt` **desc** puts
 * the non-deleted rows (`NULL`) first and the deleted ones last.
 */
export async function listStoreProducts(
  storeId: AuthorizedStoreId,
  options: { page: number; q: string | null },
): Promise<StoreProductsPage> {
  const page = Math.max(1, options.page);
  const q = options.q?.trim() || null;
  const where: Prisma.StoreProductWhereInput = {
    storeId,
    ...(q ? { localName: { contains: q, mode: "insensitive" } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.storeProduct.findMany({
      where,
      select: PRODUCT_ROW_SELECT,
      orderBy: [{ deletedAt: "desc" }, { featured: "desc" }, { localName: "asc" }],
      skip: (page - 1) * ADMIN_PRODUCTS_PAGE_SIZE,
      take: ADMIN_PRODUCTS_PAGE_SIZE,
    }),
    prisma.storeProduct.count({ where }),
  ]);

  return { items: rows.map(toAdminProductRow), total, page, pageSize: ADMIN_PRODUCTS_PAGE_SIZE };
}

export type ProductsSummary = { total: number; hidden: number; withoutImage: number };

/** Feeds the hub's `Productos` destination card (§ 2 · Inventario de pantallas). */
export async function summarizeStoreProducts(storeId: AuthorizedStoreId): Promise<ProductsSummary> {
  const scope = { storeId, deletedAt: null } as const;
  const [total, hidden, withoutImage] = await Promise.all([
    prisma.storeProduct.count({ where: scope }),
    prisma.storeProduct.count({ where: { ...scope, visible: false } }),
    prisma.storeProduct.count({ where: { ...scope, imageUrls: { isEmpty: true } } }),
  ]);
  return { total, hidden, withoutImage };
}

export type ProductLookup = { ok: true; row: AdminProductRow; storeSlug: string } | { ok: false };

/**
 * The single read that decides E19/E24's 403: a `storeProductId` that does
 * not belong to `storeId` is indistinguishable from one that does not exist.
 */
export async function getProductForEdit(
  storeId: AuthorizedStoreId,
  storeProductId: string,
): Promise<ProductLookup> {
  const row = await prisma.storeProduct.findFirst({
    where: { id: storeProductId, storeId },
    select: { ...PRODUCT_ROW_SELECT, store: { select: { slug: true } } },
  });
  if (!row) return { ok: false };
  const { store, ...rest } = row;
  return { ok: true, row: toAdminProductRow(rest), storeSlug: store.slug };
}

export type AdminCategoryOption = { id: string; name: string };

/** Feeds the CATEGORY scope's `<select>` in `PromotionForm` (design.md § 6). */
export async function listStoreCategories(
  storeId: AuthorizedStoreId,
): Promise<AdminCategoryOption[]> {
  const rows = await prisma.localCategory.findMany({
    where: { products: { some: { storeId } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return rows;
}
