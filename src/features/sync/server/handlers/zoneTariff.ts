import { prisma } from "@/lib/prisma";
import { canonicalSlug } from "@/lib/publicSlug";
import { isRetiredZone } from "@/features/zones/catalog";
import { ZONE_TARIFF_DELETE_NOT_SUPPORTED } from "@/constants/sync";
import type { ZoneTariffPayload } from "../../schemas";
import { SKIPPED, STALE, SyncEventFailure, type HandlerOutcome } from "./types";

/**
 * F-041 — the `ZONE_TARIFF` handler (architecture.md § Flujo A).
 *
 * Four steps, in this order and no other, each with its reason written:
 *
 *   1. `operation === "DELETE"` -> `ZONE_TARIFF_DELETE_NOT_SUPPORTED`, BEFORE
 *      any query and before the anti-stale guard (R20). Same order as
 *      `handleBusiness`'s `BUSINESS_DELETE_NOT_SUPPORTED`, the OPPOSITE of
 *      `handleCategory`'s (a format error cannot depend on a timestamp, E5)
 *      — and what closes the resurrection hole `CATEGORY` leaves open: once
 *      a delete is impossible, there is never a missing mark to resurrect.
 *   2. The branch, in ONE query with its own tariff row nested in the same
 *      `select` (precedent: `handleProduct`). `SKIPPED` when it does not
 *      exist or belongs to another business (R24) — terminal, so it travels
 *      in `ok`.
 *   3. The guard that REJECTS (`>=` -> `STALE`), never the ORDER form of
 *      `EXCHANGE_RATE` — this table is not append-only (R21).
 *   4. The upsert, and only THEN the canonical slug. `SKIPPED`/`STALE`/a
 *      thrown failure never call `canonicalSlug` — it does not invalidate
 *      anything on those paths (R25) and it THROWS for a branch of a
 *      multi-branch brand with no `slug` of its own
 *      (`src/lib/publicSlug.ts`), which a discarded event must never turn
 *      into a `failed[]` (caso límite 11).
 *
 * R19/E10: a retired zone still resolves and still accepts a tariff — the
 * warning is `console.warn("[sync] …")`, never `console.error`
 * (`.agent/playbook/console-error-dispara-guardian-servidor.md`), and it is
 * read from the INDEX, zero extra queries.
 */
export async function handleZoneTariff(
  payload: ZoneTariffPayload,
  operation: "CREATE" | "UPDATE" | "DELETE",
  businessId: string,
): Promise<HandlerOutcome> {
  // 1. R20 — first, before any query.
  if (operation === "DELETE") {
    console.warn("[sync] ZONE_TARIFF event rejected: DELETE is not an operation of this entity", {
      businessId,
      storeId: payload.storeId,
      zoneCode: payload.zoneCode,
    });
    throw new SyncEventFailure(ZONE_TARIFF_DELETE_NOT_SUPPORTED);
  }

  // 2. The branch, one query, its tariff row nested — calcado de
  //    `handleProduct` (`src/features/sync/server/handlers/product.ts`).
  const store = await prisma.store.findUnique({
    where: { externalId: payload.storeId },
    select: {
      id: true,
      businessId: true,
      slug: true,
      storefront: {
        select: {
          slug: true,
          stores: { where: { status: { not: "DRAFT" } }, select: { id: true, slug: true } },
        },
      },
      zoneTariffs: { where: { zoneCode: payload.zoneCode }, select: { sourceUpdatedAt: true } },
    },
  });

  if (!store || store.businessId !== businessId) return SKIPPED;

  // R19/E10: a retired zone is still known and still resolves; only warn.
  if (isRetiredZone(payload.zoneCode)) {
    console.warn("[sync] ZONE_TARIFF targets a retired zone — accepted, still resolvable", {
      zoneCode: payload.zoneCode,
    });
  }

  const payloadUpdatedAt = new Date(payload.updatedAt);
  const existing = store.zoneTariffs[0];

  // 3. R21 — reject-and-STALE, by (storeId, zoneCode). NOT the ORDER form of
  //    EXCHANGE_RATE: this table is not append-only.
  if (existing && existing.sourceUpdatedAt.getTime() >= payloadUpdatedAt.getTime()) {
    return STALE;
  }

  // 4. The upsert. `rule === "FEE"` is the only branch with a `deliveryFee`
  //    (the discriminated union already guarantees this in TypeScript); the
  //    other two write `null`, which is what retracts a previous FEE (R20).
  const deliveryFee = payload.rule === "FEE" ? payload.deliveryFee : null;

  await prisma.zoneTariff.upsert({
    where: { storeId_zoneCode: { storeId: store.id, zoneCode: payload.zoneCode } },
    create: {
      storeId: store.id,
      zoneCode: payload.zoneCode,
      rule: payload.rule,
      deliveryFee,
      sourceUpdatedAt: payloadUpdatedAt,
    },
    update: {
      rule: payload.rule,
      deliveryFee,
      sourceUpdatedAt: payloadUpdatedAt,
    },
  });

  const canonical = canonicalSlug({
    storeSlug: store.slug,
    brandSlug: store.storefront.slug,
    brandBranchCount: store.storefront.stores.length,
  });

  return { status: "processed", touchedStoreSlug: canonical };
}
