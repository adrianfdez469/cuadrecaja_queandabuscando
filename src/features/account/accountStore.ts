"use client";

import { useSyncExternalStore } from "react";
import { CUSTOMER_HINT_COOKIE, PROFILE_FETCH_TIMEOUT_MS } from "@/constants/account";
import type { AccountState } from "./types";

/**
 * Client state for the shopper's session, in ONE module + `useSyncExternalStore`
 * (AGENTS.md § Arquitectura, the same pattern as `src/features/cart/cartStore.ts`).
 * NEVER imports anything from `@supabase/*` — the one thing that must stay
 * true for the header's icon to cost ~0.7 KB instead of 61.2 (design.md § Coste
 * de cliente, `boundaries.test.ts`).
 *
 * Two independent jobs share this file because they are the two halves of
 * NC1/NC2 and both have to avoid a network request per catalogue page:
 * 1. `useSessionHint()` — a synchronous read of the `qab-shopper-hint`
 *    cookie, for `AccountBadge`.
 * 2. `getAccountProfile()` — the checkout's deduplicated `GET
 *    /api/account/profile`, so two islands mounted on the same page share
 *    ONE request instead of firing one each.
 */

export type SessionHint = "unknown" | "guest" | "signed-in";

function readHintCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .includes(`${CUSTOMER_HINT_COOKIE}=1`);
}

// No external event ever fires here — signing in and signing out are both
// hard navigations (design.md § 2, § 4), so there is nothing to subscribe
// to: the next page load re-reads the cookie from scratch. Same shape as
// `cartStore.ts`'s `useHydrated`/`useIsLocalStorageAvailable`.
function subscribeToNothing(): () => void {
  return () => {};
}

function getSnapshot(): SessionHint {
  return readHintCookie() ? "signed-in" : "guest";
}

// Stable reference: the prerendered HTML is shared by every visitor (R11),
// so it can never claim a session one way or the other.
function getServerSnapshot(): SessionHint {
  return "unknown";
}

/** `AccountBadge`'s only data source. Sync, no network, no `@supabase/*`. */
export function useSessionHint(): SessionHint {
  return useSyncExternalStore(subscribeToNothing, getSnapshot, getServerSnapshot);
}

const NO_SESSION: AccountState = { signedIn: false, profile: null };

async function fetchAccountProfile(): Promise<AccountState> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROFILE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch("/api/account/profile", { signal: controller.signal });
    if (!response.ok) return NO_SESSION;
    return (await response.json()) as AccountState;
  } catch {
    // Timeout, network down, Auth caído: all look like "no session" to the
    // checkout (E17) — nobody waits and nobody sees an error for this.
    return NO_SESSION;
  } finally {
    clearTimeout(timeout);
  }
}

let cachedProfileRequest: Promise<AccountState> | null = null;

/**
 * One `GET /api/account/profile` per page load, no matter how many islands
 * call this (architecture.md § Flujo de datos, DA1). Never rejects.
 */
export function getAccountProfile(): Promise<AccountState> {
  cachedProfileRequest ??= fetchAccountProfile();
  return cachedProfileRequest;
}
