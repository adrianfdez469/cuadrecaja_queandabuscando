import { beforeEach, describe, expect, it, vi } from "vitest";

const exchangeCustomerCode = vi.fn();
const ensureCustomerForUser = vi.fn();

vi.mock("@/lib/auth/customerSession", () => ({
  exchangeCustomerCode: (...args: unknown[]) => exchangeCustomerCode(...args),
}));

vi.mock("@/features/account/server/customers", () => ({
  ensureCustomerForUser: (...args: unknown[]) => ensureCustomerForUser(...args),
}));

const { GET } = await import("./route");

const USER = { id: "u1", email: "ana@x.cu", fullName: "Ana Pérez" };

function get(query: string) {
  return GET(new Request(`http://localhost/auth/callback${query}`));
}

beforeEach(() => {
  exchangeCustomerCode.mockReset().mockResolvedValue({ ok: true, user: USER });
  ensureCustomerForUser.mockReset().mockResolvedValue({ name: null, phone: null, email: null });
});

describe("GET /auth/callback (E3, E19, E20, E27) — criterio 1b", () => {
  it("code válido: canjea, crea/asegura el Customer y redirige 307 al next validado", async () => {
    const response = await get("?code=abc&next=/tienda-demo/checkout");
    expect(response.status).toBe(307);
    expect(exchangeCustomerCode).toHaveBeenCalledWith("abc");
    expect(ensureCustomerForUser).toHaveBeenCalledWith(USER);
    expect(response.headers.get("location")).toBe("http://localhost/tienda-demo/checkout");
  });

  it("un next hostil termina en /cuenta (E27, R7)", async () => {
    for (const hostile of ["https://otro.com", "//otro.com", "/../x", "javascript:alert(1)"]) {
      const response = await get(`?code=abc&next=${encodeURIComponent(hostile)}`);
      expect(response.headers.get("location")).toBe("http://localhost/cuenta");
    }
  });

  it("sin next, redirige a /cuenta", async () => {
    const response = await get("?code=abc");
    expect(response.headers.get("location")).toBe("http://localhost/cuenta");
  });

  it("error=access_denied: NO canjea, no Customer, 307 a aviso=cancelado (E20)", async () => {
    const response = await get("?error=access_denied&next=/cuenta");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/cuenta/entrar?aviso=cancelado");
    expect(exchangeCustomerCode).not.toHaveBeenCalled();
    expect(ensureCustomerForUser).not.toHaveBeenCalled();
  });

  it("sin code: 307 a aviso=caducado, sin sesión ni Customer (E19)", async () => {
    const response = await get("?next=/cuenta");
    expect(response.headers.get("location")).toBe("http://localhost/cuenta/entrar?aviso=caducado");
    expect(exchangeCustomerCode).not.toHaveBeenCalled();
  });

  it("canje fallido: 307 a aviso=caducado, sin Customer (E19)", async () => {
    exchangeCustomerCode.mockResolvedValue({ ok: false, reason: "expired" });
    const response = await get("?code=abc");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/cuenta/entrar?aviso=caducado");
    expect(ensureCustomerForUser).not.toHaveBeenCalled();
  });
});
