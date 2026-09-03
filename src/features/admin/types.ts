import type { Availability, StoreStatus } from "@/generated/prisma/enums";
import type { StorageFailureReason as LibStorageFailureReason } from "@/lib/supabase/storage";
import type { PublicSlug } from "@/lib/publicSlug";
import type { ThemeTokens } from "@/features/theming/storeTheme";

/**
 * Wire types for the admin panel.
 *
 * Only the product/image shapes this cycle needs — promotions arrive in the
 * next one (`impl.md` § Desviaciones anota por qué). `AdminWriteResult` is
 * the shared shape every write in `server/mutations.ts` returns; the route
 * handlers under `app/api/admin/` map it to HTTP and nothing else does.
 */

export type AdminStoreListItem = {
  id: string;
  /** F-017: the CANONICAL public slug — never `Store.slug` directly, which
   *  is nullable and, in this stage, always empty for a brand-new store. */
  canonicalSlug: PublicSlug;
  name: string;
  status: StoreStatus;
  city: string | null;
  address: string | null;
  disabledReasonCode: string | null;
  disabledMessage: string | null;
  disabledAt: string | null;
};

/** What `setStoreEnabled` returns and the switch's endpoint sends back. */
export type AdminStoreRow = {
  id: string;
  canonicalSlug: PublicSlug;
  status: StoreStatus;
  disabledReasonCode: string | null;
  disabledMessage: string | null;
  disabledAt: string | null;
};

/** Discriminated by `enabled`, mirroring the Zod schema (HD14). */
export type StoreStatusBody =
  { enabled: true } | { enabled: false; reasonCode: string; message: string | null };

/** What `POST /api/admin/stores/{storeId}/branches` accepts (HS8, etapa 2):
 *  the store id — from `session.storeIds`, authorized separately from the
 *  one in the route (architecture.md § La forma). */
export type GroupStoresBody = { joiningStoreId: string };

/** One row of what `groupStoreIntoBrand` returns — the URL a shopper (or a
 *  QR) actually reaches, never a promise computed apart from the write. */
export type GroupStoresBranch = { storeId: string; slug: PublicSlug; url: string };

export type GroupStoresRow = {
  storefrontId: string;
  brandSlug: PublicSlug;
  branches: GroupStoresBranch[];
};

/** DP2/HS12: a sibling branch of the admin's OWN brand that this admin does
 *  NOT manage — name and city only, and DELIBERATELY no `storeId`: the panel
 *  cannot build a link or a form out of this even if someone tries later. */
export type BrandBranch = {
  name: string;
  city: string | null;
  canonicalSlug: PublicSlug;
  status: StoreStatus;
};

/** A candidate for `GroupStoresForm`'s radios — always a store the admin
 *  already manages (`session.storeIds`), so a `storeId` here is fine. */
export type GroupCandidate = {
  id: string;
  name: string;
  city: string | null;
  canonicalSlug: PublicSlug;
};

export type AdminProductRow = {
  id: string;
  slug: string;
  localName: string;
  categoryName: string | null;
  availability: Availability;
  syncedAt: string;
  deletedAt: string | null;
  syncedPrice: string;
  syncedPriceCurrency: string;
  description: string | null;
  imageUrls: string[];
  priceOverride: string | null;
  priceOverrideCurrency: string | null;
  visible: boolean;
  featured: boolean;
};

/** What the isla sends. `priceOverrideCurrency` is never accepted from the
 *  client (R14): the server sets it to the product's `syncedPriceCurrency`. */
export type ProductWriteBody = {
  description: string | null;
  imageUrls: string[];
  priceOverride: string | null;
  visible: boolean;
  featured: boolean;
};

/** Alias of the shared shape in `@/lib/supabase/storage` (AGENTS.md: no duplicate interfaces). */
export type StorageFailureReason = LibStorageFailureReason;

/**
 * F-011 tanda 3. What `PUT /api/admin/stores/{storeId}/branding` accepts —
 * `ThemeTokens` imported from theming, never a second declaration of the
 * same five keys (AGENTS.md: no duplicate interfaces; R32/criterio 16).
 */
export type BrandingBody = ThemeTokens;

/** What a branding write returns. `branchCount` does not leak anything: only
 *  an admin who already covers every one of those branches (HD16) receives it. */
export type AdminBrandingRow = {
  storefrontId: string;
  brandSlug: PublicSlug;
  themeTokens: ThemeTokens;
  branchCount: number;
};

/** HD3/PP3. Read shape for the panel's promotions screens. */
export type AdminPromotionRow = {
  id: string;
  name: string | null;
  type: "PERCENTAGE" | "FIXED";
  scope: "PRODUCT" | "CATEGORY" | "ORDER";
  value: string;
  conditions: unknown;
  startsAt: string;
  endsAt: string | null;
  active: boolean;
};

/** Discriminated by `scope`, mirroring `promotionBodySchema` (R30). */
export type PromotionBody = {
  name: string | null;
  type: "PERCENTAGE" | "FIXED";
  value: string;
  startsAt: string;
  endsAt: string | null;
  active: boolean;
} & (
  | { scope: "PRODUCT"; conditions: { storeProductIds: string[] } }
  | { scope: "CATEGORY"; conditions: { localCategoryIds: string[] } }
  | { scope: "ORDER"; conditions: { minSubtotal: string | null } }
);

/**
 * Every mutation in `server/mutations.ts` resolves to one of these.
 *
 * `"created"` carries only `value` — this cycle's one creator is the image
 * upload, whose resource has no `id` distinct from its URL. `architecture.md`
 * sketches `{ kind: "created"; id: string; value: T }` for the promotions
 * that arrive in the next cycle; whoever adds them decides then whether `id`
 * belongs at this level or inside `value` (see `impl.md` § Desviaciones).
 */
export type AdminWriteResult<T> =
  | { kind: "saved"; value: T }
  | { kind: "created"; value: T }
  | { kind: "product_not_in_store" } // -> 403 (E19)
  | { kind: "product_deleted" } // -> 409: a soft-deleted product is not editable
  | { kind: "too_many_images" } // -> 409 (E23)
  | { kind: "promotion_not_in_store" } // -> 403 (E33)
  | { kind: "invalid_conditions"; issues: { path: (string | number)[]; message: string }[] } // -> 400 (R30)
  | { kind: "storage_unavailable"; reason: StorageFailureReason } // -> 503 (E25)
  | { kind: "not_found" } // -> 404: the authorized store was deleted mid-session
  | { kind: "different_business" } // -> 409 (HS8): grouping across businesses
  | { kind: "already_in_brand" } // -> 409 (HS8): nothing to do
  | { kind: "invalid_timezone" } // -> 409 (F-022 E5, R12): the store's zone is unreadable
  | { kind: "failed" }; // -> 500
