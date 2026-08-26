"use client";

import { useCallback, useSyncExternalStore } from "react";
import { CART_MAX_LINES, CART_MAX_QTY_PER_LINE, CART_MIN_QTY_PER_LINE } from "@/constants/cart";
import {
  clearCart as clearStoredCart,
  isLocalStorageAvailable,
  keyFor,
  readCart,
  writeCart,
} from "./cartStorage";
import type { CartLine, CartSnapshot } from "./parseCart";

/**
 * Client cart state: a single module + `useSyncExternalStore`, no Context and
 * no gestor de estado (architecture.md decisión, SP4). A module is what lets
 * the button on the product page and the badge in the layout — two different
 * subtrees — share state without a provider wrapping every storefront page,
 * including the `●` ones.
 *
 * Holds exactly ONE store's cart in memory at a time: every page under
 * `/[slug]` deals with a single `Store.id`, and `ensureStore` swaps state
 * when that id changes (E4). `localStorage` is read only inside
 * `subscribe`/effects, never during render.
 */

function emptySnapshot(storeId: string): CartSnapshot {
  return { storeId, items: [], updatedAt: new Date(0).toISOString() };
}

// Stable reference: React compares getServerSnapshot() by identity across
// calls, and this never changes, so there is nothing to cause a mismatch.
const SERVER_SNAPSHOT: CartSnapshot = emptySnapshot("");

let currentStoreId: string | null = null;
let currentSnapshot: CartSnapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function ensureStore(storeId: string): void {
  if (currentStoreId === storeId) return;
  currentStoreId = storeId;
  const stored = readCart(storeId);
  currentSnapshot = stored ?? emptySnapshot(storeId);
}

function persist(): void {
  if (!currentStoreId) return;
  currentSnapshot = { ...currentSnapshot, updatedAt: new Date().toISOString() };
  writeCart(currentSnapshot);
  notify();
}

function handleStorageEvent(storeId: string, listener: () => void) {
  return (event: StorageEvent) => {
    // A different tab wrote OUR store's key: reload from storage (E23).
    // event.key is null for localStorage.clear(); reload defensively too.
    if (event.key !== null && event.key !== keyFor(storeId)) return;
    const stored = readCart(storeId);
    currentSnapshot = stored ?? emptySnapshot(storeId);
    listener();
  };
}

function subscribe(storeId: string, listener: () => void): () => void {
  ensureStore(storeId);
  listeners.add(listener);
  const onStorage = handleStorageEvent(storeId, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(storeId: string): CartSnapshot {
  ensureStore(storeId);
  return currentSnapshot;
}

function getServerSnapshot(): CartSnapshot {
  return SERVER_SNAPSHOT;
}

function addLine(storeId: string, line: Omit<CartLine, "qty">, qty: number): void {
  ensureStore(storeId);
  const items = [...currentSnapshot.items];
  const index = items.findIndex((item) => item.storeProductId === line.storeProductId);

  if (index >= 0) {
    const newQty = Math.min(items[index].qty + qty, CART_MAX_QTY_PER_LINE);
    items[index] = { ...items[index], qty: newQty, display: line.display };
  } else {
    // Tope de 50 líneas (R14): a full cart silently ignores a brand-new
    // product. The screens that call add() compute `disabled` from the
    // current count, so this is a backstop, not the primary guard.
    if (items.length >= CART_MAX_LINES) return;
    const clamped = Math.min(Math.max(qty, CART_MIN_QTY_PER_LINE), CART_MAX_QTY_PER_LINE);
    items.push({ ...line, qty: clamped });
  }

  currentSnapshot = { ...currentSnapshot, items };
  persist();
}

function setQtyLine(storeId: string, storeProductId: string, qty: number): void {
  ensureStore(storeId);
  if (qty <= 0) {
    removeLine(storeId, storeProductId);
    return;
  }
  const clamped = Math.min(qty, CART_MAX_QTY_PER_LINE);
  const items = currentSnapshot.items.map((item) =>
    item.storeProductId === storeProductId ? { ...item, qty: clamped } : item,
  );
  currentSnapshot = { ...currentSnapshot, items };
  persist();
}

function removeLine(storeId: string, storeProductId: string): void {
  ensureStore(storeId);
  const items = currentSnapshot.items.filter((item) => item.storeProductId !== storeProductId);
  currentSnapshot = { ...currentSnapshot, items };
  persist();
}

function clearLines(storeId: string): void {
  ensureStore(storeId);
  currentSnapshot = emptySnapshot(storeId);
  clearStoredCart(storeId);
  notify();
}

function totalUnits(items: CartLine[]): number {
  return items.reduce((total, item) => total + item.qty, 0);
}

export type UseCartResult = {
  items: CartLine[];
  /** Units, not lines — it is what a shopper actually counts (design.md). */
  count: number;
  add(line: Omit<CartLine, "qty">, qty?: number): void;
  setQty(storeProductId: string, qty: number): void;
  remove(storeProductId: string): void;
  clear(): void;
};

export function useCart(storeId: string): UseCartResult {
  const boundSubscribe = useCallback(
    (listener: () => void) => subscribe(storeId, listener),
    [storeId],
  );
  const boundGetSnapshot = useCallback(() => getSnapshot(storeId), [storeId]);

  const snapshot = useSyncExternalStore(boundSubscribe, boundGetSnapshot, getServerSnapshot);

  const add = useCallback(
    (line: Omit<CartLine, "qty">, qty = 1) => addLine(storeId, line, qty),
    [storeId],
  );
  const setQty = useCallback(
    (storeProductId: string, qty: number) => setQtyLine(storeId, storeProductId, qty),
    [storeId],
  );
  const remove = useCallback(
    (storeProductId: string) => removeLine(storeId, storeProductId),
    [storeId],
  );
  const clear = useCallback(() => clearLines(storeId), [storeId]);

  return { items: snapshot.items, count: totalUnits(snapshot.items), add, setQty, remove, clear };
}

// Availability never changes after the first check, so there is nothing to
// subscribe to — this only exists to read a browser-only value without a
// hydration mismatch, using the same server/client snapshot split as the
// cart itself instead of a setState-in-effect (react-hooks/set-state-in-effect).
function subscribeToNothing(): () => void {
  return () => {};
}

// The server (and the first client render, matched against it) assumes
// storage IS available: the warning is opt-in once the client proves
// otherwise, not opt-out — the prerendered HTML must never claim the
// browser is blocking storage before anything has actually checked.
function assumeAvailableOnServer(): boolean {
  return true;
}

/** `true` on the server and on first paint; the real value once mounted. */
export function useIsLocalStorageAvailable(): boolean {
  return useSyncExternalStore(subscribeToNothing, isLocalStorageAvailable, assumeAvailableOnServer);
}

function isTrue(): boolean {
  return true;
}
function isFalse(): boolean {
  return false;
}

/**
 * `false` during the server render (and the first client render, matched
 * against it), `true` from the next paint on. This is what lets `CartView`
 * and `CheckoutForm` tell "genuinely nothing hydrated yet" (F0: show the
 * cascarón) apart from "hydrated and the cart is empty" (E6's real empty
 * state) — `useCart`'s snapshot alone cannot make that distinction, because
 * its server snapshot is also an empty cart.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeToNothing, isTrue, isFalse);
}
