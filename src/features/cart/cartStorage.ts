import { CART_STORAGE_KEY_PREFIX } from "@/constants/cart";
import { parseStoredCart, serializeCart, type CartSnapshot } from "./parseCart";

/**
 * `localStorage` adapter, namespaced per `Store.id` (R12) with a fallback to
 * an in-memory `Map` when `localStorage` throws — private browsing, a full
 * quota, or a browser that disables it entirely (E21). Nothing above this
 * module needs to know which case it is in: `readCart`/`writeCart` always
 * work, just without persistence across a reload when storage is blocked.
 */

/** Exported so `cartStore.ts` can match a `storage` event to the right store. */
export function keyFor(storeId: string): string {
  return `${CART_STORAGE_KEY_PREFIX}${storeId}`;
}

let cachedAvailable: boolean | undefined;

/**
 * Probed once per page load and cached — this is what lets the UI show the
 * "your browser is not saving the cart" warning exactly once per visit
 * instead of re-checking on every read.
 */
export function isLocalStorageAvailable(): boolean {
  if (cachedAvailable !== undefined) return cachedAvailable;
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      cachedAvailable = false;
      return cachedAvailable;
    }
    const probeKey = "qab.__probe__";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
    cachedAvailable = true;
  } catch {
    cachedAvailable = false;
  }
  return cachedAvailable;
}

const memoryFallback = new Map<string, string>();

export function readCart(storeId: string): CartSnapshot | null {
  const key = keyFor(storeId);
  const raw = isLocalStorageAvailable()
    ? window.localStorage.getItem(key)
    : (memoryFallback.get(key) ?? null);
  return parseStoredCart(raw);
}

export function writeCart(snapshot: CartSnapshot): void {
  const key = keyFor(snapshot.storeId);
  const serialized = serializeCart(snapshot);
  if (isLocalStorageAvailable()) {
    try {
      window.localStorage.setItem(key, serialized);
      return;
    } catch {
      // Quota just filled mid-session: fall through to memory rather than
      // losing the write.
    }
  }
  memoryFallback.set(key, serialized);
}

export function clearCart(storeId: string): void {
  const key = keyFor(storeId);
  if (isLocalStorageAvailable()) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing to do — there was nothing durable to clear.
    }
  }
  memoryFallback.delete(key);
}
