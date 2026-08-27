import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BranchSwitchNotice } from "./BranchSwitchNotice";
import { writeCart } from "../cartStorage";

// `snapshotCache` is memoized per `storeId` (ficha `set-state-en-efecto-prohibido`
// — the component reads via `useSyncExternalStore`, and `getSnapshot` has to
// return a stable reference). Each test needs its OWN id, same reason
// `cartStore.test.tsx` does — reusing one across tests would read a cached
// snapshot from a PREVIOUS test instead of what this test just wrote.
let counter = 0;
function freshStoreId(): string {
  counter += 1;
  return `branch-switch-store-${counter}`;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("BranchSwitchNotice — criterio 6, HS11", () => {
  it("renders nothing when the current branch's cart is empty", () => {
    const storeId = freshStoreId();
    render(<BranchSwitchNotice storeId={storeId} branchName="La Rampa · Vedado" />);
    expect(screen.queryByText(/Dejas/)).toBeNull();
    expect(screen.queryByText(/no está guardando/)).toBeNull();
  });

  it("reports the line count of the CURRENT branch's cart, in units not lines (B/C)", () => {
    const storeId = freshStoreId();
    writeCart({
      storeId,
      updatedAt: new Date().toISOString(),
      items: [
        {
          storeProductId: "sp-1",
          slug: "cafe",
          qty: 3,
          display: { name: "Café", unitPrice: "100.00", currency: "CUP" },
        },
        {
          storeProductId: "sp-2",
          slug: "jugo",
          qty: 1,
          display: { name: "Jugo", unitPrice: "50.00", currency: "CUP" },
        },
      ],
    });

    render(<BranchSwitchNotice storeId={storeId} branchName="La Rampa · Vedado" />);

    expect(
      screen.getByText(/Dejas 4 productos en el carrito de La Rampa · Vedado/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Un carrito que no tocas en 30 días se vacía solo/),
    ).toBeInTheDocument();
    // HS11/DP1 → "no": never names or counts a DIFFERENT branch's cart.
    expect(screen.queryByText(/otra sucursal/i)).toBeNull();
  });

  it("uses the singular for exactly one unit", () => {
    const storeId = freshStoreId();
    writeCart({
      storeId,
      updatedAt: new Date().toISOString(),
      items: [
        {
          storeProductId: "sp-1",
          slug: "cafe",
          qty: 1,
          display: { name: "Café", unitPrice: "100.00", currency: "CUP" },
        },
      ],
    });

    render(<BranchSwitchNotice storeId={storeId} branchName="La Rampa · Vedado" />);
    expect(screen.getByText(/Dejas 1 producto en el carrito/)).toBeInTheDocument();
  });

  describe("when the browser is not saving (E, private browsing)", () => {
    const realLocalStorage = window.localStorage;

    afterEach(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: realLocalStorage,
      });
      vi.resetModules();
    });

    it("shows the storage-unavailable warning, never a permanence promise", async () => {
      // `cartStorage.ts` memoizes `isLocalStorageAvailable()` for the life of
      // the module (design.md § V18) — the sabotage has to happen BEFORE
      // anything (including an earlier test in THIS file) ever calls it, or
      // the cached `true` wins. `vi.resetModules()` + a dynamic re-import is
      // the same technique `cartStorage.test.tsx`'s own E21 suite uses.
      vi.resetModules();
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new Error("blocked");
        },
      });

      const { BranchSwitchNotice: FreshNotice } = await import("./BranchSwitchNotice");
      render(<FreshNotice storeId={freshStoreId()} branchName="La Rampa · Vedado" />);

      expect(screen.getByText(/Tu navegador no está guardando el carrito/)).toBeInTheDocument();
      expect(screen.queryByText(/Dejas/)).toBeNull();
    });
  });
});
