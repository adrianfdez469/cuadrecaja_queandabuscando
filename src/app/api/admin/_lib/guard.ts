import type { NextResponse } from "next/server";
import { getAdminSession, type AdminSession } from "@/lib/auth/adminSession";
import { authorizeStore, type AuthorizedStoreId } from "@/features/admin/authorization";
import { forbidden, unauthorized } from "./respond";

/**
 * Maps `authorizeStore` to HTTP: 401 without a cookie (E5), 403 on a store
 * outside the session (E4). Gemelo of `api/internal/_lib/guard.ts`. Zero
 * queries: the session already carries `storeIds`.
 */
export type AdminGuardResult =
  | { ok: true; storeId: AuthorizedStoreId; session: AdminSession }
  | { ok: false; response: NextResponse };

export async function guardAdminStore(storeId: string): Promise<AdminGuardResult> {
  const session = await getAdminSession();
  const authorized = authorizeStore(session, storeId);
  if (authorized.ok) return authorized;
  return {
    ok: false,
    response: authorized.denial === "UNAUTHORIZED" ? unauthorized() : forbidden(),
  };
}
