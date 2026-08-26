import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCart, isLocalStorageAvailable, readCart, writeCart } from "./cartStorage";

function snapshot(storeId: string, storeProductId = "sp-1") {
  return {
    storeId,
    updatedAt: new Date().toISOString(),
    items: [
      {
        storeProductId,
        slug: "cafe-cubita",
        qty: 2,
        display: { name: "Café Cubita", unitPrice: "450.00", currency: "CUP" },
      },
    ],
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("readCart()/writeCart() — criterio 1", () => {
  it("writes under a key namespaced by Store.id and reads it back", () => {
    writeCart(snapshot("store-a"));
    expect(window.localStorage.getItem("qab.cart.v1.store-a")).not.toBeNull();
    expect(readCart("store-a")?.items).toHaveLength(1);
  });

  it("writing store A's cart never touches store B's key", () => {
    writeCart(snapshot("store-a"));
    writeCart(snapshot("store-b", "sp-2"));

    expect(readCart("store-a")?.items[0].storeProductId).toBe("sp-1");
    expect(readCart("store-b")?.items[0].storeProductId).toBe("sp-2");
    expect(window.localStorage.getItem("qab.cart.v1.store-a")).not.toBeNull();
    expect(window.localStorage.getItem("qab.cart.v1.store-b")).not.toBeNull();
  });

  it("returns null for a store with nothing stored", () => {
    expect(readCart("store-nothing-here")).toBeNull();
  });

  it("clearCart removes only that store's key", () => {
    writeCart(snapshot("store-a"));
    writeCart(snapshot("store-b", "sp-2"));
    clearCart("store-a");
    expect(readCart("store-a")).toBeNull();
    expect(readCart("store-b")).not.toBeNull();
  });
});

describe("degradation when localStorage throws (E21)", () => {
  const originalSetItem = window.localStorage.setItem.bind(window.localStorage);

  afterEach(() => {
    window.localStorage.setItem = originalSetItem;
    vi.resetModules();
  });

  it("falls back to memory and keeps working when setItem throws", async () => {
    vi.resetModules();
    const blocked = await import("./cartStorage");
    window.localStorage.setItem = () => {
      throw new DOMException("QuotaExceededError");
    };

    expect(() => blocked.writeCart(snapshot("store-blocked"))).not.toThrow();
    expect(blocked.readCart("store-blocked")?.items).toHaveLength(1);
  });
});

describe("isLocalStorageAvailable()", () => {
  it("is true in this jsdom environment", () => {
    expect(isLocalStorageAvailable()).toBe(true);
  });
});
