import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ORDER_EXPIRED_PROPOSAL_REASON } from "@/constants/orders";

/**
 * El barrido del vencimiento (architecture.md DA5, § "El reloj").
 *
 * ONE `UPDATE` condition on `(status, expiresAt)`, optionally narrowed to a
 * `businessId`. Deliberately returns the un-awaited `PrismaPromise` instead
 * of `await`ing it here: `pull.ts` needs to hand this to
 * `prisma.$transaction([…])` in ARRAY form — never the interactive
 * callback, ficha `pooler-transaccion-deadlock` — so the barrido and the
 * `findMany` that follows run in the SAME round-trip and the POS never
 * receives a row this call is, in that same instant, cancelling out from
 * under it.
 *
 * Idempotent by construction (R14): `status = 'AWAITING_CUSTOMER'` is part
 * of the condition, and the barrido itself removes rows from that set — a
 * second run affects 0 rows because nothing left matches, not because
 * anything keeps count of whether it already ran.
 */
export function expireProposalsQuery(businessId?: string) {
  const scope = businessId ? Prisma.sql`AND "businessId" = ${businessId}` : Prisma.empty;

  return prisma.$executeRaw(Prisma.sql`
    UPDATE "Order"
       SET status              = 'CANCELLED'::"OrderStatus",
           "cancelledBy"       = 'EXPIRY'::"OrderCancelledBy",
           "proposalOutcome"   = 'EXPIRED'::"ProposalOutcome",
           "proposalDecidedAt" = now(),
           "cancelReason"      = ${ORDER_EXPIRED_PROPOSAL_REASON},
           "updatedAt"         = now()
     WHERE status = 'AWAITING_CUSTOMER'::"OrderStatus"
       AND "expiresAt" < now()
       ${scope}
  `);
}
