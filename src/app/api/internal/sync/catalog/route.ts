import { NextResponse } from "next/server";
import { guardInternalRequest } from "../../_lib/guard";
import { serializableIssues } from "../../_lib/issues";
import { catalogBatchSchema } from "@/features/sync/schemas";
import { processCatalogBatch } from "@/features/sync/server/processBatch";

export const dynamic = "force-dynamic";

/**
 * Catalog, price and store metadata, delivered from cuadrecaja's outbox.
 *
 * Responds 207 with a per-event result so the POS can mark its outbox rows
 * individually — a partial failure must not force it to replay what already
 * landed. Everything in `ok` is safe to mark done; only `failed` is retried.
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

  const parsed = catalogBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_BATCH", issues: serializableIssues(parsed.error) },
      { status: 400 },
    );
  }

  try {
    const result = await processCatalogBatch(parsed.data.businessId, parsed.data.events);
    return NextResponse.json(result, { status: 207 });
  } catch (error) {
    // The batch itself blew up (database unreachable, say). Report nothing as
    // accepted so the POS retries the whole thing; the inbox makes that safe.
    console.error("[sync/catalog] batch failed", error);
    return NextResponse.json({ error: "BATCH_FAILED" }, { status: 500 });
  }
}
