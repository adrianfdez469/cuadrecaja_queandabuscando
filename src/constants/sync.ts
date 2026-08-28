/**
 * Numbers the sync ingestion would otherwise repeat as magic literals
 * (AGENTS.md § Prohibiciones).
 */

/**
 * F-024: rows per `createMany` statement when writing `CanonicalBarcode`.
 * Postgres caps a statement at 65 535 bound parameters and each row binds 2
 * (`canonicalProductId`, `ean`); with a realistic product (k ≤ 10 codes) this
 * never trips, but R11 allows an unbounded list, so the writer chunks instead
 * of failing the event forever on the absurd case.
 */
export const CANONICAL_BARCODE_INSERT_CHUNK = 1000;
