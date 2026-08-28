import { NextResponse } from "next/server";
import { withInternalAuth } from "../../_lib/guard";
import { serializableIssues } from "../../_lib/issues";
import { catalogBatchSchema } from "@/features/sync/schemas";
import { processCatalogBatch } from "@/features/sync/server/processBatch";
import { findCatalogMismatch } from "@/features/sync/identity";

export const dynamic = "force-dynamic";

/**
 * Catalog, price and store metadata, delivered from cuadrecaja's outbox.
 *
 * Responds 207 with a per-event result so the POS can mark its outbox rows
 * individually — a partial failure must not force it to replay what already
 * landed. Everything in `ok` is safe to mark done; only `failed` is retried.
 *
 * F-018 (R5, E14): a `businessId` in the body (root or any event payload
 * that carries one) that does not match the authenticated caller aborts the
 * WHOLE batch with 403 before `processCatalogBatch` — and so before
 * `recordBatch` — ever runs. No `SyncEvent` row is left for a retry to
 * report back as `duplicate`.
 */
export const POST = withInternalAuth(async (request, caller) => {
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

  if (findCatalogMismatch(caller.externalId, parsed.data)) {
    return NextResponse.json({ error: "BUSINESS_MISMATCH" }, { status: 403 });
  }

  try {
    const result = await processCatalogBatch(caller, parsed.data.events);
    return NextResponse.json(result, { status: 207 });
  } catch (error) {
    // The batch itself blew up (database unreachable, say). Report nothing as
    // accepted so the POS retries the whole thing; the inbox makes that safe.
    console.error("[sync/catalog] batch failed", error);
    return NextResponse.json({ error: "BATCH_FAILED" }, { status: 500 });
  }
});
