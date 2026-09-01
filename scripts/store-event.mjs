#!/usr/bin/env node
/**
 * F-032 (architecture.md § DA5): the shared building blocks for every STORE
 * sync event a verification script sends — `send-catalog-batch.mjs` (the
 * main instrument, criteria 1–6) and `send-store-batch.mjs` (AP1: no
 * longer allowed to build its own, contact-less payload). ONE place, so
 * R21 (the contact fields) and the thirteen purchase-configuration presets
 * can never drift between the two scripts the way they already had.
 */

/**
 * R21: the contact fields `prisma/seed.ts` writes for `seed-tienda-1`
 * (slug `tienda-demo`), copied here as LITERALS rather than read from
 * Postgres or imported from the seed — the script only needs
 * `QAB_BASE_URL` and a token, and can point at another host; the seed is
 * TypeScript and this file is plain `.mjs`, so it cannot `import` it
 * either. The `common` object of `src/features/sync/server/handlers/store.ts`
 * writes `payload.x ?? null` for each of these: a STORE event that omits
 * them BLANKS the column, which is exactly the trap this fixture exists to
 * avoid. `src/app/api/internal/boundaries.test.ts` asserts each value
 * below still appears in `prisma/seed.ts`, so a seed edit here turns that
 * test red before any script run silently erases the fixture.
 */
export const SEED_STORE_CONTACT = {
  description: "Todo para la casa, a dos cuadras de 23 y L.",
  city: "La Habana",
  address: "Calle 23 esq. L, Vedado",
  whatsapp: "+5350000001",
};

/**
 * Thirteen DATA presets, not thirteen code paths — the case a caller picks
 * is spread on top of a valid payload in the ONE place `buildStorePayload`
 * does it below. `none` is what a plain run with no `--store-config` at
 * all sends: the v6 shape, none of the five keys (E1/E3/E14). `all` is
 * what a bare `--store-config` (no `=caso`) sends.
 */
export const STORE_CONFIG_CASES = {
  none: {},
  all: {
    checkoutMode: "ONSITE",
    deliveryEnabled: true,
    deliveryFee: 750.5,
    deliveryFeeMode: "QUOTED_PER_ORDER",
    orderExpiryHours: 6,
  },
  partial: { deliveryFee: 300 },
  "null-fee": { deliveryFee: null, deliveryFeeMode: "QUOTED_PER_ORDER" },
  "null-mode": { deliveryFeeMode: null },
  decimals: { deliveryFee: 12.345 },
  negative: { deliveryFee: -1 },
  "hours-zero": { orderExpiryHours: 0 },
  "hours-max": { orderExpiryHours: 9000 },
  "bad-mode": { deliveryFeeMode: "PER_KM" },
  "bad-checkout": { checkoutMode: "TELEGRAM" },
  contradictory: { deliveryEnabled: true, deliveryFeeMode: "FLAT_RATE", deliveryFee: null },
  "enable-only": { deliveryEnabled: true },
};

/**
 * Exits with code 2 and the list of valid cases for an unrecognised
 * `--store-config=<caso>` — never sends a batch with a silently empty
 * configuration because of a typo'd flag.
 */
export function resolveStoreConfigCase(name) {
  if (Object.prototype.hasOwnProperty.call(STORE_CONFIG_CASES, name)) {
    return STORE_CONFIG_CASES[name];
  }
  console.error(`Unknown --store-config case "${name}". Valid cases:`);
  for (const key of Object.keys(STORE_CONFIG_CASES)) console.error(`  ${key}`);
  process.exit(2);
}

/**
 * The `payload` of a STORE event for the seeded store: the contact fields
 * (R21) are ALWAYS present, and the five purchase-configuration keys of
 * exactly one case are spread on top — never omitted by accident.
 */
export function buildStorePayload({
  storeId = "seed-tienda-1",
  businessId = "seed-negocio-1",
  businessName = "Distribuidora La Rampa",
  name = "La Rampa · Vedado",
  updatedAt,
  configCase = "none",
}) {
  return {
    storeId,
    businessId,
    businessName,
    name,
    ...SEED_STORE_CONTACT,
    baseCurrency: "CUP",
    ...resolveStoreConfigCase(configCase),
    publishToStore: true,
    updatedAt,
  };
}

/** A full `entity: "STORE"` sync event wrapping `buildStorePayload`. */
export function buildStoreEvent(eventId, options) {
  return {
    eventId,
    entity: "STORE",
    operation: "UPDATE",
    occurredAt: new Date().toISOString(),
    payload: buildStorePayload(options),
  };
}
