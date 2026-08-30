import { NextResponse } from "next/server";
import { withInternalAuth } from "../../_lib/guard";
import { serializableIssues } from "../../_lib/issues";
import { proposeOrderChangeSchema } from "@/features/orders/schemas";
import { proposeOrderChange } from "@/features/orders/server/proposal";

export const dynamic = "force-dynamic";

/**
 * The store proposes a change (architecture.md DA2, E1/E4). Internal —
 * `withInternalAuth`, the same envelope as `/orders/status` and the pull:
 * machine-to-machine only, excluded from robots.txt, never reachable with a
 * browser session.
 */
export const POST = withInternalAuth(async (request, caller) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = proposeOrderChangeSchema.safeParse(body);
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

  const result = await proposeOrderChange({
    businessId: caller.businessId,
    orderId,
    currencyCode: parsed.data.currencyCode,
    subtotal: parsed.data.subtotal,
    discountTotal: parsed.data.discountTotal,
    deliveryFee: parsed.data.deliveryFee,
    total: parsed.data.total,
    message: parsed.data.message ?? null,
    items: parsed.data.items,
  });

  switch (result.kind) {
    case "proposed":
      return NextResponse.json({
        ok: true,
        status: "AWAITING_CUSTOMER",
        expiresAt: result.expiresAt.toISOString(),
        currencyCode: result.currencyCode,
        previousTotal: result.previousTotal,
        proposedTotal: result.proposedTotal,
        orderUrl: result.orderUrl,
        customerWhatsappUrl: result.customerWhatsappUrl,
        customerWhatsappReason: result.customerWhatsappReason,
      });
    case "unknown_order":
      return NextResponse.json({ error: "UNKNOWN_ORDER" }, { status: 404 });
    case "currency_mismatch":
      return NextResponse.json({ error: "CURRENCY_MISMATCH" }, { status: 400 });
    case "not_proposable":
      return NextResponse.json(
        { error: "ORDER_NOT_PROPOSABLE", status: result.status },
        { status: 409 },
      );
    case "failed":
      return NextResponse.json({ error: "PROPOSAL_FAILED" }, { status: 500 });
  }
});
