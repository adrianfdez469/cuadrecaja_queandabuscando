import { prisma } from "@/lib/prisma";
import { revalidateStores } from "@/lib/cache";
import { canonicalSlug, type PublicSlug } from "@/lib/publicSlug";
import type { Prisma } from "@/generated/prisma/client";
import { extensionForMime } from "@/lib/imageType";
import type { AllowedImageMime } from "@/constants/media";
import { uploadStoreObject } from "@/lib/supabase/storage";
import { objectPathFor } from "../storagePaths";
import type { AuthorizedStoreId } from "../authorization";
import { PRODUCT_ROW_SELECT, toAdminProductRow } from "./products";
import { PROMOTION_ROW_SELECT, toAdminPromotionRow } from "./promotions";
import type {
  AdminProductRow,
  AdminPromotionRow,
  AdminStoreRow,
  AdminWriteResult,
  PromotionBody,
  ProductWriteBody,
  StoreStatusBody,
} from "../types";

/**
 * The panel's write funnel. THE ONLY file in the panel that writes to
 * Postgres or calls Storage's upload. Every export ends in `commit()`, which
 * revalidates the store's public tags — writing without revalidating is not
 * possible without editing this file.
 *
 * `PanelProductColumn` and `PanelStoreColumn` are compile-time whitelists: a
 * sync-owned column in a `data` this file did not list (`syncedPrice`,
 * `localName`, `availability`, `publishedAt`, ...) is a type error, not a
 * runtime mistake to catch later (R8, criterio 3). `boundaries.test.ts`
 * backs this up with a grep, because a `route.ts` is outside the ESLint rule
 * that only covers `*.tsx`.
 *
 * `status` is the one column BOTH the sync and the panel legitimately write
 * (HD10 supersedes the half of HD2 that forbade it here) — but only inside
 * `setStoreEnabled`'s own `data`, never inside a product write. That is
 * exactly what `boundaries.test.ts`'s inverted assertion checks.
 */
type PanelProductColumn =
  "description" | "imageUrls" | "priceOverride" | "priceOverrideCurrency" | "visible" | "featured";
type PanelProductWrite = Pick<Prisma.StoreProductUpdateInput, PanelProductColumn>;

type PanelStoreColumn = "status" | "disabledReasonCode" | "disabledMessage" | "disabledAt";
type PanelStoreWrite = Pick<Prisma.StoreUpdateInput, PanelStoreColumn>;

/** HD3: every column of a `Promotion` the panel may write — the whole row
 *  except `id`/`storeId`/`createdAt`/`updatedAt`, all plainly the panel's
 *  own (there is no sync-owned column on this table at all). */
type PanelPromotionColumn =
  "name" | "type" | "scope" | "value" | "conditions" | "startsAt" | "endsAt" | "active";
type PanelPromotionWrite = Pick<Prisma.PromotionUncheckedCreateInput, PanelPromotionColumn>;

type PrismaErrorLike = { code: string };
function isRecordNotFound(error: unknown): error is PrismaErrorLike {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as PrismaErrorLike).code === "P2025"
  );
}

/** Writes, then revalidates the affected store. No export below bypasses this. */
async function commit<T>(slug: PublicSlug, write: () => Promise<T>): Promise<T> {
  const value = await write();
  revalidateStores([slug]);
  return value;
}

/**
 * F-017: every write here still ends up revalidating by slug, but the
 * slug now has to be the CANONICAL one — `Store.slug` alone is nullable
 * and, for a brand-new store, always empty. Every `select` in this file
 * that used to read `store: { select: { slug: true } }` now reads this
 * shape instead.
 */
const STORE_CANONICAL_SELECT = {
  slug: true,
  storefront: {
    select: {
      slug: true,
      stores: { where: { status: { not: "DRAFT" } }, select: { id: true } },
    },
  },
} satisfies Prisma.StoreSelect;

type StoreCanonicalRef = {
  slug: string | null;
  storefront: { stores: { id: string }[]; slug: string };
};

function canonicalOfStore(store: StoreCanonicalRef): PublicSlug {
  return canonicalSlug({
    storeSlug: store.slug,
    brandSlug: store.storefront.slug,
    brandBranchCount: store.storefront.stores.length,
  });
}

/**
 * E15/E16/E19: the write is scoped to `storeId` in the lookup, then applied
 * by `id` alone (the lookup already proved ownership) — two round-trips,
 * never a `$transaction` (the pooler runs in transaction mode).
 */
export async function saveProduct(
  storeId: AuthorizedStoreId,
  storeProductId: string,
  body: ProductWriteBody,
): Promise<AdminWriteResult<AdminProductRow>> {
  const existing = await prisma.storeProduct.findFirst({
    where: { id: storeProductId, storeId },
    select: {
      id: true,
      deletedAt: true,
      syncedPriceCurrency: true,
      store: { select: STORE_CANONICAL_SELECT },
    },
  });
  if (!existing) return { kind: "product_not_in_store" };
  if (existing.deletedAt) return { kind: "product_deleted" };

  const hasOverride = body.priceOverride !== null;

  // Inlined, not a separately typed `const data`, so the literal object
  // `boundaries.test.ts` greps for (a `data` property with an inline object)
  // is exactly what runs, not a variable reference to one built elsewhere.
  const updated = await commit(canonicalOfStore(existing.store), () =>
    prisma.storeProduct.update({
      where: { id: existing.id },
      data: {
        description: body.description,
        imageUrls: body.imageUrls,
        priceOverride: hasOverride ? body.priceOverride : null,
        // R14: never inherited from the client, always the synced currency of
        // the moment — quitting the override sets both columns to null.
        priceOverrideCurrency: hasOverride ? existing.syncedPriceCurrency : null,
        visible: body.visible,
        featured: body.featured,
      } satisfies PanelProductWrite,
      select: PRODUCT_ROW_SELECT,
    }),
  );

  return { kind: "saved", value: toAdminProductRow(updated) };
}

export type UploadedImage = { bytes: Buffer; mime: AllowedImageMime };

/**
 * E20: subir y DESPUÉS escribir. If the write below fails after the object
 * is already in the bucket, the result is an orphan object and no broken
 * URL — the safer of the two possible half-failures.
 *
 * Ownership (E24), the soft-delete guard and the E23 image cap are all
 * checked by the caller (`getProductForEdit` in `server/products.ts`)
 * BEFORE the request body is even read, which is what makes the 403 of
 * E24 happen "before reading the file". This function trusts that check
 * and only does the two writes: the Storage upload and the atomic push.
 */
export async function appendProductImage(
  storeId: AuthorizedStoreId,
  storeProductId: string,
  storeSlug: PublicSlug,
  file: UploadedImage,
): Promise<AdminWriteResult<{ url: string; imageUrls: string[] }>> {
  const path = objectPathFor({ storeId, storeProductId, ext: extensionForMime(file.mime) });
  const uploaded = await uploadStoreObject(path, file.bytes, file.mime);
  if (!uploaded.ok) return { kind: "storage_unavailable", reason: uploaded.reason };

  const updated = await commit(storeSlug, () =>
    prisma.storeProduct.update({
      where: { id: storeProductId },
      data: { imageUrls: { push: uploaded.url } },
      select: { imageUrls: true },
    }),
  );

  return { kind: "created", value: { url: uploaded.url, imageUrls: updated.imageUrls } };
}

/**
 * HD10-HD15: the público switch. One round-trip — `update` by the
 * authorized `storeId` itself, no prior lookup, because the store IS the
 * authorized entity (unlike a product, there is no ownership to re-verify).
 * `P2025` (the row vanished between login and this request) becomes
 * `not_found`, mapped to 404 by `_lib/respond.ts`.
 */
const STORE_ROW_SELECT = {
  id: true,
  status: true,
  disabledReasonCode: true,
  disabledMessage: true,
  disabledAt: true,
  ...STORE_CANONICAL_SELECT,
} satisfies Prisma.StoreSelect;

export async function setStoreEnabled(
  storeId: AuthorizedStoreId,
  body: StoreStatusBody,
): Promise<AdminWriteResult<AdminStoreRow>> {
  try {
    // Two separate calls, each with its own inline `data` object, one per
    // branch — rather than one ternary assigned to a shared `const data` —
    // so each is independently greppable by `boundaries.test.ts`, and only
    // one of the two ever runs.
    const updated = body.enabled
      ? await prisma.store.update({
          where: { id: storeId },
          data: {
            status: "PUBLISHED",
            disabledReasonCode: null,
            disabledMessage: null,
            disabledAt: null,
          } satisfies PanelStoreWrite,
          select: STORE_ROW_SELECT,
        })
      : await prisma.store.update({
          where: { id: storeId },
          data: {
            status: "SUSPENDED",
            disabledReasonCode: body.reasonCode,
            disabledMessage: body.message,
            disabledAt: new Date(),
          } satisfies PanelStoreWrite,
          select: STORE_ROW_SELECT,
        });

    const canonical = canonicalOfStore(updated);
    revalidateStores([canonical]);
    return {
      kind: "saved",
      value: {
        id: updated.id,
        canonicalSlug: canonical,
        status: updated.status,
        disabledReasonCode: updated.disabledReasonCode,
        disabledMessage: updated.disabledMessage,
        disabledAt: updated.disabledAt?.toISOString() ?? null,
      },
    };
  } catch (error) {
    if (isRecordNotFound(error)) return { kind: "not_found" };
    throw error;
  }
}

/**
 * R30: an id in `conditions` that does not belong to this store (or this
 * store's business, for a category) is a 400, never a promotion that
 * silently applies to everything. One indexed `count` — the same shape
 * `saveProduct`'s ownership check already uses.
 */
async function conditionsIssues(
  storeId: AuthorizedStoreId,
  businessId: string,
  body: PromotionBody,
): Promise<{ path: (string | number)[]; message: string }[]> {
  if (body.scope === "PRODUCT") {
    const ids = body.conditions.storeProductIds;
    const count = await prisma.storeProduct.count({ where: { storeId, id: { in: ids } } });
    if (count !== ids.length) {
      return [
        {
          path: ["conditions", "storeProductIds"],
          message: "one or more products do not belong to this store",
        },
      ];
    }
  } else if (body.scope === "CATEGORY") {
    const ids = body.conditions.localCategoryIds;
    const count = await prisma.localCategory.count({ where: { businessId, id: { in: ids } } });
    if (count !== ids.length) {
      return [
        {
          path: ["conditions", "localCategoryIds"],
          message: "one or more categories do not belong to this store",
        },
      ];
    }
  }
  return [];
}

function promotionWriteData(body: PromotionBody): PanelPromotionWrite {
  return {
    name: body.name,
    type: body.type,
    scope: body.scope,
    value: body.value,
    conditions: body.conditions,
    startsAt: new Date(body.startsAt),
    endsAt: body.endsAt ? new Date(body.endsAt) : null,
    active: body.active,
  };
}

export async function createPromotion(
  storeId: AuthorizedStoreId,
  body: PromotionBody,
): Promise<AdminWriteResult<AdminPromotionRow>> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { businessId: true, ...STORE_CANONICAL_SELECT },
  });
  if (!store) return { kind: "not_found" };

  const issues = await conditionsIssues(storeId, store.businessId, body);
  if (issues.length > 0) return { kind: "invalid_conditions", issues };

  const created = await commit(canonicalOfStore(store), () =>
    prisma.promotion.create({
      data: { storeId, ...promotionWriteData(body) },
      select: PROMOTION_ROW_SELECT,
    }),
  );

  return { kind: "created", value: toAdminPromotionRow(created) };
}

export async function updatePromotion(
  storeId: AuthorizedStoreId,
  promotionId: string,
  body: PromotionBody,
): Promise<AdminWriteResult<AdminPromotionRow>> {
  const existing = await prisma.promotion.findFirst({
    where: { id: promotionId, storeId },
    select: { id: true, store: { select: { businessId: true, ...STORE_CANONICAL_SELECT } } },
  });
  if (!existing) return { kind: "promotion_not_in_store" };

  const issues = await conditionsIssues(storeId, existing.store.businessId, body);
  if (issues.length > 0) return { kind: "invalid_conditions", issues };

  const updated = await commit(canonicalOfStore(existing.store), () =>
    prisma.promotion.update({
      where: { id: existing.id },
      data: promotionWriteData(body),
      select: PROMOTION_ROW_SELECT,
    }),
  );

  return { kind: "saved", value: toAdminPromotionRow(updated) };
}

export async function deletePromotion(
  storeId: AuthorizedStoreId,
  promotionId: string,
): Promise<AdminWriteResult<{ id: string }>> {
  const existing = await prisma.promotion.findFirst({
    where: { id: promotionId, storeId },
    select: { id: true, store: { select: STORE_CANONICAL_SELECT } },
  });
  if (!existing) return { kind: "promotion_not_in_store" };

  await commit(canonicalOfStore(existing.store), () =>
    prisma.promotion.delete({ where: { id: existing.id } }),
  );

  return { kind: "saved", value: { id: existing.id } };
}
