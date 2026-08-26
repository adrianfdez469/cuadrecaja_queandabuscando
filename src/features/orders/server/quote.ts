import { prisma } from "@/lib/prisma";
import { multiply, sum, type Money, type MoneyInput } from "@/lib/money";
import { resolvePrice } from "@/lib/pricing";
import {
  indexPromotions,
  orderDiscount,
  type PromotionIndex,
  type PromotionRow,
} from "@/lib/promotions";
import type { CheckoutMode } from "@/generated/prisma/enums";
import type { QuoteLineReason, QuoteResponse } from "../types";

/**
 * Cotización.
 *
 * The only place in the system that decides a price (architecture.md
 * decisión 2). `POST /api/orders/quote` and `POST /api/orders` both go
 * through `quoteCart`, so what the cart shows and what the checkout charges
 * cannot diverge. Nothing here is cached: every read is fresh, on purpose —
 * a stale price here is a wrong total there.
 */

export type OrderStore = {
  id: string;
  businessId: string;
  slug: string;
  name: string;
  /** `Business.baseCurrencyCode`, read at the same moment as everything else. */
  currencyCode: string;
  checkoutMode: CheckoutMode;
  deliveryEnabled: boolean;
  deliveryFee: string | null;
  /** `Store.whatsapp ?? Store.phone`. `null` disables the wa.me link (E18). */
  whatsappNumber: string | null;
  /** HD10-HD15: the checkout has to reject explicitly when this is not
   *  `PUBLISHED` — the query below no longer filters by it. */
  status: "DRAFT" | "PUBLISHED" | "SUSPENDED";
  disabledReasonCode: string | null;
  disabledMessage: string | null;
  disabledAt: Date | null;
};

export type OrderableLine = {
  storeProductId: string;
  slug: string;
  name: string;
  qty: number;
  orderable: true;
  unitPrice: Money;
  originalUnitPrice: Money;
  /** HD3: the pre-discount price, in the order's currency. `null` unless a
   *  PRODUCT/CATEGORY promotion actually won for this line. */
  listUnitPrice: Money | null;
  lineTotal: Money;
};

export type UnorderableLine = {
  storeProductId: string;
  /** `null` only for a storeProductId that does not exist at all — the UI
   *  still needs *something* to show, so this falls back to the id itself. */
  slug: string;
  name: string;
  qty: number;
  orderable: false;
  reason: QuoteLineReason;
};

export type QuotedLine = OrderableLine | UnorderableLine;

export type CartQuote = {
  store: OrderStore;
  lines: QuotedLine[];
  /** Sum of `lineTotal` for orderable lines only, in `store.currencyCode`. */
  subtotal: Money;
  /** ORDER-scope discount (R29). `total = subtotal - discountTotal + deliveryFee`. */
  discountTotal: Money;
  /** Every rate read for this business, fresh. Callers restrict to the
   *  currencies actually used before freezing a `rateSnapshot` (R9). */
  rates: Record<string, string>;
  capturedAt: string;
};

export async function loadStoreForOrder(slug: string): Promise<OrderStore | null> {
  // HD11: no `status` filter — the checkout has to answer "closed", not
  // "does not exist", for a store that is merely SUSPENDED.
  const store = await prisma.store.findFirst({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      checkoutMode: true,
      deliveryEnabled: true,
      deliveryFee: true,
      whatsapp: true,
      phone: true,
      status: true,
      disabledReasonCode: true,
      disabledMessage: true,
      disabledAt: true,
      business: { select: { id: true, baseCurrencyCode: true } },
    },
  });
  if (!store || store.status === "DRAFT") return null;

  return {
    id: store.id,
    businessId: store.business.id,
    slug: store.slug,
    name: store.name,
    currencyCode: store.business.baseCurrencyCode,
    checkoutMode: store.checkoutMode,
    deliveryEnabled: store.deliveryEnabled,
    deliveryFee: store.deliveryFee?.toString() ?? null,
    whatsappNumber: store.whatsapp ?? store.phone ?? null,
    status: store.status,
    disabledReasonCode: store.disabledReasonCode,
    disabledMessage: store.disabledMessage,
    disabledAt: store.disabledAt,
  };
}

/** Fresh read of the latest rate per currency for a business — never cached. */
async function loadFreshRates(businessId: string): Promise<Record<string, string>> {
  const rows = await prisma.exchangeRate.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    select: { currencyCode: true, rate: true },
  });

  const latest: Record<string, string> = {};
  for (const row of rows) {
    if (!(row.currencyCode in latest)) latest[row.currencyCode] = row.rate.toString();
  }
  return latest;
}

/**
 * HD3: fresh, never cached (unlike the storefront's `loadCatalog`) — the
 * checkout has to see a promotion the instant it starts or ends, same as it
 * already does for prices (R28's up-to-an-hour lag is a storefront trade-off
 * this path does not inherit).
 */
async function loadFreshPromotions(storeId: string): Promise<PromotionIndex> {
  const rows = await prisma.promotion.findMany({
    where: { storeId, active: true },
    select: {
      id: true,
      type: true,
      scope: true,
      value: true,
      conditions: true,
      startsAt: true,
      endsAt: true,
      active: true,
    },
  });
  const promotionRows: PromotionRow[] = rows.map((row) => ({
    id: row.id,
    type: row.type,
    scope: row.scope,
    value: row.value.toString(),
    conditions: row.conditions,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    active: row.active,
  }));
  return indexPromotions(promotionRows, new Date());
}

type RequestedItem = { storeProductId: string; qty: number };

type LoadedProduct = {
  id: string;
  slug: string;
  localName: string;
  availability: "OUT_OF_STOCK" | "LOW_STOCK" | "AVAILABLE";
  visible: boolean;
  deletedAt: Date | null;
  syncedPrice: MoneyInput;
  syncedPriceCurrency: string;
  priceOverride: MoneyInput | null;
  priceOverrideCurrency: string | null;
  localCategoryId: string | null;
};

function quoteLine(
  requested: RequestedItem,
  product: LoadedProduct | undefined,
  storeCurrency: string,
  rates: Record<string, string>,
  promotions: PromotionIndex,
): QuotedLine {
  if (!product) {
    return {
      storeProductId: requested.storeProductId,
      slug: requested.storeProductId,
      name: requested.storeProductId,
      qty: requested.qty,
      orderable: false,
      reason: "REMOVED",
    };
  }

  if (product.deletedAt !== null || !product.visible) {
    return {
      storeProductId: product.id,
      slug: product.slug,
      name: product.localName,
      qty: requested.qty,
      orderable: false,
      reason: "REMOVED",
    };
  }

  if (product.availability === "OUT_OF_STOCK") {
    return {
      storeProductId: product.id,
      slug: product.slug,
      name: product.localName,
      qty: requested.qty,
      orderable: false,
      reason: "OUT_OF_STOCK",
    };
  }

  let resolved;
  try {
    resolved = resolvePrice(product, {
      targetCurrency: storeCurrency,
      rates,
      baseCurrency: storeCurrency, // Business.baseCurrencyCode === store.currencyCode here
      promotions: promotions.forProduct(product.id, product.localCategoryId),
    });
  } catch {
    return {
      storeProductId: product.id,
      slug: product.slug,
      name: product.localName,
      qty: requested.qty,
      orderable: false,
      reason: "NO_PRICE",
    };
  }

  return {
    storeProductId: product.id,
    slug: product.slug,
    name: product.localName,
    qty: requested.qty,
    orderable: true,
    unitPrice: resolved.price,
    // R29/hallazgo 1: with a promotion, the "effective before converting"
    // price IS the discounted one — this is what OrderItem.originalUnitPrice
    // publishes to the POS, and the contract's formula depends on it.
    originalUnitPrice: resolved.beforeConversion,
    listUnitPrice: resolved.listPrice,
    lineTotal: multiply(resolved.price, requested.qty),
  };
}

/** The single source of price and orderability (R4, R6, R11). */
export async function quoteCart(store: OrderStore, items: RequestedItem[]): Promise<CartQuote> {
  const ids = items.map((item) => item.storeProductId);

  const [products, rates, promotions] = await Promise.all([
    ids.length === 0
      ? Promise.resolve([])
      : prisma.storeProduct.findMany({
          where: { storeId: store.id, id: { in: ids } },
          select: {
            id: true,
            slug: true,
            localName: true,
            availability: true,
            visible: true,
            deletedAt: true,
            syncedPrice: true,
            syncedPriceCurrency: true,
            priceOverride: true,
            priceOverrideCurrency: true,
            localCategoryId: true,
          },
        }),
    loadFreshRates(store.businessId),
    loadFreshPromotions(store.id),
  ]);

  const byId = new Map(products.map((product) => [product.id, product]));
  const lines = items.map((item) =>
    quoteLine(item, byId.get(item.storeProductId), store.currencyCode, rates, promotions),
  );

  const subtotal = sum(
    lines.filter((line): line is OrderableLine => line.orderable).map((line) => line.lineTotal),
    store.currencyCode,
  );

  const { discount: discountTotal } = orderDiscount(subtotal, promotions.order, {
    rates,
    baseCurrency: store.currencyCode,
  });

  return { store, lines, subtotal, discountTotal, rates, capturedAt: new Date().toISOString() };
}

export type QuoteBySlugResult =
  | { kind: "not_found" }
  | { kind: "closed"; reasonCode: string | null; message: string | null; disabledAt: Date | null }
  | { kind: "ok"; quote: CartQuote };

/**
 * HD10-HD15: a store that exists but is not `PUBLISHED` is `"closed"`, not
 * `"not_found"` — the route answers 409, not 404 (the store is there, the
 * page for it responds 200, and this is not a server failure either).
 */
export async function quoteBySlug(
  slug: string,
  items: RequestedItem[],
): Promise<QuoteBySlugResult> {
  const store = await loadStoreForOrder(slug);
  if (!store) return { kind: "not_found" };
  if (store.status !== "PUBLISHED") {
    return {
      kind: "closed",
      reasonCode: store.disabledReasonCode,
      message: store.disabledMessage,
      disabledAt: store.disabledAt,
    };
  }
  const quote = await quoteCart(store, items);
  return { kind: "ok", quote };
}

/** Shapes a `CartQuote` into what `POST /api/orders/quote` sends over the wire. */
export function toQuoteResponse(quote: CartQuote): QuoteResponse {
  return {
    store: {
      slug: quote.store.slug,
      name: quote.store.name,
      currencyCode: quote.store.currencyCode,
      checkoutMode: quote.store.checkoutMode,
      deliveryEnabled: quote.store.deliveryEnabled,
      deliveryFee: quote.store.deliveryFee,
    },
    lines: quote.lines.map((line) =>
      line.orderable
        ? {
            storeProductId: line.storeProductId,
            slug: line.slug,
            name: line.name,
            qty: line.qty,
            unitPrice: line.unitPrice.amount,
            currencyCode: line.unitPrice.currency,
            lineTotal: line.lineTotal.amount,
            originalUnitPrice: line.originalUnitPrice.amount,
            originalCurrencyCode: line.originalUnitPrice.currency,
            listUnitPrice: line.listUnitPrice?.amount ?? null,
            orderable: true as const,
          }
        : {
            storeProductId: line.storeProductId,
            slug: line.slug,
            name: line.name,
            qty: line.qty,
            unitPrice: null,
            currencyCode: null,
            lineTotal: null,
            originalUnitPrice: null,
            originalCurrencyCode: null,
            listUnitPrice: null,
            orderable: false as const,
            reason: line.reason,
          },
    ),
    subtotal: quote.subtotal.amount,
    discountTotal: quote.discountTotal.amount,
    capturedAt: quote.capturedAt,
  };
}
