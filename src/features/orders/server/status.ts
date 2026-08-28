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
 */
export async function setOrderStatus(input: SetOrderStatusInput): Promise<{ ok: boolean }> {
  const updated = await prisma.order.updateMany({
    where: { id: input.orderId, businessId: input.businessId },
    data: {
      status: input.status,
      cancelReason: input.reason,
    },
  });

  return { ok: updated.count > 0 };
}
