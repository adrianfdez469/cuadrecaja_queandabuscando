import { NextResponse } from "next/server";
import { guardInternalRequest } from "../_lib/guard";
import { storeReconciliationHash } from "@/features/sync/server/reconciliation";

export const dynamic = "force-dynamic";

/**
 * Nightly reconciliation. Both sides compute the same hash over the same
 * fields; a mismatch means the sync has drifted and that store gets fully
 * resynced. Without this, a broken sync produces no error at all — the data
 * just quietly goes stale, which is the failure mode nobody notices for weeks.
 */
export async function GET(request: Request) {
  const denied = guardInternalRequest(request);
  if (denied) return denied;

  const storeId = new URL(request.url).searchParams.get("storeId");
  if (!storeId) {
    return NextResponse.json({ error: "MISSING_STORE_ID" }, { status: 400 });
  }

  const result = await storeReconciliationHash(storeId);
  if (!result) {
    return NextResponse.json({ error: "UNKNOWN_STORE" }, { status: 404 });
  }

  return NextResponse.json(result);
}
