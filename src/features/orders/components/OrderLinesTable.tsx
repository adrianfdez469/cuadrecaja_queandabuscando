import type { ReactNode } from "react";
import { formatMoney, money } from "@/lib/money";
import type { OrderSnapshotItem } from "../server/read";

/**
 * The frozen lines of a persisted order (R8, E20) — server component, no
 * directive. Every amount here comes straight from the snapshot, never
 * recomputed from the current catalogue.
 *
 * F-019 (design.md § Componentes de UI): `title`/`badge` are optional so the
 * SAME component can render "Tu pedido si aceptas el cambio" + `Badge
 * Propuesta` for the proposed lines (E3), with no change for the two
 * existing call sites that pass neither.
 *
 * F-031 design.md § 3: the delivery row's visibility is decided by the
 * MODALITY (`hasDelivery`), never by the amount — a gifted $0.00 delivery
 * still gets its row, and pickup never shows one even if `deliveryFee`
 * happened to carry a value. `deliveryFee: null` means "not quoted yet"
 * (R1/R19): it is never read as zero.
 */
export function OrderLinesTable({
  items,
  currencyCode,
  subtotal,
  deliveryFee,
  hasDelivery,
  total,
  title = "Tu pedido",
  badge,
}: {
  items: OrderSnapshotItem[];
  currencyCode: string;
  subtotal: string;
  deliveryFee: string | null;
  hasDelivery: boolean;
  total: string;
  title?: string;
  badge?: ReactNode;
}) {
  const deliveryPending = hasDelivery && deliveryFee === null;
  const deliveryFeeMoney =
    hasDelivery && deliveryFee !== null ? money(deliveryFee, currencyCode) : null;

  return (
    <div>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        {title}
        {badge}
      </h2>
      <ul className="divide-border mt-3 divide-y">
        {items.map((item, index) => (
          <li key={index} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              {Number(item.quantity)} x {item.name}
            </span>
            <span className="shrink-0 font-medium">
              {formatMoney(money(item.lineTotal, item.currencyCode))}
            </span>
          </li>
        ))}
      </ul>

      <div className="border-border mt-3 space-y-1 border-t pt-3 text-sm">
        <div className="flex justify-between">
          <span className="text-fg-muted">Subtotal</span>
          <span>{formatMoney(money(subtotal, currencyCode))}</span>
        </div>
        {hasDelivery && (
          <div className="flex justify-between">
            <span className="text-fg-muted">Envío</span>
            <span>{deliveryFeeMoney ? formatMoney(deliveryFeeMoney) : "Por confirmar"}</span>
          </div>
        )}
        <div>
          <div className="border-border flex justify-between border-t pt-2 font-semibold">
            <span>{deliveryPending ? "Total parcial" : "Total"}</span>
            <span>{formatMoney(money(total, currencyCode))}</span>
          </div>
          {deliveryPending && (
            <p className="text-fg mt-0.5 text-right text-sm">más el envío por confirmar</p>
          )}
        </div>
      </div>
    </div>
  );
}
