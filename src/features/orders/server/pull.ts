import { prisma } from "@/lib/prisma";

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
 */

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
  items: {
    storeProductExternalId: string | null;
    name: string;
    unitPrice: string;
    currencyCode: string;
    quantity: string;
    lineTotal: string;
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
    items: order.items.map((item) => ({
      storeProductExternalId: item.storeProduct?.externalId ?? null,
      name: item.name,
      unitPrice: item.unitPrice.toString(),
      currencyCode: item.currencyCode,
      quantity: item.quantity.toString(),
      lineTotal: item.lineTotal.toString(),
    })),
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
