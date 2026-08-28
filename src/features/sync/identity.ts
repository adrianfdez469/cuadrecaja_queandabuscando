import type { SyncEventInput } from "./schemas";

/**
 * Coherence checks between the caller's authenticated identity and the
 * `businessId` the payload still carries (R5, E14). Pure: no Prisma, no
 * React. Called from the route, BEFORE any write — a mismatch aborts the
 * whole batch (R5), so no `SyncEvent` row is ever left for a retry to report
 * as `duplicate` (AGENTS.md § «Un evento fallido NO es un duplicado»).
 *
 * The `businessId` in the wire payload never disappears (the Zod schemas do
 * not change): it becomes redundant-and-checked instead of authoritative.
 */

/**
 * Returns the path of the first field that does not match, or `null` if the
 * whole batch is coherent with the caller. The mismatched VALUE is never
 * returned to the caller — the 403 body is fixed (`BUSINESS_MISMATCH`).
 */
export function findCatalogMismatch(
  callerExternalId: string,
  batch: { businessId: string; events: SyncEventInput[] },
): string | null {
  if (batch.businessId !== callerExternalId) return "businessId";

  for (let i = 0; i < batch.events.length; i += 1) {
    const event = batch.events[i];
    // CURRENCY does not carry a businessId at all — nothing to check.
    if ("businessId" in event.payload && event.payload.businessId !== callerExternalId) {
      return `events[${i}].payload.businessId`;
    }
  }

  return null;
}

export function findAvailabilityMismatch(
  callerExternalId: string,
  batch: { businessId: string },
): string | null {
  return batch.businessId !== callerExternalId ? "businessId" : null;
}
