import { prisma } from "@/lib/prisma";
import type { OrderStatus } from "@/generated/prisma/enums";

export type SetOrderStatusInput = {
  businessId: string;
  orderId: bigint;
  status: OrderStatus;
  reason: string | null;
};

/**
 * The POS reports what happened to an order it pulled.
 *
 * F-018: moved out of `src/app/api/internal/orders/status/route.ts`, which
 * used to import Prisma directly — a layer violation `src/app/` can no
 * longer commit (AGENTS.md § Arquitectura; this file is the only place that
 * still touches the query).
 *
 * Scoped by `businessId` so an order that belongs to another business is
 * never touched: `updated.count === 0` covers both "no such order" and "not
 * yours" with the same 404, which is what keeps this endpoint from being an
 * oracle of existence between tenants (R6, E12).
 *
 * F-019 DA6: `cancelledBy` is computed from the INPUT status, not the row's
 * previous one — `"STORE"` for `CANCELLED`/`REJECTED_BY_STORE`, `null` for
 * everything else — so this stays a single `updateMany` with no `CASE`. No
 * guard on the FROM state (R15: the POS is the authority, F-007 R7), and no
 * proposal column is touched here — `expiresAt` is never cleared even when
 * the POS reports past `AWAITING_CUSTOMER`, since every write conditioned on
 * that state already requires `status = 'AWAITING_CUSTOMER'` (a stale
 * `expiresAt` cannot cause a wrong write).
 */
export async function setOrderStatus(input: SetOrderStatusInput): Promise<{ ok: boolean }> {
  const cancelledBy =
    input.status === "CANCELLED" || input.status === "REJECTED_BY_STORE" ? "STORE" : null;

  const updated = await prisma.order.updateMany({
    where: { id: input.orderId, businessId: input.businessId },
    data: {
      status: input.status,
      cancelReason: input.reason,
      cancelledBy,
    },
  });

  return { ok: updated.count > 0 };
}
