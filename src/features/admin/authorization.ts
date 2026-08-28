import { canManageStore, type AdminSession } from "@/lib/auth/adminSession";

/**
 * The single place the panel decides who may act on a store.
 *
 * Pure: no Prisma, no `fetch`, no cookies. `authorizeStore` wraps
 * `canManageStore` (R1, R2 — the session, not `AdminStoreAccess`, is the
 * source of truth) and hands back a *branded* store id that only this
 * function can produce. Every mutation in `server/mutations.ts` requires
 * that brand by signature, so writing without authorizing does not compile.
 */
declare const authorizedBrand: unique symbol;
export type AuthorizedStoreId = string & { readonly [authorizedBrand]: true };

export type AdminDenial = "UNAUTHORIZED" | "FORBIDDEN";

export type AuthorizeResult =
  | { ok: true; storeId: AuthorizedStoreId; session: AdminSession }
  | { ok: false; denial: AdminDenial };

/**
 * `null` session → `UNAUTHORIZED` (401 in the API, redirect on the page —
 * already handled by `src/app/admin/layout.tsx`).
 * A session that cannot manage `storeId` → `FORBIDDEN` (403 in the API,
 * `notFound()` on the page — R7).
 */
export function authorizeStore(session: AdminSession | null, storeId: string): AuthorizeResult {
  if (!session) return { ok: false, denial: "UNAUTHORIZED" };
  if (!canManageStore(session, storeId)) return { ok: false, denial: "FORBIDDEN" };
  return { ok: true, storeId: storeId as AuthorizedStoreId, session };
}

/**
 * F-011 tanda 3 (HD16/R42): a `storefrontId` whose branding may be edited —
 * every one of its RENDERABLE branches is in `session.storeIds`. Not a
 * second path of authorization: the same module, `canManageStore` reused
 * unchanged, and a second branded type the mutation exigirá por firma.
 */
declare const brandAuthorized: unique symbol;
export type AuthorizedStorefrontId = string & { readonly [brandAuthorized]: true };

/** A renderable branch, as `loadBrandingTarget` reads it — only what the
 *  screen (E40b) may show about one this admin does NOT manage. */
export type CoverageBranch = { id: string; name: string; city: string | null };

export type BrandCoverageResult =
  | { ok: true; storefrontId: AuthorizedStorefrontId }
  | {
      ok: false;
      denial: "FORBIDDEN";
      /** Never `storeId` (HS12): the panel cannot build a link or a form
       *  toward a branch its own session does not cover. */
      missing: readonly { name: string; city: string | null }[];
    };

/**
 * Pure, zero queries: `session` already proved a request came from an
 * authenticated admin (the caller ran `guardAdminStore` first), so this only
 * asks whether that session's `storeIds` covers EVERY branch it was handed.
 * An empty `branches` array (a brand with no renderable branch yet) is `ok`
 * — R42 is about coverage, not about there being anything to cover.
 */
export function authorizeBrandCoverage(
  session: AdminSession,
  brand: { storefrontId: string; branches: readonly CoverageBranch[] },
): BrandCoverageResult {
  const missing = brand.branches.filter((branch) => !canManageStore(session, branch.id));
  if (missing.length > 0) {
    return {
      ok: false,
      denial: "FORBIDDEN",
      missing: missing.map(({ name, city }) => ({ name, city })),
    };
  }
  return { ok: true, storefrontId: brand.storefrontId as AuthorizedStorefrontId };
}
