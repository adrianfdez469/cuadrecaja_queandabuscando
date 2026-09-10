import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { add, money, subtract, type Money } from "@/lib/money";
import { generateOrderCode } from "@/lib/orderCode";
import { CART_MAX_QTY_PER_LINE, CART_MIN_QTY_PER_LINE } from "@/constants/cart";
import {
  ORDER_CODE_MAX_RETRIES,
  ORDER_RATE_LIMIT_MAX_PENDING,
  ORDER_RATE_LIMIT_WINDOW_MINUTES,
} from "@/constants/orders";
import type { CreateOrderRequest } from "../schemas";
import type { PriceChangedLine, QuoteLineReason, UnavailableLine } from "../types";
import {
  deliveryFeeForNewOrder,
  isDeliveryOffered,
  type ChosenZone,
  type DeliveryConfig,
} from "../deliveryOffer";
import { isUniqueViolation } from "./prismaErrors";
import { getOrderByCode, orderWhatsappUrl } from "./read";
import { loadStoreForOrder, quoteCart, type OrderableLine, type OrderStore } from "./quote";
import { loadStoreZoneCoverage } from "@/features/zones/server/coverage";
import type { OfferableZone } from "@/features/zones/coverage";

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
  // F-020: `businessId` is what the first trigger's `after()` call needs
  // (architecture.md § Componentes, "businessId en el resultado") — only
  // this variant, never "idempotent" (E16: a 200-idempotent response has no
  // new row to pull, so it never rings).
  | {
      kind: "created";
      code: string;
      orderUrl: string;
      whatsappUrl: string | null;
      businessId: string;
    }
  | { kind: "idempotent"; code: string; orderUrl: string; whatsappUrl: string | null }
  | { kind: "empty_cart" }
  | { kind: "store_not_found" }
  | {
      kind: "store_closed";
      reasonCode: string | null;
      message: string | null;
      disabledAt: Date | null;
    }
  | { kind: "items_unavailable"; lines: UnavailableLine[] }
  | {
      kind: "price_changed";
      lines: PriceChangedLine[];
      total: string;
      /** F-042 E15/C13: presente solo cuando el desajuste incluye el
       *  envío. */
      delivery?: { was: string | null; now: string };
    }
  | { kind: "too_many_orders"; retryAfterSeconds: number }
  // F-042 (architecture.md § AD7, § Flujo C): los dos desenlaces nuevos del
  // paso 4.2, antes de tocar la comparación de totales — un pedido con la
  // zona mal no gasta una ranura del límite de abuso.
  | { kind: "delivery_zone_required" }
  | { kind: "delivery_zone_not_served"; zoneCode: string }
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

  const snapshot = await getOrderByCode(store.id, code);
  return snapshot ? orderWhatsappUrl(snapshot) : null;
}

async function toCreatedResult(store: OrderStore, code: string): Promise<CreateOrderResult> {
  return {
    kind: "created",
    code,
    orderUrl: orderUrlFor(store.slug, code),
    whatsappUrl: await buildWhatsappUrlForOrder(store, code),
    businessId: store.businessId,
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

export async function createOrder(
  body: CreateOrderRequest,
  /**
   * D6/R14, architecture.md § DA2: resolves to the signed-in shopper's
   * `Customer.id`, or `null` for a guest. NEVER rejects. Defaults to a
   * resolved `null` so every existing call site — and every assertion in
   * F-010's own suite — is unaffected (criterio 4: "sin tocar un aserto").
   */
  customerLink: Promise<string | null> = Promise.resolve(null),
): Promise<CreateOrderResult> {
  // 1. Store lookup. Nothing else is consulted if this fails.
  const store = await loadStoreForOrder(body.storeSlug);
  if (!store) return { kind: "store_not_found" };

  // 1.5. HD10-HD15: reject BEFORE quoting or the abuse guard (architecture.md
  // § El checkout y el pedido) — a closed store must not spend a slot of the
  // rate limit, and must not cost a price lookup either.
  if (store.status !== "PUBLISHED") {
    return {
      kind: "store_closed",
      reasonCode: store.disabledReasonCode,
      message: store.disabledMessage,
      disabledAt: store.disabledAt,
    };
  }

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
  // invented as a new error kind the contract does not define. F-031 DA6:
  // both calls go through the same pure rule CheckoutForm.tsx uses, so the
  // two can never drift apart (I3/I4).
  const deliveryConfig: DeliveryConfig = {
    deliveryEnabled: store.deliveryEnabled,
    deliveryFeeMode: store.deliveryFeeMode,
    deliveryFee: store.deliveryFee,
  };

  // 4.1 (F-042, architecture.md § Flujo C) — solo se consulta el tarifario
  // cuando el modo lo pide; para cualquier otro modo no se consulta nada.
  const isZoneBased = store.deliveryFeeMode === "ZONE_BASED";
  const zoneCoverage = isZoneBased ? await loadStoreZoneCoverage(prisma, store.id) : null;
  const hasResolvableZone = (zoneCoverage?.length ?? 0) > 0;

  // 4.2 — en una tienda ZONE_BASED, un DELIVERY nunca se degrada a PICKUP
  // en silencio (E20): incluso sin NINGUNA zona resoluble, la respuesta es
  // el error propio, no un pedido de mostrador que nadie pidió. Por eso
  // esta rama mira `body.fulfillment` directamente, sin pasar por
  // `isDeliveryOffered` — la vieja regla de R3 ("sin oferta, se trata como
  // PICKUP") sigue viva para FLAT_RATE/QUOTED_PER_ORDER, más abajo, pero
  // ZONE_BASED contesta siempre uno de tres desenlaces (architecture.md
  // § AD7): sin código, DELIVERY_ZONE_REQUIRED (E17, E20); código presente
  // pero no ofrecible por ESTA tienda —inventado, retirado, de primer
  // nivel, NOT_SERVED o de otra tienda: los cinco son el MISMO hecho (E16,
  // E18, caso límite 14)—, DELIVERY_ZONE_NOT_SERVED; presente y ofrecible,
  // se resuelve.
  let resolvedZone: OfferableZone | null = null;
  if (body.fulfillment === "DELIVERY" && isZoneBased) {
    if (!body.zoneCode) return { kind: "delivery_zone_required" };
    const zone = zoneCoverage?.find((z) => z.code === body.zoneCode) ?? null;
    if (!zone) return { kind: "delivery_zone_not_served", zoneCode: body.zoneCode };
    resolvedZone = zone;
  }
  const chosenZone: ChosenZone | null = resolvedZone
    ? { code: resolvedZone.code, deliveryFee: resolvedZone.deliveryFee }
    : null;

  // Para FLAT_RATE/QUOTED_PER_ORDER, R3 de siempre: sin oferta, se trata
  // como PICKUP. Para ZONE_BASED, `resolvedZone` ya decidió arriba —
  // `isDeliveryOffered` con `hasResolvableZone` coincide con esa decisión
  // por construcción (un `resolvedZone` no nulo implica una cobertura no
  // vacía).
  const isDelivery =
    body.fulfillment === "DELIVERY" && isDeliveryOffered(deliveryConfig, { hasResolvableZone });

  const deliveryFeeResult = deliveryFeeForNewOrder(
    deliveryConfig,
    isDelivery ? "DELIVERY" : "PICKUP",
    chosenZone,
  );
  // F-031 E2/R3: "not_quoted" — only a QUOTED_PER_ORDER store's DELIVERY
  // order gets here. Never confused with a genuine `0.00` (R1). "zone_required"
  // is provably unreachable here: whenever isDelivery && ZONE_BASED, the
  // block above already resolved `chosenZone` or returned before this line.
  let deliveryFee: Money | null;
  switch (deliveryFeeResult.kind) {
    case "charged":
      deliveryFee = money(deliveryFeeResult.amount, store.currencyCode);
      break;
    case "not_quoted":
      deliveryFee = null;
      break;
    case "zone_required":
      throw new Error(
        "createOrder: deliveryFeeForNewOrder returned zone_required after the zone was already resolved — this is unreachable by construction",
      );
    default: {
      const exhaustive: never = deliveryFeeResult;
      throw new Error(`createOrder: unhandled delivery fee result ${String(exhaustive)}`);
    }
  }
  const deliveryAddress = isDelivery ? (body.deliveryAddress ?? null) : null;

  // R29: total = subtotal - discountTotal + deliveryFee. discountTotal is
  // ORDER-scope only (R30) — the line-level discount is already inside each
  // line's unitPrice/lineTotal, folded into subtotal. F-031 R9: while the
  // delivery fee is not quoted, `total` stays PARTIAL — subtotal minus
  // discount, with nothing invented for an envío nobody priced yet.
  const total =
    deliveryFee === null
      ? subtract(quote.subtotal, quote.discountTotal)
      : add(subtract(quote.subtotal, quote.discountTotal), deliveryFee);
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

    // F-042 E15/C13: presente solo cuando el cliente mandó
    // `expectedDeliveryFee` Y el envío es lo que cambió — "el envío pasó de
    // 300 a 350" en vez de "los precios cambiaron".
    const delivery =
      body.expectedDeliveryFee !== undefined && deliveryFeeResult.kind === "charged"
        ? { was: body.expectedDeliveryFee, now: deliveryFeeResult.amount }
        : undefined;

    return { kind: "price_changed", lines, total: total.amount, delivery };
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

  // Awaited HERE, and only once: everything above (store lookup, quote, the
  // idempotency/abuse guard) already ran, so the identity resolves alongside
  // that work instead of ahead of it. It does NOT resolve instantly — with
  // HS256 it costs a round trip to Auth — so what is guaranteed is narrower
  // than it used to say here: the link never prevents the order, never makes
  // it fail, and never delays it beyond ORDER_CUSTOMER_LINK_TIMEOUT_MS
  // (R14, architecture.md § DA2 § Flujo de datos 4, corrected 2026-08-30).
  const customerId = await customerLink;

  for (let attempt = 0; attempt < ORDER_CODE_MAX_RETRIES; attempt += 1) {
    const code = generateOrderCode();
    try {
      await prisma.order.create({
        data: {
          code,
          storeId: store.id,
          businessId: store.businessId,
          customerId,
          contactName: body.contact.name,
          contactPhone: phone,
          contactEmail: body.contact.email ?? null,
          deliveryAddress,
          // F-042 R19/R20/R21: solo cuando se cierra DELIVERY en una tienda
          // ZONE_BASED — `resolvedZone` solo se asigna en ese exacto camino
          // (arriba). El nombre es una INSTANTÁNEA del índice tomada AHORA,
          // nunca derivada del código al leer (precedente: `rateSnapshot`).
          deliveryZoneCode: resolvedZone?.code ?? null,
          deliveryZoneName: resolvedZone?.name ?? null,
          status: "PENDING",
          currencyCode: store.currencyCode,
          subtotal: quote.subtotal.amount,
          discountTotal: quote.discountTotal.amount,
          deliveryFee: deliveryFee === null ? null : deliveryFee.amount,
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
