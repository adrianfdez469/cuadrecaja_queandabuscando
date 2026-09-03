import { prisma } from "@/lib/prisma";
import { revalidateSlugs, revalidateStorefronts, revalidateStores } from "@/lib/cache";
import { canonicalSlug, type PublicSlug } from "@/lib/publicSlug";
import type { Prisma } from "@/generated/prisma/client";
import { extensionForMime } from "@/lib/imageType";
import type { AllowedImageMime, ImageVariantFormat } from "@/constants/media";
import { PANEL_PRODUCT_COLUMNS } from "@/constants/admin";
import { isCanonicalTimeZone } from "@/lib/timezone";
import {
  objectPathOf,
  publicUrlFor,
  removeStoreObjects,
  uploadStoreObjects,
  type UploadObjectInput,
} from "@/lib/supabase/storage";
import { deriveImageVariants, type ImageVariantSet } from "@/lib/imageVariants";
import type { EncodeResult } from "@/lib/imageEncoder";
import { reindexStoreProduct } from "@/features/catalog/server/searchIndex";
import {
  expandBrandTouch,
  regroupStoreIntoBrand,
  type BrandRevalidationSet,
} from "@/features/storefront/server/registry";
import { objectPathFor } from "../storagePaths";
import type { AuthorizedStorefrontId, AuthorizedStoreId } from "../authorization";
import { PRODUCT_ROW_SELECT, toAdminProductRow } from "./products";
import { PROMOTION_ROW_SELECT, toAdminPromotionRow } from "./promotions";
import type {
  AdminBrandingRow,
  AdminProductRow,
  AdminPromotionRow,
  AdminStoreRow,
  AdminWriteResult,
  GroupStoresRow,
  PromotionBody,
  ProductWriteBody,
  StoreStatusBody,
} from "../types";
import type { ThemeTokens } from "@/features/theming/storeTheme";

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
type PanelProductColumn = (typeof PANEL_PRODUCT_COLUMNS)[number];
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
 * F-011 tanda 3 (R31, R35): the ONLY column of `Storefront` the panel writes
 * today. `slug`/`name`/`businessId` are the brand's identity and belong to
 * `features/storefront/server/registry.ts`; contact and the two image
 * columns stay without a writer (HD17, HD19, I15).
 */
type PanelStorefrontColumn = "themeTokens";
type PanelStorefrontWrite = Pick<Prisma.StorefrontUpdateInput, PanelStorefrontColumn>;

/**
 * Gemelo of `commit()` for a BRAND write (R36): revalidates every renderable
 * branch AND the brand itself. Private, like `commit()` — writing branding
 * without revalidating the whole set is not possible without editing this
 * file.
 */
async function commitBrand<T>(touch: BrandRevalidationSet, write: () => Promise<T>): Promise<T> {
  const value = await write();
  revalidateStores(touch.canonicalSlugs);
  revalidateStorefronts(touch.brandSlugs);
  return value;
}

/**
 * F-011 tanda 3 (HD16, R42-R44): `storefrontId` is only ever
 * `AuthorizedStorefrontId` — produced by `authorizeBrandCoverage`, which
 * only succeeds when `session.storeIds` covers EVERY renderable branch.
 * `touch` is only ever a `BrandRevalidationSet` — produced by
 * `expandBrandRevalidation`, from the SAME branches array that authorized
 * the write (R43). Neither can be hand-rolled: both are branded types.
 */
export async function saveBrandTheme(
  storefrontId: AuthorizedStorefrontId,
  touch: BrandRevalidationSet,
  tokens: ThemeTokens, // R33: `parsed.data`, never the raw request body
): Promise<AdminWriteResult<AdminBrandingRow>> {
  try {
    const updated = await commitBrand(touch, () =>
      prisma.storefront.update({
        where: { id: storefrontId },
        // R34: `themeTokensSchema.parse({})` is `{}`, never `null` — there is
        // no code path that could hand this a `null` for a `Json?` column.
        data: { themeTokens: tokens as Prisma.InputJsonObject } satisfies PanelStorefrontWrite,
        select: { id: true, slug: true, themeTokens: true },
      }),
    );

    return {
      kind: "saved",
      value: {
        storefrontId: updated.id,
        brandSlug: updated.slug as PublicSlug,
        themeTokens: tokens,
        branchCount: touch.canonicalSlugs.length,
      },
    };
  } catch (error) {
    if (isRecordNotFound(error)) return { kind: "not_found" };
    throw error;
  }
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
      // `slug` here (not just `id`) is what lets `setStoreEnabled` revalidate
      // every sibling's own slug tag when their brand is multi-branch (§
      // below) — a status flip changes the Badge every cached selector/
      // sibling-list page shows for THIS store, without moving any `Slug`
      // row of its own.
      stores: { where: { status: { not: "DRAFT" } }, select: { id: true, slug: true } },
    },
  },
} satisfies Prisma.StoreSelect;

type StoreCanonicalRef = {
  slug: string | null;
  storefront: { stores: { id: string; slug: string | null }[]; slug: string };
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
      // F-023 R9/R14: the ONE extra column, read so the purge below knows
      // which URLs disappeared — zero extra round-trips (still one `select`).
      imageUrls: true,
      store: { select: STORE_CANONICAL_SELECT },
    },
  });
  if (!existing) return { kind: "product_not_in_store" };
  if (existing.deletedAt) return { kind: "product_deleted" };

  const hasOverride = body.priceOverride !== null;

  // Inlined, not a separately typed `const data`, so the literal object
  // `boundaries.test.ts` greps for (a `data` property with an inline object)
  // is exactly what runs, not a variable reference to one built elsewhere.
  const updated = await commit(canonicalOfStore(existing.store), async () => {
    const row = await prisma.storeProduct.update({
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
    });
    // F-021 (R3, E8): the panel owns `description`, which feeds this
    // offer's own derived search index. Recomputed by reading the row's
    // current state, never by passing text — the panel cannot overwrite
    // `localName` because it never touches it (architecture.md § Decisión).
    await reindexStoreProduct(prisma, row.id);
    return row;
  });

  // F-023 R9/R14: purge AFTER the write and its revalidation — never inside
  // `commit()` — so the window where a cached page still points at a
  // just-deleted object is the smallest it can be. `await`, never `void`
  // (a serverless function's process can end the moment the response goes
  // out, and a loose promise would lose the race the other half of the time).
  const removedUrls = existing.imageUrls.filter((url) => !body.imageUrls.includes(url));
  if (removedUrls.length > 0) {
    await purgeImageUrls(removedUrls);
  }

  return { kind: "saved", value: toAdminProductRow(updated) };
}

/**
 * F-023 R9/R13: best-effort object deletion for every URL a product's
 * `imageUrls` stopped referencing. Never throws and never blocks the caller
 * on a Storage outage — a fresh log line and an orphaned object are the
 * accepted cost (E14), not a failed write.
 *
 * `deriveImageVariants` decides how many objects a URL is worth: four more
 * for a F-023 image (R11 tells them apart from a legacy F-011 object,
 * cheaply, without ever asking the bucket).
 */
async function purgeImageUrls(urls: string[]): Promise<void> {
  const keys: string[] = [];
  for (const url of urls) {
    const variants = deriveImageVariants(url);
    const urlsToRemove = variants
      ? [url, ...variants.avif.map((v) => v.url), ...variants.webp.map((v) => v.url)]
      : [url];
    for (const candidate of urlsToRemove) {
      const path = objectPathOf(candidate);
      // `null` = a URL outside our own bucket (a foreign URL slipped past
      // the schema's `.refine()` some other way, or a pre-F-011 fixture) —
      // nothing of ours to delete.
      if (path) keys.push(path);
    }
  }
  if (keys.length === 0) return;

  const removed = await removeStoreObjects(keys);
  if (!removed.ok) {
    console.error("[admin] failed to purge removed image objects:", removed.reason);
  }
}

export type UploadedImage = {
  bytes: Buffer;
  mime: AllowedImageMime;
  /** F-023: the already-encoded variant set (route.ts runs the encoder
   *  before calling this — R6 wants the codification, the expensive and
   *  most failure-prone step, done BEFORE anything touches Storage). */
  encoded: Extract<EncodeResult, { ok: true }>;
};

/**
 * E20/R6: encode → upload the WHOLE set → THEN write. If the write below
 * fails after the objects are already in the bucket, the result is orphan
 * objects and no broken URL — the safer of the two possible half-failures,
 * same call F-011 made. If ANY of the five uploads fails, the ones that DID
 * land are cleaned up immediately (E2) and `imageUrls` is never touched.
 *
 * Ownership (E24), the soft-delete guard and the E23 image cap are all
 * checked by the caller (`getProductForEdit` in `server/products.ts`)
 * BEFORE the request body is even read, which is what makes the 403 of
 * E24 happen "before reading the file". This function trusts that check
 * and only does the storage writes and the atomic push.
 */
export async function appendProductImage(
  storeId: AuthorizedStoreId,
  storeProductId: string,
  storeSlug: PublicSlug,
  file: UploadedImage,
): Promise<AdminWriteResult<{ url: string; imageUrls: string[]; warning?: "heavy_image" }>> {
  const originalPath = objectPathFor({ storeId, storeProductId, ext: extensionForMime(file.mime) });
  const originalUrl = publicUrlFor(originalPath);
  // `objectPathFor`'s own shape (`<uuid>/original.<ext>`) is exactly what
  // `deriveImageVariants` recognizes — the SAME pure function the tienda
  // uses to render, now run once forward to know what to upload. Never a
  // second, parallel way of naming the four variant objects.
  const variantSet = deriveImageVariants(originalUrl);
  if (!variantSet) {
    console.error(
      "[admin] objectPathFor produced a URL deriveImageVariants could not read:",
      originalUrl,
    );
    return { kind: "storage_unavailable", reason: "rejected" };
  }

  const objects: UploadObjectInput[] = [
    { path: originalPath, bytes: file.bytes, contentType: file.mime },
    ...file.encoded.variants.map((variant) => {
      const url = variantUrl(variantSet, variant.width, variant.format);
      // Guaranteed non-null: `url` was just built from our own bucket prefix.
      const path = objectPathOf(url) as string;
      return { path, bytes: variant.bytes, contentType: variant.contentType };
    }),
  ];

  const uploaded = await uploadStoreObjects(objects);
  if (!uploaded.ok) {
    if (uploaded.uploadedPaths.length > 0) {
      const cleanup = await removeStoreObjects(uploaded.uploadedPaths);
      if (!cleanup.ok) {
        console.error("[admin] failed to clean up a partial image upload:", cleanup.reason);
      }
    }
    return { kind: "storage_unavailable", reason: uploaded.reason };
  }

  const updated = await commit(storeSlug, () =>
    prisma.storeProduct.update({
      where: { id: storeProductId },
      data: { imageUrls: { push: originalUrl } },
      select: { imageUrls: true },
    }),
  );

  return {
    kind: "created",
    value: {
      url: originalUrl,
      imageUrls: updated.imageUrls,
      ...(file.encoded.warning ? { warning: file.encoded.warning } : {}),
    },
  };
}

function variantUrl(
  variantSet: ImageVariantSet,
  width: number,
  format: ImageVariantFormat,
): string {
  const list = format === "avif" ? variantSet.avif : variantSet.webp;
  const match = list.find((v) => v.width === width);
  // `variantSet` is derived from the SAME `src/constants/media.ts` widths and
  // formats the encoder itself uses — this cannot miss.
  if (!match) throw new Error(`No ${format} variant of width ${width} in derived set`);
  return match.url;
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
    // F-022 R12/E5: an unreadable zone must never let a store back into
    // PUBLISHED. Only the `enabled: true` branch reads this — closing below
    // reads nothing new and keeps working always, so a bad zone can never
    // block closing a store (E5).
    if (body.enabled) {
      const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: { timezone: true },
      });
      if (!store) return { kind: "not_found" };
      if (!isCanonicalTimeZone(store.timezone)) return { kind: "invalid_timezone" };
    }
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
    // Etapa 2: a status flip on a branch of a MULTI-branch brand changes
    // what every cached selector page (and every sibling's own
    // `branches[]`-carrying resolution, resolve.ts) shows for THIS store —
    // its Badge, its closure reason — without moving a single `Slug` row.
    // `revalidateStores([canonical])` above only busts THIS store's own
    // catalog tags; the brand's own slug and each sibling's own slug also
    // have to lose their cached resolution, or the selector (and the
    // siblings' /sucursales) keep the stale Badge until the 3600s ISR
    // floor — the same "revalidar solo lo que escribí, no todo lo que
    // cambia de significado" gap `regroupStoreIntoBrand` had (ficha
    // `revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado`).
    if (updated.storefront.stores.length > 1) {
      // `expandBrandTouch` is the ONE place that turns a brand's slug plus
      // its member list into every slug value this status flip might have
      // gone stale on — never hand-rolled here (`boundaries.test.ts` in
      // `features/storefront/server/` backs that with a grep).
      revalidateSlugs(expandBrandTouch(updated.storefront.slug, updated.storefront.stores));
    }
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

/**
 * HS8, etapa 2: agrupar `joiningStoreId` bajo la marca de `primaryStoreId`.
 * Las CINCO escrituras y su orden viven en
 * `features/storefront/server/registry.ts` — el único archivo autorizado a
 * tocar `Slug` (`storefront/server/boundaries.test.ts`) — así que esta
 * función solo autoriza (ya lo hizo el guard del endpoint), revalida y
 * relee la marca resultante para devolver las URL de verdad, no las que
 * prometió la vista previa.
 */
export async function groupStoreIntoBrand(
  primaryStoreId: AuthorizedStoreId,
  joiningStoreId: AuthorizedStoreId,
): Promise<AdminWriteResult<GroupStoresRow>> {
  const result = await regroupStoreIntoBrand({ primaryStoreId, joiningStoreId });
  if (!result.ok) {
    if (result.error === "NOT_FOUND") return { kind: "not_found" };
    return result.error === "DIFFERENT_BUSINESS"
      ? { kind: "different_business" }
      : { kind: "already_in_brand" };
  }

  revalidateStores(result.revalidate.canonicalSlugs);
  revalidateStorefronts(result.revalidate.brandSlugs);
  revalidateSlugs(result.revalidate.slugValues);

  const brand = await prisma.storefront.findUnique({
    where: { id: result.storefrontId },
    select: {
      slug: true,
      stores: {
        where: { status: { not: "DRAFT" } },
        select: { id: true, slug: true },
        orderBy: { name: "asc" },
      },
    },
  });
  // The write above just committed this exact row: it cannot be gone a
  // moment later on the same connection.
  if (!brand) return { kind: "failed" };

  const branchCount = brand.stores.length;
  const branches = brand.stores.map((store) => {
    const slug = canonicalSlug({
      storeSlug: store.slug,
      brandSlug: brand.slug,
      brandBranchCount: branchCount,
    });
    return { storeId: store.id, slug, url: `/${slug}` };
  });

  return {
    kind: "saved",
    value: {
      storefrontId: result.storefrontId,
      brandSlug: brand.slug as PublicSlug,
      branches,
    },
  };
}
