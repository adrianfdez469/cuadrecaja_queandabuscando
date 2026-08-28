import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-007, criterio 1: la ruta del pull responde `{ orders, nextCursor }` y
 * valida su query.
 *
 * Lo que de verdad fija este archivo es la regresión que encontró
 * `scripts/pull-orders.mjs --paginate`: `since=-1` respondía **500 con el
 * cuerpo vacío** en vez de 400. Zod rechazaba bien el negativo; lo que
 * reventaba era contarlo, porque el issue `too_small` de un schema `bigint`
 * lleva `minimum: 0n` y `NextResponse.json` hace `JSON.stringify`, que lanza
 * sobre un BigInt. La rama del 400 era la que fallaba.
 *
 * Por eso el aserto no es solo `status === 400`: es **leer el cuerpo**. Un test
 * que solo mirara el código de estado seguiría pasando con el bug puesto, que
 * es justo por lo que sobrevivió hasta que alguien ejecutó la ruta.
 *
 * F-018: la identidad ya no sale de una variable de entorno global sino del
 * `caller` que el
 * guard resuelve. Este archivo mockea `@/features/sync/server/caller` — el
 * único módulo con la consulta (AP-a) — y no `@/lib/prisma`.
 */

const pullOrders = vi.fn();
const resolveCaller = vi.fn();
const syncConfigured = vi.fn();

vi.mock("@/features/orders/server/pull", () => ({
  pullOrders: (...args: unknown[]) => pullOrders(...args),
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
  return GET(new Request(`http://localhost/api/internal/orders${query}`, { headers }));
}

beforeEach(() => {
  pullOrders.mockReset().mockResolvedValue({ orders: [], nextCursor: null });
  resolveCaller.mockReset().mockResolvedValue({ status: "ok", caller: CALLER });
  syncConfigured.mockReset().mockResolvedValue(true);
});

describe("GET /api/internal/orders — query válida", () => {
  it("traslada since y limit a pullOrders con el businessId del caller", async () => {
    const response = await get("?since=42&limit=7");

    expect(response.status).toBe(200);
    expect(pullOrders).toHaveBeenCalledWith("business-a", 42n, 7);
  });

  it("sin parámetros usa los defaults 0 y 100", async () => {
    await get("");

    expect(pullOrders).toHaveBeenCalledWith("business-a", 0n, 100);
  });

  it("devuelve tal cual lo que pullOrders produce", async () => {
    pullOrders.mockResolvedValue({ orders: [{ id: "1" }], nextCursor: "1" });
    const response = await get("?since=0&limit=1");

    await expect(response.json()).resolves.toEqual({ orders: [{ id: "1" }], nextCursor: "1" });
  });
});

describe("GET /api/internal/orders — query inválida", () => {
  // La regresión. Antes del arreglo esto era 500 con el cuerpo vacío.
  it("responde 400 —no 500— con un since negativo, y el cuerpo se puede leer", async () => {
    const response = await get("?since=-1&limit=10");

    expect(response.status).toBe(400);
    // `.json()` es el aserto que importa: es lo que lanzaba «Do not know how to
    // serialize a BigInt» cuando los issues de Zod viajaban en crudo.
    const body = await response.json();
    expect(body.error).toBe("INVALID_QUERY");
    expect(body.issues).toEqual([
      { path: ["since"], message: expect.stringContaining("Too small") },
    ]);
    expect(pullOrders).not.toHaveBeenCalled();
  });

  it("ningún issue lleva un valor no serializable, sea cual sea el schema", async () => {
    // El arreglo no es "quitar el bigint del schema" sino "no serializar nunca
    // más que path y message": esto lo fija para el siguiente campo que se añada.
    for (const query of ["?since=-1", "?since=abc", "?limit=0", "?limit=501", "?limit=x"]) {
      const response = await get(query);
      expect(response.status, query).toBe(400);
      const body = await response.json();
      for (const issue of body.issues) {
        expect(Object.keys(issue).sort(), query).toEqual(["message", "path"]);
      }
    }
  });

  it("responde 400 con since no numérico y con limit fuera de rango", async () => {
    expect((await get("?since=abc")).status).toBe(400);
    expect((await get("?limit=0")).status).toBe(400);
    expect((await get("?limit=501")).status).toBe(400);
    expect(pullOrders).not.toHaveBeenCalled();
  });
});

describe("GET /api/internal/orders — credencial (E2–E6)", () => {
  it("401 sin token, sin llegar a consultar pullOrders", async () => {
    const response = await get("?since=0&limit=1", { token: null });

    expect(response.status).toBe(401);
    expect(pullOrders).not.toHaveBeenCalled();
  });

  it("503 sin cabecera y sin ningún hash configurado (E6, PP3)", async () => {
    syncConfigured.mockResolvedValue(false);
    const response = await get("?since=0&limit=1", { token: null });

    expect(response.status).toBe(503);
    expect(pullOrders).not.toHaveBeenCalled();
  });

  it("503 con un token bien formado cuando el resolutor dice unconfigured", async () => {
    resolveCaller.mockResolvedValue({ status: "unconfigured" });
    const response = await get("?since=0&limit=1");

    expect(response.status).toBe(503);
    expect(pullOrders).not.toHaveBeenCalled();
  });

  it("401 con un token que no resuelve ningún negocio", async () => {
    resolveCaller.mockResolvedValue({ status: "unknown" });
    const response = await get("?since=0&limit=1");

    expect(response.status).toBe(401);
    expect(pullOrders).not.toHaveBeenCalled();
  });

  it("403 con el token de un negocio inactivo", async () => {
    resolveCaller.mockResolvedValue({ status: "inactive" });
    const response = await get("?since=0&limit=1");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "BUSINESS_INACTIVE" });
    expect(pullOrders).not.toHaveBeenCalled();
  });
});
