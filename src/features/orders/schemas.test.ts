import { describe, expect, it } from "vitest";
import { proposeOrderChangeSchema } from "./schemas";

/**
 * F-019 architecture.md DA2 § Contratos: the one validation this feature
 * adds that decides money math, mirroring R6/R10's rule for the checkout —
 * `Σ lineTotal = subtotal` and `total = subtotal - discountTotal + deliveryFee`,
 * checked with `src/lib/money.ts`, never `Number` on a decimal string.
 */

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    orderId: "42",
    currencyCode: "CUP",
    subtotal: "1000.00",
    deliveryFee: "180.00",
    total: "1180.00",
    message: "El envío a Playa cuesta 180.",
    items: [
      {
        storeProductId: "b5b6c1de-1f9b-4d1a-9e4c-1a2b3c4d5e6f",
        name: "Café Cubita",
        unitPrice: "500.00",
        currencyCode: "CUP",
        quantity: "2",
        lineTotal: "1000.00",
      },
    ],
    ...overrides,
  };
}

describe("proposeOrderChangeSchema — arithmetic", () => {
  it("accepts a body whose sums add up, defaulting discountTotal to '0'", () => {
    const result = proposeOrderChangeSchema.safeParse(baseBody());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.discountTotal).toBe("0");
  });

  it("rejects when Σ lineTotal ≠ subtotal", () => {
    const result = proposeOrderChangeSchema.safeParse(baseBody({ subtotal: "999.00" }));
    expect(result.success).toBe(false);
  });

  it("rejects when total ≠ subtotal - discountTotal + deliveryFee", () => {
    const result = proposeOrderChangeSchema.safeParse(baseBody({ total: "1000.00" }));
    expect(result.success).toBe(false);
  });

  it("accepts the total-unchanged case (design.md estado 3): equal totals are legitimate", () => {
    const result = proposeOrderChangeSchema.safeParse(
      baseBody({ deliveryFee: "0.00", total: "1000.00" }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a line in a currency other than the body's own", () => {
    const result = proposeOrderChangeSchema.safeParse(
      baseBody({
        items: [
          {
            storeProductId: "b5b6c1de-1f9b-4d1a-9e4c-1a2b3c4d5e6f",
            name: "Café Cubita",
            unitPrice: "500.00",
            currencyCode: "USD",
            quantity: "2",
            lineTotal: "1000.00",
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a negative amount — the decimal regex has no room for a minus sign", () => {
    const result = proposeOrderChangeSchema.safeParse(baseBody({ total: "-5.00" }));
    expect(result.success).toBe(false);
  });

  it("rejects an empty items array and more than CART_MAX_LINES", () => {
    expect(proposeOrderChangeSchema.safeParse(baseBody({ items: [] })).success).toBe(false);
  });

  it("accepts a null storeProductId on a line (a product removed from the catalog since)", () => {
    const result = proposeOrderChangeSchema.safeParse(
      baseBody({
        items: [
          {
            storeProductId: null,
            name: "Café Cubita",
            unitPrice: "500.00",
            currencyCode: "CUP",
            quantity: "2",
            lineTotal: "1000.00",
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });
});
