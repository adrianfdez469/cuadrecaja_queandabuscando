import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCart } from "../cartStorage";
import type { AccountState } from "@/features/account/types";
import type { QuoteResponse } from "@/features/orders/types";

/**
 * DA1, E12-E16 (design.md § 5). `fetch` is stubbed to answer differently by
 * URL: `/api/orders/quote` gets the usual quote, `/api/account/profile`
 * gets whatever `accountState` the test sets up.
 *
 * `src/features/account/accountStore.ts` deduplicates the profile fetch with
 * a MODULE-LEVEL cache (by design — one request per real page load, no
 * matter how many islands ask). That is exactly what would leak a resolved
 * profile from one test into the next inside the SAME file, so every test
 * resets the module registry and re-imports `CheckoutForm` fresh.
 */

const STORE_ID = "store-checkout-autocomplete-test";

function quote(): QuoteResponse {
  return {
    store: {
      slug: "tienda-demo",
      name: "La Rampa · Vedado",
      currencyCode: "CUP",
      checkoutMode: "WHATSAPP",
      deliveryEnabled: false,
      deliveryFee: null,
      // F-031 etapa 1 compile-only fixture update (impl.md § Desviaciones):
      // no assertion here exercises the mode, so FLAT_RATE preserves today's
      // behavior unchanged.
      deliveryFeeMode: "FLAT_RATE",
    },
    lines: [],
    subtotal: "0.00",
    discountTotal: "0.00",
    capturedAt: new Date("2026-08-26T10:00:00Z").toISOString(),
  };
}

function stubFetch(accountState: AccountState) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/account/profile")) {
        return new Response(JSON.stringify(accountState), { status: 200 });
      }
      return new Response(JSON.stringify(quote()), { status: 200 });
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  writeCart({
    storeId: STORE_ID,
    items: [
      {
        storeProductId: "sp-1",
        slug: "pan-suave",
        qty: 1,
        display: { name: "Pan suave", unitPrice: "90.00", currency: "CUP" },
      },
    ],
    updatedAt: new Date().toISOString(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function renderCheckoutForm() {
  const { CheckoutForm } = await import("./CheckoutForm");
  render(<CheckoutForm storeId={STORE_ID} storeSlug="tienda-demo" />);
}

describe("CheckoutForm — autocompletado del perfil (E12-E16)", () => {
  it("E12: con sesión y perfil completo, rellena los tres campos", async () => {
    stubFetch({
      signedIn: true,
      profile: { name: "Ana Pérez", phone: "+53 5555 5555", email: "ana@x.cu" },
    });
    await renderCheckoutForm();

    await waitFor(() =>
      expect(screen.getByLabelText("Nombre y apellidos")).toHaveValue("Ana Pérez"),
    );
    expect(screen.getByLabelText("Teléfono")).toHaveValue("+53 5555 5555");
    expect(screen.getByLabelText("Correo (opcional)")).toHaveValue("ana@x.cu");
    expect(
      screen.getByText("Rellenamos tus datos guardados. Puedes cambiarlos."),
    ).toBeInTheDocument();
  });

  it("E13: lo ya tecleado en el nombre gana; los demás campos sí se rellenan", async () => {
    stubFetch({
      signedIn: true,
      profile: { name: "Ana Pérez", phone: "+53 5555 5555", email: "ana@x.cu" },
    });
    await renderCheckoutForm();

    fireEvent.change(screen.getByLabelText("Nombre y apellidos"), {
      target: { value: "Ana P." },
    });

    await waitFor(() => expect(screen.getByLabelText("Teléfono")).toHaveValue("+53 5555 5555"));
    expect(screen.getByLabelText("Nombre y apellidos")).toHaveValue("Ana P.");
  });

  it("E14: perfil sin teléfono deja el campo vacío", async () => {
    stubFetch({ signedIn: true, profile: { name: "Ana Pérez", phone: null, email: "ana@x.cu" } });
    await renderCheckoutForm();

    await waitFor(() =>
      expect(screen.getByLabelText("Nombre y apellidos")).toHaveValue("Ana Pérez"),
    );
    expect(screen.getByLabelText("Teléfono")).toHaveValue("");
  });

  it("E16: sin sesión, los tres quedan vacíos y no aparece ningún error", async () => {
    stubFetch({ signedIn: false, profile: null });
    await renderCheckoutForm();

    // Espera a que el efecto del perfil termine sin cambiar nada.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.getByLabelText("Nombre y apellidos")).toHaveValue("");
    expect(screen.getByLabelText("Teléfono")).toHaveValue("");
    expect(screen.getByLabelText("Correo (opcional)")).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByText(/La tienda te va a contactar por aquí\. Si ya tienes cuenta,/),
    ).toBeInTheDocument();
  });

  it("un campo vaciado a propósito no se rellena (E13, segunda frase)", async () => {
    stubFetch({
      signedIn: true,
      profile: { name: "Ana Pérez", phone: "+53 5555 5555", email: "ana@x.cu" },
    });
    await renderCheckoutForm();

    const nameField = screen.getByLabelText("Nombre y apellidos");
    fireEvent.focus(nameField);
    fireEvent.change(nameField, { target: { value: "" } });

    await waitFor(() => expect(screen.getByLabelText("Teléfono")).toHaveValue("+53 5555 5555"));
    expect(nameField).toHaveValue("");
  });
});
