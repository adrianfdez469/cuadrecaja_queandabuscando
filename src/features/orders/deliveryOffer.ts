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
 *
 * F-042 (architecture.md § AD2, § Contratos 1; nota fechada 2026-09-09 en
 * `docs/adr/0033-cobrar-el-domicilio-y-ofrecerlo-son-dos-preguntas.md`):
 * `isDeliveryOffered` para `ZONE_BASED` deja de contestar `false` a secas.
 * La pregunta de verdad — "¿tiene esta tienda alguna zona con tarifa
 * resoluble?" — necesita el tarifario, que está en Postgres, y esta función
 * sigue siendo PURA a propósito (I4): el hecho llega YA RESUELTO como
 * segundo parámetro OBLIGATORIO (`ZoneCoverageFact`), nunca metiendo Prisma
 * aquí. Quien lo calcula es SIEMPRE un `server/`
 * (`src/features/zones/server/coverage.ts`). Y `deliveryFeeForNewOrder` deja
 * de lanzar en `ZONE_BASED` + `DELIVERY` — esa rama, inalcanzable hasta hoy,
 * ahora se alcanza — y devuelve un resultado discriminado de tres casos en
 * vez de un `string | null` que confundiría "sin cotizar" con "sin zona".
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

/** F-042 (AD2) — el hecho que la fila `Store` no puede contestar sola: lo
 *  resuelve SIEMPRE un `server/` (`loadStoreZoneCoverage`). Un objeto y no
 *  un `boolean` suelto para que la llamada se lea sola y para que un tercer
 *  hecho, si llega algún día, no cambie la aridad otra vez. */
export type ZoneCoverageFact = { hasResolvableZone: boolean };

/** F-042 (AD4) — la zona ya RESUELTA: su importe salió de
 *  `resolveZoneTariff` sobre filas reales, nunca del cliente (R8, E14). */
export type ChosenZone = { code: string; deliveryFee: string };

export type NewOrderDeliveryFee =
  | { kind: "charged"; amount: string } // "0.00" incluido: envío gratis (R10).
  | { kind: "not_quoted" } // QUOTED_PER_ORDER + DELIVERY.
  | { kind: "zone_required" }; // ZONE_BASED + DELIVERY sin zona resuelta.

/**
 * R13 — "can delivery be offered to THIS shopper RIGHT NOW?". The shopper's
 * question. `ZONE_BASED` answers with the real question F-042 exists to ask:
 * does this store have any zone with a resolvable tariff? `coverage` is
 * ALWAYS computed by a `server/` (AD2) — never here, never in the client
 * tree.
 */
export function isDeliveryOffered(config: DeliveryConfig, coverage: ZoneCoverageFact): boolean {
  if (!config.deliveryEnabled) return false;
  switch (config.deliveryFeeMode) {
    case "FLAT_RATE":
      return config.deliveryFee !== null;
    case "QUOTED_PER_ORDER":
      return true;
    case "ZONE_BASED":
      return coverage.hasResolvableZone; // F-042 — R1.
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
 * F-042 (AD4): a discriminated result, not `string | null`. A `null` would
 * have to mean two different things again — "not quoted yet"
 * (`QUOTED_PER_ORDER`) and "no zone chosen yet" (`ZONE_BASED`) — which is
 * exactly the kind of ambiguity R10/R11 exist to forbid. `"PICKUP"` always
 * returns `{ kind: "charged", amount: "0.00" }` — E8: what is uncertain is
 * the delivery, never the order itself.
 *
 * `zone` is `null` unless the caller already resolved one: the island
 * passes the zone the shopper picked from its props; the server passes the
 * one it just resolved against the base. Same function, two callers — R8.
 */
export function deliveryFeeForNewOrder(
  config: DeliveryConfig,
  fulfillment: "PICKUP" | "DELIVERY",
  zone: ChosenZone | null,
): NewOrderDeliveryFee {
  if (fulfillment === "PICKUP") return { kind: "charged", amount: "0.00" };
  switch (config.deliveryFeeMode) {
    case "FLAT_RATE":
      return { kind: "charged", amount: config.deliveryFee ?? "0.00" };
    case "QUOTED_PER_ORDER":
      return { kind: "not_quoted" };
    case "ZONE_BASED":
      // R9: JAMÁS `config.deliveryFee` aquí. Es residuo inerte, y cobrarlo
      // sería el fallo silencioso más caro que este feature puede
      // introducir. R10: la comprobación es contra `null`, no contra un
      // falsy — un `zone.deliveryFee` de "0.00" es envío gratis y entra en
      // `charged`.
      return zone === null
        ? { kind: "zone_required" }
        : { kind: "charged", amount: zone.deliveryFee };
    default: {
      const exhaustive: never = config.deliveryFeeMode;
      throw new Error(`deliveryFeeForNewOrder: unhandled mode ${String(exhaustive)}`);
    }
  }
}
