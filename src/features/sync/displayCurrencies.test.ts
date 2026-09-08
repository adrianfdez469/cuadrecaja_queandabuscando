import { describe, expect, it } from "vitest";
import { dedupeDisplayCurrencies, findInvalidDisplayCurrency } from "./displayCurrencies";

/**
 * R3/R4 (D3, humano 2026-09-07): no Prisma, no mocks — the two rules that
 * decide the vocabulary of `BUSINESS_DISPLAY_CURRENCIES_INVALID` (R14) and
 * what ends up written on the row.
 */

describe("findInvalidDisplayCurrency()", () => {
  it.each([
    ["usd", "lowercase does not case-fold"],
    ["US1", "a digit is not a letter"],
    ["€€€", "non-ASCII symbols"],
    ["USDD", "four letters is not three"],
    ["", "empty string"],
    ["  ", "blank, never trimmed"],
    ["USD ", "trailing space, never trimmed"],
  ])("%s is invalid (%s)", (code) => {
    expect(findInvalidDisplayCurrency([code])).toBe(code);
  });

  it("returns the FIRST invalid member when several are wrong", () => {
    expect(findInvalidDisplayCurrency(["CUP", "usd", "US1"])).toBe("usd");
  });

  it("returns null when every member is valid", () => {
    expect(findInvalidDisplayCurrency(["CUP", "USD", "EUR"])).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(findInvalidDisplayCurrency([])).toBeNull();
  });

  it("accepts 40 distinct valid codes with no length cap (R17)", () => {
    const codes = Array.from({ length: 40 }, (_, i) => {
      const a = String.fromCharCode(65 + Math.floor(i / 26));
      const b = String.fromCharCode(65 + (i % 26));
      return `A${a}${b}`;
    });
    expect(findInvalidDisplayCurrency(codes)).toBeNull();
  });
});

describe("dedupeDisplayCurrencies()", () => {
  it("keeps the first occurrence and the relative order of the rest (R4/E8)", () => {
    expect(dedupeDisplayCurrencies(["CUP", "USD", "CUP", "EUR", "USD"])).toEqual([
      "CUP",
      "USD",
      "EUR",
    ]);
  });

  it("does not fold case — 'CUP' and 'cup' are different codes", () => {
    expect(dedupeDisplayCurrencies(["CUP", "cup"])).toEqual(["CUP", "cup"]);
  });

  it("returns an empty list for an empty list", () => {
    expect(dedupeDisplayCurrencies([])).toEqual([]);
  });

  it("returns the list unchanged when there is nothing to dedupe", () => {
    expect(dedupeDisplayCurrencies(["CUP", "USD", "EUR"])).toEqual(["CUP", "USD", "EUR"]);
  });

  it("keeps 40 distinct codes, in order", () => {
    const codes = Array.from({ length: 40 }, (_, i) => {
      const a = String.fromCharCode(65 + Math.floor(i / 26));
      const b = String.fromCharCode(65 + (i % 26));
      return `A${a}${b}`;
    });
    expect(dedupeDisplayCurrencies(codes)).toEqual(codes);
  });
});
