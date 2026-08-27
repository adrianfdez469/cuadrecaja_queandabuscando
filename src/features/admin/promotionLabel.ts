import type { AdminPromotionRow } from "./types";

/**
 * Pure presentation helpers for the promotions listing (design.md § 5). No
 * Prisma — the page resolves category names once and passes the map in.
 */

export type PromotionStatus = "vigente" | "programada" | "vencida" | "inactiva";

export function promotionStatus(promo: AdminPromotionRow, now: Date): PromotionStatus {
  if (!promo.active) return "inactiva";
  const startsAt = new Date(promo.startsAt).getTime();
  if (startsAt > now.getTime()) return "programada";
  if (promo.endsAt && new Date(promo.endsAt).getTime() <= now.getTime()) return "vencida";
  return "vigente";
}

export const PROMOTION_STATUS_LABEL: Record<PromotionStatus, string> = {
  vigente: "Vigente",
  programada: "Programada",
  vencida: "Vencida",
  inactiva: "Inactiva",
};

export const PROMOTION_STATUS_TONE: Record<PromotionStatus, "positive" | "warning" | "muted"> = {
  vigente: "positive",
  programada: "warning",
  vencida: "muted",
  inactiva: "muted",
};

function amountLabel(promo: AdminPromotionRow, currencyCode: string): string {
  return promo.type === "PERCENTAGE" ? `${promo.value} %` : `−${promo.value} ${currencyCode}`;
}

/** The derived label the row falls back to when the admin left `name` empty. */
export function derivedPromotionLabel(
  promo: AdminPromotionRow,
  currencyCode: string,
  categoryNames: Map<string, string>,
): string {
  const amount = amountLabel(promo, currencyCode);
  const conditions = promo.conditions as Record<string, unknown> | null;

  if (promo.scope === "PRODUCT") {
    const ids = Array.isArray(conditions?.storeProductIds) ? conditions.storeProductIds : [];
    return `${amount} en ${ids.length} producto${ids.length === 1 ? "" : "s"}`;
  }
  if (promo.scope === "CATEGORY") {
    const ids = Array.isArray(conditions?.localCategoryIds)
      ? (conditions.localCategoryIds as string[])
      : [];
    const names = ids.map((id) => categoryNames.get(id) ?? "?").join(", ");
    return `${amount} en ${names || "categorías"}`;
  }
  const minSubtotal = typeof conditions?.minSubtotal === "string" ? conditions.minSubtotal : null;
  return minSubtotal
    ? `${amount} en pedidos de más de $${minSubtotal}`
    : `${amount} en todo el pedido`;
}
