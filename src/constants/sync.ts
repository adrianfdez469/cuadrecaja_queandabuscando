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

/**
 * F-037 (R9, R20): an otherwise-correct event that does NOT get applied
 * because another, earlier event of the SAME batch that it depends on
 * failed (`CATEGORY` → its `PRODUCT`s, `CURRENCY` → its `EXCHANGE_RATE`s).
 * Travels as-is, with no adornment, in `failed[].error` of the `207` and in
 * `SyncEvent.error` — the POS compares it against the exact string in
 * `docs/sync-contract.md` § Vocabulario de errores.
 */
export const DEPENDENCY_FAILED_IN_BATCH = "DEPENDENCY_FAILED_IN_BATCH";

/**
 * F-038 R3/R14 (contract v12): a `BUSINESS` event whose `displayCurrencies`
 * contains a member that is not exactly three uppercase A-Z letters
 * (`/^[A-Z]{3}$/`, never case-folded, never trimmed). Fails that event alone
 * (`207 failed[]`); the batch's other events still apply.
 */
export const BUSINESS_DISPLAY_CURRENCIES_INVALID = "BUSINESS_DISPLAY_CURRENCIES_INVALID";

/**
 * F-038 R5/R14 (contract v12): a `BUSINESS` event with `operation: "DELETE"`.
 * `DELETE` is not an operation this entity supports — there is no per-item
 * row to remove, only a whole-list replace — so it is rejected as malformed
 * rather than applied, BEFORE the anti-stale guard (R5/E6): to send an empty
 * list, emit `displayCurrencies: []` instead.
 */
export const BUSINESS_DELETE_NOT_SUPPORTED = "BUSINESS_DELETE_NOT_SUPPORTED";

/**
 * F-041 R17: a `ZONE_TARIFF` (or a `STORE.zoneCode`'s schema-level check —
 * see `STORE_ZONE_UNKNOWN` below for the row-level one) whose `zoneCode` is
 * not in the committed catalog (`src/features/zones/catalog.ts`). Decided in
 * the sobre's schema, against the ARTEFACT — zero database queries (I7) —
 * so it kills the whole `400 INVALID_BATCH` lote, same class of cost the ADR
 * 0028 § Consecuencias already accepted for a malformed value (I6).
 *
 * Class for cuadrecaja's outbox (S-007 point 9): RETRYABLE. The event is not
 * malformed — it names a real zone the two catalogs have not converged on
 * yet — so the SAME event, unchanged, can end up applying once this side's
 * catalog artefact catches up. Not one of `QAB_OUTBOX_PERMANENT_ERROR_CODES`.
 */
export const ZONE_TARIFF_ZONE_UNKNOWN = "ZONE_TARIFF_ZONE_UNKNOWN";

/**
 * F-041 R15: `deliveryFee` present (including an explicit `null`) on a
 * `ZONE_TARIFF` whose `rule` is `NOT_SERVED` or `INHERIT` — both forbid an
 * amount. Lives inside a `400`'s `issues[].message` (precedent: `barcode`,
 * `src/features/sync/schemas.ts`), not in the wire's error vocabulary: the
 * three codes the POS compares byte for byte are this one's siblings below.
 *
 * Class for cuadrecaja's outbox (S-007 point 9): PERMANENT. The same
 * `payload`, with the same `deliveryFee` where `rule` forbids it, fails
 * identically forever — the POS has to drop the field or change `rule`
 * before resending, same reasoning as `STORE_DELIVERY_CONFIG_INCONSISTENT`.
 */
export const ZONE_TARIFF_FEE_NOT_ALLOWED = "ZONE_TARIFF_FEE_NOT_ALLOWED";

/**
 * F-041 R20: a `ZONE_TARIFF` with `operation: "DELETE"`. Not an operation
 * this entity supports — `INHERIT` is the only retraction there is — thrown
 * FIRST in the handler, before any query and before the anti-stale guard:
 * a format error cannot depend on a timestamp (precedent:
 * `src/features/sync/server/handlers/business.ts`'s
 * `BUSINESS_DELETE_NOT_SUPPORTED`).
 *
 * Class for cuadrecaja's outbox (S-007 point 9): PERMANENT. A `DELETE`
 * never becomes valid by retrying it unchanged — the POS has to resend the
 * same row as an `UPDATE` with `rule: "INHERIT"` instead.
 */
export const ZONE_TARIFF_DELETE_NOT_SUPPORTED = "ZONE_TARIFF_DELETE_NOT_SUPPORTED";

/**
 * F-041 R18: a `STORE` payload's `zoneCode` is not in the committed catalog.
 * Thrown in `src/features/sync/server/handlers/store.ts`, BEFORE each of the
 * three writes it guards (same pattern as `STORE_OPENING_HOURS_INVALID`):
 * the whole event fails, none of its other fields apply, and
 * `sourceUpdatedAt` does not advance.
 *
 * Class for cuadrecaja's outbox (S-007 point 9): RETRYABLE, same reasoning
 * as `ZONE_TARIFF_ZONE_UNKNOWN` above — the code names a real zone the two
 * catalogs have not converged on yet, not a malformed value.
 */
export const STORE_ZONE_UNKNOWN = "STORE_ZONE_UNKNOWN";
