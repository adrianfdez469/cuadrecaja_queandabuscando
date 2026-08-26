"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { CART_MAX_LINES, CART_MAX_QTY_PER_LINE } from "@/constants/cart";
import { useCart, useIsLocalStorageAvailable } from "../cartStore";

/**
 * The ficha de producto's only island (E1, E2, E5). Renders on the server
 * too — a client component still produces HTML during prerender — so
 * `disabled` is in the markup before a byte of JS arrives (E5, criterio 2a).
 * `disabled` is computed by the SERVER with `isOrderable()` (+ price
 * resolvability): this component never re-derives orderability itself.
 *
 * Deliberately does not import `lib/money`: this lands on a `●` SSG page and
 * never shows a computed amount, only the raw strings the server already
 * formatted (architecture.md § Coste de cliente).
 */

const ADDED_FEEDBACK_MS = 2000;

export function AddToCartButton({
  storeId,
  storeSlug,
  storeProductId,
  slug,
  name,
  unitPrice,
  currencyCode,
  disabled,
}: {
  storeId: string;
  storeSlug: string;
  storeProductId: string;
  slug: string;
  name: string;
  unitPrice: string;
  currencyCode: string;
  disabled: boolean;
}) {
  const cart = useCart(storeId);
  const storageAvailable = useIsLocalStorageAvailable();
  const [justAdded, setJustAdded] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  const existingLine = cart.items.find((item) => item.storeProductId === storeProductId);
  const atLineCap = !existingLine && cart.items.length >= CART_MAX_LINES;
  const atQtyCap = existingLine !== undefined && existingLine.qty >= CART_MAX_QTY_PER_LINE;
  const buttonDisabled = disabled || atLineCap;

  function handleClick() {
    if (buttonDisabled || atQtyCap) return;

    cart.add({ storeProductId, slug, display: { name, unitPrice, currency: currencyCode } });
    setJustAdded(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setJustAdded(false), ADDED_FEEDBACK_MS);
  }

  return (
    <div>
      <Button
        size="lg"
        className="w-full sm:w-auto"
        disabled={buttonDisabled}
        onClick={handleClick}
      >
        {disabled ? "Agotado" : justAdded ? "✓ Agregado" : "Agregar al carrito"}
      </Button>

      {existingLine && (
        <p className="text-fg-muted mt-2 text-sm" aria-live="polite">
          En tu carrito: {existingLine.qty} ·{" "}
          <Link href={`/${storeSlug}/carrito`} className="underline">
            Ver carrito
          </Link>
        </p>
      )}

      {atLineCap && (
        <p className="text-fg-muted mt-2 text-sm">
          Tu carrito ya tiene 50 productos distintos. Quita alguno para agregar este.
        </p>
      )}

      {atQtyCap && (
        <p className="text-fg-muted mt-2 text-sm">
          Ya tienes 99 unidades de este producto, que es el máximo.
        </p>
      )}

      {!storageAvailable && (
        <p className="text-warning mt-2 text-sm">
          Tu navegador no está guardando el carrito. Si recargas la página vas a perderlo.
        </p>
      )}
    </div>
  );
}
