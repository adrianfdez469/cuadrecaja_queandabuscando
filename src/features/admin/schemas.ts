import { z } from "zod";
import { publicUrlPrefix } from "@/lib/supabase/storage";
import { PRODUCT_MAX_IMAGES } from "@/constants/media";
import { ADMIN_PRODUCT_DESCRIPTION_MAX_LENGTH } from "@/constants/admin";
import {
  STORE_DISABLED_REASON_CODES,
  STORE_DISABLED_MESSAGE_MAX_LENGTH,
} from "@/constants/storeClosure";
import { PROMOTION_MAX_PRODUCTS, PROMOTION_NAME_MAX_LENGTH } from "@/constants/promotions";
import type { GroupStoresBody, ProductWriteBody, PromotionBody, StoreStatusBody } from "./types";

/**
 * Validation for the panel's writes.
 *
 * Server-only (AGENTS.md: no Zod in the client tree). `productWriteSchema` is
 * checked against `ProductWriteBody` with `satisfies` so the two cannot
 * drift. The bucket-prefix check on `imageUrls` calls `publicUrlPrefix()`
 * inside a `.refine()` — evaluated at PARSE time, not at module load — so
 * importing this file never requires Storage's env vars to be configured.
 */

/** R15: `>= 0`, up to two decimals. "0" is a real price (ADR 0007). */
const decimal2 = z.string().regex(/^\d+(\.\d{1,2})?$/, "Not an amount with 2 decimals");

export const productWriteSchema = z
  .object({
    description: z
      .string()
      .trim()
      .max(ADMIN_PRODUCT_DESCRIPTION_MAX_LENGTH)
      .transform((v) => (v === "" ? null : v)) // R13
      .nullable()
      .default(null),
    imageUrls: z.array(z.string().url()).max(PRODUCT_MAX_IMAGES).default([]),
    priceOverride: decimal2.nullable().default(null),
    visible: z.boolean(),
    featured: z.boolean(),
  })
  .strict()
  .refine(
    // R21: only objects under our own bucket may be persisted.
    (data) => data.imageUrls.every((url) => url.startsWith(publicUrlPrefix())),
    { message: "imageUrls must be public URLs under the store's bucket", path: ["imageUrls"] },
  ) satisfies z.ZodType<ProductWriteBody>;

/**
 * HD10-HD14: `enabled: false` REQUIRES a `reasonCode` from the fixed list —
 * "closing without a reason" is a 400, not a silent default, and `"OTRO"`
 * additionally requires the free-text `message` (the whole point of
 * offering "Otro" is that the admin writes something).
 */
export const storeStatusBodySchema = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(true) }).strict(),
  z
    .object({
      enabled: z.literal(false),
      reasonCode: z.enum(STORE_DISABLED_REASON_CODES as [string, ...string[]]),
      message: z
        .string()
        .trim()
        .max(STORE_DISABLED_MESSAGE_MAX_LENGTH)
        .transform((v) => (v === "" ? null : v)) // R13
        .nullable()
        .default(null),
    })
    .strict()
    .refine((data) => data.reasonCode !== "OTRO" || Boolean(data.message), {
      message: "message is required when reasonCode is OTRO",
      path: ["message"],
    }),
]) satisfies z.ZodType<StoreStatusBody>;

/** HS8, etapa 2: the endpoint's whole body is one id — everything else
 *  (which stores, which brand) comes from the URL and the session. */
export const groupStoresBodySchema = z
  .object({ joiningStoreId: z.string().uuid() })
  .strict() satisfies z.ZodType<GroupStoresBody>;

/**
 * HD3/PP3. `scope` decides the shape of `conditions` (R30) — a `PRODUCT`
 * promotion with `localCategoryIds` (or vice versa) is a 400, not a
 * silently-ignored extra key (`.strict()` on each branch).
 */
const promotionValue = z.string().regex(/^\d+(\.\d{1,2})?$/, "Not an amount with 2 decimals");

const promotionBase = {
  name: z
    .string()
    .trim()
    .max(PROMOTION_NAME_MAX_LENGTH)
    .transform((v) => (v === "" ? null : v)) // R13
    .nullable()
    .default(null),
  type: z.enum(["PERCENTAGE", "FIXED"]),
  value: promotionValue,
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).nullable().default(null),
  active: z.boolean().default(true),
};

function percentageInRange(data: { type: string; value: string }): boolean {
  if (data.type !== "PERCENTAGE") return true;
  const n = Number(data.value);
  return n > 0 && n <= 100;
}

function fixedPositive(data: { type: string; value: string }): boolean {
  if (data.type !== "FIXED") return true;
  return Number(data.value) > 0;
}

function endsAfterStarts(data: { startsAt: string; endsAt: string | null }): boolean {
  if (!data.endsAt) return true;
  return new Date(data.endsAt).getTime() > new Date(data.startsAt).getTime();
}

export const promotionBodySchema = z
  .discriminatedUnion("scope", [
    z
      .object({
        scope: z.literal("PRODUCT"),
        ...promotionBase,
        conditions: z
          .object({
            storeProductIds: z.array(z.string().uuid()).min(1).max(PROMOTION_MAX_PRODUCTS),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        scope: z.literal("CATEGORY"),
        ...promotionBase,
        conditions: z.object({ localCategoryIds: z.array(z.string().uuid()).min(1) }).strict(),
      })
      .strict(),
    z
      .object({
        scope: z.literal("ORDER"),
        ...promotionBase,
        conditions: z.object({ minSubtotal: promotionValue.nullable().default(null) }).strict(),
      })
      .strict(),
  ])
  .refine(percentageInRange, { message: "PERCENTAGE must be in (0, 100]", path: ["value"] }) // R27
  .refine(fixedPositive, { message: "FIXED must be > 0", path: ["value"] }) // R27
  .refine(endsAfterStarts, {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  }) satisfies z.ZodType<PromotionBody>;
