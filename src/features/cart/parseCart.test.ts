import { describe, expect, it } from "vitest";
import { isCartLine, parseStoredCart, serializeCart, type CartSnapshot } from "./parseCart";

const NOW = new Date("2026-08-26T02:00:00.000Z");

function validRaw(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    storeId: "store-1",
    updatedAt: NOW.toISOString(),
    items: [
      {
        storeProductId: "sp-1",
        slug: "cafe-cubita",
        qty: 2,
        display: { name: "Café Cubita", unitPrice: "450.00", currency: "CUP" },
      },
    ],
    ...overrides,
  });
}

describe("parseStoredCart()", () => {
  it("returns null for null input", () => {
    expect(parseStoredCart(null, NOW)).toBeNull();
  });

  it("parses a valid cart", () => {
    const parsed = parseStoredCart(validRaw(), NOW);
    expect(parsed).toEqual({
      storeId: "store-1",
      updatedAt: NOW.toISOString(),
      items: [
        {
          storeProductId: "sp-1",
          slug: "cafe-cubita",
          qty: 2,
          display: { name: "Café Cubita", unitPrice: "450.00", currency: "CUP" },
        },
      ],
    });
  });

  it("discards malformed JSON (E22)", () => {
    expect(parseStoredCart("{not json", NOW)).toBeNull();
  });

  it("discards an unknown version", () => {
    expect(parseStoredCart(validRaw({ v: 2 }), NOW)).toBeNull();
  });

  it("discards a cart older than 30 days (R15)", () => {
    const stale = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();
    expect(parseStoredCart(validRaw({ updatedAt: stale }), NOW)).toBeNull();
  });

  it("keeps a cart exactly at the 30 day boundary", () => {
    const boundary = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(parseStoredCart(validRaw({ updatedAt: boundary }), NOW)).not.toBeNull();
  });

  it("discards a line with a quantity outside 1..99", () => {
    const raw = validRaw({
      items: [
        {
          storeProductId: "sp-1",
          slug: "cafe-cubita",
          qty: 100,
          display: { name: "Café Cubita", unitPrice: "450.00", currency: "CUP" },
        },
      ],
    });
    expect(parseStoredCart(raw, NOW)).toBeNull();
  });

  it("discards more than the line cap", () => {
    const items = Array.from({ length: 51 }, (_, i) => ({
      storeProductId: `sp-${i}`,
      slug: `producto-${i}`,
      qty: 1,
      display: { name: `Producto ${i}`, unitPrice: "1.00", currency: "CUP" },
    }));
    expect(parseStoredCart(validRaw({ items }), NOW)).toBeNull();
  });

  it("discards a cart missing storeId", () => {
    expect(parseStoredCart(validRaw({ storeId: "" }), NOW)).toBeNull();
  });
});

describe("isCartLine()", () => {
  it("rejects a non-integer quantity", () => {
    expect(
      isCartLine({
        storeProductId: "sp-1",
        slug: "x",
        qty: 1.5,
        display: { name: "x", unitPrice: "1.00", currency: "CUP" },
      }),
    ).toBe(false);
  });
});

describe("serializeCart() round-trips through parseStoredCart()", () => {
  it("produces something parseStoredCart accepts back", () => {
    const snapshot: CartSnapshot = {
      storeId: "store-1",
      updatedAt: NOW.toISOString(),
      items: [
        {
          storeProductId: "sp-1",
          slug: "cafe-cubita",
          qty: 3,
          display: { name: "Café Cubita", unitPrice: "450.00", currency: "CUP" },
        },
      ],
    };
    expect(parseStoredCart(serializeCart(snapshot), NOW)).toEqual(snapshot);
  });
});
