import { NextResponse } from "next/server";
import { z } from "zod";
import { guardInternalRequest } from "../../_lib/guard";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(["CONFIRMED", "READY", "DELIVERED", "CANCELLED"]),
  reason: z.string().max(500).nullish(),
});

/** The POS reports what happened to an order it pulled. */
export async function POST(request: Request) {
  const denied = guardInternalRequest(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_BODY", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  let orderId: bigint;
  try {
    orderId = BigInt(parsed.data.orderId);
  } catch {
    return NextResponse.json({ error: "INVALID_ORDER_ID" }, { status: 400 });
  }

  const updated = await prisma.order.updateMany({
    where: { id: orderId },
    data: {
      status: parsed.data.status,
      cancelReason: parsed.data.reason ?? null,
    },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "UNKNOWN_ORDER" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
