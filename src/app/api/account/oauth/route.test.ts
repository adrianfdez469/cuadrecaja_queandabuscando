import { beforeEach, describe, expect, it, vi } from "vitest";

const startOAuth = vi.fn();

vi.mock("@/lib/auth/customerSession", () => ({
  startOAuth: (...args: unknown[]) => startOAuth(...args),
}));

const { POST } = await import("./route");

const URL_OAUTH = "http://localhost/api/account/oauth";

function post(body: unknown) {
  return POST(
    new Request(URL_OAUTH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  startOAuth.mockReset().mockResolvedValue({ ok: true, url: "https://provider.example/auth" });
});

describe("POST /api/account/oauth (E2, E23) — criterio 1b", () => {
  it.each(["google", "facebook", "apple"] as const)(
    "llama a startOAuth con el provider %s y el redirectTo del origen de la petición",
    async (provider) => {
      const response = await post({ provider, next: "/tienda-demo/checkout" });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ url: "https://provider.example/auth" });
      expect(startOAuth).toHaveBeenCalledWith(
        provider,
        "http://localhost/auth/callback?next=%2Ftienda-demo%2Fcheckout",
      );
    },
  );

  it("un next hostil se sanea a /cuenta antes del redirectTo (E27, R7)", async () => {
    await post({ provider: "google", next: "https://otro.com" });
    expect(startOAuth).toHaveBeenCalledWith(
      "google",
      "http://localhost/auth/callback?next=%2Fcuenta",
    );
  });

  it("sin next, el redirectTo apunta a /cuenta", async () => {
    await post({ provider: "google" });
    expect(startOAuth).toHaveBeenCalledWith(
      "google",
      "http://localhost/auth/callback?next=%2Fcuenta",
    );
  });

  it("400 INVALID_BODY con un provider desconocido", async () => {
    const response = await post({ provider: "twitter" });
    expect(response.status).toBe(400);
    expect(startOAuth).not.toHaveBeenCalled();
  });

  it("409 PROVIDER_DISABLED y los demás métodos no se ven afectados (E23)", async () => {
    startOAuth.mockResolvedValue({ ok: false, reason: "provider_disabled" });
    const response = await post({ provider: "apple" });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "PROVIDER_DISABLED" });
  });

  it("503 AUTH_UNAVAILABLE en cualquier otro fallo", async () => {
    startOAuth.mockResolvedValue({ ok: false, reason: "not_configured" });
    const response = await post({ provider: "google" });
    expect(response.status).toBe(503);
  });
});
