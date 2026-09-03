import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-033 architecture.md DA8: la ruta con las DOS lecturas laterales, en un
 * archivo aparte de `route.test.ts` a propósito — ese archivo no se toca
 * (§ Estado actual, punto 2/3) y mockearlo aquí junto con `lateralRead`
 * habría caído en «la trampa del mock» que DA1 describe. Cubre los 200 y
 * los 400 de los criterios 5, 6, 8 y 9, y que la función de lectura
 * correspondiente NO se llamó cuando la query se rechaza.
 */

const pullOrders = vi.fn();
const readOrdersByStatus = vi.fn();
const readOrdersByIds = vi.fn();
const resolveCaller = vi.fn();
const syncConfigured = vi.fn();

vi.mock("@/features/orders/server/pull", () => ({
  pullOrders: (...args: unknown[]) => pullOrders(...args),
}));

vi.mock("@/features/orders/server/lateralRead", () => ({
  readOrdersByStatus: (...args: unknown[]) => readOrdersByStatus(...args),
  readOrdersByIds: (...args: unknown[]) => readOrdersByIds(...args),
}));

vi.mock("@/features/sync/server/caller", () => ({
  resolveCaller: (...args: unknown[]) => resolveCaller(...args),
  syncConfigured: (...args: unknown[]) => syncConfigured(...args),
}));

const { GET } = await import("./route");

const TOKEN = "t".repeat(48);
const CALLER = { businessId: "business-a", externalId: "seed-negocio-1" };

function get(query: string) {
  return GET(
    new Request(`http://localhost/api/internal/orders${query}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    }),
  );
}

beforeEach(() => {
  pullOrders.mockReset().mockResolvedValue({ orders: [], nextCursor: null });
  readOrdersByStatus.mockReset().mockResolvedValue({ orders: [], nextAfter: null });
  readOrdersByIds.mockReset().mockResolvedValue({ orders: [], nextAfter: null });
  resolveCaller.mockReset().mockResolvedValue({ status: "ok", caller: CALLER });
  syncConfigured.mockReset().mockResolvedValue(true);
});

describe("GET /api/internal/orders?status= — 200 (criterio 5)", () => {
  it("despacha a readOrdersByStatus con businessId, status, after y limit", async () => {
    readOrdersByStatus.mockResolvedValue({ orders: [{ id: "5" }], nextAfter: "5" });
    const response = await get("?status=AWAITING_CUSTOMER&limit=1&after=4");

    expect(response.status).toBe(200);
    expect(readOrdersByStatus).toHaveBeenCalledWith({
      businessId: "business-a",
      status: "AWAITING_CUSTOMER",
      after: 4n,
      limit: 1,
    });
    expect(pullOrders).not.toHaveBeenCalled();
    expect(readOrdersByIds).not.toHaveBeenCalled();
  });

  it("la respuesta lleva nextCursor: null y nextAfter de la lectura (DA7, R1)", async () => {
    readOrdersByStatus.mockResolvedValue({ orders: [{ id: "5" }], nextAfter: "5" });
    const response = await get("?status=PULLED");

    await expect(response.json()).resolves.toEqual({
      orders: [{ id: "5" }],
      nextCursor: null,
      nextAfter: "5",
    });
  });

  it("una lectura sin resultados responde 200 con lista vacía, nunca 404 (E3)", async () => {
    const response = await get("?status=REJECTED_BY_STORE");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      orders: [],
      nextCursor: null,
      nextAfter: null,
    });
  });
});

describe("GET /api/internal/orders?ids= — 200 (criterio 3)", () => {
  it("despacha a readOrdersByIds con businessId y los ids parseados", async () => {
    readOrdersByIds.mockResolvedValue({ orders: [{ id: "1" }, { id: "2" }], nextAfter: null });
    const response = await get("?ids=1,2");

    expect(response.status).toBe(200);
    expect(readOrdersByIds).toHaveBeenCalledWith({ businessId: "business-a", ids: [1n, 2n] });
    expect(pullOrders).not.toHaveBeenCalled();
    expect(readOrdersByStatus).not.toHaveBeenCalled();
  });

  it("nextAfter siempre null en la lectura por ids (SP7)", async () => {
    readOrdersByIds.mockResolvedValue({ orders: [], nextAfter: null });
    const response = await get("?ids=1,2");

    await expect(response.json()).resolves.toEqual({
      orders: [],
      nextCursor: null,
      nextAfter: null,
    });
  });
});

describe("GET /api/internal/orders — 400 y ninguna función de lectura llamada (criterio 6)", () => {
  it.each([
    ["?status=NOPE", "status fuera del enum"],
    ["?status=", "status vacío"],
    ["?status=pulled", "status en minúsculas"],
    ["?status=PULLED,CONFIRMED", "dos estados con coma"],
    ["?ids=abc", "ids no numérico"],
    ["?ids=", "ids vacío"],
    ["?ids=1,,2", "ids con hueco"],
    ["?ids=1.5", "ids decimal"],
    ["?ids=-1", "ids negativo"],
  ])("%s (%s) responde 400 INVALID_QUERY, sin orders, sin llamar a nada", async (query) => {
    const response = await get(query);

    expect(response.status, query).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("INVALID_QUERY");
    expect(body.orders).toBeUndefined();
    for (const issue of body.issues) {
      expect(Object.keys(issue).sort()).toEqual(["message", "path"]);
    }
    expect(pullOrders).not.toHaveBeenCalled();
    expect(readOrdersByStatus).not.toHaveBeenCalled();
    expect(readOrdersByIds).not.toHaveBeenCalled();
  });
});

describe("GET /api/internal/orders — el tope de ?ids= (criterio 7)", () => {
  it("101 ids responde 400 IDS_LIMIT_EXCEEDED, nunca 200 con la lista recortada", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => i + 1).join(",");
    const response = await get(`?ids=${ids}`);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.issues).toEqual([{ path: ["ids"], message: "IDS_LIMIT_EXCEEDED" }]);
    expect(readOrdersByIds).not.toHaveBeenCalled();
  });

  it("100 ids exactos responde 200", async () => {
    const ids = Array.from({ length: 100 }, (_, i) => i + 1).join(",");
    const response = await get(`?ids=${ids}`);

    expect(response.status).toBe(200);
    expect(readOrdersByIds).toHaveBeenCalledOnce();
  });
});

describe("GET /api/internal/orders — mezclar since con status/ids (criterio 8)", () => {
  it.each([
    ["?since=5&status=PULLED", "SINCE_WITH_LATERAL_READ"],
    ["?since=0&status=PULLED", "SINCE_WITH_LATERAL_READ"],
    ["?since=5&ids=1,2", "SINCE_WITH_LATERAL_READ"],
    ["?since=0&ids=1,2", "SINCE_WITH_LATERAL_READ"],
  ])("%s responde 400 %s, sin llamar a ninguna función de lectura", async (query, message) => {
    const response = await get(query);

    expect(response.status, query).toBe(400);
    const body = await response.json();
    expect(body.issues).toContainEqual({ path: [], message });
    expect(pullOrders).not.toHaveBeenCalled();
    expect(readOrdersByStatus).not.toHaveBeenCalled();
    expect(readOrdersByIds).not.toHaveBeenCalled();
  });
});

describe("GET /api/internal/orders — las otras tres combinaciones ambiguas (E14, SP6)", () => {
  it("status + ids responde 400 STATUS_WITH_IDS", async () => {
    const response = await get("?status=PULLED&ids=1,2");
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.issues).toContainEqual({ path: [], message: "STATUS_WITH_IDS" });
    expect(readOrdersByStatus).not.toHaveBeenCalled();
    expect(readOrdersByIds).not.toHaveBeenCalled();
  });

  it("after sin status responde 400 AFTER_WITHOUT_STATUS", async () => {
    const response = await get("?after=7");
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.issues).toContainEqual({ path: [], message: "AFTER_WITHOUT_STATUS" });
    expect(pullOrders).not.toHaveBeenCalled();
  });

  it("limit + ids responde 400 LIMIT_WITH_IDS — nunca sirve 1 de los 2", async () => {
    const response = await get("?ids=1,2&limit=1");
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.issues).toContainEqual({ path: [], message: "LIMIT_WITH_IDS" });
    expect(readOrdersByIds).not.toHaveBeenCalled();
  });
});

describe("GET /api/internal/orders — el pull incremental sigue intacto (criterio 13)", () => {
  it("sin status ni ids despacha a pullOrders, no a ninguna lectura lateral", async () => {
    const response = await get("?since=42&limit=7");

    expect(response.status).toBe(200);
    expect(pullOrders).toHaveBeenCalledWith("business-a", 42n, 7);
    expect(readOrdersByStatus).not.toHaveBeenCalled();
    expect(readOrdersByIds).not.toHaveBeenCalled();
  });

  it("el cuerpo del pull no lleva nextAfter (un consumidor de la v7 no ve un campo nuevo)", async () => {
    pullOrders.mockResolvedValue({ orders: [], nextCursor: "9" });
    const response = await get("");

    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["nextCursor", "orders"]);
  });
});

describe("GET /api/internal/orders — credencial, también antes de mirar la query lateral", () => {
  it("401 sin token, sin llegar a leer lateralmente", async () => {
    resolveCaller.mockReset();
    const response = await GET(new Request("http://localhost/api/internal/orders?status=PULLED"));

    expect(response.status).toBe(401);
    expect(readOrdersByStatus).not.toHaveBeenCalled();
  });

  it("403 con el token de un negocio inactivo, incluso con una query lateral válida", async () => {
    resolveCaller.mockResolvedValue({ status: "inactive" });
    const response = await get("?status=PULLED");

    expect(response.status).toBe(403);
    expect(readOrdersByStatus).not.toHaveBeenCalled();
  });
});
