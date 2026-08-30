import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileForm } from "./ProfileForm";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

const PROFILE = { name: "Ana Pérez", phone: "+53 5555 5555", email: "ana@x.cu" };

let assignSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  assignSpy = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign: assignSpy });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProfileForm (design.md § 4, E9-E11)", () => {
  it("Guardar cambios está deshabilitado hasta que algo cambie", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<ProfileForm initialProfile={PROFILE} />);
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  });

  it("editar un campo habilita Guardar y guarda con éxito (E9)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { signedIn: true, profile: PROFILE })),
    );
    render(<ProfileForm initialProfile={PROFILE} />);

    fireEvent.change(screen.getByLabelText("Nombre y apellidos"), {
      target: { value: "Ana P." },
    });
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByText("Guardamos tus datos.")).toBeInTheDocument();
  });

  it("un teléfono inválido no guarda nada y pinta el error de servidor (E10)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(400, {
          error: "INVALID_BODY",
          issues: [{ path: ["phone"], message: "Phone must have between 8 and 15 digits" }],
        }),
      ),
    );
    render(<ProfileForm initialProfile={PROFILE} />);

    fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByText(/Revisa 1 dato antes de guardar/)).toBeInTheDocument();
    // Lo demás tecleado se conserva.
    expect(screen.getByLabelText("Nombre y apellidos")).toHaveValue("Ana Pérez");
  });

  it("cerrar sesión llama a /api/account/logout y navega a / (E4)", async () => {
    // The browser's own fetch() follows a same-origin 303 automatically, so
    // what the caller sees is the FINAL response (200), not the redirect
    // itself — a hand-built `Response` cannot set `redirected` on its own.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    render(<ProfileForm initialProfile={PROFILE} />);

    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    await waitFor(() => expect(window.location.href).toBe("/"));
  });
});
