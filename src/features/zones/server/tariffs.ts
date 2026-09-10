import type { PrismaClient } from "@/generated/prisma/client";
import { findZone } from "../catalog";
import { resolveZoneTariff, type ZoneTariffResolution } from "../precedence";

/**
 * F-041 — the minimal reader (architecture.md § Flujo C). Loads the ≤2 rows
 * of a `(store, zoneCode)` that can possibly matter and hands them to the
 * PURE function — never re-implements the precedence here. The level and
 * the province come from the INDEX (`findZone`, zero queries), not from the
 * `Zone` table: that is what keeps this to ONE round trip instead of two,
 * and what keeps the pure function aligned with the vector, whose `zone` is
 * always declared, never looked up.
 */
export type ZoneTariffReader = Pick<PrismaClient, "zoneTariff">;

/** `null` when `zoneCode` is not in the published catalog — the caller
 *  decides what that means (this feature has no reader that calls it with
 *  an unvalidated code; F-042's selector would). */
export async function resolveStoreZoneTariff(
  db: ZoneTariffReader,
  storeId: string,
  zoneCode: string,
): Promise<ZoneTariffResolution | null> {
  const zone = findZone(zoneCode);
  if (!zone) return null;

  const codes = zone.provinceCode ? [zone.code, zone.provinceCode] : [zone.code];
  const rows = await db.zoneTariff.findMany({
    where: { storeId, zoneCode: { in: codes } },
    select: { zoneCode: true, rule: true, deliveryFee: true },
  });

  return resolveZoneTariff(zone, rows);
}
