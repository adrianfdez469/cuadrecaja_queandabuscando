/**
 * Subtotal · envío · total. Presentational — no `"use client"`: it is used
 * from inside `CartView` and `CheckoutForm`, which already carry the
 * directive, so this only needs to render whatever they compute.
 *
 * `undefined` for `deliveryFeeLabel` hides the row entirely (no delivery
 * offered); `null` for any label means "still calculating" (E6/E9's loading
 * state), never an empty string.
 */
export function OrderSummary({
  subtotalLabel,
  discountLabel,
  deliveryFeeLabel,
  totalLabel,
  totalCaption = "Total",
  partialNotice,
  busy = false,
  announcement,
  note,
}: {
  subtotalLabel: string | null;
  /** HD3: the ORDER-scope discount, already formatted with its own "−"
   *  sign. `undefined` hides the row (no promotion applied). */
  discountLabel?: string;
  deliveryFeeLabel?: string | null;
  totalLabel: string | null;
  /** F-031 design.md § 1: "Total" while the total is firm, "Total parcial"
   *  while the delivery fee for a DELIVERY order is not quoted yet. */
  totalCaption?: string;
  /** F-031 SP4's mandatory addendum next to a partial total ("más el envío
   *  por confirmar"). Rendered INSIDE the total block, deliberately not
   *  `note`: `note` is `text-fg-muted text-xs` — the small, easy-to-miss
   *  letter design.md rejected for exactly this sentence. */
  partialNotice?: string;
  busy?: boolean;
  /** Announced once via aria-live when the amounts settle. */
  announcement?: string;
  note?: string;
}) {
  return (
    <div aria-live="polite" aria-busy={busy} className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-fg-muted">Subtotal</span>
        <span className={subtotalLabel ? "text-fg" : "text-fg-muted"}>
          {subtotalLabel ?? "Calculando…"}
        </span>
      </div>

      {discountLabel && (
        <div className="flex justify-between text-sm">
          <span className="text-fg-muted">Descuento</span>
          <span className="text-fg">{discountLabel}</span>
        </div>
      )}

      {deliveryFeeLabel !== undefined && (
        <div className="flex justify-between text-sm">
          <span className="text-fg-muted">Envío</span>
          <span className={deliveryFeeLabel ? "text-fg" : "text-fg-muted"}>
            {deliveryFeeLabel ?? "Calculando…"}
          </span>
        </div>
      )}

      <div>
        <div className="border-border flex justify-between border-t pt-2 font-semibold">
          <span>{totalCaption}</span>
          <span className={totalLabel ? "text-fg" : "text-fg-muted"}>
            {totalLabel ?? "Calculando…"}
          </span>
        </div>
        {partialNotice && <p className="text-fg mt-0.5 text-right text-sm">{partialNotice}</p>}
      </div>

      {note && <p className="text-fg-muted text-xs">{note}</p>}
      {announcement && <span className="sr-only">{announcement}</span>}
    </div>
  );
}
