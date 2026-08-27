import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutForm } from "./CheckoutForm";
import { writeCart } from "../cartStorage";
import type { QuoteResponse } from "@/features/orders/types";

// Regresión encontrada MIRANDO la pantalla, no leyendo el código: en el PRIMER
// envío inválido el foco no se movía al resumen de errores. `submit()` llamaba a
// `summaryRef.current?.focus()` justo después de `setAttempted(true)`, y el
// <div role="alert"> se renderiza condicionalmente a ese mismo estado — así que
// en la primera pasada la ref todavía era null. Del segundo intento en adelante
// funcionaba, porque el div ya estaba montado.
//
// Por qué importa y por qué no lo pescó ninguna otra prueba: para quien navega
// con teclado o con lector de pantalla, enviar el formulario no producía NINGUNA
// señal la primera vez. El HTML servido es idéntico en los dos casos, así que
// ni `curl` ni una aserción sobre el JSX lo distinguen. Solo se ve ejecutando.

const STORE_ID = "store-checkout-focus-test";

function quote(): QuoteResponse {
  return {
    store: {
      slug: "tienda-demo",
      name: "La Rampa · Vedado",
      currencyCode: "CUP",
      checkoutMode: "WHATSAPP",
      deliveryEnabled: false,
      deliveryFee: null,
    },
    lines: [
      {
        storeProductId: "sp-1",
        slug: "pan-suave",
        name: "Pan suave",
        qty: 2,
        unitPrice: "90.00",
        currencyCode: "CUP",
        lineTotal: "180.00",
        originalUnitPrice: "90.00",
        originalCurrencyCode: "CUP",
        listUnitPrice: null,
        orderable: true,
      },
    ],
    subtotal: "180.00",
    discountTotal: "0.00",
    capturedAt: new Date("2026-08-26T10:00:00Z").toISOString(),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  writeCart({
    storeId: STORE_ID,
    items: [
      {
        storeProductId: "sp-1",
        slug: "pan-suave",
        qty: 2,
        display: { name: "Pan suave", unitPrice: "90.00", currency: "CUP" },
      },
    ],
    updatedAt: new Date().toISOString(),
  });
  // Solo se stubea la cotización: lo que se prueba es el foco, y para llegar al
  // botón de enviar el formulario necesita un quote resuelto.
  //
  // La cotización tarda a propósito. Resolverla al instante hacía que estas dos
  // pruebas ganaran por azar la carrera descrita en `enviarActivado()`: verdes
  // en una máquina descargada, rojas ~1 de cada 3 suites completas. Con el
  // retardo fijo la transición loading→ready se ejercita SIEMPRE, así que la
  // prueba pasa por lo que afirma y no por lo rápido que iba el runner.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new Response(JSON.stringify(quote()), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * El botón de enviar se renderiza desde el primer commit, DESHABILITADO
 * mientras `quoteState === "loading"`. `findByRole("button")` lo encuentra
 * igual —deshabilitado no lo saca del árbol de accesibilidad—, y
 * `fireEvent.click` sobre un botón deshabilitado no dispara nada: sin
 * `submit()` no hay `fieldErrors`, sin `fieldErrors` no hay `role="alert"`, y
 * el `findByRole` siguiente agota su techo esperando algo que ya no va a
 * ocurrir. De ahí que el fallo dijera «Unable to find role="alert"» y que
 * subir `asyncUtilTimeout` no lo arreglara nunca (ficha
 * `testing-library-timeout-1s-bajo-carga`).
 *
 * Esperar a que esté habilitado es esperar a `quoteState === "ready"`, que es
 * la precondición real de todo lo que estas pruebas afirman.
 */
async function enviarActivado() {
  const enviar = await screen.findByRole("button", { name: /confirmar/i });
  await waitFor(() => expect(enviar).toBeEnabled());
  return enviar;
}

describe("CheckoutForm — foco en el resumen de errores", () => {
  it("mueve el foco al resumen en el PRIMER envío inválido", async () => {
    render(<CheckoutForm storeId={STORE_ID} storeSlug="tienda-demo" />);

    // Enviar con todos los campos vacíos: nombre y teléfono son obligatorios.
    const enviar = await enviarActivado();
    fireEvent.click(enviar);

    const resumen = await screen.findByRole("alert");
    // El aserto que importa: no que el resumen exista —eso ya pasaba— sino que
    // el foco esté en él a la primera.
    await waitFor(() => expect(resumen).toHaveFocus());
  });

  it("sigue moviéndolo en el segundo envío inválido", async () => {
    render(<CheckoutForm storeId={STORE_ID} storeSlug="tienda-demo" />);

    const enviar = await enviarActivado();
    fireEvent.click(enviar);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());

    // Mover el foco a otro sitio y volver a enviar mal: el resumen lo recupera.
    enviar.focus();
    expect(enviar).toHaveFocus();
    fireEvent.click(enviar);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
  });
});
