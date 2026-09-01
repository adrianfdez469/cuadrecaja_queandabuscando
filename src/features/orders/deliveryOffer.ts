/**
 * "Cuándo se ofrece domicilio" (F-031 architecture.md DA6).
 *
 * R20 turned a two-term condition into a three-term one, and until this
 * module existed it was written out TWICE — `createOrder.ts` and
 * `CheckoutForm.tsx` — which is exactly how I3/I4 were born (two copies
 * drifting apart). Both now import from here instead.
 *
 * Deliberately pure: no Prisma, no React, no Zod, so the client checkout
 * island can import it too (AGENTS.md: only each domain's `server/`
 * subfolder may touch Prisma; this file lives one level up, in
 * `features/orders/`, on purpose).
 */

export type DeliveryFeeModeName = "FLAT_RATE" | "QUOTED_PER_ORDER";

export type DeliveryConfig = {
  deliveryEnabled: boolean;
  deliveryFeeMode: DeliveryFeeModeName;
  /** The store's flat fee. `null` = no fee stored — only meaningful for
   *  `FLAT_RATE`; `QUOTED_PER_ORDER` never reads it (§ Casos límite, "manda
   *  el modo"). */
  deliveryFee: string | null;
};

/**
 * R20: domicilio is offered when `deliveryEnabled` is true AND the mode has
 * something to close it with — a flat fee already set, or a store that
 * quotes per order (which needs no fee on file to make the offer).
 */
export function isDeliveryOffered(config: DeliveryConfig): boolean {
  if (!config.deliveryEnabled) return false;
  if (config.deliveryFeeMode === "QUOTED_PER_ORDER") return true;
  return config.deliveryFee !== null;
}

/** F-032 R8: the state the sync must never write — delivery turned on with
 *  nothing to charge for it. The degenerate case of `isDeliveryOffered`,
 *  written IN TERMS OF it so the two can never drift apart (architecture.md
 *  § DA1): the day a third `DeliveryFeeMode` appears, there is exactly one
 *  place that decides "is there something to close delivery with". */
export function isDeliveryConfigInconsistent(config: DeliveryConfig): boolean {
  return config.deliveryEnabled && !isDeliveryOffered(config);
}

/**
 * The delivery fee to use for a NEW order, given the fulfillment that was
 * actually decided (already degraded to `"PICKUP"` in silence when
 * `isDeliveryOffered` is false — R3 of F-010, unchanged).
 *
 * `null` = not quoted yet: only `"QUOTED_PER_ORDER"` with `"DELIVERY"`
 * returns it, and it IGNORES any residual `deliveryFee` the store row still
 * carries (§ Casos límite, "manda el modo con una deliveryFee residual").
 * `"PICKUP"` always returns `"0.00"` — E8: what is uncertain is the delivery,
 * never the order itself.
 */
export function deliveryFeeForNewOrder(
  config: DeliveryConfig,
  fulfillment: "PICKUP" | "DELIVERY",
): string | null {
  if (fulfillment === "PICKUP") return "0.00";
  if (config.deliveryFeeMode === "QUOTED_PER_ORDER") return null;
  return config.deliveryFee ?? "0.00";
}
