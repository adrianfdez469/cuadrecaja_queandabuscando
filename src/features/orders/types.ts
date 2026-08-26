/**
 * Wire types for the two public order endpoints.
 *
 * Deliberately NOT Zod: this file is imported by client islands (`CartView`,
 * `CheckoutForm`), and architecture.md forbids Zod anywhere in the client
 * tree. `features/orders/schemas.ts` is checked against these with
 * `satisfies` so the server's real validation cannot silently drift from what
 * the islands expect.
 */

export type QuoteLineReason = "OUT_OF_STOCK" | "REMOVED" | "NO_PRICE";

export type QuoteRequestItem = { storeProductId: string; qty: number };
export type QuoteRequestBody = { storeSlug: string; items: QuoteRequestItem[] };

export type QuoteStore = {
  slug: string;
  name: string;
  currencyCode: string;
  checkoutMode: "WHATSAPP" | "ONSITE";
  deliveryEnabled: boolean;
  deliveryFee: string | null;
};

/**
 * A line that is not orderable still carries `name`/`slug`/`qty`, so the
 * screen can say which product to remove — but never a price, because
 * nothing unsellable gets one invented (architecture.md § POST /orders/quote).
 */
export type QuoteLine = {
  storeProductId: string;
  slug: string;
  name: string;
  qty: number;
  unitPrice: string | null;
  currencyCode: string | null;
  lineTotal: string | null;
  originalUnitPrice: string | null;
  originalCurrencyCode: string | null;
  orderable: boolean;
  reason?: QuoteLineReason;
};

export type QuoteResponse = {
  store: QuoteStore;
  lines: QuoteLine[];
  /** Sum of `lineTotal` for orderable lines only. */
  subtotal: string;
  capturedAt: string;
};

export type Fulfillment = "PICKUP" | "DELIVERY";

export type CreateOrderItem = {
  storeProductId: string;
  qty: number;
  /** What the client is currently showing for this line — optional, compared
   *  only to sharpen the 409 message (AP1). Never persisted. */
  expectedUnitPrice?: string;
};

export type CreateOrderContact = {
  name: string;
  phone: string;
  email?: string;
};

export type CreateOrderBody = {
  storeSlug: string;
  items: CreateOrderItem[];
  contact: CreateOrderContact;
  fulfillment: Fulfillment;
  deliveryAddress?: string;
  notes?: string;
  /** What the client is showing as the total — compared, never persisted (R7). */
  expectedTotal: string;
  /** One per checkout attempt (R26). Absent means no duplicate protection (R28). */
  idempotencyKey?: string;
};

export type CreateOrderSuccess = {
  code: string;
  orderUrl: string;
  whatsappUrl: string | null;
};

export type CreateOrderIdempotentSuccess = CreateOrderSuccess & { idempotent: true };

export type InvalidBodyIssue = { path: (string | number)[]; message: string };

export type UnavailableLine = { storeProductId: string; reason: QuoteLineReason };
export type PriceChangedLine = { storeProductId: string; was: string | null; now: string };

export type CreateOrderError =
  | { error: "INVALID_BODY"; issues: InvalidBodyIssue[] }
  | { error: "EMPTY_CART" }
  | { error: "STORE_NOT_FOUND" }
  | { error: "ITEMS_UNAVAILABLE"; lines: UnavailableLine[] }
  | { error: "PRICE_CHANGED"; lines: PriceChangedLine[]; total: string }
  | { error: "TOO_MANY_ORDERS"; retryAfterSeconds: number }
  | { error: "ORDER_CREATE_FAILED" };
