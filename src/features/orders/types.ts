/**
 * Wire types for the two public order endpoints.
 *
 * Deliberately NOT Zod: this file is imported by client islands (`CartView`,
 * `CheckoutForm`), and architecture.md forbids Zod anywhere in the client
 * tree. `features/orders/schemas.ts` is checked against these with
 * `satisfies` so the server's real validation cannot silently drift from what
 * the islands expect.
 */
import type { SerializableIssue } from "@/lib/httpJson";

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
  /** F-031 R20: travels EXPLICIT so the checkout island never has to deduce
   *  a mode from `deliveryFee === null`, which today means "no delivery". */
  deliveryFeeMode: "FLAT_RATE" | "QUOTED_PER_ORDER";
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
  /** List price in the order's currency, HD3 — `null` unless a promotion
   *  actually lowered this line (design.md § 7's "Antes {importe}"). */
  listUnitPrice: string | null;
  orderable: boolean;
  reason?: QuoteLineReason;
};

export type QuoteResponse = {
  store: QuoteStore;
  lines: QuoteLine[];
  /** Sum of `lineTotal` for orderable lines only. */
  subtotal: string;
  /** ORDER-scope discount (R29). "0" when none applies. */
  discountTotal: string;
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

/** Alias of the shared shape in `@/lib/httpJson` (AGENTS.md: no duplicate interfaces). */
export type InvalidBodyIssue = SerializableIssue;

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

// ---------------------------------------------------------------------------
// F-019 — renegotiation wire types (architecture.md § Contratos, § Tipos de
// hilo). Not Zod, same reason as the rest of this file: the Zod schemas in
// `features/orders/schemas.ts` are checked against these with `satisfies`.
// ---------------------------------------------------------------------------

export type ProposalItem = {
  storeProductId: string | null;
  name: string;
  unitPrice: string;
  currencyCode: string;
  quantity: string;
  lineTotal: string;
  originalUnitPrice?: string;
  originalCurrencyCode?: string;
};

/** Body of `POST /api/internal/orders/proposal` (architecture.md DA2). */
export type ProposalPayload = {
  orderId: string;
  currencyCode: string;
  subtotal: string;
  discountTotal?: string;
  deliveryFee: string;
  total: string;
  message?: string | null;
  items: ProposalItem[];
};

/** `200` body of `POST /api/internal/orders/proposal`. */
export type ProposalResponse = {
  ok: true;
  status: "AWAITING_CUSTOMER";
  expiresAt: string;
  currencyCode: string;
  previousTotal: string;
  proposedTotal: string;
  orderUrl: string;
  /** Toward the CUSTOMER (R12) — `null` with a reason when unusable (R13). */
  customerWhatsappUrl: string | null;
  customerWhatsappReason: "NO_PHONE_DIGITS" | null;
};

export type ProposalError =
  | { error: "INVALID_JSON" }
  | { error: "INVALID_BODY"; issues: InvalidBodyIssue[] }
  | { error: "INVALID_ORDER_ID" }
  | { error: "CURRENCY_MISMATCH" }
  | { error: "UNKNOWN_ORDER" }
  | { error: "ORDER_NOT_PROPOSABLE"; status: string }
  | { error: "PROPOSAL_FAILED" };

/** Values of the `decision` field on `POST /[slug]/pedido/[code]/respuesta`
 *  (architecture.md DA4) — see `ORDER_PROPOSAL_DECISION` for the constants. */
export type ProposalDecision = "aprobar" | "rechazar";
