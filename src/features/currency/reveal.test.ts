import { describe, expect, it } from "vitest";
import { REFERENCE_CURRENCY_BOOT_SCRIPT, renderReferenceCurrencyCss } from "./reveal";

/**
 * F-039 (architecture.md AD4, § Pruebas: el reparto entre archivos). Covers
 * C2 and C9: the N+1 rules come from the OFFERED set (DH5), not the
 * declared one, and an empty set means no `<style>` at all — the caller
 * decides that from an empty string, this module never special-cases it.
 *
 * The five branches of the boot script itself are executed (not just
 * string-matched) in `src/features/currency/referenceCurrencyStore.test.tsx`
 * — that needs a DOM, so it lives in the jsdom project (`.test.tsx`), not
 * here (AGENTS.md § Cosas que muerden, ficha `test-en-entorno-equivocado`).
 */

describe("renderReferenceCurrencyCss()", () => {
  it("is empty for an empty offered set (C9: no <style> at all)", () => {
    expect(renderReferenceCurrencyCss([])).toBe("");
  });

  it("emits one :not() rule per offered currency, plus the sentinel rule", () => {
    const css = renderReferenceCurrencyCss(["USD", "MLC"]);
    expect(css).toBe(
      '[data-ref-currency="USD"] [data-equiv]:not([data-equiv="USD"]){display:none}' +
        '[data-ref-currency="MLC"] [data-equiv]:not([data-equiv="MLC"]){display:none}' +
        '[data-ref-currency="none"] [data-equiv]{display:none}',
    );
  });

  it("never puts a display declaration on the visible element (:not(), not revert)", () => {
    const css = renderReferenceCurrencyCss(["USD"]);
    expect(css).not.toContain("revert");
    // The rule for the CHOSEN currency only ever appears inside :not(...) —
    // never as a bare selector of its own.
    expect(css.match(/\[data-equiv="USD"\]/g)).toHaveLength(1);
  });

  it("one rule is exactly 76 bytes for a three-letter code (architecture.md AD4)", () => {
    const [firstRule] = renderReferenceCurrencyCss(["USD"]).split("}").filter(Boolean);
    expect(Buffer.byteLength(`${firstRule}}`, "utf8")).toBe(76);
  });
});

describe("REFERENCE_CURRENCY_BOOT_SCRIPT", () => {
  it("is a plain string constant with no interpolation placeholder", () => {
    expect(typeof REFERENCE_CURRENCY_BOOT_SCRIPT).toBe("string");
    expect(REFERENCE_CURRENCY_BOOT_SCRIPT).not.toContain("${");
  });

  it("is a self-invoking function expression, byte-measured", () => {
    expect(REFERENCE_CURRENCY_BOOT_SCRIPT.startsWith("(function(){")).toBe(true);
    expect(REFERENCE_CURRENCY_BOOT_SCRIPT.endsWith("})();")).toBe(true);
    expect(Buffer.byteLength(REFERENCE_CURRENCY_BOOT_SCRIPT, "utf8")).toBe(373);
  });

  it("reads the exact storage key and attribute names AD9 declares", () => {
    expect(REFERENCE_CURRENCY_BOOT_SCRIPT).toContain("qab.reference-currency.v1");
    expect(REFERENCE_CURRENCY_BOOT_SCRIPT).toContain("data-ref-choices");
    expect(REFERENCE_CURRENCY_BOOT_SCRIPT).toContain("data-ref-default");
    expect(REFERENCE_CURRENCY_BOOT_SCRIPT).toContain("data-ref-currency");
  });
});
