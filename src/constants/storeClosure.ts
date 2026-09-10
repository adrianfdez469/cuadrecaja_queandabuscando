/**
 * HD14: the six fixed reasons an admin can pick when closing a store to the
 * public, plus "OTRO" which forces the free-text message. The database
 * stores the CODE, never the phrase (design.md § 8) — fixing a wording here
 * fixes every closed store at once, and no row ever carries a stale copy of
 * a sentence.
 */
export const STORE_DISABLED_REASONS = {
  ADECUACIONES: "Estamos realizando adecuaciones en la tienda.",
  FUERA_DE_SERVICIO: "Tienda temporalmente fuera de servicio.",
  REPONIENDO_INVENTARIO: "Estamos reponiendo el inventario. Volvemos en cuanto tengamos productos.",
  VACACIONES: "Cerrado por vacaciones. Volvemos pronto.",
  SOLO_EN_EL_LOCAL: "Por ahora atendemos solo en el local, no por internet.",
  OTRO: null,
} as const;

export type StoreDisabledReasonCode = keyof typeof STORE_DISABLED_REASONS;

export const STORE_DISABLED_REASON_CODES = Object.keys(
  STORE_DISABLED_REASONS,
) as StoreDisabledReasonCode[];

export function isStoreDisabledReasonCode(value: string): value is StoreDisabledReasonCode {
  return (STORE_DISABLED_REASON_CODES as readonly string[]).includes(value);
}

/**
 * Internal-only marker the HD12 migration writes on every store it closed
 * retroactively — never offered as a choice in the panel's list, and never
 * confused with a `null` reason (which means the POS closed it and did not
 * say why).
 */
export const PLATFORM_ROLLOUT_REASON_CODE = "PLATFORM_ROLLOUT";

/**
 * F-040 (architecture.md AD3, R5): the derived "this store cannot show any
 * price right now" state — computed at render time from the catalogue and
 * the rates, NEVER persisted (criterio 4, ADR 0017 (a)). Same shape as
 * `PLATFORM_ROLLOUT_REASON_CODE`: a loose constant, deliberately outside
 * `STORE_DISABLED_REASONS`, so it never shows up in the panel's list and
 * `storeStatusBodySchema` (`src/features/admin/schemas.ts`) rejects it if
 * anything ever tried to write it (E19).
 */
export const PRICES_UNAVAILABLE_REASON_CODE = "PRICES_UNAVAILABLE";

export const STORE_DISABLED_MESSAGE_MAX_LENGTH = 140;
