import {
  CART_EXPIRY_DAYS,
  CART_MAX_LINES,
  CART_MAX_QTY_PER_LINE,
  CART_MIN_QTY_PER_LINE,
  CART_STORAGE_VERSION,
} from "@/constants/cart";

/**
 * Hand-written type guard for what `localStorage` says the cart is.
 *
 * Deliberately NOT Zod: this file ships to every page that renders an island,
 * including the SSG product page, and Zod v4 is ~13 KB gzip on its own —
 * architecture.md's hard restriction is zero Zod in the client tree. ~40 lines
 * with no dependency does the same job for this one small shape.
 *
 * Anything that does not match — wrong version, wrong types, a line outside
 * its limits, a cart untouched for more than CART_EXPIRY_DAYS — is discarded
 * as a whole (R16, E22): the shopper did nothing wrong and there is nothing
 * partial to recover.
 */

export type CartLineDisplay = {
  name: string;
  unitPrice: string;
  currency: string;
};

export type CartLine = {
  storeProductId: string;
  slug: string;
  qty: number;
  /** Only for painting instantly from what was known at add-time. Never used
   *  to compute a total, and never sent to the server. */
  display: CartLineDisplay;
};

export type CartSnapshot = {
  storeId: string;
  items: CartLine[];
  updatedAt: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isDisplay(value: unknown): value is CartLineDisplay {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.name) &&
    isNonEmptyString(candidate.unitPrice) &&
    isNonEmptyString(candidate.currency)
  );
}

export function isCartLine(value: unknown): value is CartLine {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.storeProductId) &&
    isNonEmptyString(candidate.slug) &&
    typeof candidate.qty === "number" &&
    Number.isInteger(candidate.qty) &&
    candidate.qty >= CART_MIN_QTY_PER_LINE &&
    candidate.qty <= CART_MAX_QTY_PER_LINE &&
    isDisplay(candidate.display)
  );
}

function isFreshIsoDate(value: unknown, now: Date): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const ageMs = now.getTime() - parsed.getTime();
  const maxAgeMs = CART_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  return ageMs >= 0 && ageMs <= maxAgeMs;
}

/**
 * Parses the raw string read from `localStorage`. Returns `null` for
 * anything that is not exactly the expected shape — including a cart older
 * than CART_EXPIRY_DAYS (R15) — never throws.
 */
export function parseStoredCart(raw: string | null, now: Date = new Date()): CartSnapshot | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;

  if (candidate.v !== CART_STORAGE_VERSION) return null;
  if (!isNonEmptyString(candidate.storeId)) return null;
  if (!isFreshIsoDate(candidate.updatedAt, now)) return null;
  if (!Array.isArray(candidate.items)) return null;
  if (candidate.items.length > CART_MAX_LINES) return null;
  if (!candidate.items.every(isCartLine)) return null;

  return {
    storeId: candidate.storeId,
    items: candidate.items as CartLine[],
    updatedAt: candidate.updatedAt as string,
  };
}

/** Serializes a snapshot back into what `parseStoredCart` accepts. */
export function serializeCart(snapshot: CartSnapshot): string {
  return JSON.stringify({
    v: CART_STORAGE_VERSION,
    storeId: snapshot.storeId,
    updatedAt: snapshot.updatedAt,
    items: snapshot.items,
  });
}
