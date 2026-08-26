/**
 * Contact normalization.
 *
 * Pure and reused on both sides of the checkout: the server schema calls it
 * before persisting (spec § «Cómo se llenan Order y OrderItem»: "normalizados
 * y recortados"), and it is what R30 compares to count PENDING orders per
 * phone. F-012 will reuse it for the account's saved contact.
 */

/** Trims and collapses internal whitespace, so "Ana   Pérez " -> "Ana Pérez". */
export function normalizeName(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

/**
 * Keeps a leading `+` (if present) and strips everything but digits from the
 * rest, so "+53 5555-5555" and "+53 5555 5555" normalize to the same value —
 * which is what makes the R30 window count the same person once.
 */
export function normalizePhone(input: string): string {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return hasPlus ? `+${digits}` : digits;
}
