import { NextResponse } from "next/server";
import { withInternalAuth } from "../../_lib/guard";
import { mintRealtimeCredential, subscriptionAvailability } from "@/lib/realtime/subscriptionToken";

export const dynamic = "force-dynamic";

/**
 * The credential a POS needs to subscribe to its own bell channel (F-020,
 * architecture.md DA5, spec E18). Wrapped in `withInternalAuth`, the SAME
 * envelope every other `/api/internal/*` route uses — not a new
 * authentication scheme: the `businessId` comes from the bearer's hash,
 * NEVER from anything the client sends (there is no body to send it in).
 *
 * `POST`, not `GET`: minting a credential is an action, and a URL that
 * returns a token should never risk sitting in a cache or a proxy's log.
 */
export const POST = withInternalAuth(async (_request, caller) => {
  const availability = subscriptionAvailability();
  if (!availability.ok) {
    // ADR 0002: this is the OTHER route the credential can be missing
    // through — the POS asked and got told "not configured", never a
    // silent 200 with a token that would not verify against anything. R9:
    // whoever hits this keeps working off the cron, same as before F-020.
    console.error("[realtime] credential not minted", {
      businessId: caller.businessId,
      reason: availability.reason,
    });
    return NextResponse.json({ error: "REALTIME_NOT_CONFIGURED" }, { status: 503 });
  }

  const credential = await mintRealtimeCredential(caller.businessId);
  return NextResponse.json(credential, { status: 200 });
});
