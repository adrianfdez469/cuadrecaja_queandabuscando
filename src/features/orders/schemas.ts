import { z } from "zod";
import { CART_MAX_LINES, CART_MAX_QTY_PER_LINE, CART_MIN_QTY_PER_LINE } from "@/constants/cart";
import {
  CONTACT_EMAIL_MAX_LENGTH,
  CONTACT_NAME_MAX_LENGTH,
  CONTACT_NAME_MIN_LENGTH,
  CONTACT_PHONE_MAX_DIGITS,
  CONTACT_PHONE_MIN_DIGITS,
  DELIVERY_ADDRESS_MAX_LENGTH,
  DELIVERY_ADDRESS_MIN_LENGTH,
  ORDER_NOTES_MAX_LENGTH,
  ORDER_PROPOSAL_MESSAGE_MAX_LENGTH,
} from "@/constants/orders";
import { add, money, subtract, sum, type Money } from "@/lib/money";
import { normalizeName, normalizePhone } from "./contact";
import type {
  CreateOrderBody,
  CreateOrderContact,
  CreateOrderItem,
  Fulfillment,
  ProposalItem,
  ProposalPayload,
  QuoteRequestBody,
  QuoteRequestItem,
} from "./types";

/**
 * The only validation in this feature that decides anything (R6). Server
 * only — importing this from a client component would drag Zod (~13 KB
 * gzip) into a page that has to stay small. `features/cart/parseCart.ts` is
 * the hand-written equivalent that the client uses instead.
 *
 * Every schema is checked against its wire type with `satisfies`, so the
 * shape this validates cannot quietly drift from what the islands assume.
 */

const storeProductIdSchema = z.string().uuid();
const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Not a decimal amount");

const quoteItemSchema = z.object({
  storeProductId: storeProductIdSchema,
  qty: z.number().int().min(CART_MIN_QTY_PER_LINE).max(CART_MAX_QTY_PER_LINE),
}) satisfies z.ZodType<QuoteRequestItem>;

export const quoteRequestSchema = z.object({
  storeSlug: z.string().trim().min(1),
  items: z.array(quoteItemSchema).max(CART_MAX_LINES),
}) satisfies z.ZodType<QuoteRequestBody>;

const nameSchema = z
  .string()
  .transform((value) => normalizeName(value))
  .refine((value) => value.length >= CONTACT_NAME_MIN_LENGTH, "Name is too short")
  .refine((value) => value.length <= CONTACT_NAME_MAX_LENGTH, "Name is too long");

const phoneSchema = z
  .string()
  .transform((value) => normalizePhone(value))
  .refine((value) => {
    const digits = value.startsWith("+") ? value.slice(1) : value;
    return (
      /^\d+$/.test(digits) &&
      digits.length >= CONTACT_PHONE_MIN_DIGITS &&
      digits.length <= CONTACT_PHONE_MAX_DIGITS
    );
  }, `Phone must have between ${CONTACT_PHONE_MIN_DIGITS} and ${CONTACT_PHONE_MAX_DIGITS} digits`);

const emailSchema = z.string().trim().max(CONTACT_EMAIL_MAX_LENGTH).email();

const contactSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  email: emailSchema.optional(),
}) satisfies z.ZodType<CreateOrderContact>;

const fulfillmentSchema = z.enum(["PICKUP", "DELIVERY"]) satisfies z.ZodType<Fulfillment>;

const createOrderItemSchema = z.object({
  storeProductId: storeProductIdSchema,
  qty: z.number().int().min(CART_MIN_QTY_PER_LINE).max(CART_MAX_QTY_PER_LINE),
  expectedUnitPrice: decimalStringSchema.optional(),
}) satisfies z.ZodType<CreateOrderItem>;

/**
 * Items may legitimately be empty here: the empty-cart check happens in
 * `createOrder.ts` and answers with the specific `EMPTY_CART` error, not a
 * generic `INVALID_BODY` (architecture.md § Flujo de datos, step 3).
 */
export const createOrderRequestSchema = z
  .object({
    storeSlug: z.string().trim().min(1),
    items: z.array(createOrderItemSchema).max(CART_MAX_LINES),
    contact: contactSchema,
    fulfillment: fulfillmentSchema,
    deliveryAddress: z
      .string()
      .trim()
      .min(DELIVERY_ADDRESS_MIN_LENGTH)
      .max(DELIVERY_ADDRESS_MAX_LENGTH)
      .optional(),
    notes: z.string().trim().max(ORDER_NOTES_MAX_LENGTH).optional(),
    expectedTotal: decimalStringSchema,
    idempotencyKey: z.string().uuid().optional(),
  })
  .superRefine((body, ctx) => {
    if (body.fulfillment === "DELIVERY" && !body.deliveryAddress) {
      ctx.addIssue({
        code: "custom",
        message: "Delivery address is required when fulfillment is DELIVERY",
        path: ["deliveryAddress"],
      });
    }
  }) satisfies z.ZodType<CreateOrderBody>;

export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

// ---------------------------------------------------------------------------
// F-019 — proposing a change (architecture.md DA2 § Contratos)
// ---------------------------------------------------------------------------

const proposalItemSchema = z.object({
  storeProductId: storeProductIdSchema.nullable(),
  name: z.string().trim().min(1).max(200),
  unitPrice: decimalStringSchema,
  currencyCode: z.string().length(3),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
  lineTotal: decimalStringSchema,
  originalUnitPrice: decimalStringSchema.optional(),
  originalCurrencyCode: z.string().length(3).optional(),
}) satisfies z.ZodType<ProposalItem>;

/**
 * The one validation in this feature that decides money math (mirrors R6's
 * rule for the checkout): `Σ lineTotal = subtotal` and
 * `total = subtotal - discountTotal + deliveryFee`, checked with
 * `src/lib/money.ts` — never `Number` on a decimal string. A currency other
 * than `Order.currencyCode` is NOT caught here (this schema has no database
 * access): `proposeOrderChange` rejects that with `CURRENCY_MISMATCH` (400).
 */
export const proposeOrderChangeSchema = z
  .object({
    orderId: z.string().min(1),
    currencyCode: z.string().length(3),
    subtotal: decimalStringSchema,
    discountTotal: decimalStringSchema.default("0"),
    deliveryFee: decimalStringSchema,
    total: decimalStringSchema,
    message: z.string().trim().max(ORDER_PROPOSAL_MESSAGE_MAX_LENGTH).nullish(),
    items: z.array(proposalItemSchema).min(1).max(CART_MAX_LINES),
  })
  .superRefine((body, ctx) => {
    const currency = body.currencyCode;

    const mismatchedLine = body.items.some((item) => item.currencyCode !== currency);
    if (mismatchedLine) {
      ctx.addIssue({
        code: "custom",
        message: "Every line must be in the proposal's own currency",
        path: ["items"],
      });
      return;
    }

    let subtotal: Money;
    let discountTotal: Money;
    let deliveryFee: Money;
    let total: Money;
    let lineTotals: Money[];
    try {
      subtotal = money(body.subtotal, currency);
      discountTotal = money(body.discountTotal, currency);
      deliveryFee = money(body.deliveryFee, currency);
      total = money(body.total, currency);
      lineTotals = body.items.map((item) => money(item.lineTotal, currency));
    } catch {
      ctx.addIssue({ code: "custom", message: "Invalid amount", path: [] });
      return;
    }

    const sumLineTotals = sum(lineTotals, currency);
    if (sumLineTotals.amount !== subtotal.amount) {
      ctx.addIssue({
        code: "custom",
        message: "Σ lineTotal must equal subtotal",
        path: ["subtotal"],
      });
    }

    const expectedTotal = add(subtract(subtotal, discountTotal), deliveryFee);
    if (expectedTotal.amount !== total.amount) {
      ctx.addIssue({
        code: "custom",
        message: "total must equal subtotal - discountTotal + deliveryFee",
        path: ["total"],
      });
    }
  }) satisfies z.ZodType<ProposalPayload>;

export type ProposeOrderChangeRequest = z.infer<typeof proposeOrderChangeSchema>;
