import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useCart } from "./cartStore";

// The module holds ONE store's cart in memory at a time (by design — see
// cartStore.ts). Each test therefore needs its OWN store id: reusing "store-a"
// across tests would let `ensureStore`'s short-circuit (`currentStoreId ===
// storeId`) skip reloading from storage and leak state between tests.
//
// IMPORTANT: the id is always computed OUTSIDE the render callback and
// closed over. Calling `freshStoreId()` *inside* `() => useCart(freshStoreId())`
// would hand `useCart` a NEW id on every re-render (React's dev-mode double
// render, or the re-render `notify()` itself triggers), which `ensureStore`
// then reads as "switched stores" and resets to an empty cart every time.
let storeCounter = 0;
function freshStoreId(): string {
  storeCounter += 1;
  return `store-${storeCounter}`;
}

function line(storeProductId = "sp-1", overrides: Record<string, unknown> = {}) {
  return {
    storeProductId,
    slug: `producto-${storeProductId}`,
    display: { name: `Producto ${storeProductId}`, unitPrice: "100.00", currency: "CUP" },
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("useCart() — add/setQty/remove/clear", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useCart(freshStoreId()));
    expect(result.current.items).toEqual([]);
    expect(result.current.count).toBe(0);
  });

  it("adds a line with quantity 1 by default (E1)", () => {
    const storeId = freshStoreId();
    const { result } = renderHook(() => useCart(storeId));
    act(() => result.current.add(line()));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].qty).toBe(1);
    expect(result.current.count).toBe(1);
  });

  it("adding the same product again merges into ONE line, not two (E2)", () => {
    const storeId = freshStoreId();
    const { result } = renderHook(() => useCart(storeId));
    act(() => result.current.add(line()));
    act(() => result.current.add(line()));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].qty).toBe(2);
  });

  it("caps a line at 99 units (R14)", () => {
    const storeId = freshStoreId();
    const { result } = renderHook(() => useCart(storeId));
    act(() => result.current.add(line(), 60));
    act(() => result.current.add(line(), 60));
    expect(result.current.items[0].qty).toBe(99);
  });

  it("caps at 50 distinct lines and silently ignores a 51st product (R14)", () => {
    const storeId = freshStoreId();
    const { result } = renderHook(() => useCart(storeId));
    act(() => {
      for (let i = 0; i < 51; i += 1) result.current.add(line(`sp-${i}`));
    });
    expect(result.current.items).toHaveLength(50);
  });

  it("setQty(0) removes the line (R14)", () => {
    const storeId = freshStoreId();
    const { result } = renderHook(() => useCart(storeId));
    act(() => result.current.add(line()));
    act(() => result.current.setQty("sp-1", 0));
    expect(result.current.items).toEqual([]);
  });

  it("setQty clamps to 99", () => {
    const storeId = freshStoreId();
    const { result } = renderHook(() => useCart(storeId));
    act(() => result.current.add(line()));
    act(() => result.current.setQty("sp-1", 500));
    expect(result.current.items[0].qty).toBe(99);
  });

  it("remove() drops exactly that line", () => {
    const storeId = freshStoreId();
    const { result } = renderHook(() => useCart(storeId));
    act(() => result.current.add(line("sp-1")));
    act(() => result.current.add(line("sp-2")));
    act(() => result.current.remove("sp-1"));
    expect(result.current.items.map((item) => item.storeProductId)).toEqual(["sp-2"]);
  });

  it("clear() empties the cart and the underlying storage key", () => {
    const storeId = freshStoreId();
    const { result } = renderHook(() => useCart(storeId));
    act(() => result.current.add(line()));
    act(() => result.current.clear());
    expect(result.current.items).toEqual([]);
    expect(window.localStorage.getItem(`qab.cart.v1.${storeId}`)).toBeNull();
  });

  it("count sums units across lines, not the number of lines", () => {
    const storeId = freshStoreId();
    const { result } = renderHook(() => useCart(storeId));
    act(() => result.current.add(line("sp-1"), 3));
    act(() => result.current.add(line("sp-2"), 4));
    expect(result.current.count).toBe(7);
  });
});

describe("useCart() — per-store isolation (E4, criterio 1)", () => {
  // The module holds ONE store's cart at a time by design (a real page is
  // always scoped to a single Store.id — two different stores mounted
  // simultaneously in one tab does not happen in production). The storage
  // layer's isolation — writing store A never touches store B's key — is
  // covered directly in cartStorage.test.tsx; this is the hook-level
  // scenario that DOES happen: navigating from one store's pages to another.
  it("switching a single hook instance between stores swaps the cart (E4)", () => {
    const storeA = freshStoreId();
    const storeB = freshStoreId();

    window.localStorage.setItem(
      `qab.cart.v1.${storeA}`,
      JSON.stringify({
        v: 1,
        storeId: storeA,
        updatedAt: new Date().toISOString(),
        items: [
          {
            storeProductId: "sp-1",
            slug: "x",
            qty: 2,
            display: { name: "x", unitPrice: "1.00", currency: "CUP" },
          },
        ],
      }),
    );

    const { result, rerender } = renderHook(({ storeId }) => useCart(storeId), {
      initialProps: { storeId: storeB },
    });
    expect(result.current.items).toEqual([]);

    rerender({ storeId: storeA });
    expect(result.current.items).toHaveLength(1);
  });
});

describe("useCart() — persistence and cross-tab sync (E3, E23)", () => {
  it("persists across a fresh hook instance (simulating a reload)", () => {
    const storeId = freshStoreId();
    const first = renderHook(() => useCart(storeId));
    act(() => first.result.current.add(line(), 2));

    const second = renderHook(() => useCart(storeId));
    expect(second.result.current.items).toHaveLength(1);
    expect(second.result.current.items[0].qty).toBe(2);
  });

  it("reacts to a storage event from another tab for the SAME store", () => {
    const storeId = freshStoreId();
    const { result } = renderHook(() => useCart(storeId));
    expect(result.current.items).toEqual([]);

    // Simulate another tab writing directly, then firing the native event.
    window.localStorage.setItem(
      `qab.cart.v1.${storeId}`,
      JSON.stringify({
        v: 1,
        storeId,
        updatedAt: new Date().toISOString(),
        items: [
          {
            storeProductId: "sp-9",
            slug: "x",
            qty: 1,
            display: { name: "x", unitPrice: "1.00", currency: "CUP" },
          },
        ],
      }),
    );
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: `qab.cart.v1.${storeId}` }));
    });

    expect(result.current.items).toHaveLength(1);
  });

  it("ignores a storage event for a DIFFERENT store's key", () => {
    const storeA = freshStoreId();
    const storeB = freshStoreId();
    const { result } = renderHook(() => useCart(storeA));
    act(() => result.current.add(line("sp-1")));

    window.localStorage.setItem(`qab.cart.v1.${storeB}`, "garbage-should-not-matter");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: `qab.cart.v1.${storeB}` }));
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].storeProductId).toBe("sp-1");
  });
});
