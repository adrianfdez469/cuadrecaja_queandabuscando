import { prisma } from "@/lib/prisma";
import { isOrderCode, normalizeOrderCode } from "@/lib/orderCode";
import { money } from "@/lib/money";
import { publicEnv } from "@/lib/env";
import { canonicalSlug, type PublicSlug } from "@/lib/publicSlug";
import { routingWhatsappNumber } from "@/lib/storeContact";
import type { CheckoutMode, OrderCancelledBy, OrderStatus } from "@/generated/prisma/enums";
import { buildWhatsappUrl } from "../whatsapp";
import type { ProposalItem } from "../types";

/**
 * Lectura del pedido — the snapshot frozen at checkout time (R8), never
 * derived from the current catalogue. Used by `/[slug]/pedido/[code]`
 * (E16, E19) and by `createOrder.ts` to build the WhatsApp link from exactly
 * what got persisted, instead of recomputing it from an in-memory quote.
 *
 * F-017: looked up by `storeId`, never by slug — the resolver
 * (`features/storefront/server/resolve.ts`) is the only thing allowed to
 * turn a URL slug into a store. 404 stays "cross-store by construction"
 * (E17): the query filters by `code` AND `storeId` in the same `findFirst`,
 * so a code that belongs to another store never resolves here.
 */

export type OrderSnapshotItem = {
  storeProductId: string | null;
  name: string;
  unitPrice: string;
  currencyCode: string;
  quantity: string;
  lineTotal: string;
};

/**
 * F-019: present whenever the order has ever HAD a proposal — live
 * (`status === "AWAITING_CUSTOMER"`) or resolved (an approval keeps these
 * columns, PP3/DA1: only a SECOND proposal overwrites them). The page tells
 * "still live" from "already decided" by `status` and `proposalOutcome`,
 * not by whether this object exists at all.
 */
export type OrderSnapshotProposal = {
  proposedAt: string;
  expiresAt: string;
  message: string | null;
  previousTotal: string;
  subtotal: string;
  discountTotal: string;
  deliveryFee: string;
  total: string;
  items: ProposalItem[];
  outcome: "APPROVED" | "REJECTED" | "EXPIRED" | null;
};

export type OrderSnapshot = {
  code: string;
  status: OrderStatus;
  /** The order's URL always uses the CANONICAL slug (R17), computed here
   *  from the same brand/branch-count read every other writer uses. */
  storeSlug: PublicSlug;
  storeName: string;
  checkoutMode: CheckoutMode;
  /** R15: always the branch's own number, never the brand's. `null` means
   *  no wa.me link (E18). */
  whatsappNumber: string | null;
  contact: { name: string; phone: string; email: string | null };
  fulfillment: "PICKUP" | "DELIVERY";
  deliveryAddress: string | null;
  currencyCode: string;
  subtotal: string;
  /** F-031 DA1: `null` = not quoted yet. Never substituted with `"0.00"`
   *  here — the ausencia reaches the view model itself (R1, R19). */
  deliveryFee: string | null;
  total: string;
  notes: string | null;
  createdAt: string;
  /** R9. `null` while the order is not closed, and for every row from
   *  before this feature. */
  cancelledBy: OrderCancelledBy | null;
  proposal: OrderSnapshotProposal | null;
  items: OrderSnapshotItem[];
};

export async function getOrderByCode(
  storeId: string,
  rawCode: string,
): Promise<OrderSnapshot | null> {
  const code = normalizeOrderCode(rawCode);
  if (!isOrderCode(code)) return null;

  const order = await prisma.order.findFirst({
    where: { code, storeId },
    select: {
      code: true,
      status: true,
      contactName: true,
      contactPhone: true,
      contactEmail: true,
      deliveryAddress: true,
      currencyCode: true,
      subtotal: true,
      deliveryFee: true,
      total: true,
      notes: true,
      createdAt: true,
      cancelledBy: true,
      proposedAt: true,
      expiresAt: true,
      proposalMessage: true,
      previousTotal: true,
      proposedSubtotal: true,
      proposedDiscountTotal: true,
      proposedDeliveryFee: true,
      proposedTotal: true,
      proposedItems: true,
      proposalOutcome: true,
      store: {
        select: {
          slug: true,
          name: true,
          checkoutMode: true,
          whatsapp: true,
          phone: true,
          storefront: { select: { slug: true, stores: { select: { id: true } } } },
        },
      },
      items: {
        select: {
          storeProductId: true,
          name: true,
          unitPrice: true,
          currencyCode: true,
          quantity: true,
          lineTotal: true,
        },
      },
    },
  });
  if (!order) return null;

  const proposal: OrderSnapshotProposal | null =
    order.expiresAt !== null &&
    order.proposedAt !== null &&
    order.previousTotal !== null &&
    order.proposedSubtotal !== null &&
    order.proposedDiscountTotal !== null &&
    order.proposedDeliveryFee !== null &&
    order.proposedTotal !== null
      ? {
          proposedAt: order.proposedAt.toISOString(),
          expiresAt: order.expiresAt.toISOString(),
          message: order.proposalMessage,
          previousTotal: order.previousTotal.toString(),
          subtotal: order.proposedSubtotal.toString(),
          discountTotal: order.proposedDiscountTotal.toString(),
          deliveryFee: order.proposedDeliveryFee.toString(),
          total: order.proposedTotal.toString(),
          items: (order.proposedItems as unknown as ProposalItem[] | null) ?? [],
          outcome: order.proposalOutcome,
        }
      : null;

  return {
    code: order.code,
    status: order.status,
    storeSlug: canonicalSlug({
      storeSlug: order.store.slug,
      brandSlug: order.store.storefront.slug,
      brandBranchCount: order.store.storefront.stores.length,
    }),
    storeName: order.store.name,
    checkoutMode: order.store.checkoutMode,
    whatsappNumber: routingWhatsappNumber(order.store),
    contact: { name: order.contactName, phone: order.contactPhone, email: order.contactEmail },
    fulfillment: order.deliveryAddress ? "DELIVERY" : "PICKUP",
    deliveryAddress: order.deliveryAddress,
    currencyCode: order.currencyCode,
    cancelledBy: order.cancelledBy,
    proposal,
    subtotal: order.subtotal.toString(),
    deliveryFee: order.deliveryFee === null ? null : order.deliveryFee.toString(),
    total: order.total.toString(),
    notes: order.notes,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      storeProductId: item.storeProductId,
      name: item.name,
      unitPrice: item.unitPrice.toString(),
      currencyCode: item.currencyCode,
      quantity: item.quantity.toString(),
      lineTotal: item.lineTotal.toString(),
    })),
  };
}

function orderUrlFor(storeSlug: string, code: string): string {
  return `/${storeSlug}/pedido/${code}`;
}

/**
 * The wa.me link, built from the PERSISTED snapshot — never from an
 * in-memory quote. Shared by `createOrder.ts` (the checkout response) and
 * `/[slug]/pedido/[code]` (the confirmation page), so the two can never
 * disagree, including for the 200-idempotent path where nothing was just
 * written.
 */
export function orderWhatsappUrl(snapshot: OrderSnapshot): string | null {
  if (snapshot.checkoutMode !== "WHATSAPP") return null;

  return buildWhatsappUrl({
    storeName: snapshot.storeName,
    whatsappNumber: snapshot.whatsappNumber,
    code: snapshot.code,
    lines: snapshot.items.map((item) => ({
      quantity: String(Number(item.quantity)),
      name: item.name,
      lineTotal: money(item.lineTotal, item.currencyCode),
    })),
    subtotal: money(snapshot.subtotal, snapshot.currencyCode),
    // F-031 R1/E13: `null` propagates as `null`, never `money(0, …)` — the
    // deviation this line used to carry (impl.md § Desviaciones, etapas 1-2)
    // is closed now that `whatsapp.ts` accepts `Money | null` and prints
    // "por confirmar" itself.
    deliveryFee:
      snapshot.deliveryFee === null ? null : money(snapshot.deliveryFee, snapshot.currencyCode),
    total: money(snapshot.total, snapshot.currencyCode),
    fulfillment: snapshot.fulfillment,
    deliveryAddress: snapshot.deliveryAddress,
    contactName: snapshot.contact.name,
    contactPhone: snapshot.contact.phone,
    orderUrl: new URL(orderUrlFor(snapshot.storeSlug, snapshot.code), publicEnv.siteUrl).toString(),
  });
}
