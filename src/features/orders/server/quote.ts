import { prisma } from "@/lib/prisma";
import { convert, money, multiply, sum, type Money, type MoneyInput } from "@/lib/money";
import { effectivePrice } from "@/lib/pricing";
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
};

export type OrderableLine = {
  storeProductId: string;
  slug: string;
  name: string;
  qty: number;
  orderable: true;
  unitPrice: Money;
  originalUnitPrice: Money;
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
  /** Every rate read for this business, fresh. Callers restrict to the
   *  currencies actually used before freezing a `rateSnapshot` (R9). */
  rates: Record<string, string>;
  capturedAt: string;
};

export async function loadStoreForOrder(slug: string): Promise<OrderStore | null> {
  const store = await prisma.store.findFirst({
    where: { slug, status: "PUBLISHED" },
    select: {
      id: true,
      slug: true,
      name: true,
      checkoutMode: true,
      deliveryEnabled: true,
      deliveryFee: true,
      whatsapp: true,
      phone: true,
      business: { select: { id: true, baseCurrencyCode: true } },
    },
  });
  if (!store) return null;

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
};

function quoteLine(
  requested: RequestedItem,
  product: LoadedProduct | undefined,
  storeCurrency: string,
  rates: Record<string, string>,
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

  const original = effectivePrice(product);
  let unitPrice: Money;
  try {
    unitPrice = convert(original, storeCurrency, rates);
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
    unitPrice,
    originalUnitPrice: money(original.amount, original.currency),
    lineTotal: multiply(unitPrice, requested.qty),
  };
}

/** The single source of price and orderability (R4, R6, R11). */
export async function quoteCart(store: OrderStore, items: RequestedItem[]): Promise<CartQuote> {
  const ids = items.map((item) => item.storeProductId);

  const [products, rates] = await Promise.all([
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
          },
        }),
    loadFreshRates(store.businessId),
  ]);

  const byId = new Map(products.map((product) => [product.id, product]));
  const lines = items.map((item) =>
    quoteLine(item, byId.get(item.storeProductId), store.currencyCode, rates),
  );

  const subtotal = sum(
    lines.filter((line): line is OrderableLine => line.orderable).map((line) => line.lineTotal),
    store.currencyCode,
  );

  return { store, lines, subtotal, rates, capturedAt: new Date().toISOString() };
}

/** `null` when the store does not exist or is not published (E17 for the quote path). */
export async function quoteBySlug(slug: string, items: RequestedItem[]): Promise<CartQuote | null> {
  const store = await loadStoreForOrder(slug);
  if (!store) return null;
  return quoteCart(store, items);
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
            orderable: false as const,
            reason: line.reason,
          },
    ),
    subtotal: quote.subtotal.amount,
    capturedAt: quote.capturedAt,
  };
}
