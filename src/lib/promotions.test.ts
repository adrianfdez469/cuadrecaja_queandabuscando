import { describe, expect, it } from "vitest";
import { money } from "./money";
import {
  applyPromotion,
  indexPromotions,
  orderDiscount,
  selectPromotion,
  type PromotionRow,
} from "./promotions";

const NOW = new Date("2026-08-27T00:00:00Z");
const RATES = { USD: "440" };

function row(overrides: Partial<PromotionRow> = {}): PromotionRow {
  return {
    id: "p1",
    type: "PERCENTAGE",
    scope: "PRODUCT",
    value: "20",
    conditions: { storeProductIds: ["sp-1"] },
    startsAt: new Date("2026-01-01"),
    endsAt: null,
    active: true,
    ...overrides,
  };
}

describe("indexPromotions() — R25 vigency", () => {
  it("includes an active promotion with no end date", () => {
    const index = indexPromotions([row()], NOW);
    expect(index.forProduct("sp-1", null)).toHaveLength(1);
  });

  it("excludes an inactive promotion", () => {
    const index = indexPromotions([row({ active: false })], NOW);
    expect(index.forProduct("sp-1", null)).toHaveLength(0);
  });

  it("excludes a promotion that has not started yet", () => {
    const index = indexPromotions([row({ startsAt: new Date("2099-01-01") })], NOW);
    expect(index.forProduct("sp-1", null)).toHaveLength(0);
  });

  it("excludes a promotion whose endsAt already passed", () => {
    const index = indexPromotions([row({ endsAt: new Date("2020-01-01") })], NOW);
    expect(index.forProduct("sp-1", null)).toHaveLength(0);
  });

  it("includes a CATEGORY promotion for products in that category, plus its own PRODUCT ones", () => {
    const index = indexPromotions(
      [
        row({ id: "p-cat", scope: "CATEGORY", conditions: { localCategoryIds: ["cat-1"] } }),
        row({ id: "p-prod" }),
      ],
      NOW,
    );
    const candidates = index.forProduct("sp-1", "cat-1").map((c) => c.id);
    expect(candidates.sort()).toEqual(["p-cat", "p-prod"]);
  });

  it("drops a PRODUCT row with invalid conditions rather than applying it to everything", () => {
    const index = indexPromotions([row({ conditions: { storeProductIds: [] } })], NOW);
    expect(index.forProduct("sp-1", null)).toHaveLength(0);
    expect(index.forProduct("anything", null)).toHaveLength(0);
  });

  it("collects ORDER promotions separately, with minSubtotal parsed", () => {
    const index = indexPromotions(
      [row({ id: "p-order", scope: "ORDER", conditions: { minSubtotal: "1000" } })],
      NOW,
    );
    expect(index.order).toEqual([expect.objectContaining({ id: "p-order", minSubtotal: "1000" })]);
  });

  it("drops an ORDER row whose minSubtotal is not a string", () => {
    const index = indexPromotions(
      [row({ id: "p-order", scope: "ORDER", conditions: { minSubtotal: 1000 } })],
      NOW,
    );
    expect(index.order).toHaveLength(0);
  });
});

describe("selectPromotion() — R26", () => {
  it("picks the promotion that leaves the lowest price", () => {
    const cheap = { ...row({ id: "a", value: "10" }) };
    const expensive = { ...row({ id: "b", value: "50" }) };
    const winner = selectPromotion(
      [
        {
          id: cheap.id,
          type: cheap.type,
          value: cheap.value,
          startsAt: cheap.startsAt,
          endsAt: null,
          active: true,
          scope: "PRODUCT",
        },
        {
          id: expensive.id,
          type: expensive.type,
          value: expensive.value,
          startsAt: expensive.startsAt,
          endsAt: null,
          active: true,
          scope: "PRODUCT",
        },
      ],
      money("100", "CUP"),
      { rates: RATES, baseCurrency: "CUP" },
    );
    expect(winner?.id).toBe("b"); // 50% off beats 10% off
  });

  it("breaks a tie by earliest startsAt, then by id ascending", () => {
    const a = {
      id: "b-later",
      type: "PERCENTAGE" as const,
      value: "20",
      startsAt: new Date("2026-02-01"),
      endsAt: null,
      active: true,
      scope: "PRODUCT" as const,
    };
    const b = {
      id: "a-earlier",
      type: "PERCENTAGE" as const,
      value: "20",
      startsAt: new Date("2026-01-01"),
      endsAt: null,
      active: true,
      scope: "PRODUCT" as const,
    };
    const winner = selectPromotion([a, b], money("100", "CUP"), {
      rates: RATES,
      baseCurrency: "CUP",
    });
    expect(winner?.id).toBe("a-earlier");
  });

  it("returns null with no candidates", () => {
    expect(
      selectPromotion([], money("100", "CUP"), { rates: RATES, baseCurrency: "CUP" }),
    ).toBeNull();
  });
});

describe("applyPromotion() — R27", () => {
  const applied = {
    id: "p1",
    type: "PERCENTAGE" as const,
    value: "20",
    startsAt: NOW,
    endsAt: null,
    active: true,
    scope: "PRODUCT" as const,
  };

  it("PERCENTAGE discounts the price and keeps listPrice as the original", () => {
    const result = applyPromotion(money("500", "CUP"), applied, {
      rates: RATES,
      baseCurrency: "CUP",
    });
    expect(result.price.amount).toBe("400.00");
    expect(result.listPrice.amount).toBe("500.00");
  });

  it("FIXED converts value from baseCurrency into the price's own currency", () => {
    const fixed = { ...applied, type: "FIXED" as const, value: "44000" }; // 44000 CUP
    const result = applyPromotion(money("500", "USD"), fixed, {
      rates: RATES,
      baseCurrency: "CUP",
    });
    // 44000 CUP / 440 = 100 USD discount.
    expect(result.price.amount).toBe("400.00");
  });

  it("never goes below 0", () => {
    const fixed = { ...applied, type: "FIXED" as const, value: "999999" };
    const result = applyPromotion(money("10", "CUP"), fixed, { rates: RATES, baseCurrency: "CUP" });
    expect(result.price.amount).toBe("0.00");
  });
});

describe("orderDiscount() — R29, R30", () => {
  it("returns 0 when the subtotal does not reach minSubtotal", () => {
    const promo = {
      id: "o1",
      type: "FIXED" as const,
      value: "100",
      startsAt: NOW,
      endsAt: null,
      active: true,
      minSubtotal: "1000",
    };
    const result = orderDiscount(money("500", "CUP"), [promo], {
      rates: RATES,
      baseCurrency: "CUP",
    });
    expect(result).toEqual({ discount: money("0", "CUP"), promotionId: null });
  });

  it("applies the discount once the subtotal reaches minSubtotal", () => {
    const promo = {
      id: "o1",
      type: "FIXED" as const,
      value: "100",
      startsAt: NOW,
      endsAt: null,
      active: true,
      minSubtotal: "1000",
    };
    const result = orderDiscount(money("2000", "CUP"), [promo], {
      rates: RATES,
      baseCurrency: "CUP",
    });
    expect(result).toEqual({ discount: money("100", "CUP"), promotionId: "o1" });
  });

  it("a FIXED discount never exceeds the subtotal", () => {
    const promo = {
      id: "o1",
      type: "FIXED" as const,
      value: "9999",
      startsAt: NOW,
      endsAt: null,
      active: true,
      minSubtotal: null,
    };
    const result = orderDiscount(money("50", "CUP"), [promo], {
      rates: RATES,
      baseCurrency: "CUP",
    });
    expect(result.discount.amount).toBe("50.00");
  });
});
