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
 *
 * F-041 (architecture.md § Contratos 1, I4): `ZONE_BASED` split what used to
 * be ONE question into TWO. `DeliveryFeeModeName` now comes from the
 * generated enum with `import type` — cero bytes in the client bundle, and
 * it cannot fall behind a third mode again the way the hand-rolled union
 * did. `hasSomethingToChargeDeliveryWith` and `isDeliveryOffered` deliberately
 * repeat the `FLAT_RATE`/`QUOTED_PER_ORDER` branches: they are two different
 * questions that happen to agree on two of the three modes today, and
 * writing one in terms of the other is exactly the shortcut that made this
 * feature impossible (F-031's DA1 anticipated the day, and got the shape
 * wrong — ADR 0033).
 */

import type { DeliveryFeeMode } from "@/generated/prisma/enums";

export type DeliveryFeeModeName = DeliveryFeeMode;

export type DeliveryConfig = {
  deliveryEnabled: boolean;
  deliveryFeeMode: DeliveryFeeModeName;
  /** The store's flat fee. `null` = no fee stored — only meaningful for
   *  `FLAT_RATE`; `QUOTED_PER_ORDER` and `ZONE_BASED` never read it (§ Casos
   *  límite, "manda el modo"; R11). */
  deliveryFee: string | null;
};

/**
 * R12 — "does this CONFIGURATION have something to charge delivery with?".
 * The sync's question. `ZONE_BASED` answers YES, and what backs that answer
 * is not on this row at all: it is the tarifario, which arrives through a
 * different sync entity (`ZONE_TARIFF`) and can change without any `STORE`
 * event. This is what `assertDeliveryConsistent`
 * (`src/features/sync/server/handlers/store.ts`) now checks instead of
 * `isDeliveryOffered` — a `ZONE_BASED` store with `deliveryEnabled: true`
 * and no fee on the row is NOT the inconsistent state F-032 guards against.
 */
export function hasSomethingToChargeDeliveryWith(config: DeliveryConfig): boolean {
  switch (config.deliveryFeeMode) {
    case "FLAT_RATE":
      return config.deliveryFee !== null;
    case "QUOTED_PER_ORDER":
      return true;
    case "ZONE_BASED":
      return true;
    default: {
      const exhaustive: never = config.deliveryFeeMode;
      throw new Error(`hasSomethingToChargeDeliveryWith: unhandled mode ${String(exhaustive)}`);
    }
  }
}

/**
 * R13 — "can delivery be offered to THIS shopper RIGHT NOW?". The shopper's
 * question. `ZONE_BASED`, until F-042 exists, answers NO: there is no
 * selector, so there is no zone to resolve — the honest answer is "cannot
 * charge this shipment today". F-042 replaces this line with its own
 * criterio 9 ("does this store have any zone with a resolvable tariff?").
 */
export function isDeliveryOffered(config: DeliveryConfig): boolean {
  if (!config.deliveryEnabled) return false;
  switch (config.deliveryFeeMode) {
    case "FLAT_RATE":
      return config.deliveryFee !== null;
    case "QUOTED_PER_ORDER":
      return true;
    case "ZONE_BASED":
      return false; // R13 — F-042 replaces this with the real question.
    default: {
      const exhaustive: never = config.deliveryFeeMode;
      throw new Error(`isDeliveryOffered: unhandled mode ${String(exhaustive)}`);
    }
  }
}

/** F-032 R8 / F-041 ADR 0033: the state the sync must never write — delivery
 *  turned on with nothing to close it with. Written in terms of
 *  `hasSomethingToChargeDeliveryWith` (the CONFIGURATION question), never
 *  `isDeliveryOffered` (the SHOPPER question) — that decoupling is the whole
 *  point of I4: the day a fifth mode appears, there is exactly one place
 *  that decides "is there something to close delivery with", and this is
 *  not the same place that decides whether to offer it today. */
export function isDeliveryConfigInconsistent(config: DeliveryConfig): boolean {
  return config.deliveryEnabled && !hasSomethingToChargeDeliveryWith(config);
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
 *
 * F-041 E17: `ZONE_BASED` with `"DELIVERY"` is UNREACHABLE by construction —
 * `createOrder.ts` decides `isDelivery` with `isDeliveryOffered`, which
 * answers `false` for `ZONE_BASED` until F-042, so it always passes
 * `"PICKUP"` here. If it were ever reached, a visible 500 is preferable to
 * silently charging `"0.00"` for a shipment nobody priced (the exact thing
 * R11/R13 exist to prevent).
 */
export function deliveryFeeForNewOrder(
  config: DeliveryConfig,
  fulfillment: "PICKUP" | "DELIVERY",
): string | null {
  if (fulfillment === "PICKUP") return "0.00";
  switch (config.deliveryFeeMode) {
    case "FLAT_RATE":
      return config.deliveryFee ?? "0.00";
    case "QUOTED_PER_ORDER":
      return null;
    case "ZONE_BASED":
      throw new Error(
        "deliveryFeeForNewOrder: ZONE_BASED never reaches DELIVERY before F-042 — isDeliveryOffered() already returns false for it",
      );
    default: {
      const exhaustive: never = config.deliveryFeeMode;
      throw new Error(`deliveryFeeForNewOrder: unhandled mode ${String(exhaustive)}`);
    }
  }
}
