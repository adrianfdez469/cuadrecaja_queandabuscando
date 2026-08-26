import { NextResponse } from "next/server";
import { z } from "zod";
import { guardInternalRequest } from "../_lib/guard";
import { serializableIssues } from "../_lib/issues";
import { pullOrders } from "@/features/orders/server/pull";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  since: z.coerce.bigint().nonnegative().default(0n),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** The POS pulls new orders. Nothing here ever calls out to cuadrecaja. */
export async function GET(request: Request) {
  const denied = guardInternalRequest(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    since: url.searchParams.get("since") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_QUERY", issues: serializableIssues(parsed.error) },
      { status: 400 },
    );
  }

  try {
    const result = await pullOrders(parsed.data.since, parsed.data.limit);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[internal/orders] pull failed", error);
    return NextResponse.json({ error: "PULL_FAILED" }, { status: 500 });
  }
}
