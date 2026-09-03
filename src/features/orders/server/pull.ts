import { prisma } from "@/lib/prisma";
import { readAfterExpirySweeps } from "./expiry";
import { PULLED_ORDER_SELECT, toPulledOrder, type PulledOrder } from "./pulledOrder";

export type { RateSnapshot, PulledOrderProposal, PulledOrder } from "./pulledOrder";

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
 *
 * F-033 (v8, DA1): the `select` and the row → `PulledOrder` mapping moved to
 * `pulledOrder.ts` (R2) — this function only wires the where/orderBy/take
 * that decide WHICH rows come back and the `updateMany` that marks them
 * `PULLED` (R7: that marking belongs ONLY to this function). The barrido
 * composition moved to `readAfterExpirySweeps` (DA2); the two barridos
 * themselves did not change.
 */
export async function pullOrders(
  businessId: string,
  since: bigint,
  limit: number,
): Promise<{ orders: PulledOrder[]; nextCursor: string | null }> {
  const rows = await readAfterExpirySweeps(
    businessId,
    prisma.order.findMany({
      where: { businessId, id: { gt: since } },
      orderBy: { id: "asc" },
      take: limit,
      select: PULLED_ORDER_SELECT,
    }),
  );

  const orders: PulledOrder[] = rows.map(toPulledOrder);

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
