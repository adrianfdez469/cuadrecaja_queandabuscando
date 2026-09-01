import { prisma } from "@/lib/prisma";
import type { OrderStatus } from "@/generated/prisma/enums";
import { ORDER_STATUSES_REQUIRING_QUOTED_DELIVERY } from "@/constants/orders";

export type SetOrderStatusInput = {
  businessId: string;
  orderId: bigint;
  status: OrderStatus;
  reason: string | null;
};

/**
 * F-031 DA5/architecture.md: the three outcomes this can end in. `ok` is the
 * 200 the route already returned; `unknown_order` is the 404 that also
 * covers "belongs to another business" (unchanged, R17); `delivery_not_quoted`
 * is the new 409 (`ORDER_DELIVERY_NOT_QUOTED`), and it writes nothing.
 */
export type SetOrderStatusResult =
  { kind: "ok" } | { kind: "unknown_order" } | { kind: "delivery_not_quoted" };

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
 *
 * F-031 DA5: for the three destinations that require the delivery fee
 * already quoted (`ORDER_STATUSES_REQUIRING_QUOTED_DELIVERY`), the SAME
 * `updateMany` grows a `deliveryFee: { not: null }` guard instead of reading
 * before writing — no extra round-trip in the happy path, no TOCTOU window.
 * On 0 rows, `classifyZeroRows` tells "not yours/does not exist" apart from
 * "yours, but not quoted yet", checking business ownership FIRST (R17): a
 * mismatched `businessId` returns `unknown_order` without ever looking at
 * `deliveryFee`, so the 409 can never confirm another business's order
 * exists.
 */
export async function setOrderStatus(input: SetOrderStatusInput): Promise<SetOrderStatusResult> {
  const cancelledBy =
    input.status === "CANCELLED" || input.status === "REJECTED_BY_STORE" ? "STORE" : null;
  const requiresQuote = (ORDER_STATUSES_REQUIRING_QUOTED_DELIVERY as readonly string[]).includes(
    input.status,
  );

  const updated = await prisma.order.updateMany({
    where: {
      id: input.orderId,
      businessId: input.businessId,
      ...(requiresQuote ? { deliveryFee: { not: null } } : {}),
    },
    data: {
      status: input.status,
      cancelReason: input.reason,
      cancelledBy,
    },
  });

  if (updated.count > 0) return { kind: "ok" };

  return classifyZeroRows(input.orderId, input.businessId, requiresQuote);
}

/**
 * 0 rows affected: one extra, classifying read — same shape as
 * `proposal.ts`'s `classifyZeroRows` (DA5). Business ownership is checked
 * BEFORE the quote guard, on purpose (R17).
 */
async function classifyZeroRows(
  orderId: bigint,
  businessId: string,
  requiresQuote: boolean,
): Promise<SetOrderStatusResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { businessId: true, deliveryFee: true },
  });

  if (!order || order.businessId !== businessId) return { kind: "unknown_order" };

  if (requiresQuote && order.deliveryFee === null) return { kind: "delivery_not_quoted" };

  // The row matched every condition on a second look (lost a race against a
  // concurrent write between the updateMany and this read) — same 404 this
  // situation already returned before this guard existed, not a new outcome.
  // `warn`, not `error`: this is an expected, benign race, not a failure —
  // `error` would trip verify.sh's SERVIDOR_ERROR_RE (`⨯`) during smoke/visual
  // for something that isn't a bug.
  console.warn("[orders] setOrderStatus: 0 rows matched but the row satisfies every condition", {
    orderId: orderId.toString(),
    businessId,
  });
  return { kind: "unknown_order" };
}
