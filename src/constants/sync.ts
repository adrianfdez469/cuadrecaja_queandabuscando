/**
 * Numbers and error codes the sync ingestion would otherwise repeat as magic
 * literals (AGENTS.md § Prohibiciones).
 */

/**
 * F-024: rows per `createMany` statement when writing `CanonicalBarcode`.
 * Postgres caps a statement at 65 535 bound parameters and each row binds 2
 * (`canonicalProductId`, `ean`); with a realistic product (k ≤ 10 codes) this
 * never trips, but R11 allows an unbounded list, so the writer chunks instead
 * of failing the event forever on the absurd case.
 */
export const CANONICAL_BARCODE_INSERT_CHUNK = 1000;

/**
 * F-032 R8/R10: a `STORE` event would leave `deliveryEnabled: true` with
 * `deliveryFeeMode: "FLAT_RATE"` and `deliveryFee: NULL` — a store that says
 * it offers delivery with nothing to charge for it. The single token for
 * both halves of the guard (§ R10): the `refine` on `storePayloadSchema`
 * uses it as the Zod `400` `issues[].message`, and `SyncEventFailure` uses it
 * as the `207` `failed[].error` when the row is what makes it contradictory.
 */
export const STORE_DELIVERY_CONFIG_INCONSISTENT = "STORE_DELIVERY_CONFIG_INCONSISTENT";
