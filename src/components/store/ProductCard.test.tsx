import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductCard } from "./ProductCard";
import { renderReferenceCurrencyCss } from "@/features/currency/reveal";
import type { CatalogProduct } from "@/features/catalog/server/queries";

/**
 * F-039 (architecture.md § Pruebas, plan.md paso 5). The FIRST test of this
 * component. Covers C1 (principal in base, marked equivalent), C2 (the
 * approximate one is never the principal), C9 (zero equivalents ⇒ nothing
 * new), and C15 (with the reveal `<style>` and the attribute in place, the
 * accessible name of a hidden equivalent does not leak).
 */

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: "product-1",
    slug: "arroz-blanco-1-kg",
    name: "Arroz blanco 1 kg",
    description: null,
    imageUrls: [],
    availability: "AVAILABLE",
    featured: false,
    categoryName: null,
    categorySlug: null,
    syncedPrice: "620.00",
    syncedPriceCurrency: "CUP",
    priceOverride: null,
    priceOverrideCurrency: null,
    promotions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderCard(overrides: Partial<Parameters<typeof ProductCard>[0]> = {}) {
  return render(
    <ProductCard
      product={product()}
      storeSlug="tienda-demo"
      displayCurrency="CUP"
      displayCurrencies={[]}
      rates={{}}
      {...overrides}
    />,
  );
}

describe("ProductCard — principal, equivalentes y 'Consultar' (C1, C2, C9)", () => {
  it("shows only the principal, with nothing new, when the business declares no extra currency", () => {
    renderCard({ displayCurrencies: [], rates: {} });
    expect(screen.getByText("$620.00")).toBeInTheDocument();
    expect(screen.queryByText("≈")).not.toBeInTheDocument();
    // C9: not even an empty wrapping <span> — the price is a bare text node.
    const price = screen.getByText("$620.00");
    expect(price.tagName).not.toBe("SPAN");
  });

  it("marks the equivalent with data-equiv, and it is never the principal", () => {
    renderCard({
      displayCurrencies: ["CUP", "USD"],
      rates: { USD: "440" },
    });
    const principal = screen.getByText("$620.00");
    const equivalentAmount = screen.getByText("US$1.41");
    expect(principal).not.toBe(equivalentAmount);

    const equivalentEl = equivalentAmount.closest("[data-equiv]");
    expect(equivalentEl).not.toBeNull();
    expect(equivalentEl).toHaveAttribute("data-equiv", "USD");
  });

  it("paints one element per offered equivalent, with nothing static hiding any of them", () => {
    renderCard({
      displayCurrencies: ["CUP", "USD", "MLC"],
      rates: { USD: "440", MLC: "210.5" },
    });
    const equivalents = document.querySelectorAll("[data-equiv]");
    expect(equivalents).toHaveLength(2);
    for (const el of equivalents) {
      expect(el).not.toHaveAttribute("hidden");
      expect(el.className).not.toMatch(/hidden/);
      expect(el).not.toHaveAttribute("aria-hidden");
    }
  });

  it('shows "Consultar" and zero equivalents when the price cannot be resolved (E9)', () => {
    renderCard({
      product: product({ syncedPriceCurrency: "EUR" }),
      displayCurrency: "CUP",
      displayCurrencies: ["CUP", "USD"],
      rates: { USD: "440" }, // no EUR rate: resolvePrice throws
    });
    expect(screen.getByText("Consultar")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-equiv]")).toHaveLength(0);
  });

  it("an equivalent with no rate is omitted, the rest still paint (R5)", () => {
    renderCard({
      displayCurrencies: ["CUP", "USD", "EUR"],
      rates: { USD: "440" }, // no EUR rate
    });
    expect(document.querySelectorAll("[data-equiv]")).toHaveLength(1);
    expect(document.querySelector('[data-equiv="EUR"]')).toBeNull();
  });
});

describe("ProductCard — nombre accesible con el mecanismo de revelado puesto (C15)", () => {
  it("the accessible name does NOT leak the currency that is hidden by the reveal CSS", () => {
    const css = renderReferenceCurrencyCss(["USD", "MLC"]);
    const { container } = render(
      <div data-ref-currency="USD">
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <ProductCard
          product={product()}
          storeSlug="tienda-demo"
          displayCurrency="CUP"
          displayCurrencies={["CUP", "USD", "MLC"]}
          rates={{ USD: "440", MLC: "210.5" }}
        />
      </div>,
    );

    // USD is the chosen reference currency: its equivalent stays, MLC's does
    // not — verified through getComputedStyle, not by reading the JSX.
    const usdEquivalent = container.querySelector('[data-equiv="USD"]') as HTMLElement;
    const mlcEquivalent = container.querySelector('[data-equiv="MLC"]') as HTMLElement;
    expect(getComputedStyle(usdEquivalent).display).not.toBe("none");
    expect(getComputedStyle(mlcEquivalent).display).toBe("none");

    // R15: `display: none` takes the element OUT of the accessibility tree,
    // so the accessible-name-aware query (not `textContent`, which ignores
    // CSS entirely) finds the shown one and never the hidden one.
    expect(screen.getByRole("link", { name: /US\$1\.41/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /MLC/ })).not.toBeInTheDocument();
  });
});
