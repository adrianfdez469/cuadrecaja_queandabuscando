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

      <div className="border-border flex justify-between border-t pt-2 font-semibold">
        <span>Total</span>
        <span className={totalLabel ? "text-fg" : "text-fg-muted"}>
          {totalLabel ?? "Calculando…"}
        </span>
      </div>

      {note && <p className="text-fg-muted text-xs">{note}</p>}
      {announcement && <span className="sr-only">{announcement}</span>}
    </div>
  );
}
