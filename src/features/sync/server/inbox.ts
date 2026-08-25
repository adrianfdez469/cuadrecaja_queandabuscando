import { prisma } from "@/lib/prisma";
import type { SyncEventInput } from "../schemas";

/**
 * Inbox pattern.
 *
 * Idempotency is by `eventId` — the id of the row in cuadrecaja's OutboxEvento.
 * Recording the whole batch first, with skipDuplicates, means resending a batch
 * is free and the POS can retry without coordination.
 */

export type RecordedBatch = {
  /** Events to apply now, in the order they should be applied. */
  fresh: SyncEventInput[];
  /** Events already applied on a previous delivery. */
  duplicateIds: string[];
};

export async function recordBatch(
  businessId: string,
  events: SyncEventInput[],
): Promise<RecordedBatch> {
  const existing = await prisma.syncEvent.findMany({
    where: { eventId: { in: events.map((e) => e.eventId) } },
    select: { eventId: true, status: true },
  });

  /**
   * Only a settled event counts as a duplicate.
   *
   * An event recorded but left FAILED (its handler threw) or PENDING (the
   * process died mid-batch) must be reprocessed. Treating those as duplicates
   * would report them back in `ok`, the POS would mark its outbox row done, and
   * the update would be lost permanently with nothing anywhere reporting an
   * error. Retrying is safe: every handler is idempotent and guarded against
   * stale writes.
   */
  const settled = new Set(
    existing
      .filter((row) => row.status === "PROCESSED" || row.status === "SKIPPED")
      .map((row) => row.eventId),
  );
  const recorded = new Set(existing.map((row) => row.eventId));

  const fresh = events.filter((event) => !settled.has(event.eventId));
  const unrecorded = fresh.filter((event) => !recorded.has(event.eventId));

  if (unrecorded.length > 0) {
    await prisma.syncEvent.createMany({
      data: unrecorded.map((event) => ({
        eventId: event.eventId,
        businessId,
        entity: event.entity,
        operation: event.operation,
        occurredAt: new Date(event.occurredAt),
        payload: event.payload as object,
      })),
      skipDuplicates: true,
    });
  }

  // Apply in causal order. Out-of-order delivery is still safe thanks to the
  // stale-write guard, but sorting keeps the common case cheap.
  fresh.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  return { fresh, duplicateIds: [...settled] };
}

export async function markProcessed(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;
  await prisma.syncEvent.updateMany({
    where: { eventId: { in: eventIds } },
    data: { status: "PROCESSED", processedAt: new Date() },
  });
}

export async function markSkipped(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;
  await prisma.syncEvent.updateMany({
    where: { eventId: { in: eventIds } },
    data: { status: "SKIPPED", processedAt: new Date() },
  });
}

export async function markFailed(failures: { eventId: string; error: string }[]): Promise<void> {
  // Left as FAILED on purpose: recordBatch re-picks these on the next delivery.
  // One update per failure, but failures are rare by construction.
  await Promise.all(
    failures.map((failure) =>
      prisma.syncEvent.updateMany({
        where: { eventId: failure.eventId },
        data: { status: "FAILED", error: failure.error.slice(0, 500) },
      }),
    ),
  );
}
