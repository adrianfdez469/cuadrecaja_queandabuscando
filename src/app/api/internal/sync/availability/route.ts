import { NextResponse } from "next/server";
import { guardInternalRequest } from "../../_lib/guard";
import { availabilityBatchSchema } from "@/features/sync/schemas";
import { applyAvailability } from "@/features/sync/server/availability";

export const dynamic = "force-dynamic";

/**
 * Stock availability, as a three-value enum. The raw stock integer never
 * crosses the boundary — businesses do not expose their inventory, and selling
 * 3 of 40 units produces no event at all because the enum did not change.
 *
 * The POS finds the work with a convergent query against its own
 * `dispPublicada` column, so there is no cursor to lose data through. It
 * confirms only what this endpoint reports back in `confirmed`.
 */
export async function POST(request: Request) {
  const denied = guardInternalRequest(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = availabilityBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_BATCH", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await applyAvailability(parsed.data.items);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[sync/availability] batch failed", error);
    return NextResponse.json({ error: "BATCH_FAILED" }, { status: 500 });
  }
}
