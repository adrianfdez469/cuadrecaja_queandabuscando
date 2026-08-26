import { prisma } from "@/lib/prisma";
import { money, multiply } from "@/lib/money";

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
 */

/** The exact shape frozen into `Order.rateSnapshot` at checkout time (R9). */
type RateSnapshot = { base: string; capturedAt: string; rates: Record<string, string> };

export type PulledOrder = {
  id: string;
  code: string;
  storeExternalId: string;
  status: string;
  contact: { name: string; phone: string; email: string | null; address: string | null };
  currencyCode: string;
  subtotal: string;
  discountTotal: string;
  deliveryFee: string;
  total: string;
  notes: string | null;
  createdAt: string;
  /** New in v2: the rates frozen at checkout, for reconstructing the conversion. */
  rateSnapshot: RateSnapshot;
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

export async function pullOrders(
  since: bigint,
  limit: number,
): Promise<{ orders: PulledOrder[]; nextCursor: string | null }> {
  const rows = await prisma.order.findMany({
    where: { id: { gt: since } },
    orderBy: { id: "asc" },
    take: limit,
    include: {
      store: { select: { externalId: true } },
      items: { include: { storeProduct: { select: { externalId: true } } } },
    },
  });

  const orders: PulledOrder[] = rows.map((order) => ({
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
    subtotal: order.subtotal.toString(),
    discountTotal: order.discountTotal.toString(),
    deliveryFee: order.deliveryFee.toString(),
    total: order.total.toString(),
    notes: order.notes,
    createdAt: order.createdAt.toISOString(),
    rateSnapshot: order.rateSnapshot as RateSnapshot,
    items: order.items.map((item) => {
      const unitPrice = item.unitPrice.toString();
      const currencyCode = item.currencyCode;
      const lineTotal = item.lineTotal.toString();

      const hasOriginal = item.originalUnitPrice !== null && item.originalCurrencyCode !== null;
      const originalUnitPrice = hasOriginal ? item.originalUnitPrice!.toString() : unitPrice;
      const originalCurrencyCode = hasOriginal ? item.originalCurrencyCode! : currencyCode;
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
  }));

  // Mark as pulled so the admin panel can show what the POS has already seen.
  const pendingIds = rows.filter((o) => o.status === "PENDING").map((o) => o.id);
  if (pendingIds.length > 0) {
    await prisma.order.updateMany({
      where: { id: { in: pendingIds } },
      data: { status: "PULLED", pulledAt: new Date() },
    });
  }

  const last = rows.at(-1);
  return {
    orders,
    // Null means "caught up". A cursor equal to the last id means there may be
    // more; the POS keeps calling until it gets an empty page.
    nextCursor: rows.length === limit && last ? last.id.toString() : null,
  };
}
