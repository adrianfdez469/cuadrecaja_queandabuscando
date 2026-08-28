import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-018, criterio C12 (`.agent/features.json`): "POST
 * /api/internal/sync/availability con el token de A y un item de una tienda
 * de B responde 200 sin ese item en 'confirmed' y sin cambiar la
 * disponibilidad de B." E17/E18/R5.
 *
 * `findAvailabilityMismatch` only guards the root `businessId` — the mismatch
 * that matters for C12 (an ajeno `storeId` inside `items[]`, root
 * `businessId` still the caller's own) is `applyAvailability`'s job, and it
 * is proved against real Postgres in
 * `src/features/sync/server/tenantScoping.db.test.ts`. This file is the
 * route-level backstop: it had no test at all before F-018 (the endpoint's
 * only prior coverage was the pure `findAvailabilityMismatch` unit test).
 * Mocks `@/features/sync/server/caller` (AP-a) and
 * `@/features/sync/server/availability`, not Prisma.
 */

const applyAvailability = vi.fn();
const resolveCaller = vi.fn();
const syncConfigured = vi.fn();

vi.mock("@/features/sync/server/availability", () => ({
  applyAvailability: (...args: unknown[]) => applyAvailability(...args),
}));

vi.mock("@/features/sync/server/caller", () => ({
  resolveCaller: (...args: unknown[]) => resolveCaller(...args),
  syncConfigured: (...args: unknown[]) => syncConfigured(...args),
}));

const { POST } = await import("./route");

const TOKEN = "t".repeat(48);
const CALLER = { businessId: "business-a", externalId: "seed-negocio-1" };

function post(body: unknown, { token = TOKEN }: { token?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return POST(
    new Request("http://localhost/api/internal/sync/availability", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  applyAvailability.mockReset().mockResolvedValue({ applied: 0, confirmed: [] });
  resolveCaller.mockReset().mockResolvedValue({ status: "ok", caller: CALLER });
  syncConfigured.mockReset().mockResolvedValue(true);
});

describe("POST /api/internal/sync/availability — camino correcto", () => {
  it("200 y applyAvailability se llama con el businessId del caller, no el del cuerpo", async () => {
    applyAvailability.mockResolvedValue({
      applied: 1,
      confirmed: [["sp-1", "seed-tienda-1"]],
    });

    const response = await post({
      businessId: "seed-negocio-1",
      items: [{ storeProductId: "sp-1", storeId: "seed-tienda-1", availability: "OUT_OF_STOCK" }],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      applied: 1,
      confirmed: [["sp-1", "seed-tienda-1"]],
    });
    expect(applyAvailability).toHaveBeenCalledWith("business-a", [
      { storeProductId: "sp-1", storeId: "seed-tienda-1", availability: "OUT_OF_STOCK" },
    ]);
  });
});

describe("POST /api/internal/sync/availability — C2/E14: businessId ajeno en la raíz del cuerpo", () => {
  it("403 BUSINESS_MISMATCH y applyAvailability nunca se llama", async () => {
    const response = await post({
      businessId: "seed-negocio-2",
      items: [{ storeProductId: "sp-1", storeId: "seed-tienda-7", availability: "OUT_OF_STOCK" }],
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "BUSINESS_MISMATCH" });
    expect(applyAvailability).not.toHaveBeenCalled();
  });
});

describe("POST /api/internal/sync/availability — cuerpos inválidos", () => {
  it("400 INVALID_JSON", async () => {
    const response = await post("no soy json");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "INVALID_JSON" });
    expect(applyAvailability).not.toHaveBeenCalled();
  });

  it("400 INVALID_BATCH si items está vacío", async () => {
    const response = await post({ businessId: "seed-negocio-1", items: [] });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_BATCH");
    expect(applyAvailability).not.toHaveBeenCalled();
  });
});

describe("POST /api/internal/sync/availability — credencial (E2–E6)", () => {
  it("401 sin cabecera Authorization", async () => {
    const response = await post(
      {
        businessId: "seed-negocio-1",
        items: [{ storeProductId: "sp-1", storeId: "s-1", availability: "AVAILABLE" }],
      },
      { token: null },
    );

    expect(response.status).toBe(401);
    expect(applyAvailability).not.toHaveBeenCalled();
  });

  it("403 con el token de un negocio inactivo", async () => {
    resolveCaller.mockResolvedValue({ status: "inactive" });
    const response = await post({
      businessId: "seed-negocio-1",
      items: [{ storeProductId: "sp-1", storeId: "s-1", availability: "AVAILABLE" }],
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "BUSINESS_INACTIVE" });
    expect(applyAvailability).not.toHaveBeenCalled();
  });

  it("503 sin ningún hash configurado", async () => {
    syncConfigured.mockResolvedValue(false);
    const response = await post(
      {
        businessId: "seed-negocio-1",
        items: [{ storeProductId: "sp-1", storeId: "s-1", availability: "AVAILABLE" }],
      },
      { token: null },
    );

    expect(response.status).toBe(503);
    expect(applyAvailability).not.toHaveBeenCalled();
  });
});
