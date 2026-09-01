import { prisma } from "@/lib/prisma";
import { money, multiply } from "@/lib/money";
import { publicEnv } from "@/lib/env";
import { canonicalSlug } from "@/lib/publicSlug";
import { routingWhatsappNumber } from "@/lib/storeContact";
import { buildProposalWhatsappUrl } from "../whatsapp";
import { expireProposalsQuery, expireUnquotedDeliveryOrdersQuery } from "./expiry";

/**
 * Order pull.
 *
 * The POS reads orders; this app never writes to the POS. That inversion is the
 * whole point of the architecture: the public-facing runtime holds no
 * credentials for the transactional database, so a compromise here cannot reach
 * the sales data.
 *
 * A pulled order stays readable and is NOT deleted — the shopper's order status
 * page keeps working, and the POS reports progress back via /orders/status.
 *
 * v2 (F-010): four fields added, strictly additive — every field the POS
 * already reads keeps its name, type and meaning (docs/sync-contract.md).
 * `unitPrice`/`currencyCode`/`lineTotal`/`subtotal`/`total` stay exactly what
 * they are today: everything in the order's own currency, with
 * `Σ lineTotal = subtotal`. The originals below are informative only and
 * never sumable (R5b) — nothing here derives a total from them.
 *
 * v5 (F-019, NOT additive in the status enum — architecture.md § "Los siete
 * puntos del contrato"): `cancelledBy`, `customerWhatsappUrl` and `proposal`
 * are additive fields; the enum growing from 6 to 9 values is not, and the
 * contract says so. `select` is now EXPLICIT instead of `include`:
 * `proposedItems` (a `Json?`, potentially several KB — architecture.md §
 * Escalabilidad) is never read here, on purpose (DA5/DA1).
 *
 * DA5: the barrido — the `AWAITING_CUSTOMER` proposals this business's own
 * clock ran out on — happens in the SAME round-trip as the read, via
 * `$transaction([...])` in ARRAY form (never the interactive callback: the
 * pooler runs in transaction mode and the global client has no "inside" to
 * misuse there, ficha `pooler-transaccion-deadlock`). Going first is what
 * lets the `findMany` right after it see its own write: the POS never
 * receives an `AWAITING_CUSTOMER` this same call just expired.
 *
 * F-031 (v6, DA4): a SECOND barrido, `expireUnquotedDeliveryOrdersQuery`,
 * joins the same array — the pedido whose delivery fee nobody quoted, which
 * this clock counts from `createdAt` and NEVER touches `AWAITING_CUSTOMER`
 * (R15, disjoint `WHERE`s). Same round-trip, same reasons: the POS sees the
 * cancellation on the very pull that would otherwise hand it a live order.
 *

 * F-031 (v6, AP1): every money amount below now goes through `money(...)`
 * before it leaves this function, always two fraction digits — `subtotal`,
 * `discountTotal`, `deliveryFee`, `total`, the four `proposal.*` amounts and
 * each line's `unitPrice`/`lineTotal`/`originalUnitPrice`/`originalLineTotal`.
 * `Decimal.toString()` used to suppress trailing zeros (`880.00` → `"880"`),
 * which the v5.1 contract's own published example never actually matched.
 * `quantity` is NOT money and stays untouched. This normalization is scoped
 * to THIS payload only — never extend it to the marketplace catalogue or to
 * the reconciliation hash of § ⑤, which strips trailing zeros on purpose.
 *
 * `deliveryFee` also carries F-031 DA1/DA3: `Order.deliveryFee` is nullable
 * now (`NULL` = not quoted yet). This function never sends `null` on the
 * wire (R18) — a `NULL` column emits `"0.00"` — and instead adds
 * `deliveryFeePending: true` so a v5 consumer that does
 * `parseFloat(order.deliveryFee)` keeps working unchanged.
 */

/** The exact shape frozen into `Order.rateSnapshot` at checkout time (R9). */
type RateSnapshot = { base: string; capturedAt: string; rates: Record<string, string> };

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

export async function pullOrders(
  businessId: string,
  since: bigint,
  limit: number,
): Promise<{ orders: PulledOrder[]; nextCursor: string | null }> {
  const [, , rows] = await prisma.$transaction([
    expireProposalsQuery(businessId),
    expireUnquotedDeliveryOrdersQuery(businessId),
    prisma.order.findMany({
      where: { businessId, id: { gt: since } },
      orderBy: { id: "asc" },
      take: limit,
      select: {
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
      },
    }),
  ]);

  const orders: PulledOrder[] = rows.map((order) => {
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
          ? multiply(money(originalUnitPrice, originalCurrencyCode), item.quantity.toString())
              .amount
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
  });

  // Mark as pulled so the admin panel can show what the POS has already seen.
  const pendingIds = rows.filter((o) => o.status === "PENDING").map((o) => o.id);
  if (pendingIds.length > 0) {
    await prisma.order.updateMany({
      where: { businessId, id: { in: pendingIds } },
      data: { status: "PULLED", pulledAt: new Date() },
    });
  }

  const last = rows.at(-1);
  return {
    orders,
    // Null means "caught up" and the POS stops there — it does NOT keep calling
    // until it gets an empty page. Only a full page yields a cursor: a page that
    // came back half empty already proves nothing is left behind, so spending a
    // round-trip to confirm it would be waste. Contract: sync-contract.md § ③④.
    nextCursor: rows.length === limit && last ? last.id.toString() : null,
  };
}
