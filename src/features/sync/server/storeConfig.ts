import { DeliveryFeeMode } from "@/generated/prisma/enums";
import type { DeliveryConfig } from "@/features/orders/deliveryOffer";
import type { StorePayload } from "../schemas";

/**
 * F-032 (architecture.md § DA3): "omitir no es apagar" (R1) written once,
 * typed, instead of fifteen hand-rolled conditional spreads (five keys ×
 * three writes in handlers/store.ts). `undefined` (absent) never enters
 * `out`; `null` DOES survive — the only key that can carry it is
 * `deliveryFee` (R3), and that `null` is meaningful: it clears the column.
 */

export const STORE_CONFIG_KEYS = [
  "checkoutMode",
  "deliveryEnabled",
  "deliveryFee",
  "deliveryFeeMode",
  "orderExpiryHours",
] as const;

export type StoreConfigColumn = (typeof STORE_CONFIG_KEYS)[number];

/**
 * Deliberately built from `StorePayload`'s own (narrow, literal) field
 * types rather than `Prisma.StoreUpdateInput`'s: `npx tsc --noEmit` on a
 * throwaway file (created and deleted, architecture.md § Contratos
 * internos) showed the Prisma-typed version does NOT compile when spread
 * into `createStorefrontWithStore`'s `store:` — `StoreCreateData`'s field
 * types reject the `…FieldUpdateOperationsInput` half of `StoreUpdateInput`'s
 * union. The payload-shaped type is a subtype of BOTH targets' field types,
 * so it spreads cleanly into either write with zero casts (§ Desviaciones
 * de impl.md).
 */
export type StoreConfigWrite = Partial<Pick<StorePayload, StoreConfigColumn>>;

function pickDefined<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) out[key] = value; // `null` SÍ pasa: borra
  }
  return out;
}

/** R1-R3, R14: the keys the payload actually sent, ready to spread with
 *  `...config` into any of the handler's three writes. Called with `{}` on
 *  `DELETE` (E11): a delete never configures, whatever the payload carries. */
export function storeConfigWrite(payload: StorePayload): StoreConfigWrite {
  return pickDefined(payload, STORE_CONFIG_KEYS);
}

/** The state of a store that does not exist yet, per the `@default(...)`s of
 *  the `Store` block in prisma/schema.prisma — the only copy of those two
 *  defaults in TypeScript. `storeConfig.test.ts` compares this against the
 *  schema on disk so the two cannot drift apart in silence (architecture.md
 *  § DA2). `checkoutMode` and `orderExpiryHours` are NOT here: neither
 *  participates in the R8 guard, so Postgres applies their defaults on
 *  `CREATE` and nothing in TypeScript ever needs to read them first. */
export const NEW_STORE_DELIVERY_BASELINE: DeliveryConfig = {
  deliveryEnabled: false,
  deliveryFeeMode: DeliveryFeeMode.FLAT_RATE,
  deliveryFee: null,
};

/**
 * R7: the "effective value" the R8 guard checks — the payload's value for a
 * key when present, otherwise `fallback`'s (the existing row's config, or
 * `NEW_STORE_DELIVERY_BASELINE` when there is no row yet). `fallback` and
 * the return value carry `deliveryFee` as the string `DeliveryConfig`
 * already uses (a `Decimal`'s own `.toString()`); the payload's `number` is
 * turned into a string ONLY to answer "is there a fee on file", never
 * rendered anywhere (`String(500)` is not `"500.00"` — architecture.md
 * § Contratos internos, punto 3).
 */
export function effectiveDeliveryConfig(
  config: StoreConfigWrite,
  fallback: DeliveryConfig,
): DeliveryConfig {
  return {
    deliveryEnabled:
      config.deliveryEnabled !== undefined ? config.deliveryEnabled : fallback.deliveryEnabled,
    deliveryFeeMode:
      config.deliveryFeeMode !== undefined ? config.deliveryFeeMode : fallback.deliveryFeeMode,
    deliveryFee:
      config.deliveryFee !== undefined
        ? config.deliveryFee === null
          ? null
          : String(config.deliveryFee)
        : fallback.deliveryFee,
  };
}
