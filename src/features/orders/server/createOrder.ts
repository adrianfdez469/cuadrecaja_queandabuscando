import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { add, money, type Money } from "@/lib/money";
import { generateOrderCode } from "@/lib/orderCode";
import { CART_MAX_QTY_PER_LINE, CART_MIN_QTY_PER_LINE } from "@/constants/cart";
import {
  ORDER_CODE_MAX_RETRIES,
  ORDER_RATE_LIMIT_MAX_PENDING,
  ORDER_RATE_LIMIT_WINDOW_MINUTES,
} from "@/constants/orders";
import type { CreateOrderRequest } from "../schemas";
import type { PriceChangedLine, QuoteLineReason, UnavailableLine } from "../types";
import { isUniqueViolation } from "./prismaErrors";
import { getOrderByCode, orderWhatsappUrl } from "./read";
import { loadStoreForOrder, quoteCart, type OrderableLine, type OrderStore } from "./quote";

/**
 * Creación del pedido.
 *
 * Follows the exact step order architecture.md fixes (§ Flujo de datos):
 * store lookup, merge duplicate lines, empty-cart check, quote + availability,
 * price check, ONE query for idempotency + abuse guard (idempotency wins),
 * then a nested `create`. No `$transaction` anywhere — the pooler runs in
 * transaction mode (ficha pooler-transaccion-deadlock) and this whole flow is
 * either read-only or a single round-trip write.
 */

export type CreateOrderResult =
  | { kind: "created"; code: string; orderUrl: string; whatsappUrl: string | null }
  | { kind: "idempotent"; code: string; orderUrl: string; whatsappUrl: string | null }
  | { kind: "empty_cart" }
  | { kind: "store_not_found" }
  | { kind: "items_unavailable"; lines: UnavailableLine[] }
  | { kind: "price_changed"; lines: PriceChangedLine[]; total: string }
  | { kind: "too_many_orders"; retryAfterSeconds: number }
  | { kind: "failed" };

type MergedItem = { storeProductId: string; qty: number; expectedUnitPrice?: string };

/**
 * Sums duplicate `storeProductId`s BEFORE the 99-per-line cap applies (spec §
 * casos límite). The merged quantity is clamped rather than rejected: R14
 * fixes the ceiling at 99, and clamping keeps this from needing an error kind
 * the contract does not define for a case no criterion exercises.
 */
function mergeItems(items: CreateOrderRequest["items"]): MergedItem[] {
  const merged = new Map<string, MergedItem>();
  for (const item of items) {
    const existing = merged.get(item.storeProductId);
    if (existing) {
      existing.qty = Math.min(existing.qty + item.qty, CART_MAX_QTY_PER_LINE);
      if (existing.expectedUnitPrice === undefined) {
        existing.expectedUnitPrice = item.expectedUnitPrice;
      }
    } else {
      merged.set(item.storeProductId, {
        storeProductId: item.storeProductId,
        qty: Math.max(CART_MIN_QTY_PER_LINE, Math.min(item.qty, CART_MAX_QTY_PER_LINE)),
        expectedUnitPrice: item.expectedUnitPrice,
      });
    }
  }
  return [...merged.values()];
}

function orderUrlFor(storeSlug: string, code: string): string {
  return `/${storeSlug}/pedido/${code}`;
}

/**
 * Reads back what was just written (or already existed, for the idempotent
 * path) to build the wa.me link from the PERSISTED snapshot — never from the
 * in-memory quote. `orderWhatsappUrl` (features/orders/server/read.ts) is the
 * same function `/[slug]/pedido/[code]` uses, so the two can never disagree.
 */
async function buildWhatsappUrlForOrder(store: OrderStore, code: string): Promise<string | null> {
  // Avoid the extra read entirely for ONSITE — the link never renders there
  // (E18), so there is nothing to fetch a snapshot for.
  if (store.checkoutMode !== "WHATSAPP") return null;

  const snapshot = await getOrderByCode(store.slug, code);
  return snapshot ? orderWhatsappUrl(snapshot) : null;
}

async function toCreatedResult(store: OrderStore, code: string): Promise<CreateOrderResult> {
  return {
    kind: "created",
    code,
    orderUrl: orderUrlFor(store.slug, code),
    whatsappUrl: await buildWhatsappUrlForOrder(store, code),
  };
}

async function toIdempotentResult(store: OrderStore, code: string): Promise<CreateOrderResult> {
  return {
    kind: "idempotent",
    code,
    orderUrl: orderUrlFor(store.slug, code),
    whatsappUrl: await buildWhatsappUrlForOrder(store, code),
  };
}

export async function createOrder(body: CreateOrderRequest): Promise<CreateOrderResult> {
  // 1. Store lookup. Nothing else is consulted if this fails.
  const store = await loadStoreForOrder(body.storeSlug);
  if (!store) return { kind: "store_not_found" };

  // 2. Merge duplicate lines before anything else sees them.
  const mergedItems = mergeItems(body.items);

  // 3. An empty cart is its own error, not a generic 400.
  if (mergedItems.length === 0) return { kind: "empty_cart" };

  // 4. Quote + availability. quoteCart is the single source of price (R4, R6).
  const quote = await quoteCart(
    store,
    mergedItems.map((item) => ({ storeProductId: item.storeProductId, qty: item.qty })),
  );

  const unavailable = quote.lines.filter((line) => !line.orderable);
  if (unavailable.length > 0) {
    return {
      kind: "items_unavailable",
      lines: unavailable.map((line) => ({
        storeProductId: line.storeProductId,
        reason: (line as { reason: QuoteLineReason }).reason,
      })),
    };
  }

  const orderableLines = quote.lines.filter((line): line is OrderableLine => line.orderable);

  // R3: delivery only exists where the store offers it. A client asking for
  // DELIVERY at a store that does not is treated as PICKUP rather than
  // invented as a new error kind the contract does not define.
  const deliveryOffered = store.deliveryEnabled && store.deliveryFee !== null;
  const isDelivery = body.fulfillment === "DELIVERY" && deliveryOffered;
  const deliveryFee: Money = isDelivery
    ? money(store.deliveryFee as string, store.currencyCode)
    : money("0", store.currencyCode);
  const deliveryAddress = isDelivery ? (body.deliveryAddress ?? null) : null;

  const total = add(quote.subtotal, deliveryFee);
  const expectedTotal = money(body.expectedTotal, store.currencyCode);

  // 5. Price check, BEFORE the abuse guard: a stale total must not spend
  // a slot of the rate limit (architecture.md § Flujo de datos, step 5).
  if (total.amount !== expectedTotal.amount) {
    const anyExpectedUnitPrice = mergedItems.some((item) => item.expectedUnitPrice !== undefined);
    const expectedByProduct = new Map(
      mergedItems.map((item) => [item.storeProductId, item.expectedUnitPrice]),
    );

    const lines: PriceChangedLine[] = anyExpectedUnitPrice
      ? orderableLines
          .filter((line) => {
            const expected = expectedByProduct.get(line.storeProductId);
            return expected !== undefined && expected !== line.unitPrice.amount;
          })
          .map((line) => ({
            storeProductId: line.storeProductId,
            was: expectedByProduct.get(line.storeProductId) ?? null,
            now: line.unitPrice.amount,
          }))
      : orderableLines.map((line) => ({
          storeProductId: line.storeProductId,
          was: null,
          now: line.unitPrice.amount,
        }));

    return { kind: "price_changed", lines, total: total.amount };
  }

  const phone = body.contact.phone;

  // 6. ONE query, idempotency OR the abuse window — never a $transaction.
  const windowStart = new Date(Date.now() - ORDER_RATE_LIMIT_WINDOW_MINUTES * 60_000);
  const branches: Prisma.OrderWhereInput[] = [
    { storeId: store.id, contactPhone: phone, status: "PENDING", createdAt: { gte: windowStart } },
  ];
  // Only add the key branch when a key was sent — an `undefined` field would
  // be dropped by Prisma and match every order in the table (R28 vs a leak).
  if (body.idempotencyKey) {
    branches.unshift({ storeId: store.id, idempotencyKey: body.idempotencyKey });
  }

  const guardRows = await prisma.order.findMany({
    where: { OR: branches },
    select: { id: true, code: true, idempotencyKey: true, status: true, createdAt: true },
  });

  if (body.idempotencyKey) {
    const existing = guardRows.find((row) => row.idempotencyKey === body.idempotencyKey);
    if (existing) return toIdempotentResult(store, existing.code);
  }

  const pendingInWindow = guardRows.filter(
    (row) => row.status === "PENDING" && row.createdAt >= windowStart,
  );
  if (pendingInWindow.length >= ORDER_RATE_LIMIT_MAX_PENDING) {
    const oldest = pendingInWindow.reduce(
      (min, row) => (row.createdAt < min ? row.createdAt : min),
      pendingInWindow[0].createdAt,
    );
    const retryAfterMs = oldest.getTime() + ORDER_RATE_LIMIT_WINDOW_MINUTES * 60_000 - Date.now();
    return {
      kind: "too_many_orders",
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  // 7. Nested create, atomic in one round-trip. Retries only the code.
  const rateSnapshot = buildRateSnapshot(
    store.currencyCode,
    orderableLines,
    quote.rates,
    quote.capturedAt,
  );

  for (let attempt = 0; attempt < ORDER_CODE_MAX_RETRIES; attempt += 1) {
    const code = generateOrderCode();
    try {
      await prisma.order.create({
        data: {
          code,
          storeId: store.id,
          customerId: null,
          contactName: body.contact.name,
          contactPhone: phone,
          contactEmail: body.contact.email ?? null,
          deliveryAddress,
          status: "PENDING",
          currencyCode: store.currencyCode,
          subtotal: quote.subtotal.amount,
          discountTotal: "0",
          deliveryFee: deliveryFee.amount,
          total: total.amount,
          rateSnapshot,
          notes: body.notes ?? null,
          idempotencyKey: body.idempotencyKey ?? null,
          items: {
            create: orderableLines.map((line) => ({
              storeProductId: line.storeProductId,
              name: line.name,
              unitPrice: line.unitPrice.amount,
              currencyCode: line.unitPrice.currency,
              quantity: line.qty,
              lineTotal: line.lineTotal.amount,
              originalUnitPrice: line.originalUnitPrice.amount,
              originalCurrencyCode: line.originalUnitPrice.currency,
            })),
          },
        },
        select: { code: true },
      });

      return toCreatedResult(store, code);
    } catch (error) {
      if (isUniqueViolation(error, "code")) continue; // collision: try another code

      if (isUniqueViolation(error, "idempotencyKey") && body.idempotencyKey) {
        // Lost a race against a concurrent request with the same key.
        const existing = await prisma.order.findFirst({
          where: { idempotencyKey: body.idempotencyKey, storeId: store.id },
          select: { code: true },
        });
        if (existing) return toIdempotentResult(store, existing.code);

        // The key exists but not for this store: never surface another
        // store's order. Fail closed and log for investigation.
        console.error("[orders] idempotencyKey collided outside its store", { storeId: store.id });
        return { kind: "failed" };
      }

      throw error;
    }
  }

  console.error("[orders] exhausted code retries", { storeId: store.id });
  return { kind: "failed" };
}

/** Only the currencies actually used in the order, excluding the base (R9). */
function buildRateSnapshot(
  baseCurrency: string,
  lines: OrderableLine[],
  rates: Record<string, string>,
  capturedAt: string,
): Prisma.InputJsonValue {
  const used: Record<string, string> = {};
  for (const line of lines) {
    const currency = line.originalUnitPrice.currency;
    if (currency !== baseCurrency && currency in rates) used[currency] = rates[currency];
  }
  return { base: baseCurrency, capturedAt, rates: used };
}
