import { NextResponse } from "next/server";
import { z } from "zod";
import { withInternalAuth } from "../../_lib/guard";
import { serializableIssues } from "../../_lib/issues";
import { setOrderStatus } from "@/features/orders/server/status";

export const dynamic = "force-dynamic";

// F-019 DA6/E19: AWAITING_CUSTOMER stays OUT of this enum on purpose — it is
// the one status only `/orders/proposal` may set (the only action that also
// fixes an `expiresAt`), so it falls through to INVALID_BODY (400) here.
const bodySchema = z.object({
  orderId: z.string().min(1),
  status: z.enum([
    "CONFIRMED",
    "READY",
    "IN_TRANSIT",
    "DELIVERED",
    "CANCELLED",
    "REJECTED_BY_STORE",
  ]),
  reason: z.string().max(500).nullish(),
});

/** The POS reports what happened to an order it pulled. */
export const POST = withInternalAuth(async (request, caller) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_BODY", issues: serializableIssues(parsed.error) },
      { status: 400 },
    );
  }

  let orderId: bigint;
  try {
    orderId = BigInt(parsed.data.orderId);
  } catch {
    return NextResponse.json({ error: "INVALID_ORDER_ID" }, { status: 400 });
  }

  const result = await setOrderStatus({
    businessId: caller.businessId,
    orderId,
    status: parsed.data.status,
    reason: parsed.data.reason ?? null,
  });

  // F-031 DA5/R17: business isolation is `setOrderStatus`'s job (checked
  // BEFORE the quote guard in `classifyZeroRows`) — this route only
  // translates the outcome, never re-derives it.
  if (result.kind === "delivery_not_quoted") {
    return NextResponse.json({ error: "ORDER_DELIVERY_NOT_QUOTED" }, { status: 409 });
  }

  if (result.kind === "unknown_order") {
    return NextResponse.json({ error: "UNKNOWN_ORDER" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
});
