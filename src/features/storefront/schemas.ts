import { isReservedSlug, isWellFormedSlug } from "@/lib/slug";

/**
 * The shape of a PROPOSED slug (F-017, I4) — the registry, and the day the
 * panel edits a slug by hand. This is the "reject" half of derivar/proponer:
 * the sync's `uniqueSlug()` disguises and suffixes instead, because an
 * event must never fail over a local's unfortunate name (E14).
 */
export type SlugProposalRejection = "INVALID_SLUG" | "RESERVED_SLUG";

/**
 * Validates a proposed slug BEFORE any query — criterio 8 requires that
 * creating a brand with `slug: "admin"` fails "por validación, no por un
 * 404 en tiempo de ejecución", with zero database round-trips.
 */
export function assertProposableSlug(candidate: string): SlugProposalRejection | null {
  if (!isWellFormedSlug(candidate)) return "INVALID_SLUG";
  if (isReservedSlug(candidate)) return "RESERVED_SLUG";
  return null;
}
