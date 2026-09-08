import { describe, expect, it } from "vitest";
import { convert, money } from "./money";
import { equivalentCurrencies, priceEquivalents, selectableCurrencies } from "./priceEquivalents";

/**
 * F-039 (architecture.md AD1, § Pruebas: el reparto entre archivos): the pure
 * arithmetic, with no Prisma and no React. Covers spec.md R2, R5, R7, R9,
 * R10, R23 and criterion 7 (the anchor is never skipped).
 */

describe("equivalentCurrencies()", () => {
  it("is the declared list minus the base (R2)", () => {
    expect(equivalentCurrencies(["CUP", "USD"], "CUP")).toEqual(["USD"]);
  });

  it("does not paint the base twice when it repeats in the list (E8)", () => {
    expect(equivalentCurrencies(["CUP", "USD", "CUP"], "CUP")).toEqual(["USD"]);
  });

  it("keeps the whole list when the base is absent from it (E7)", () => {
    expect(equivalentCurrencies(["USD"], "CUP")).toEqual(["USD"]);
  });

  it("returns an empty set for an empty list", () => {
    expect(equivalentCurrencies([], "CUP")).toEqual([]);
  });
});

describe("priceEquivalents()", () => {
  const price = money("4400.00", "CUP");

  it("omits a declared currency that has no rate, keeping the rest (E6/R5)", () => {
    const out = priceEquivalents(price, ["CUP", "USD", "EUR"], "CUP", { USD: "440" });
    expect(out.map((m) => m.currency)).toEqual(["USD"]);
  });

  it("treats a zero rate as absent, not as a free conversion", () => {
    const out = priceEquivalents(price, ["CUP", "USD"], "CUP", { USD: "0" });
    expect(out).toEqual([]);
  });

  it("treats a negative rate as absent", () => {
    const out = priceEquivalents(price, ["CUP", "USD"], "CUP", { USD: "-5" });
    expect(out).toEqual([]);
  });

  it("returns nothing for an empty declared list", () => {
    expect(priceEquivalents(price, [], "CUP", { USD: "440" })).toEqual([]);
  });

  it("discards a garbage code silently, same as any other missing rate", () => {
    // The writer already validates the format (CURRENCY_CODE_PATTERN); this
    // module trusts `convert`'s failure rather than checking the shape a
    // second time (R23(1)).
    const out = priceEquivalents(price, ["CUP", "usd"], "CUP", { USD: "440" });
    expect(out).toEqual([]);
  });

  it("computes the equivalent through convert(), not a second division", () => {
    const rates = { USD: "440", MLC: "210.5" };
    const out = priceEquivalents(price, ["CUP", "USD"], "CUP", rates);
    expect(out).toEqual([convert(price, "USD", rates)]);
  });

  it("never skips the anchor (criterion 7): base MLC, product USD, equivalent EUR", () => {
    const rates = { USD: "100", MLC: "3", EUR: "7" };
    // What resolvePrice would hand this module: the product's USD price
    // already converted to the base MLC.
    const priceInBase = convert(money("1", "USD"), "MLC", rates);

    const [equivalent] = priceEquivalents(priceInBase, ["MLC", "EUR"], "MLC", rates);

    // The correct path: MLC -> anchor -> EUR, on the amount ALREADY in the
    // base, with whatever rounding that intermediate step introduced.
    expect(equivalent).toEqual(convert(priceInBase, "EUR", rates));

    // The bug this guards against: composing a "direct" USD/EUR quotient by
    // converting from the ORIGIN currency straight to the equivalent,
    // skipping the base entirely. With these rates the two roundings
    // genuinely disagree, so this is not a tautology.
    const skippedTheBase = convert(money("1", "USD"), "EUR", rates);
    expect(equivalent.amount).not.toBe(skippedTheBase.amount);
  });
});

describe("selectableCurrencies() (DH5, R23)", () => {
  it("offers a declared currency with a calculable equivalent", () => {
    expect(selectableCurrencies(["CUP", "USD"], "CUP", { USD: "440" })).toEqual(["USD"]);
  });

  it("does NOT offer a declared currency with no rate — the other half of E6", () => {
    const out = selectableCurrencies(["CUP", "USD", "EUR"], "CUP", { USD: "440" });
    expect(out).toEqual(["USD"]);
    expect(out).not.toContain("EUR");
  });

  it("treats a zero or negative rate as unofferable, not just uncalculated", () => {
    expect(selectableCurrencies(["CUP", "USD"], "CUP", { USD: "0" })).toEqual([]);
    expect(selectableCurrencies(["CUP", "USD"], "CUP", { USD: "-1" })).toEqual([]);
  });

  it("returns an empty set when the base itself has no rate (non-CUP base)", () => {
    // MLC is the base here and carries no rate of its own (only the anchor
    // CUP is implicit); every conversion out of MLC has to fail.
    const out = selectableCurrencies(["USD"], "MLC", { USD: "440" });
    expect(out).toEqual([]);
  });

  it("returns an empty set for an empty declared list", () => {
    expect(selectableCurrencies([], "CUP", { USD: "440" })).toEqual([]);
  });

  it("its first element is what the store starts on (SP1(a))", () => {
    const out = selectableCurrencies(["CUP", "USD", "MLC"], "CUP", { USD: "440" });
    // MLC has no rate and is skipped; USD is the only, and therefore first,
    // offered currency.
    expect(out[0]).toBe("USD");
  });

  it("and the offered set is exactly what priceEquivalents would paint for a probe amount", () => {
    const rates = { USD: "440", MLC: "210.5" };
    const declared = ["CUP", "USD", "MLC"];
    const offered = selectableCurrencies(declared, "CUP", rates);
    const painted = priceEquivalents(money(1, "CUP"), declared, "CUP", rates).map(
      (m) => m.currency,
    );
    expect(offered).toEqual(painted);
  });
});
