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
