import { describe, expect, it } from "vitest";
import {
  add,
  compare,
  convert,
  formatMoney,
  formatWholeMoney,
  isZero,
  money,
  MoneyError,
  multiply,
  percentageOff,
  subtract,
  sum,
} from "./money";

describe("money()", () => {
  it("normalises to two fraction digits", () => {
    expect(money("10", "CUP").amount).toBe("10.00");
    expect(money(10.5, "CUP").amount).toBe("10.50");
    expect(money("10.499", "CUP").amount).toBe("10.50");
    expect(money("10.494", "CUP").amount).toBe("10.49");
  });

  it("accepts anything Decimal-like without importing Prisma", () => {
    const decimalLike = { toString: () => "1234.56" };
    expect(money(decimalLike, "USD").amount).toBe("1234.56");
  });

  it("rejects non-numeric input", () => {
    expect(() => money("abc", "CUP")).toThrow(MoneyError);
  });

  it("requires a currency", () => {
    expect(() => money(1, "")).toThrow(MoneyError);
  });
});

describe("arithmetic", () => {
  it("does not drift the way floats do", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE 754. It must here.
    const total = add(money("0.10", "CUP"), money("0.20", "CUP"));
    expect(total.amount).toBe("0.30");
  });

  it("adds and subtracts", () => {
    expect(add(money("10.05", "CUP"), money("2.50", "CUP")).amount).toBe("12.55");
    expect(subtract(money("10.05", "CUP"), money("2.50", "CUP")).amount).toBe("7.55");
  });

  it("refuses to mix currencies", () => {
    expect(() => add(money(1, "CUP"), money(1, "USD"))).toThrow(/mismatch/i);
  });

  it("multiplies by fractional quantities", () => {
    expect(multiply(money("100.00", "CUP"), "2.5").amount).toBe("250.00");
    expect(multiply(money("33.33", "CUP"), "3").amount).toBe("99.99");
    expect(multiply(money("10.00", "CUP"), "0.333").amount).toBe("3.33");
  });

  it("sums an empty list to zero", () => {
    const zero = sum([], "CUP");
    expect(zero.amount).toBe("0.00");
    expect(isZero(zero)).toBe(true);
  });

  it("sums a list", () => {
    const total = sum([money("1.11", "CUP"), money("2.22", "CUP"), money("3.33", "CUP")], "CUP");
    expect(total.amount).toBe("6.66");
  });
});

describe("convert()", () => {
  // rate = CUP per 1 unit. CUP itself is never in the table.
  const rates = { USD: "440", MLC: "210.5" };

  it("returns the same object when currencies match", () => {
    const value = money("10", "USD");
    expect(convert(value, "USD", rates)).toBe(value);
  });

  it("converts to the anchor", () => {
    expect(convert(money("2", "USD"), "CUP", rates).amount).toBe("880.00");
  });

  it("converts from the anchor", () => {
    expect(convert(money("880", "CUP"), "USD", rates).amount).toBe("2.00");
  });

  it("converts across two non-anchor currencies", () => {
    // 1 USD = 440 CUP; 1 MLC = 210.5 CUP  =>  1 USD = 2.0902... MLC
    expect(convert(money("1", "USD"), "MLC", rates).amount).toBe("2.09");
  });

  it("throws instead of guessing when a rate is missing", () => {
    expect(() => convert(money("1", "EUR"), "CUP", rates)).toThrow(/no exchange rate/i);
  });

  it("rejects a non-positive rate rather than dividing by zero", () => {
    expect(() => convert(money("1", "CUP"), "USD", { USD: "0" })).toThrow(/non-positive/i);
  });
});

describe("formatMoney()", () => {
  it("formats a known currency", () => {
    const output = formatMoney(money("1234.5", "USD"), { locale: "en-US" });
    expect(output).toContain("1,234.50");
  });

  it("falls back for an unknown currency code", () => {
    const output = formatMoney(money("10", "XYZ"), { locale: "en-US", symbol: "¤" });
    expect(output).toMatch(/10\.00/);
  });
});

describe("formatWholeMoney() (F-027 RD4)", () => {
  it("drops the fraction digits a whole amount never needs", () => {
    const output = formatWholeMoney(money("350", "USD"), { locale: "en-US" });
    expect(output).not.toContain(".00");
    expect(output).toContain("350");
  });

  it("shares the SAME symbol as formatMoney for the same currency", () => {
    const whole = formatWholeMoney(money("350", "USD"), { locale: "en-US" });
    const withCents = formatMoney(money("350", "USD"), { locale: "en-US" });
    const symbol = whole.replace(/[\d.,\s]/g, "");
    expect(withCents.startsWith(symbol) || withCents.endsWith(symbol)).toBe(true);
  });

  it("never prints a fraction, on the primary path or the fallback one", () => {
    const output = formatWholeMoney(money("10", "XYZ"), { locale: "en-US", symbol: "¤" });
    expect(output).not.toContain(".");
    expect(output).toMatch(/10/);
  });
});

describe("percentageOff()", () => {
  it("takes a percentage off", () => {
    expect(percentageOff(money("500", "CUP"), "20").amount).toBe("400.00");
  });

  it("floors at 0 rather than going negative", () => {
    expect(percentageOff(money("10", "CUP"), "100").amount).toBe("0.00");
  });

  it("rounds half up on the smallest unit", () => {
    // 50% of 10.03 is exactly 5.015; the DISCOUNT rounds up to 5.02, so the
    // remaining price is 5.01, not 5.02 or a truncated 5.00.
    expect(percentageOff(money("10.03", "CUP"), "50").amount).toBe("5.01");
  });
});

describe("compare()", () => {
  it("orders two amounts in the same currency", () => {
    expect(compare(money("5", "CUP"), money("10", "CUP"))).toBe(-1);
    expect(compare(money("10", "CUP"), money("5", "CUP"))).toBe(1);
    expect(compare(money("5", "CUP"), money("5", "CUP"))).toBe(0);
  });

  it("throws on a currency mismatch, like the rest of the arithmetic", () => {
    expect(() => compare(money("5", "CUP"), money("5", "USD"))).toThrow(MoneyError);
  });
});
