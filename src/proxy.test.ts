import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshCustomerSession = vi.fn();

vi.mock("@/lib/auth/customerSession", () => ({
  refreshCustomerSession: (...args: unknown[]) => refreshCustomerSession(...args),
}));

const { default: proxy, config } = await import("./proxy");

function request(path: string, { adminCookie }: { adminCookie?: string } = {}) {
  const headers = new Headers();
  if (adminCookie) headers.set("cookie", `qab-admin-session=${adminCookie}`);
  return new NextRequest(new URL(path, "http://localhost"), { headers });
}

beforeEach(() => {
  refreshCustomerSession.mockReset().mockResolvedValue(undefined);
});

/**
 * DA4, R22, I5: the bifurcation has to happen BEFORE the admin redirect, or
 * every shopper without an admin cookie visiting `/cuenta` lands on
 * `/?admin=sesion-requerida` instead of the sign-in screen.
 */
describe("proxy — bifurcación por prefijo (DA4, R22, I5)", () => {
  it("/cuenta sin ninguna cookie: NUNCA redirige a /?admin=sesion-requerida (E24)", async () => {
    const response = await proxy(request("/cuenta"));
    expect(response.status).not.toBe(307);
    expect(response.headers.get("location")).toBeNull();
    expect(refreshCustomerSession).toHaveBeenCalledOnce();
  });

  it("/cuenta/entrar sin ninguna cookie: pasa, sin redirigir", async () => {
    const response = await proxy(request("/cuenta/entrar"));
    expect(response.headers.get("location")).toBeNull();
    expect(refreshCustomerSession).toHaveBeenCalledOnce();
  });

  it("/auth/callback: pasa por refreshCustomerSession, nunca por la rama de admin", async () => {
    const response = await proxy(request("/auth/callback?code=abc"));
    expect(response.headers.get("location")).toBeNull();
    expect(refreshCustomerSession).toHaveBeenCalledOnce();
  });

  it("/admin sin ADMIN_COOKIE: sigue redirigiendo a /?admin=sesion-requerida (comportamiento de hoy, intacto)", async () => {
    const response = await proxy(request("/admin"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/?admin=sesion-requerida");
    expect(refreshCustomerSession).not.toHaveBeenCalled();
  });

  it("/admin con ADMIN_COOKIE: pasa, y refreshCustomerSession no se llama (las dos sesiones no se estorban, E18)", async () => {
    const response = await proxy(request("/admin", { adminCookie: "token" }));
    expect(response.headers.get("location")).toBeNull();
    expect(refreshCustomerSession).not.toHaveBeenCalled();
  });

  it('el matcher no contiene "slug" en ninguna forma (R22)', () => {
    const matcherText = JSON.stringify(config.matcher).toLowerCase();
    expect(matcherText).not.toContain("slug");
  });
});
