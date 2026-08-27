"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { Alert } from "@/components/ui/Alert";
import { isLocalStorageAvailable, readCart } from "../cartStorage";

/**
 * The ONLY client island `/[slug]/sucursales` ships (criterio 6, HS11). It
 * reads a SINGLE `localStorage` key — the current branch's, with the loose
 * `readCart()` reader `cartStorage.ts` exposes, never `useCart()`/`cartStore.ts`:
 * `cartStore` holds exactly ONE store's cart in memory at a time, and this
 * screen's `CartBadge` (in the layout, when entered by a branch's own slug)
 * already owns that slot for the SAME store id — reading through `useCart`
 * here would be harmless only because the ids match, and reusing the module
 * for a second purpose is how the next reader picks the wrong store's cart
 * by accident. HS11 (design.md DP1 → "no"): it never asks about a
 * DIFFERENT branch's cart, so there is only ever one id to read.
 *
 * The FIRST line of the notice ("Tu carrito no se mueve…") is server-rendered
 * by the page itself — this component only ADDS what needs the browser: how
 * many lines are in that one cart, or that the browser is not saving it.
 *
 * Reads via `useSyncExternalStore`, same family as `cartStore.ts`'s
 * `useHydrated`/`useIsLocalStorageAvailable` — no `useState` + `useEffect`
 * (ficha `set-state-en-efecto-prohibido`): the server snapshot is always
 * "nothing to add", and the client snapshot is memoized in a `useRef` that
 * lives and dies with THIS component instance (never a module-level cache —
 * a module-level `Map` kept the FIRST answer forever, so a shopper who left
 * this page with an empty cart, added something, and came back via a
 * client-side `<Link>` (a remount, not a hard reload) would keep reading the
 * stale "nothing to add" snapshot; a `useRef` starts fresh on every mount,
 * while still returning the SAME reference across repeated calls within
 * that one mount — the stability `useSyncExternalStore` requires to avoid
 * the "tearing" warning).
 */
type NoticeState = { kind: "none" } | { kind: "count"; count: number } | { kind: "unavailable" };

const NONE: NoticeState = { kind: "none" };

function computeSnapshot(storeId: string): NoticeState {
  if (!isLocalStorageAvailable()) return { kind: "unavailable" };
  const cart = readCart(storeId);
  const count = cart?.items.reduce((total, item) => total + item.qty, 0) ?? 0;
  return count > 0 ? { kind: "count", count } : NONE;
}

function getServerSnapshot(): NoticeState {
  return NONE;
}

function subscribeToNothing(): () => void {
  // Nothing external changes this while the page is open — a `storage`
  // event from another tab is out of scope (design.md § 3 does not ask
  // for it), and a fresh mount (a real navigation, hard or soft) re-reads
  // for real via the `useRef` below.
  return () => {};
}

export function BranchSwitchNotice({
  storeId,
  branchName,
}: {
  storeId: string;
  branchName: string;
}) {
  const cacheRef = useRef<{ storeId: string; snapshot: NoticeState } | null>(null);

  const getClientSnapshot = useCallback((): NoticeState => {
    if (!cacheRef.current || cacheRef.current.storeId !== storeId) {
      cacheRef.current = { storeId, snapshot: computeSnapshot(storeId) };
    }
    return cacheRef.current.snapshot;
  }, [storeId]);

  const state = useSyncExternalStore(subscribeToNothing, getClientSnapshot, getServerSnapshot);

  if (state.kind === "none") return null;

  if (state.kind === "unavailable") {
    return (
      <Alert tone="warning" className="mt-2">
        Tu navegador no está guardando el carrito. Si cambias de sucursal ahora, vas a perder lo que
        armaste en {branchName}.
      </Alert>
    );
  }

  return (
    <Alert tone="muted" className="mt-2">
      <p>
        Dejas {state.count} {state.count === 1 ? "producto" : "productos"} en el carrito de{" "}
        {branchName}. Siguen ahí cuando vuelvas.
      </p>
      <p className="mt-1">Un carrito que no tocas en 30 días se vacía solo.</p>
    </Alert>
  );
}
