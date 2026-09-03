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

/**
 * F-022 E10/SP3: a `STORE` event whose `openingHours` does not match the
 * format `src/lib/openingHours.ts` validates. Thrown by
 * `assertOpeningHoursValid` in `src/features/sync/server/handlers/store.ts`,
 * BEFORE the write it guards — the same pattern as
 * `STORE_DELIVERY_CONFIG_INCONSISTENT` above. That event fails whole: none
 * of its other fields (a corrected `name` or `phone`) apply either, and the
 * rest of the batch still does.
 */
export const STORE_OPENING_HOURS_INVALID = "STORE_OPENING_HOURS_INVALID";

/**
 * F-022 R12: `Store.timezone` fails `isCanonicalTimeZone` (`src/lib/timezone.ts`)
 * at the moment a `STORE` event would set `status: "PUBLISHED"` (create, or
 * republish when the opt-in flips). The row's zone never becomes readable by
 * this event alone — only a corrected `UPDATE` (docs/despliegue.md, while
 * F-011 has no editor) fixes it.
 */
export const STORE_TIMEZONE_INVALID = "STORE_TIMEZONE_INVALID";

/**
 * F-034: hard cap on `POST /api/provisioning/credential`'s body — the same
 * pattern as `ORDER_MAX_BODY_BYTES` (`src/constants/orders.ts`). The body is
 * just `{ externalId, name? }`, so 4 KB is generous headroom over the 128 +
 * 200 character limits the schema already enforces, not a tight budget.
 */
export const PROVISIONING_MAX_BODY_BYTES = 4096;
