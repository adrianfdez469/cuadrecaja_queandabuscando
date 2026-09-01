import { z } from "zod";
import { CheckoutMode, DeliveryFeeMode } from "@/generated/prisma/enums";
import { STORE_DELIVERY_CONFIG_INCONSISTENT } from "@/constants/sync";

/**
 * Wire format for /api/internal/sync/*.
 *
 * Field names are English on the wire even though cuadrecaja's schema is in
 * Spanish, so that neither side has to translate at read time. The mapping is
 * documented in docs/sync-contract.md.
 *
 * `updatedAt` on every payload is the stale-write guard: an UPDATE only lands
 * when it is newer than what is already stored, which is what makes delivery
 * order irrelevant and retries safe.
 */

export const MAX_CATALOG_EVENTS = 500;
export const MAX_AVAILABILITY_ITEMS = 2000;

const isoDate = z.iso.datetime({ offset: true });

// --- payloads --------------------------------------------------------------

export const storePayloadSchema = z
  .object({
    storeId: z.string().min(1),
    businessId: z.string().min(1),
    businessName: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullish(),
    /** Optional: derived from the name when the POS does not supply one. */
    slug: z.string().nullish(),
    address: z.string().nullish(),
    city: z.string().nullish(),
    province: z.string().nullish(),
    latitude: z.number().min(-90).max(90).nullish(),
    longitude: z.number().min(-180).max(180).nullish(),
    phone: z.string().nullish(),
    whatsapp: z.string().nullish(),
    email: z.string().nullish(),
    openingHours: z.unknown().nullish(),
    baseCurrency: z.string().length(3).default("CUP"),
    /**
     * F-032 (R1-R3, R5, R19): the purchase configuration cuadrecaja is now the
     * owner of. All five are OPTIONAL and PLAIN (R2) — absent means "leave the
     * column alone", never "reset to the default" (R1, "omitir no es
     * apagar"). Vocabulary comes from the generated Prisma enums, never a
     * copied literal (R19). Only `deliveryFee` is `.nullish()`: `null` is the
     * one way the POS has to clear the fee when it moves to
     * `QUOTED_PER_ORDER` (R3/E4). `null` on any of the other four is a type
     * error (R3/E5) — the column is not nullable, so translating `null` to
     * "default" or "absent" would invent a meaning the POS cannot ask for.
     */
    checkoutMode: z.enum(CheckoutMode).optional(),
    deliveryEnabled: z.boolean().optional(),
    /** R5: `Decimal(14,2)` — more decimals round silently, more digits
     *  overflow into a Postgres 22003 (a 500 instead of a 400). */
    deliveryFee: z.number().nonnegative().multipleOf(0.01).max(999999999999.99).nullish(),
    deliveryFeeMode: z.enum(DeliveryFeeMode).optional(),
    /** R5: `expiry.ts`/`proposal.ts` do `now() ± make_interval(hours => …)`;
     *  a value near `INT_MAX` pushes the timestamp out of range and breaks the
     *  expiry sweep for every tenant, not just this one. */
    orderExpiryHours: z.int().min(1).max(8760).optional(),
    /** The business's opt-in for this specific location. */
    publishToStore: z.boolean(),
    /** v3, optional (HD15, proposed in docs/sync-contract.md). Shown to the
     *  shopper when `publishToStore` is false; ignored otherwise. */
    unpublishReason: z.string().max(160).nullish(),
    updatedAt: isoDate,
  })
  .refine(
    (p) =>
      !(p.deliveryEnabled === true && p.deliveryFeeMode === "FLAT_RATE" && p.deliveryFee === null),
    { error: STORE_DELIVERY_CONFIG_INCONSISTENT, path: ["deliveryFee"] },
  );

export const categoryPayloadSchema = z.object({
  categoryId: z.string().min(1),
  businessId: z.string().min(1),
  name: z.string().min(1),
  color: z.string().nullish(),
  updatedAt: isoDate,
});

export const productPayloadSchema = z.object({
  /** cuadrecaja ProductoTienda.id — the per-store identity. */
  storeProductId: z.string().min(1),
  /** cuadrecaja Producto.id — shared across the business's locations. */
  productId: z.string().min(1),
  businessId: z.string().min(1),
  storeId: z.string().min(1),
  localName: z.string().min(1),
  /** F-024 v4 (R1): obligatory, list of text, `[]` valid. No `.max()` (R11):
   *  a cap would turn a datum the POS cannot change into a permanent 400. */
  barcodes: z.array(z.string()),
  /** F-024 v4 (R2): the singular key is FORBIDDEN, not merely ignored. Zod
   *  silently drops unknown keys, so leaving it out of the object would not
   *  satisfy criterion 1 — its presence must produce an `issue` and the 400. */
  barcode: z
    .never({ error: "`barcode` was removed in contract v4 — send `barcodes: string[]` instead" })
    .optional(),
  localCategoryId: z.string().nullish(),
  price: z.number().nonnegative(),
  currency: z.string().length(3),
  canonicalProductId: z.string().nullish(),
  imageUrl: z.string().nullish(),
  /** Per-product publication flag, owned by the POS. */
  publishToStore: z.boolean(),
  updatedAt: isoDate,
});

export const currencyPayloadSchema = z.object({
  code: z.string().length(3),
  name: z.string().min(1),
  symbol: z.string().min(1),
  active: z.boolean().default(true),
  updatedAt: isoDate,
});

export const exchangeRatePayloadSchema = z.object({
  businessId: z.string().min(1),
  currency: z.string().length(3),
  /** CUP per 1 unit. CUP itself is never sent. */
  rate: z.number().positive(),
  updatedAt: isoDate,
});

// --- envelope --------------------------------------------------------------

export const syncOperationSchema = z.enum(["CREATE", "UPDATE", "DELETE"]);

/**
 * Discriminated on `entity` so a malformed product payload cannot be silently
 * accepted as some other entity's shape.
 */
export const syncEventSchema = z.discriminatedUnion("entity", [
  z.object({
    eventId: z.string().min(1),
    entity: z.literal("STORE"),
    operation: syncOperationSchema,
    occurredAt: isoDate,
    payload: storePayloadSchema,
  }),
  z.object({
    eventId: z.string().min(1),
    entity: z.literal("CATEGORY"),
    operation: syncOperationSchema,
    occurredAt: isoDate,
    payload: categoryPayloadSchema,
  }),
  z.object({
    eventId: z.string().min(1),
    entity: z.literal("PRODUCT"),
    operation: syncOperationSchema,
    occurredAt: isoDate,
    payload: productPayloadSchema,
  }),
  z.object({
    eventId: z.string().min(1),
    entity: z.literal("CURRENCY"),
    operation: syncOperationSchema,
    occurredAt: isoDate,
    payload: currencyPayloadSchema,
  }),
  z.object({
    eventId: z.string().min(1),
    entity: z.literal("EXCHANGE_RATE"),
    operation: syncOperationSchema,
    occurredAt: isoDate,
    payload: exchangeRatePayloadSchema,
  }),
]);

export const catalogBatchSchema = z.object({
  businessId: z.string().min(1),
  events: z.array(syncEventSchema).min(1).max(MAX_CATALOG_EVENTS),
});

export const availabilityBatchSchema = z.object({
  businessId: z.string().min(1),
  items: z
    .array(
      z.object({
        storeProductId: z.string().min(1),
        storeId: z.string().min(1),
        availability: z.enum(["OUT_OF_STOCK", "LOW_STOCK", "AVAILABLE"]),
      }),
    )
    .min(1)
    .max(MAX_AVAILABILITY_ITEMS),
});

// --- results ---------------------------------------------------------------

/**
 * Every status except `failed` means "do not send this again".
 * The POS marks its outbox row done for anything listed in `ok`.
 */
export const EVENT_STATUS = [
  "processed",
  "duplicate",
  "skipped_not_published",
  "stale",
  "failed",
] as const;

export type EventStatus = (typeof EVENT_STATUS)[number];

export type EventResult = {
  eventId: string;
  status: EventStatus;
  error?: string;
};

export type CatalogBatchResponse = {
  /** Event ids the POS may mark as processed. */
  ok: string[];
  failed: { id: string; error: string }[];
  /** Per-event detail, for logging and debugging. */
  results: EventResult[];
};

export type SyncEventInput = z.infer<typeof syncEventSchema>;
export type ProductPayload = z.infer<typeof productPayloadSchema>;
export type StorePayload = z.infer<typeof storePayloadSchema>;
export type CategoryPayload = z.infer<typeof categoryPayloadSchema>;
export type CurrencyPayload = z.infer<typeof currencyPayloadSchema>;
export type ExchangeRatePayload = z.infer<typeof exchangeRatePayloadSchema>;

export function summarize(results: EventResult[]): CatalogBatchResponse {
  return {
    ok: results.filter((r) => r.status !== "failed").map((r) => r.eventId),
    failed: results
      .filter((r) => r.status === "failed")
      .map((r) => ({ id: r.eventId, error: r.error ?? "UNKNOWN_ERROR" })),
    results,
  };
}
