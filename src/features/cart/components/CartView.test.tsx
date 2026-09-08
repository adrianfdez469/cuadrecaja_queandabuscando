import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CartView } from "./CartView";
import { writeCart } from "../cartStorage";
import { REFERENCE_CURRENCY_STORAGE_KEY } from "@/constants/currency";
import type { QuoteResponse } from "@/features/orders/types";

/**
 * F-039 (architecture.md § Pruebas, plan.md paso 6, criterio 13). The FIRST
 * test of this component. DH3: the equivalent of the subtotal, computed
 * client-side with the SAME rate table the quote used (AD3), with the
 * "Cobramos en <base>" notice that has to sit next to it (R16).
 */

const STORE_ID = "store-cartview-equivalent-test";

function quote(overrides: Partial<QuoteResponse> = {}): QuoteResponse {
  return {
    store: {
      slug: "tienda-demo",
      name: "La Rampa · Vedado",
      currencyCode: "CUP",
      checkoutMode: "WHATSAPP",
      deliveryEnabled: false,
      deliveryFee: null,
      deliveryFeeMode: "FLAT_RATE",
      displayCurrencies: ["CUP", "USD"],
    },
    lines: [
      {
        storeProductId: "sp-1",
        slug: "pan-suave",
        name: "Pan suave",
        qty: 2,
        unitPrice: "2200.00",
        currencyCode: "CUP",
        lineTotal: "4400.00",
        originalUnitPrice: "2200.00",
        originalCurrencyCode: "CUP",
        listUnitPrice: null,
        orderable: true,
      },
    ],
    // 4400.00 CUP / 440.000000 (CUP per USD) = US$10.00, design.md's own
    // worked example (§ 3).
    subtotal: "4400.00",
    discountTotal: "0.00",
    capturedAt: new Date("2026-09-08T10:00:00Z").toISOString(),
    rates: { USD: "440.000000" },
    ...overrides,
  };
}

function stubQuote(response: QuoteResponse, delayMs = 50) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      // Fixed delay: exercises the loading→ready transition every run,
      // instead of letting it be decided by how fast the runner is
      // (AGENTS.md § Cosas que muerden).
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return new Response(JSON.stringify(response), { status: 200 });
    }),
  );
}

function seedCart(storeId: string) {
  writeCart({
    storeId,
    items: [
      {
        storeProductId: "sp-1",
        slug: "pan-suave",
        qty: 2,
        display: { name: "Pan suave", unitPrice: "2200.00", currency: "CUP" },
      },
    ],
    updatedAt: new Date().toISOString(),
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CartView — el equivalente del subtotal (DH3, C13)", () => {
  it("no pinta ningún equivalente mientras el subtotal todavía dice 'Calculando…'", async () => {
    window.localStorage.setItem(REFERENCE_CURRENCY_STORAGE_KEY, "USD");
    seedCart(STORE_ID);
    stubQuote(quote());

    render(<CartView storeId={STORE_ID} storeSlug="tienda-demo" />);

    // While the request is in flight the subtotal itself is "Calculando…":
    // no "≈" anywhere yet, on a number that is not firm.
    expect(screen.getByText("Calculando…")).toBeInTheDocument();
    expect(screen.queryByText("US$10.00")).not.toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByText("$4,400.00", { selector: "span" })).toBeInTheDocument(),
    );
    expect(screen.getByText("US$10.00")).toBeInTheDocument();
  });

  it("pinta el equivalente en la moneda ya elegida en la cabecera, con el aviso del cobro (D8)", async () => {
    window.localStorage.setItem(REFERENCE_CURRENCY_STORAGE_KEY, "USD");
    seedCart(`${STORE_ID}-chosen`);
    stubQuote(quote());

    render(<CartView storeId={`${STORE_ID}-chosen`} storeSlug="tienda-demo" />);

    expect(await screen.findByText("US$10.00")).toBeInTheDocument();
    expect(
      screen.getByText(
        "El envío se calcula en el siguiente paso. Cobramos en CUP; el equivalente es aproximado.",
      ),
    ).toBeInTheDocument();
  });

  it("no pinta nada con 'solo la moneda base' elegida (el centinela)", async () => {
    window.localStorage.setItem(REFERENCE_CURRENCY_STORAGE_KEY, "none");
    seedCart(`${STORE_ID}-none`);
    stubQuote(quote());

    render(<CartView storeId={`${STORE_ID}-none`} storeSlug="tienda-demo" />);

    await waitFor(() =>
      expect(screen.getByText("$4,400.00", { selector: "span" })).toBeInTheDocument(),
    );
    expect(screen.queryByText("US$10.00")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "El envío se calcula en el siguiente paso. Cobramos en CUP; el equivalente es aproximado.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByText("El envío se calcula en el siguiente paso.")).toBeInTheDocument();
  });

  it("una preferencia que esta tienda no ofrece no pinta nada, y no se borra (E17/R17)", async () => {
    window.localStorage.setItem(REFERENCE_CURRENCY_STORAGE_KEY, "EUR");
    seedCart(`${STORE_ID}-not-offered`);
    stubQuote(quote());

    render(<CartView storeId={`${STORE_ID}-not-offered`} storeSlug="tienda-demo" />);

    await waitFor(() =>
      expect(screen.getByText("$4,400.00", { selector: "span" })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
    // R17: the preference itself survives — this screen never writes it.
    expect(window.localStorage.getItem(REFERENCE_CURRENCY_STORAGE_KEY)).toBe("EUR");
  });

  it("sin monedas declaradas, nada nuevo (E10/C9)", async () => {
    window.localStorage.setItem(REFERENCE_CURRENCY_STORAGE_KEY, "USD");
    seedCart(`${STORE_ID}-empty`);
    stubQuote(
      quote({
        store: { ...quote().store, displayCurrencies: [] },
      }),
    );

    render(<CartView storeId={`${STORE_ID}-empty`} storeSlug="tienda-demo" />);

    await waitFor(() =>
      expect(screen.getByText("$4,400.00", { selector: "span" })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
  });
});
