import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The 401/403/503 matrix (spec.md E1–E8, E14; architecture.md § Contratos —
 * El envoltorio). `@/features/sync/server/caller` is the only module
 * mocked (AP-a): `withInternalAuth` never touches Prisma itself.
 */

const resolveCaller = vi.fn();
const syncConfigured = vi.fn();

vi.mock("@/features/sync/server/caller", () => ({
  resolveCaller: (...args: unknown[]) => resolveCaller(...args),
  syncConfigured: (...args: unknown[]) => syncConfigured(...args),
}));

const { withInternalAuth } = await import("./guard");

const TOKEN = "t".repeat(48);
const CALLER = { businessId: "business-1", externalId: "seed-negocio-1" };

function request(token: string | null) {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/internal/orders", { headers });
}

beforeEach(() => {
  resolveCaller.mockReset().mockResolvedValue({ status: "ok", caller: CALLER });
  syncConfigured.mockReset().mockResolvedValue(true);
});

describe("withInternalAuth() — E1: camino feliz", () => {
  it("llama al handler con el caller resuelto y ninguna otra identidad", async () => {
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const wrapped = withInternalAuth(handler);

    const req = request(TOKEN);
    const response = await wrapped(req);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(req, CALLER);
  });
});

describe("withInternalAuth() — E2/E3: cabecera ausente o mal formada", () => {
  it("401 sin cabecera Authorization, sin resolver ningún caller", async () => {
    const handler = vi.fn();
    const response = await withInternalAuth(handler)(request(null));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "UNAUTHORIZED" });
    expect(resolveCaller).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("401 con un esquema distinto de Bearer", async () => {
    const req = new Request("http://localhost/api/internal/orders", {
      headers: { authorization: TOKEN },
    });
    const response = await withInternalAuth(vi.fn())(req);
    expect(response.status).toBe(401);
    expect(resolveCaller).not.toHaveBeenCalled();
  });

  it("401 con un token de menos de 32 caracteres", async () => {
    const response = await withInternalAuth(vi.fn())(request("short"));
    expect(response.status).toBe(401);
    expect(resolveCaller).not.toHaveBeenCalled();
  });
});

describe("withInternalAuth() — E4: token que no resuelve ningún negocio", () => {
  it("401, idéntico al de cabecera ausente", async () => {
    resolveCaller.mockResolvedValue({ status: "unknown" });
    const handler = vi.fn();
    const response = await withInternalAuth(handler)(request(TOKEN));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "UNAUTHORIZED" });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("withInternalAuth() — E5: negocio inactivo (HD2)", () => {
  it("403 BUSINESS_INACTIVE, nunca 401 ni 200", async () => {
    resolveCaller.mockResolvedValue({ status: "inactive" });
    const handler = vi.fn();
    const response = await withInternalAuth(handler)(request(TOKEN));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "BUSINESS_INACTIVE" });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("withInternalAuth() — E6/PP3: ningún negocio configurado", () => {
  it("503 sin cabecera cuando no hay ningún hash configurado", async () => {
    syncConfigured.mockResolvedValue(false);
    const handler = vi.fn();
    const response = await withInternalAuth(handler)(request(null));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "SYNC_NOT_CONFIGURED" });
    // PP3: la sonda de configuración SÍ se ejecuta en este camino de fallo.
    expect(syncConfigured).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
  });

  it("503 con un token bien formado cuando resolveCaller dice unconfigured", async () => {
    resolveCaller.mockResolvedValue({ status: "unconfigured" });
    const handler = vi.fn();
    const response = await withInternalAuth(handler)(request(TOKEN));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "SYNC_NOT_CONFIGURED" });
    expect(handler).not.toHaveBeenCalled();
  });
});
