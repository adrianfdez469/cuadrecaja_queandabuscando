import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignInCard } from "./SignInCard";

/**
 * design.md §§ 1-2. Every network call is stubbed `fetch`; the only DOM
 * escape hatch (`window.location.assign`) is spied so a successful sign-in
 * does not make jsdom log an unimplemented-navigation warning.
 */

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

let assignSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  assignSpy = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign: assignSpy });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("SignInCard — Auth sin configurar (E26)", () => {
  it("pinta el aviso y los cuatro métodos deshabilitados, sin llamar a fetch", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<SignInCard next="/cuenta" authConfigured={false} aviso={null} />);

    expect(
      screen.getByText("El acceso a tu cuenta no está disponible ahora mismo."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continuar con Google/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Continuar con Facebook/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Continuar con Apple/ })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("SignInCard — paso correo (design.md § 1)", () => {
  it("un correo mal escrito no llama a nadie", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<SignInCard next="/cuenta" authConfigured aviso={null} />);

    fireEvent.change(screen.getByLabelText("Correo"), { target: { value: "no-es-un-correo" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviarme un código" }));

    expect(await screen.findByText(/Escribe un correo válido/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("pedir un código pasa al paso 'código' en sitio, sin navegar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { sent: true })),
    );
    render(<SignInCard next="/cuenta" authConfigured aviso={null} />);

    fireEvent.change(screen.getByLabelText("Correo"), { target: { value: "ana@x.cu" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviarme un código" }));

    expect(await screen.findByText("Escribe el código")).toBeInTheDocument();
    expect(screen.getByText(/Te mandamos un código de 6 dígitos a ana@x.cu/)).toBeInTheDocument();
  });

  it("pulsar cada botón de proveedor llama a /api/account/oauth con su provider (criterio 1b)", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { url: "https://provider.example/x" }));
    vi.stubGlobal("fetch", fetchSpy);
    render(<SignInCard next="/tienda-demo" authConfigured aviso={null} />);

    fireEvent.click(screen.getByRole("button", { name: /Continuar con Facebook/ }));

    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith("https://provider.example/x"));
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/account/oauth",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ provider: "facebook", next: "/tienda-demo" }),
      }),
    );
  });

  it("409 PROVIDER_DISABLED pinta el aviso y no rompe los demás métodos (E23)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(409, { error: "PROVIDER_DISABLED" })),
    );
    render(<SignInCard next="/cuenta" authConfigured aviso={null} />);

    fireEvent.click(screen.getByRole("button", { name: /Continuar con Apple/ }));

    expect(
      await screen.findByText("Ese método de acceso no está disponible ahora mismo."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continuar con Google/ })).toBeEnabled();
  });

  it("aviso=caducado se pinta desde el servidor (E19)", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<SignInCard next="/cuenta" authConfigured aviso="caducado" />);
    expect(screen.getByText("El acceso caducó. Vuelve a intentarlo.")).toBeInTheDocument();
  });
});

describe("SignInCard — paso código (design.md § 2)", () => {
  async function goToCodeStep() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { sent: true })),
    );
    render(<SignInCard next="/cuenta" authConfigured aviso={null} />);
    fireEvent.change(screen.getByLabelText("Correo"), { target: { value: "ana@x.cu" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviarme un código" }));
    await screen.findByText("Escribe el código");
  }

  it("teclear uno a uno NO comprueba solo: solo habilita Entrar", async () => {
    await goToCodeStep();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const field = screen.getByLabelText("Código de 6 dígitos");
    for (const digit of "123456") {
      fireEvent.change(field, { target: { value: (field as HTMLInputElement).value + digit } });
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled();
  });

  it("pegar los 6 dígitos de golpe se comprueba solo", async () => {
    await goToCodeStep();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { signedIn: true, profile: null })),
    );

    fireEvent.change(screen.getByLabelText("Código de 6 dígitos"), {
      target: { value: "123456" },
    });

    await waitFor(() => expect(window.location.href).toBe("/cuenta"));
  });

  it("tres códigos incorrectos seguidos agotan el código (R5, E21)", async () => {
    await goToCodeStep();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(401, { error: "OTP_REJECTED", reason: "invalid" })),
    );

    // Each attempt arrives "all at once" (a fresh six-digit value in one
    // `change`, same as autofill/paste) so it auto-submits — clearing first
    // mimics the browser replacing a selected value on retype.
    fireEvent.change(screen.getByLabelText("Código de 6 dígitos"), { target: { value: "000000" } });
    expect(
      await screen.findByText("Ese código no es correcto. Te quedan 2 intentos."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Código de 6 dígitos"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Código de 6 dígitos"), { target: { value: "000000" } });
    expect(
      await screen.findByText("Ese código no es correcto. Te queda 1 intento."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Código de 6 dígitos"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Código de 6 dígitos"), { target: { value: "000000" } });
    expect(await screen.findByText("Ese código ya no sirve. Pide uno nuevo.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Código de 6 dígitos")).not.toBeInTheDocument();
  });

  it("Reenviar el código está deshabilitado tras enviar", async () => {
    await goToCodeStep();
    expect(screen.getByRole("button", { name: /Reenviar el código/ })).toBeDisabled();
  });

  it("Cambiar el correo vuelve al paso 1 conservando el correo", async () => {
    await goToCodeStep();
    fireEvent.click(screen.getByRole("button", { name: "Cambiar el correo" }));
    expect(await screen.findByRole("heading", { name: "Entrar a tu cuenta" })).toBeInTheDocument();
    expect(screen.getByLabelText("Correo")).toHaveValue("ana@x.cu");
  });
});
