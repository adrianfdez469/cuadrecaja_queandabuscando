import { Prisma } from "@/generated/prisma/client";
import { money, multiply } from "@/lib/money";
import { publicEnv } from "@/lib/env";
import { canonicalSlug } from "@/lib/publicSlug";
import { routingWhatsappNumber } from "@/lib/storeContact";
import { buildProposalWhatsappUrl } from "../whatsapp";

/**
 * LA forma del payload del POS (F-033 R2, architecture.md DA1): el `select`
 * y el mapeo a `PulledOrder`, en un solo sitio. Extraído de `pull.ts` sin
 * cambiar una línea de aritmética ni de formato (F-033 paso 1, refactor
 * puro) — un pedido servido lateralmente (`lateralRead.ts`) es byte a byte
 * el mismo objeto que sirve el pull incremental (`pull.ts`), porque los dos
 * pasan por este módulo y no lo importan por caminos distintos.
 */

/** The exact shape frozen into `Order.rateSnapshot` at checkout time (R9). */
export type RateSnapshot = { base: string; capturedAt: string; rates: Record<string, string> };

export type PulledOrderProposal = {
  proposedAt: string;
  expiresAt: string;
  previousTotal: string;
  subtotal: string;
  discountTotal: string;
  deliveryFee: string;
  total: string;
  message: string | null;
};

export type PulledOrder = {
  id: string;
  code: string;
  storeExternalId: string;
  status: string;
  contact: { name: string; phone: string; email: string | null; address: string | null };
  currencyCode: string;
  subtotal: string;
  discountTotal: string;
  /** Always present (R18), two decimals. `"0.00"` when NULL — see
   *  `deliveryFeePending` for whether that is an ACTUAL zero. */
  deliveryFee: string;
  /** New in v6 (F-031 DA3): `true` while `Order.deliveryFee` is `NULL` — the
   *  ONLY way to tell "not quoted yet" from "quoted at 0.00" (R1, R19). Never
   *  inferred from `contact.address` or from comparing `total`/`subtotal`. */
  deliveryFeePending: boolean;
  total: string;
  notes: string | null;
  createdAt: string;
  /** New in v2: the rates frozen at checkout, for reconstructing the conversion. */
  rateSnapshot: RateSnapshot;
  /** New in v5: R9 — `null` while the order is not closed. */
  cancelledBy: "CUSTOMER" | "EXPIRY" | "STORE" | null;
  /** New in v5: toward the customer, for EVERY order (E24/I3), `null` with
   *  no usable digits (R13). Never sent by anyone here — the encargado
   *  opens it (R12). */
  customerWhatsappUrl: string | null;
  /** New in v5: present ONLY while `status === "AWAITING_CUSTOMER"`. */
  proposal: PulledOrderProposal | null;
  items: {
    storeProductExternalId: string | null;
    name: string;
    unitPrice: string;
    currencyCode: string;
    quantity: string;
    lineTotal: string;
    /** New in v2. Never `null`: a pre-F-010 order without a stored original
     *  falls back to the converted value, so a reader expecting a number
     *  never has to special-case a missing one. */
    originalUnitPrice: string;
    originalCurrencyCode: string;
    originalLineTotal: string;
  }[];
};

function orderUrlFor(storeSlug: string, code: string): string {
  return new URL(`/${storeSlug}/pedido/${code}`, publicEnv.siteUrl).toString();
}

/** R2: EL `select` del payload del POS. Una constante, un solo sitio.
 *  `as const satisfies` (no solo `satisfies`) para que `OrderGetPayload`
 *  conserve los literales `true` y el tipo de fila se derive del propio
 *  select. */
export const PULLED_ORDER_SELECT = {
  id: true,
  code: true,
  status: true,
  contactName: true,
  contactPhone: true,
  contactEmail: true,
  deliveryAddress: true,
  currencyCode: true,
  subtotal: true,
  discountTotal: true,
  deliveryFee: true,
  total: true,
  notes: true,
  createdAt: true,
  rateSnapshot: true,
  cancelledBy: true,
  proposedAt: true,
  expiresAt: true,
  previousTotal: true,
  proposedSubtotal: true,
  proposedDiscountTotal: true,
  proposedDeliveryFee: true,
  proposedTotal: true,
  proposalMessage: true,
  // proposedItems is DELIBERATELY not selected (DA1/DA5): the POS
  // composed those lines itself when it proposed; the pull never
  // reads them back.
  store: {
    select: {
      externalId: true,
      slug: true,
      name: true,
      whatsapp: true,
      phone: true,
      storefront: { select: { slug: true, stores: { select: { id: true } } } },
    },
  },
  items: {
    select: {
      name: true,
      unitPrice: true,
      currencyCode: true,
      quantity: true,
      lineTotal: true,
      originalUnitPrice: true,
      originalCurrencyCode: true,
      storeProduct: { select: { externalId: true } },
    },
  },
} as const satisfies Prisma.OrderSelect;

export type PulledOrderRow = Prisma.OrderGetPayload<{ select: typeof PULLED_ORDER_SELECT }>;

/** R2: EL mapeo. El cuerpo que antes vivía en `pull.ts` (`rows.map(...)`),
 *  sin cambiar una línea de aritmética ni de formato. */
export function toPulledOrder(order: PulledOrderRow): PulledOrder {
  const storeSlug = canonicalSlug({
    storeSlug: order.store.slug,
    brandSlug: order.store.storefront.slug,
    brandBranchCount: order.store.storefront.stores.length,
  });
  const whatsappNumber = routingWhatsappNumber(order.store);
  const customerWhatsappUrl = whatsappNumber
    ? buildProposalWhatsappUrl({
        customerPhone: order.contactPhone,
        storeName: order.store.name,
        code: order.code,
        orderUrl: orderUrlFor(storeSlug, order.code),
      }).url
    : null;

  const proposal: PulledOrderProposal | null =
    order.status === "AWAITING_CUSTOMER" &&
    order.expiresAt &&
    order.proposedAt &&
    order.previousTotal !== null &&
    order.proposedSubtotal !== null &&
    order.proposedDiscountTotal !== null &&
    order.proposedDeliveryFee !== null &&
    order.proposedTotal !== null
      ? {
          proposedAt: order.proposedAt.toISOString(),
          expiresAt: order.expiresAt.toISOString(),
          previousTotal: money(order.previousTotal, order.currencyCode).amount,
          subtotal: money(order.proposedSubtotal, order.currencyCode).amount,
          discountTotal: money(order.proposedDiscountTotal, order.currencyCode).amount,
          deliveryFee: money(order.proposedDeliveryFee, order.currencyCode).amount,
          total: money(order.proposedTotal, order.currencyCode).amount,
          message: order.proposalMessage,
        }
      : null;

  return {
    id: order.id.toString(),
    code: order.code,
    storeExternalId: order.store.externalId,
    status: order.status,
    contact: {
      name: order.contactName,
      phone: order.contactPhone,
      email: order.contactEmail,
      address: order.deliveryAddress,
    },
    currencyCode: order.currencyCode,
    subtotal: money(order.subtotal, order.currencyCode).amount,
    discountTotal: money(order.discountTotal, order.currencyCode).amount,
    // F-031 DA1/R18: NULL (not quoted yet) is never sent as `null` — it is
    // `"0.00"` plus `deliveryFeePending: true` below.
    deliveryFee: money(order.deliveryFee ?? 0, order.currencyCode).amount,
    deliveryFeePending: order.deliveryFee === null,
    total: money(order.total, order.currencyCode).amount,
    notes: order.notes,
    createdAt: order.createdAt.toISOString(),
    rateSnapshot: order.rateSnapshot as RateSnapshot,
    cancelledBy: order.cancelledBy,
    customerWhatsappUrl,
    proposal,
    items: order.items.map((item) => {
      const currencyCode = item.currencyCode;
      const unitPrice = money(item.unitPrice, currencyCode).amount;
      const lineTotal = money(item.lineTotal, currencyCode).amount;

      const hasOriginal = item.originalUnitPrice !== null && item.originalCurrencyCode !== null;
      const originalCurrencyCode = hasOriginal ? item.originalCurrencyCode! : currencyCode;
      const originalUnitPrice = hasOriginal
        ? money(item.originalUnitPrice!, originalCurrencyCode).amount
        : unitPrice;
      // quantity is NOT money (AP1): left as-is, whatever precision Decimal gives it.
      const originalLineTotal = hasOriginal
        ? multiply(money(originalUnitPrice, originalCurrencyCode), item.quantity.toString()).amount
        : lineTotal;

      return {
        storeProductExternalId: item.storeProduct?.externalId ?? null,
        name: item.name,
        unitPrice,
        currencyCode,
        quantity: item.quantity.toString(),
        lineTotal,
        originalUnitPrice,
        originalCurrencyCode,
        originalLineTotal,
      };
    }),
  };
}
