import { NextResponse } from "next/server";
import { expireProposalsQuery } from "@/features/orders/server/expiry";
import { verifyCronSecret } from "../_lib/guard";

export const dynamic = "force-dynamic";

/**
 * The daily safety net (architecture.md § "El reloj", DA5). Runs the SAME
 * barrido `pullOrders` runs on every pull, but with no `businessId` — every
 * business, not only ones that happen to poll. The pull is what keeps
 * `AWAITING_CUSTOMER` fresh in practice (every ~2 minutes); this exists for
 * a store that stops pulling altogether.
 */
export async function GET(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  const expired = await expireProposalsQuery();
  return NextResponse.json({ expired: Number(expired) });
}
