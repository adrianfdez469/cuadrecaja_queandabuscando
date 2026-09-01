import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-014, C11: the only route under `/api/internal/*` that had no test of
 * its own. With mocks, no base — the SQL/DB half is `reconciliation.db.test.ts`
 * (D4). Pattern copied from
 * `src/app/api/internal/slug-availability/route.test.ts`.
 */

const storeReconciliationHash = vi.fn();
const resolveCaller = vi.fn();
const syncConfigured = vi.fn();

vi.mock("@/features/sync/server/reconciliation", () => ({
  storeReconciliationHash: (...args: unknown[]) => storeReconciliationHash(...args),
}));

vi.mock("@/features/sync/server/caller", () => ({
  resolveCaller: (...args: unknown[]) => resolveCaller(...args),
  syncConfigured: (...args: unknown[]) => syncConfigured(...args),
}));

const { GET } = await import("./route");

const TOKEN = "t".repeat(48);
const CALLER = { businessId: "business-a", externalId: "seed-negocio-1" };

function get(query: string, { token = TOKEN }: { token?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return GET(new Request(`http://localhost/api/internal/reconciliation${query}`, { headers }));
}

beforeEach(() => {
  storeReconciliationHash.mockReset();
  resolveCaller.mockReset().mockResolvedValue({ status: "ok", caller: CALLER });
  syncConfigured.mockReset().mockResolvedValue(true);
});

describe("GET /api/internal/reconciliation", () => {
  it("responde 200 con { products, hash } cuando la tienda existe", async () => {
    storeReconciliationHash.mockResolvedValue({ products: 15, hash: "a".repeat(32) });

    const response = await get("?storeId=seed-tienda-1");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ products: 15, hash: "a".repeat(32) });
    expect(storeReconciliationHash).toHaveBeenCalledWith(CALLER.businessId, "seed-tienda-1");
  });

  it("responde 400 MISSING_STORE_ID sin storeId, con token válido", async () => {
    const response = await get("");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "MISSING_STORE_ID" });
    expect(storeReconciliationHash).not.toHaveBeenCalled();
  });

  it("responde 400 MISSING_STORE_ID con storeId vacío", async () => {
    const response = await get("?storeId=");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "MISSING_STORE_ID" });
    expect(storeReconciliationHash).not.toHaveBeenCalled();
  });

  it("responde 404 UNKNOWN_STORE cuando la tienda no existe o es de otro negocio", async () => {
    storeReconciliationHash.mockResolvedValue(null);

    const response = await get("?storeId=seed-tienda-de-otro-negocio");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "UNKNOWN_STORE" });
  });

  it("E10: sin cabecera Authorization responde 401, NUNCA 400, aunque también falte storeId (con syncConfigured=true)", async () => {
    resolveCaller.mockResolvedValue({ status: "unknown" });
    syncConfigured.mockResolvedValue(true);

    // Ni storeId en la query: si el guard no fuera primero, esto podría
    // alcanzar el 400 MISSING_STORE_ID en vez del 401.
    const response = await get("", { token: null });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "UNAUTHORIZED" });
    expect(storeReconciliationHash).not.toHaveBeenCalled();
  });

  it("E10: sin cabecera y sin NINGÚN negocio con token acuñado responde 503, no 401", async () => {
    syncConfigured.mockResolvedValue(false);

    const response = await get("?storeId=seed-tienda-1", { token: null });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "SYNC_NOT_CONFIGURED" });
    expect(storeReconciliationHash).not.toHaveBeenCalled();
  });

  it("un token que no resuelve ningún negocio responde 401 UNAUTHORIZED", async () => {
    resolveCaller.mockResolvedValue({ status: "unknown" });

    const response = await get("?storeId=seed-tienda-1");
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "UNAUTHORIZED" });
    expect(storeReconciliationHash).not.toHaveBeenCalled();
  });
});
