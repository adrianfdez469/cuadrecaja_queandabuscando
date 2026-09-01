import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrderStatus } from "@/generated/prisma/enums";
import { ORDER_PROPOSAL_DECISION, ORDER_REJECTED_BY_CUSTOMER_REASON } from "@/constants/orders";
import type { ProposalDecision } from "../types";

/**
 * Aprobar y rechazar (architecture.md DA3, DA4).
 *
 * Each is ONE statement, no `$transaction`: Postgres's own implicit
 * transaction makes the CTE chain atomic (won → cleared → inserted for
 * approve; a single UPDATE for reject) at the cost of one round-trip
 * (ficha `pooler-transaccion-deadlock` — the global client stays outside any
 * `$transaction` block here, there simply isn't one).
 *
 * R22: looked up by `(storeId, code)` in the SAME query that writes — never
 * a separate lookup by `code` alone — so a code that belongs to another
 * store affects 0 rows exactly like one that does not exist.
 *
 * R8/E11: `expiresAt > now()` is part of the WRITE condition, not a
 * check beforehand — a vencida propuesta cannot be approved even if the
 * cron and the pull's own barrido both ran late.
 */

export type RespondToProposalInput = {
  storeId: string;
  code: string;
  decision: ProposalDecision;
};

export type RespondToProposalResult =
  // F-020: `businessId` is what the second trigger's `after()` call needs
  // (architecture.md § Componentes, "businessId en el resultado") — the ONLY
  // variant that ever rings the bell (R8/E14: an idempotent 200 writes
  // nothing new, so it never carries one).
  | { kind: "applied"; status: OrderStatus; businessId: string }
  | { kind: "idempotent"; status: OrderStatus }
  | { kind: "already_decided"; status: OrderStatus }
  | { kind: "expired"; status: OrderStatus }
  | { kind: "no_live_proposal"; status: OrderStatus }
  | { kind: "unknown_order" };

type WonRow = { code: string; businessId: string };

export async function respondToProposal(
  input: RespondToProposalInput,
): Promise<RespondToProposalResult> {
  const isApprove = input.decision === ORDER_PROPOSAL_DECISION.APPROVE;
  const rows = isApprove
    ? await approve(input.storeId, input.code)
    : await reject(input.storeId, input.code);

  if (rows.length > 0) {
    return {
      kind: "applied",
      status: isApprove ? "CONFIRMED" : "CANCELLED",
      businessId: rows[0].businessId,
    };
  }

  return classifyZeroRows(input.storeId, input.code, input.decision);
}

/**
 * DA3: `won` → `cleared` → `inserted`, ordered by DATA dependency, not by
 * the order they are written in. `cleared`/`inserted` only do anything if
 * `won` actually matched a row, and `inserted` never sees what `cleared`
 * just deleted — every CTE in the chain shares the SAME snapshot. `criterio
 * 6`: `rateSnapshot` is not in this `SET` at all.
 */
async function approve(storeId: string, code: string): Promise<WonRow[]> {
  return prisma.$queryRaw<WonRow[]>(Prisma.sql`
    WITH won AS (
      UPDATE "Order"
         SET status                = 'CONFIRMED'::"OrderStatus",
             subtotal               = "proposedSubtotal",
             "discountTotal"        = "proposedDiscountTotal",
             "deliveryFee"          = "proposedDeliveryFee",
             total                  = "proposedTotal",
             "proposalOutcome"      = 'APPROVED'::"ProposalOutcome",
             "proposalDecidedAt"    = now(),
             "updatedAt"            = now()
       WHERE code = ${code} AND "storeId" = ${storeId}
         AND status = 'AWAITING_CUSTOMER'::"OrderStatus"
         AND "expiresAt" > now()
      RETURNING id, code, "businessId", "proposedItems"
    ), cleared AS (
      DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM won) RETURNING 1
    ), inserted AS (
      INSERT INTO "OrderItem" (id, "orderId", "storeProductId", name, "unitPrice",
                               "currencyCode", quantity, "lineTotal",
                               "originalUnitPrice", "originalCurrencyCode")
      SELECT gen_random_uuid()::text, won.id, li."storeProductId", li.name, li."unitPrice",
             li."currencyCode", li.quantity, li."lineTotal",
             li."originalUnitPrice", li."originalCurrencyCode"
        FROM won,
             jsonb_to_recordset(won."proposedItems") AS li(
               "storeProductId" text, name text, "unitPrice" numeric(14,2),
               "currencyCode" text, quantity numeric(14,3), "lineTotal" numeric(14,2),
               "originalUnitPrice" numeric(14,2), "originalCurrencyCode" text
             )
      RETURNING 1
    )
    SELECT code, "businessId" FROM won
  `);
}

/**
 * Same shape, no line changes: rejecting cancels the order as it stood
 * (R2 — the proposal never touched the live amounts) and attributes the
 * cancellation to the customer. `cancelReason` is the fixed server string
 * `ORDER_REJECTED_BY_CUSTOMER_REASON` — this route accepts no free text from
 * the customer at all (ADR 0024 defensa 6).
 */
async function reject(storeId: string, code: string): Promise<WonRow[]> {
  return prisma.$queryRaw<WonRow[]>(Prisma.sql`
    UPDATE "Order"
       SET status              = 'CANCELLED'::"OrderStatus",
           "cancelledBy"       = 'CUSTOMER'::"OrderCancelledBy",
           "proposalOutcome"   = 'REJECTED'::"ProposalOutcome",
           "proposalDecidedAt" = now(),
           "cancelReason"      = ${ORDER_REJECTED_BY_CUSTOMER_REASON},
           "updatedAt"         = now()
     WHERE code = ${code} AND "storeId" = ${storeId}
       AND status = 'AWAITING_CUSTOMER'::"OrderStatus"
       AND "expiresAt" > now()
    RETURNING code, "businessId"
  `);
}

/**
 * 0 rows affected: ONE read decides between the 200-idempotent path and the
 * three flavors of 409 (DA4's rule). `proposalOutcome` — not `status` — is
 * what decides idempotency: the POS can move `status` along afterwards
 * (F-007 R7) without erasing the record of what the customer decided.
 */
async function classifyZeroRows(
  storeId: string,
  code: string,
  decision: ProposalDecision,
): Promise<RespondToProposalResult> {
  const order = await prisma.order.findFirst({
    where: { code, storeId },
    select: { status: true, proposalOutcome: true },
  });
  if (!order) return { kind: "unknown_order" };

  const matchesAlready =
    (decision === ORDER_PROPOSAL_DECISION.APPROVE && order.proposalOutcome === "APPROVED") ||
    (decision === ORDER_PROPOSAL_DECISION.REJECT && order.proposalOutcome === "REJECTED");
  if (matchesAlready) return { kind: "idempotent", status: order.status };

  // Still waiting, so the only thing that could have blocked the write is
  // the deadline (E11/E12) — the cron or the pull's own barrido may just not
  // have reached this row yet.
  if (order.status === "AWAITING_CUSTOMER") return { kind: "expired", status: order.status };

  if (order.proposalOutcome === "APPROVED" || order.proposalOutcome === "REJECTED") {
    return { kind: "already_decided", status: order.status };
  }

  return { kind: "no_live_proposal", status: order.status };
}
