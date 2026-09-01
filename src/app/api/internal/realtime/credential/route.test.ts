import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-020, architecture.md DA5, spec E18. `withInternalAuth` is exercised
 * for real (same pattern as `src/app/api/internal/orders/route.test.ts`):
 * only `@/features/sync/server/caller` (the guard's own dependency) and
 * `@/lib/realtime/subscriptionToken` are mocked.
 */

const resolveCaller = vi.fn();
const syncConfigured = vi.fn();
const subscriptionAvailability = vi.fn();
const mintRealtimeCredential = vi.fn();

vi.mock("@/features/sync/server/caller", () => ({
  resolveCaller: (...args: unknown[]) => resolveCaller(...args),
  syncConfigured: (...args: unknown[]) => syncConfigured(...args),
}));

vi.mock("@/lib/realtime/subscriptionToken", () => ({
  subscriptionAvailability: (...args: unknown[]) => subscriptionAvailability(...args),
  mintRealtimeCredential: (...args: unknown[]) => mintRealtimeCredential(...args),
}));

const { POST } = await import("./route");

const TOKEN = "t".repeat(48);
const CALLER_A = { businessId: "business-a", externalId: "seed-negocio-1" };
const CALLER_B = { businessId: "business-b", externalId: "seed-negocio-2" };

const CREDENTIAL_A = {
  url: "https://ref.supabase.co",
  apikey: "anon-key",
  channel: "negocio:business-a",
  event: "pedidos",
  token: "jwt-for-business-a",
  expiresAt: "2026-09-01T06:00:00.000Z",
  expiresInSeconds: 3600,
};

function post({ token = TOKEN, body }: { token?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return POST(
    new Request("http://localhost/api/internal/realtime/credential", {
      method: "POST",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
}

beforeEach(() => {
  resolveCaller.mockReset().mockResolvedValue({ status: "ok", caller: CALLER_A });
  syncConfigured.mockReset().mockResolvedValue(true);
  subscriptionAvailability.mockReset().mockReturnValue({ ok: true });
  mintRealtimeCredential.mockReset().mockResolvedValue(CREDENTIAL_A);
});

describe("POST /api/internal/realtime/credential — 200", () => {
  it("mints with the caller's OWN businessId and returns the credential verbatim", async () => {
    const response = await post();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(CREDENTIAL_A);
    expect(mintRealtimeCredential).toHaveBeenCalledWith("business-a");
  });

  // criterio 13, E18: there is no request body field for businessId at
  // all — sending one anyway must have zero effect, because the route never
  // even reads the body.
  it("criterio 13 — a body claiming a DIFFERENT businessId is ignored entirely", async () => {
    mintRealtimeCredential.mockResolvedValue({
      ...CREDENTIAL_A,
      channel: "negocio:business-a",
      token: "jwt-for-business-a",
    });
    const response = await post({ body: { businessId: "business-b" } });

    expect(response.status).toBe(200);
    expect(mintRealtimeCredential).toHaveBeenCalledWith("business-a");
    expect(mintRealtimeCredential).not.toHaveBeenCalledWith("business-b");
  });

  it("criterio 13 — the bearer of B never mints a credential naming A's channel", async () => {
    resolveCaller.mockResolvedValue({ status: "ok", caller: CALLER_B });
    mintRealtimeCredential.mockResolvedValue({ ...CREDENTIAL_A, channel: "negocio:business-b" });

    const response = await post();
    const body = await response.json();

    expect(mintRealtimeCredential).toHaveBeenCalledWith("business-b");
    expect(body.channel).not.toBe("negocio:business-a");
  });
});

describe("POST /api/internal/realtime/credential — el guard (E18)", () => {
  it("401 sin token, sin llegar a mintRealtimeCredential", async () => {
    const response = await post({ token: null });

    expect(response.status).toBe(401);
    expect(mintRealtimeCredential).not.toHaveBeenCalled();
  });

  it("401 con un token que no resuelve ningún negocio", async () => {
    resolveCaller.mockResolvedValue({ status: "unknown" });
    const response = await post();

    expect(response.status).toBe(401);
    expect(mintRealtimeCredential).not.toHaveBeenCalled();
  });

  it("403 BUSINESS_INACTIVE", async () => {
    resolveCaller.mockResolvedValue({ status: "inactive" });
    const response = await post();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "BUSINESS_INACTIVE" });
    expect(mintRealtimeCredential).not.toHaveBeenCalled();
  });

  it("503 SYNC_NOT_CONFIGURED sin cabecera y sin ningún hash configurado", async () => {
    syncConfigured.mockResolvedValue(false);
    const response = await post({ token: null });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "SYNC_NOT_CONFIGURED" });
    expect(mintRealtimeCredential).not.toHaveBeenCalled();
  });
});

describe("POST /api/internal/realtime/credential — Realtime sin configurar (R9, R15)", () => {
  it("503 REALTIME_NOT_CONFIGURED cuando falta SUPABASE_JWT_SECRET (o la URL/anon key)", async () => {
    subscriptionAvailability.mockReturnValue({ ok: false, reason: "missing_jwt_secret" });
    const response = await post();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "REALTIME_NOT_CONFIGURED" });
    expect(mintRealtimeCredential).not.toHaveBeenCalled();
  });
});
