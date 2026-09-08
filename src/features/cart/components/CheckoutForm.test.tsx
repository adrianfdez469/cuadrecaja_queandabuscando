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
      // F-031 etapa 1 compile-only fixture update (impl.md § Desviaciones):
      // no assertion here exercises the mode, so FLAT_RATE preserves today's
      // behavior unchanged.
      deliveryFeeMode: "FLAT_RATE",
      // F-039 (architecture.md AD3): no assertion in this describe exercises
      // equivalents, so an empty declared list keeps today's behavior
      // (no sub-line under the total).
      displayCurrencies: [],
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
    rates: {},
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

/**
 * F-031 design.md § 2 y § 1 ("El fieldset de modalidad" / "Resumen del
 * checkout"), verificación del plan (paso 3): un `quote` en modo cotizado.
 * DP1 (`.agent/progress/F-031.md`): el subtotal termina en centavos
 * distintos de `00` (`$1,234.56`) para que un aserto de "no imprime el cero"
 * no dé un falso positivo con `"1,000.00"`.
 */
describe("CheckoutForm — envío cotizado (F-031)", () => {
  const STORE_ID_QUOTED = "store-checkout-quoted-test";

  function quotedQuote(): QuoteResponse {
    return {
      store: {
        slug: "tienda-demo",
        name: "La Rampa · Vedado",
        currencyCode: "CUP",
        checkoutMode: "WHATSAPP",
        deliveryEnabled: true,
        deliveryFee: null,
        deliveryFeeMode: "QUOTED_PER_ORDER",
        displayCurrencies: [],
      },
      lines: [
        {
          storeProductId: "sp-1",
          slug: "cafe-cubita",
          name: "Café Cubita 500 g",
          qty: 2,
          unitPrice: "617.28",
          currencyCode: "CUP",
          lineTotal: "1234.56",
          originalUnitPrice: "617.28",
          originalCurrencyCode: "CUP",
          listUnitPrice: null,
          orderable: true,
        },
      ],
      subtotal: "1234.56",
      discountTotal: "0.00",
      capturedAt: new Date("2026-09-01T10:00:00Z").toISOString(),
      rates: {},
    };
  }

  beforeEach(() => {
    writeCart({
      storeId: STORE_ID_QUOTED,
      items: [
        {
          storeProductId: "sp-1",
          slug: "cafe-cubita",
          qty: 2,
          display: { name: "Café Cubita 500 g", unitPrice: "617.28", currency: "CUP" },
        },
      ],
      updatedAt: new Date().toISOString(),
    });
    // Overrides the file-level stub: this describe needs the QUOTED_PER_ORDER
    // response, not the FLAT_RATE one above.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return new Response(JSON.stringify(quotedQuote()), { status: 200 });
      }),
    );
  });

  it("el radio de domicilio existe, su descripción no lleva dígitos, el envío no es una cifra y el total es parcial (criterio 1)", async () => {
    render(<CheckoutForm storeId={STORE_ID_QUOTED} storeSlug="tienda-demo" />);
    await enviarActivado();

    const radio = screen.getByRole("radio", { name: /envío a domicilio/i });
    // El nombre accesible completo del radio (label + description, design.md
    // § 2) no contiene ningún dígito: "Costo por confirmar", no "+ $500.00".
    expect(radio.closest("label")?.textContent ?? "").not.toMatch(/\d/);
    expect(screen.getByText("Costo por confirmar")).toBeInTheDocument();

    fireEvent.click(radio);

    // La fila de envío del resumen dice "Por confirmar", nunca una cifra.
    const envioValue = await screen.findByText("Por confirmar");
    expect(envioValue.textContent).not.toMatch(/\$|\d/);

    // El total se nombra parcial, con su coletilla, y sigue siendo solo el
    // subtotal — sin un envío inventado.
    expect(screen.getByText("Total parcial")).toBeInTheDocument();
    expect(screen.getByText("más el envío por confirmar")).toBeInTheDocument();
    // El total parcial es el mismo importe que el subtotal mientras el envío
    // no está cotizado — sin un envío inventado sumado encima.
    expect(screen.getAllByText("$1,234.56").length).toBeGreaterThanOrEqual(2);
  });

  it("volver a retiro devuelve el resumen a 'Total' y 'Envío $0.00', sin residuos", async () => {
    render(<CheckoutForm storeId={STORE_ID_QUOTED} storeSlug="tienda-demo" />);
    await enviarActivado();

    fireEvent.click(screen.getByRole("radio", { name: /envío a domicilio/i }));
    await screen.findByText("Total parcial");

    fireEvent.click(screen.getByRole("radio", { name: /recoger en la tienda/i }));

    await waitFor(() => expect(screen.queryByText("Total parcial")).not.toBeInTheDocument());
    expect(screen.queryByText("Por confirmar")).not.toBeInTheDocument();
    expect(screen.queryByText("más el envío por confirmar")).not.toBeInTheDocument();
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });
});

/**
 * F-039 (plan.md paso 6, criterio 13): el límite duro del feature —
 * "no se cambia lo que se cobra"— comprobado como aserto, no solo como
 * prosa. Con una moneda de referencia elegida (USD, con tasa), el resumen
 * enseña el equivalente (DH3), pero el `POST /api/orders` que sale es
 * BYTE A BYTE el mismo que sin ningún equivalente en pantalla: mismo
 * `expectedTotal`, en la base, y ninguna mención de la moneda de referencia
 * en el cuerpo.
 */
describe("CheckoutForm — el equivalente no toca lo que se cobra (C13)", () => {
  const STORE_ID_EQUIVALENT = "store-checkout-equivalent-test";

  function quoteWithEquivalent(): QuoteResponse {
    return {
      store: {
        slug: "tienda-demo",
        name: "La Rampa · Vedado",
        currencyCode: "CUP",
        checkoutMode: "WHATSAPP",
        deliveryEnabled: false,
        deliveryFee: null,
        deliveryFeeMode: "FLAT_RATE",
        // AD3/DH8: the FULL table, unfiltered — exactly what `toQuoteResponse`
        // publishes.
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
      // 4400.00 CUP / 440.000000 (CUP per USD) = US$10.00, the same round
      // number design.md's own worked example uses (§ 4).
      subtotal: "4400.00",
      discountTotal: "0.00",
      capturedAt: new Date("2026-09-08T10:00:00Z").toISOString(),
      rates: { USD: "440.000000" },
    };
  }

  let ordersRequestBody: Record<string, unknown> | null;

  beforeEach(() => {
    ordersRequestBody = null;
    window.localStorage.clear();
    // The SAME key the header selector writes (AD9) — reused, not a second
    // preference store, so this is exactly what a shopper who already chose
    // USD elsewhere in the site would have saved.
    window.localStorage.setItem("qab.reference-currency.v1", "USD");
    writeCart({
      storeId: STORE_ID_EQUIVALENT,
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/orders/quote")) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return new Response(JSON.stringify(quoteWithEquivalent()), { status: 200 });
        }
        if (url.includes("/api/orders")) {
          ordersRequestBody = JSON.parse(String(init?.body));
          return new Response(
            JSON.stringify({
              code: "PED-0001",
              orderUrl: "/tienda-demo/pedido/PED-0001",
              whatsappUrl: null,
            }),
            { status: 201 },
          );
        }
        return new Response("{}", { status: 200 });
      }),
    );
  });

  it("pinta el equivalente en USD y aun así envía el expectedTotal de siempre, en CUP", async () => {
    render(<CheckoutForm storeId={STORE_ID_EQUIVALENT} storeSlug="tienda-demo" />);
    const enviar = await enviarActivado();

    // DH3: el equivalente aproximado del total se ve antes de enviar nada.
    expect(await screen.findByText("US$10.00")).toBeInTheDocument();
    expect(screen.getByText("Cobramos en CUP; el equivalente es aproximado.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nombre y apellidos"), {
      target: { value: "Ana Pérez" },
    });
    fireEvent.change(screen.getByLabelText("Teléfono"), {
      target: { value: "+53 5555 5555" },
    });

    fireEvent.click(enviar);

    await waitFor(() => expect(ordersRequestBody).not.toBeNull());
    // § Qué queda fuera 3 del plan: `expectedTotal` viaja igual que antes de
    // este feature — en la base, idéntico al subtotal sin descuento ni envío.
    expect(ordersRequestBody).toMatchObject({ expectedTotal: "4400.00" });
    // Ninguna mención de la moneda de referencia en el cuerpo: el equivalente
    // es solo lectura, nunca algo que se envía o se cobra.
    expect(JSON.stringify(ordersRequestBody)).not.toContain("USD");
  });
});
