import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { publicEnv } from "@/lib/env";
import type { OrderStatus } from "@/generated/prisma/enums";
import type { ProposalItem } from "../types";
import { buildProposalWhatsappUrl, type ProposalWhatsappReason } from "../whatsapp";
import { getOrderByCode } from "./read";

/**
 * Proponer una modificación (architecture.md DA2).
 *
 * ONE statement — `UPDATE … FROM "Store" … RETURNING` — with no read before
 * it: `previousTotal = o.total` is resolved atomically (the row a concurrent
 * approval might be mutating right now), and `expiresAt` is computed with
 * `make_interval(hours => …)` against the DATABASE's own `now()`, the same
 * clock every later comparison uses (R5, R7). The admissible states go in
 * the `WHERE`, so a non-proposable order affects 0 rows and writes nothing
 * (E4). Only on 0 rows does this fall back to a second, classifying read.
 */

export type ProposeOrderChangeInput = {
  businessId: string;
  orderId: bigint;
  currencyCode: string;
  subtotal: string;
  discountTotal: string;
  deliveryFee: string;
  total: string;
  message: string | null;
  items: ProposalItem[];
};

export type ProposeOrderChangeResult =
  | {
      kind: "proposed";
      expiresAt: Date;
      currencyCode: string;
      previousTotal: string;
      proposedTotal: string;
      orderUrl: string;
      /** Toward the CUSTOMER (R12) — the encargado clicks this, nobody here
       *  sends it automatically. */
      customerWhatsappUrl: string | null;
      customerWhatsappReason: ProposalWhatsappReason | null;
    }
  | { kind: "unknown_order" }
  | { kind: "currency_mismatch" }
  | { kind: "not_proposable"; status: OrderStatus }
  | { kind: "failed" };

const PROPOSABLE_STATUSES: readonly OrderStatus[] = ["PULLED", "CONFIRMED", "AWAITING_CUSTOMER"];

type ProposeRow = {
  code: string;
  storeId: string;
  expiresAt: Date;
  previousTotal: string;
  proposedTotal: string;
  currencyCode: string;
};

function orderUrlFor(storeSlug: string, code: string): string {
  return new URL(`/${storeSlug}/pedido/${code}`, publicEnv.siteUrl).toString();
}

export async function proposeOrderChange(
  input: ProposeOrderChangeInput,
): Promise<ProposeOrderChangeResult> {
  const rows = await prisma.$queryRaw<ProposeRow[]>(Prisma.sql`
    UPDATE "Order" o
       SET status                  = 'AWAITING_CUSTOMER'::"OrderStatus",
           "proposedAt"            = now(),
           "expiresAt"             = now() + make_interval(hours => s."orderExpiryHours"),
           "previousTotal"         = o.total,
           "proposedSubtotal"      = ${input.subtotal}::numeric(14,2),
           "proposedDiscountTotal" = ${input.discountTotal}::numeric(14,2),
           "proposedDeliveryFee"   = ${input.deliveryFee}::numeric(14,2),
           "proposedTotal"         = ${input.total}::numeric(14,2),
           "proposedItems"         = ${JSON.stringify(input.items)}::jsonb,
           "proposalMessage"       = ${input.message},
           "proposalOutcome"       = NULL,
           "proposalDecidedAt"     = NULL,
           "cancelledBy"           = NULL,
           "cancelReason"          = NULL,
           "updatedAt"             = now()
      FROM "Store" s
     WHERE o."storeId" = s.id
       AND o.id = ${input.orderId}
       AND o."businessId" = ${input.businessId}
       AND o."currencyCode" = ${input.currencyCode}
       AND o.status IN ('PULLED', 'CONFIRMED', 'AWAITING_CUSTOMER')
    RETURNING o.code, o."storeId", o."expiresAt", o."previousTotal", o."proposedTotal",
              o."currencyCode"
  `);

  const won = rows[0];
  if (!won) return classifyZeroRows(input.orderId, input.businessId, input.currencyCode);

  const snapshot = await getOrderByCode(won.storeId, won.code);
  const orderUrl = orderUrlFor(snapshot?.storeSlug ?? won.storeId, won.code);
  const contactPhone = snapshot?.contact.phone;
  const storeName = snapshot?.storeName;

  const whatsapp =
    contactPhone && storeName
      ? buildProposalWhatsappUrl({
          customerPhone: contactPhone,
          storeName,
          code: won.code,
          orderUrl,
        })
      : { url: null, reason: "NO_PHONE_DIGITS" as const };

  return {
    kind: "proposed",
    expiresAt: won.expiresAt,
    currencyCode: won.currencyCode,
    previousTotal: String(won.previousTotal),
    proposedTotal: String(won.proposedTotal),
    orderUrl,
    customerWhatsappUrl: whatsapp.url,
    customerWhatsappReason: whatsapp.reason,
  };
}

/**
 * 0 rows affected: one extra read to tell apart "no existe / no es tuyo"
 * (404, R22 — same code as a fully unknown order), "moneda distinta" (400)
 * and "estado no proponible" (409, with the current status) — the only
 * consultation this function makes on the error path (DA2).
 */
async function classifyZeroRows(
  orderId: bigint,
  businessId: string,
  currencyCode: string,
): Promise<ProposeOrderChangeResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { businessId: true, currencyCode: true, status: true },
  });

  if (!order || order.businessId !== businessId) return { kind: "unknown_order" };
  if (order.currencyCode !== currencyCode) return { kind: "currency_mismatch" };
  if (!PROPOSABLE_STATUSES.includes(order.status)) {
    return { kind: "not_proposable", status: order.status };
  }

  // The row matched every condition on a second look (lost a race against a
  // concurrent write between the UPDATE and this read) — nothing to blame
  // the caller for, and retrying is the caller's call, not this function's.
  return { kind: "failed" };
}
