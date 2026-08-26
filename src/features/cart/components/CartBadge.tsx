"use client";

import Link from "next/link";
import { useCart } from "../cartStore";

/**
 * The header's cart link, present on every storefront page (DP1/DP3: cost
 * accepted deliberately, including on the `●` pages — otherwise adding
 * something produces no visible signal anywhere, E1).
 *
 * The bubble renders ONLY when `count > 0`. `getServerSnapshot` in
 * `cartStore.ts` is always empty, so the prerendered HTML never has a bubble
 * either — there is no hydration mismatch to reconcile, and a "0" is never
 * painted, which would be a lie before hydration finishes reading storage.
 */
export function CartBadge({ storeId, storeSlug }: { storeId: string; storeSlug: string }) {
  const cart = useCart(storeId);
  const displayCount = cart.count > 99 ? "99+" : String(cart.count);

  return (
    <Link
      href={`/${storeSlug}/carrito`}
      className="inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap"
      aria-label={cart.count > 0 ? `Carrito, ${cart.count} productos` : "Carrito"}
    >
      Carrito
      {cart.count > 0 && (
        <span
          aria-hidden
          className="bg-brand-contrast text-brand inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold"
        >
          {displayCount}
        </span>
      )}
    </Link>
  );
}
