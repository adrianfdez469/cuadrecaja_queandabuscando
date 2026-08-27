import Link from "next/link";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/Badge";
import { QuantityStepper } from "@/components/ui/QuantityStepper";

export type CartLineStatus = "ok" | "OUT_OF_STOCK" | "REMOVED" | "NO_PRICE";

const STATUS_LABEL: Record<Exclude<CartLineStatus, "ok">, string> = {
  OUT_OF_STOCK: "Agotado",
  REMOVED: "Ya no está disponible",
  NO_PRICE: "Sin precio disponible",
};

/**
 * One row of `/[slug]/carrito`. Presentational — no `"use client"` (used
 * from `CartView`, which already carries it). The total-of-line cell always
 * renders, even with `null`, so its height never changes when the amount
 * arrives (design.md: "la lista no se mueve nunca").
 */
export function CartLineRow({
  name,
  storeSlug,
  productSlug,
  qty,
  unitPriceLabel,
  unitPriceMuted,
  listUnitPriceLabel,
  lineTotalLabel,
  status,
  onIncrement,
  onDecrement,
  onChangeQty,
  onRemove,
}: {
  name: string;
  storeSlug: string;
  productSlug: string | null;
  qty: number;
  unitPriceLabel: string;
  unitPriceMuted: boolean;
  /** HD3: the pre-discount unit price, for the "Antes" strikethrough
   *  (design.md § 7). `undefined` when no promotion won this line. */
  listUnitPriceLabel?: string;
  lineTotalLabel: string | null;
  status: CartLineStatus;
  onIncrement: () => void;
  onDecrement: () => void;
  onChangeQty: (qty: number) => void;
  onRemove: () => void;
}) {
  const isOk = status === "ok";

  return (
    <li className="border-border flex flex-wrap items-center gap-3 border-b py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        {isOk && productSlug ? (
          <Link
            href={`/${storeSlug}/p/${productSlug}`}
            className="block truncate font-medium hover:underline"
          >
            {name}
          </Link>
        ) : (
          <span className={cn("block truncate font-medium", !isOk && "text-fg-muted")}>{name}</span>
        )}
        <p className={cn("text-sm", unitPriceMuted ? "text-fg-muted" : "text-fg")}>
          {isOk ? `${unitPriceLabel} c/u` : STATUS_LABEL[status]}
        </p>
        {isOk && listUnitPriceLabel && (
          <p className="text-fg-muted text-xs">
            Antes <span className="line-through">{listUnitPriceLabel}</span>
          </p>
        )}
        {status === "OUT_OF_STOCK" && (
          <Badge tone="muted" className="mt-1">
            Agotado
          </Badge>
        )}
      </div>

      <div className="flex w-full items-center justify-between gap-3 sm:w-auto">
        {isOk ? (
          <QuantityStepper
            value={qty}
            label={name}
            onIncrement={onIncrement}
            onDecrement={onDecrement}
            onChange={onChangeQty}
          />
        ) : (
          <span aria-hidden="true" className="text-fg-muted">
            —
          </span>
        )}
        <button
          type="button"
          onClick={onRemove}
          className={cn(
            "min-h-11 rounded-md px-3 text-sm underline",
            isOk ? "text-fg-muted hover:text-fg" : "text-danger font-medium",
          )}
        >
          Quitar
        </button>
      </div>

      <div className="w-full text-right font-medium sm:w-24 sm:shrink-0">
        {lineTotalLabel ?? (isOk ? " " : "—")}
      </div>
    </li>
  );
}
