import { NextResponse } from "next/server";
import { z } from "zod";
import { withInternalAuth } from "../../_lib/guard";
import { serializableIssues } from "../../_lib/issues";
import { setOrderStatus } from "@/features/orders/server/status";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(["CONFIRMED", "READY", "DELIVERED", "CANCELLED"]),
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

  if (!result.ok) {
    return NextResponse.json({ error: "UNKNOWN_ORDER" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
});
