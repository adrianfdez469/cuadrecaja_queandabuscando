import { prisma } from "@/lib/prisma";
import type { AuthorizedStoreId } from "../authorization";
import type { AdminPromotionRow } from "../types";

/** Read side of the panel's promotions screens. Writes live in `server/mutations.ts`. */

export const PROMOTION_ROW_SELECT = {
  id: true,
  name: true,
  type: true,
  scope: true,
  value: true,
  conditions: true,
  startsAt: true,
  endsAt: true,
  active: true,
} as const;

type PromotionRecord = {
  id: string;
  name: string | null;
  type: "PERCENTAGE" | "FIXED";
  scope: "PRODUCT" | "CATEGORY" | "ORDER";
  value: { toString(): string };
  conditions: unknown;
  startsAt: Date;
  endsAt: Date | null;
  active: boolean;
};

export function toAdminPromotionRow(row: PromotionRecord): AdminPromotionRow {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    scope: row.scope,
    value: row.value.toString(),
    conditions: row.conditions,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    active: row.active,
  };
}

export async function listPromotions(storeId: AuthorizedStoreId): Promise<AdminPromotionRow[]> {
  const rows = await prisma.promotion.findMany({
    where: { storeId },
    orderBy: [{ active: "desc" }, { startsAt: "desc" }],
    select: PROMOTION_ROW_SELECT,
  });
  return rows.map(toAdminPromotionRow);
}

export type PromotionLookup = { ok: true; row: AdminPromotionRow } | { ok: false };

/** E33's 403: a promotion that does not belong to `storeId` is indistinguishable from missing. */
export async function getPromotion(
  storeId: AuthorizedStoreId,
  promotionId: string,
): Promise<PromotionLookup> {
  const row = await prisma.promotion.findFirst({
    where: { id: promotionId, storeId },
    select: PROMOTION_ROW_SELECT,
  });
  return row ? { ok: true, row: toAdminPromotionRow(row) } : { ok: false };
}
