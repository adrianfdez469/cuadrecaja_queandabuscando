import { renderToString } from "react-dom/server";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { REFERENCE_CURRENCY_STORAGE_KEY } from "@/constants/currency";
import { ReferenceCurrencySelect } from "./ReferenceCurrencySelect";

/**
 * F-039 (design.md § El selector, § Textos D4/D5; architecture.md § Pruebas).
 * Covers C12 and DH5: the options are exactly the OFFERED set plus "solo la
 * base", a declared currency with no rate never appears at all — not inert,
 * not disabled — and nothing of this renders before hydration (R13).
 */

beforeEach(() => {
  window.localStorage.clear();
});

describe("ReferenceCurrencySelect — before hydration (R13)", () => {
  it("the served HTML has no <select>, no label text, only the reserved hole", () => {
    const html = renderToString(
      <ReferenceCurrencySelect baseCurrency="CUP" offeredCurrencies={["USD", "MLC"]} />,
    );
    expect(html).not.toContain("<select");
    expect(html).not.toContain("Moneda de referencia");
    expect(html).not.toContain("Solo CUP");
  });
});

describe("ReferenceCurrencySelect — hydrated (D4/D5, DH5)", () => {
  it("lists 'Solo <base>' first, then one 'También en <code>' per offered currency, in order", () => {
    render(<ReferenceCurrencySelect baseCurrency="CUP" offeredCurrencies={["USD", "MLC"]} />);
    const select = screen.getByRole("combobox", { name: "Moneda de referencia" });
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["Solo CUP", "También en USD", "También en MLC"]);
  });

  it("a currency this store does not offer never appears as an option — not inert, not disabled", () => {
    render(<ReferenceCurrencySelect baseCurrency="CUP" offeredCurrencies={["USD"]} />);
    const select = screen.getByRole("combobox", { name: "Moneda de referencia" });
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["Solo CUP", "También en USD"]);
    expect(select.querySelector("option[disabled]")).toBeNull();
  });

  it("starts on the first offered currency when nothing is stored (SP1(a))", () => {
    render(<ReferenceCurrencySelect baseCurrency="CUP" offeredCurrencies={["USD", "MLC"]} />);
    const select = screen.getByRole("combobox", {
      name: "Moneda de referencia",
    }) as HTMLSelectElement;
    expect(select.value).toBe("USD");
  });

  it("choosing an option persists it and announces the change (D7)", () => {
    render(<ReferenceCurrencySelect baseCurrency="CUP" offeredCurrencies={["USD", "MLC"]} />);
    const select = screen.getByRole("combobox", { name: "Moneda de referencia" });

    fireEvent.change(select, { target: { value: "MLC" } });

    expect(window.localStorage.getItem(REFERENCE_CURRENCY_STORAGE_KEY)).toBe("MLC");
    expect(screen.getByText("Ahora también en MLC.")).toBeInTheDocument();
  });

  it('choosing "Solo CUP" announces the base-only phrase (D7)', () => {
    window.localStorage.setItem(REFERENCE_CURRENCY_STORAGE_KEY, "USD");
    render(<ReferenceCurrencySelect baseCurrency="CUP" offeredCurrencies={["USD", "MLC"]} />);
    const select = screen.getByRole("combobox", { name: "Moneda de referencia" });

    fireEvent.change(select, { target: { value: "none" } });

    expect(screen.getByText("Ahora solo en CUP.")).toBeInTheDocument();
  });

  it("the announcement region is empty on mount — never pre-filled (§ Accesibilidad)", () => {
    render(<ReferenceCurrencySelect baseCurrency="CUP" offeredCurrencies={["USD", "MLC"]} />);
    expect(screen.queryByText(/^Ahora /)).not.toBeInTheDocument();
  });
});
