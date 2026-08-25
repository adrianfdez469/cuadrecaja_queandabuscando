import type { Availability } from "@/generated/prisma/enums";

/**
 * Availability presentation.
 *
 * The raw stock integer never crosses the boundary from cuadrecaja — the enum
 * is computed there, against a per-product threshold that lives beside the
 * stock it depends on. So there is nothing to derive here, only to present and
 * to gate ordering on.
 */

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  AVAILABLE: "Disponible",
  LOW_STOCK: "Pocas unidades",
  OUT_OF_STOCK: "Agotado",
};

export type AvailabilityTone = "positive" | "warning" | "muted";

export const AVAILABILITY_TONE: Record<Availability, AvailabilityTone> = {
  AVAILABLE: "positive",
  LOW_STOCK: "warning",
  OUT_OF_STOCK: "muted",
};

export function isOrderable(availability: Availability): boolean {
  return availability !== "OUT_OF_STOCK";
}

/**
 * Whether the badge is worth rendering at all. Showing "Disponible" on every
 * card is noise; the shopper only needs to be told when something is scarce.
 */
export function shouldShowBadge(availability: Availability): boolean {
  return availability !== "AVAILABLE";
}
