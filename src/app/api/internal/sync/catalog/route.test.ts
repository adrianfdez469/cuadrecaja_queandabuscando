import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-018, criterio C2 (`.agent/features.json`): "POST /api/internal/sync/catalog
 * con token de A y businessId de B en el payload responde 403 y no escribe
 * nada." E14 / R5.
 *
 * This route file had no test at all before F-018's tester wrote this one —
 * `findCatalogMismatch` was only unit-tested as a pure function
 * (`src/features/sync/identity.test.ts`), never exercised through the actual
 * route to prove the mismatch short-circuits BEFORE `processCatalogBatch`
 * (and therefore before `recordBatch`/the `SyncEvent` inbox) ever runs. See
 * `tests.md` for the manual HTTP+DB confirmation of the "no row survives a
 * retry as duplicate" trap (AGENTS.md § "Un evento fallido NO es un
 * duplicado") — this file is the fast, mocked backstop for the same
 * property: `processCatalogBatch` must never be called.
 *
 * Mocks `@/features/sync/server/caller` (AP-a) and
 * `@/features/sync/server/processBatch`, not Prisma.
 */

const processCatalogBatch = vi.fn();
const resolveCaller = vi.fn();
const syncConfigured = vi.fn();

vi.mock("@/features/sync/server/processBatch", () => ({
  processCatalogBatch: (...args: unknown[]) => processCatalogBatch(...args),
}));

vi.mock("@/features/sync/server/caller", () => ({
  resolveCaller: (...args: unknown[]) => resolveCaller(...args),
  syncConfigured: (...args: unknown[]) => syncConfigured(...args),
}));

const { POST } = await import("./route");

const TOKEN = "t".repeat(48);
const CALLER = { businessId: "business-a", externalId: "seed-negocio-1" };

function currencyEvent(eventId: string) {
  return {
    eventId,
    entity: "CURRENCY",
    operation: "UPDATE",
    occurredAt: "2026-08-27T00:00:00.000Z",
    payload: {
      code: "USD",
      name: "Dólar",
      symbol: "$",
      active: true,
      updatedAt: "2026-08-27T00:00:00.000Z",
    },
  };
}

function post(body: unknown, { token = TOKEN }: { token?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return POST(
    new Request("http://localhost/api/internal/sync/catalog", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  processCatalogBatch.mockReset().mockResolvedValue({ ok: [], failed: [], results: [] });
  resolveCaller.mockReset().mockResolvedValue({ status: "ok", caller: CALLER });
  syncConfigured.mockReset().mockResolvedValue(true);
});

describe("POST /api/internal/sync/catalog — C2/E14: businessId ajeno en el cuerpo", () => {
  it("403 BUSINESS_MISMATCH y processCatalogBatch NUNCA se llama, cuando el businessId raíz es de otro negocio", async () => {
    const response = await post({
      businessId: "seed-negocio-2",
      events: [currencyEvent("evt-1")],
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "BUSINESS_MISMATCH" });
    expect(processCatalogBatch).not.toHaveBeenCalled();
  });

  it("403 BUSINESS_MISMATCH cuando el businessId raíz coincide pero un evento STORE lleva el de otro negocio", async () => {
    const response = await post({
      businessId: "seed-negocio-1",
      events: [
        {
          eventId: "evt-2",
          entity: "STORE",
          operation: "UPDATE",
          occurredAt: "2026-08-27T00:00:00.000Z",
          payload: {
            storeId: "ext-store-1",
            businessId: "seed-negocio-2",
            businessName: "Negocio ajeno",
            name: "Tienda",
            publishToStore: true,
            baseCurrency: "CUP",
            updatedAt: "2026-08-27T00:00:00.000Z",
          },
        },
      ],
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "BUSINESS_MISMATCH" });
    expect(processCatalogBatch).not.toHaveBeenCalled();
  });
});

describe("POST /api/internal/sync/catalog — camino correcto", () => {
  it("207 y processCatalogBatch se llama con el caller resuelto, cuando el cuerpo es coherente", async () => {
    processCatalogBatch.mockResolvedValue({
      ok: ["evt-1"],
      failed: [],
      results: [{ eventId: "evt-1", status: "processed" }],
    });

    const response = await post({
      businessId: "seed-negocio-1",
      events: [currencyEvent("evt-1")],
    });

    expect(response.status).toBe(207);
    expect(processCatalogBatch).toHaveBeenCalledWith(
      CALLER,
      expect.arrayContaining([expect.objectContaining({ eventId: "evt-1" })]),
    );
  });
});

describe("POST /api/internal/sync/catalog — cuerpos inválidos", () => {
  it("400 INVALID_JSON, sin llamar a processCatalogBatch", async () => {
    const response = await post("no soy json");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "INVALID_JSON" });
    expect(processCatalogBatch).not.toHaveBeenCalled();
  });

  it("400 INVALID_BATCH si el cuerpo no cumple el schema", async () => {
    const response = await post({ businessId: "seed-negocio-1", events: [] });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_BATCH");
    expect(processCatalogBatch).not.toHaveBeenCalled();
  });
});

describe("POST /api/internal/sync/catalog — credencial (E2–E6)", () => {
  it("401 sin cabecera Authorization, sin llegar a processCatalogBatch", async () => {
    const response = await post(
      { businessId: "seed-negocio-1", events: [currencyEvent("evt-1")] },
      { token: null },
    );

    expect(response.status).toBe(401);
    expect(processCatalogBatch).not.toHaveBeenCalled();
  });

  it("403 con el token de un negocio inactivo, sin llegar a processCatalogBatch", async () => {
    resolveCaller.mockResolvedValue({ status: "inactive" });
    const response = await post({ businessId: "seed-negocio-1", events: [currencyEvent("evt-1")] });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "BUSINESS_INACTIVE" });
    expect(processCatalogBatch).not.toHaveBeenCalled();
  });

  it("503 sin ningún hash configurado, sin llegar a processCatalogBatch", async () => {
    syncConfigured.mockResolvedValue(false);
    const response = await post(
      { businessId: "seed-negocio-1", events: [currencyEvent("evt-1")] },
      { token: null },
    );

    expect(response.status).toBe(503);
    expect(processCatalogBatch).not.toHaveBeenCalled();
  });
});
