import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  expireProposalsQuery,
  expireUnquotedDeliveryOrdersQuery,
} from "@/features/orders/server/expiry";
import { verifyCronSecret } from "../_lib/guard";

export const dynamic = "force-dynamic";

/**
 * The daily safety net (architecture.md § "El reloj", DA5). Runs the SAME
 * two barridos `pullOrders` runs on every pull, but with no `businessId` —
 * every business, not only ones that happen to poll. The pull is what keeps
 * `AWAITING_CUSTOMER` (and, since F-031, the pedido sin cotizar) fresh in
 * practice; this exists for a store that stops pulling altogether.
 *
 * F-031 DA4: both queries share ONE `$transaction([...])` in array form (a
 * single round-trip, never the interactive callback — the pooler runs in
 * transaction mode, ficha `pooler-transaccion-deadlock`). `expired` keeps
 * meaning exactly what it meant before this feature; `expiredUnquotedDelivery`
 * is the new key.
 */
export async function GET(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  const [expired, expiredUnquotedDelivery] = await prisma.$transaction([
    expireProposalsQuery(),
    expireUnquotedDeliveryOrdersQuery(),
  ]);
  return NextResponse.json({
    expired: Number(expired),
    expiredUnquotedDelivery: Number(expiredUnquotedDelivery),
  });
}
