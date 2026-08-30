import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-007, criterio 3: `POST /api/internal/orders/status` actualiza el estado y
 * responde 404 para un pedido inexistente.
 *
 * F-018: la escritura se movió a `features/orders/server/status.ts`
 * (`setOrderStatus`) — esta ruta ya no importa `@/lib/prisma` (arregla la
 * violación de capa preexistente). El guard se mockea a nivel de
 * `@/features/sync/server/caller` (AP-a), no con la variable de entorno
 * global que F-018 borra.
 */

const setOrderStatus = vi.fn();
const resolveCaller = vi.fn();
const syncConfigured = vi.fn();

vi.mock("@/features/orders/server/status", () => ({
  setOrderStatus: (...args: unknown[]) => setOrderStatus(...args),
}));

vi.mock("@/features/sync/server/caller", () => ({
  resolveCaller: (...args: unknown[]) => resolveCaller(...args),
  syncConfigured: (...args: unknown[]) => syncConfigured(...args),
}));

const { POST } = await import("./route");

const TOKEN = "t".repeat(48);
const URL_STATUS = "http://localhost/api/internal/orders/status";
const CALLER = { businessId: "business-a", externalId: "seed-negocio-1" };

function post(body: unknown, { token = TOKEN }: { token?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;

  return POST(
    new Request(URL_STATUS, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  setOrderStatus.mockReset().mockResolvedValue({ ok: true });
  resolveCaller.mockReset().mockResolvedValue({ status: "ok", caller: CALLER });
  syncConfigured.mockReset().mockResolvedValue(true);
});

describe("POST /api/internal/orders/status — camino correcto", () => {
  it("responde 200 { ok: true } y llama a setOrderStatus con el businessId del caller", async () => {
    const response = await post({ orderId: "42", status: "CONFIRMED" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(setOrderStatus).toHaveBeenCalledWith({
      businessId: "business-a",
      // El id viaja como string porque es BIGINT y no cabe en un Number, pero
      // la consulta tiene que ir con un bigint de verdad o no encuentra la fila.
      orderId: 42n,
      status: "CONFIRMED",
      reason: null,
    });
  });

  it("pasa `reason` al cancelar", async () => {
    await post({ orderId: "7", status: "CANCELLED", reason: "sin existencias" });

    expect(setOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "CANCELLED", reason: "sin existencias" }),
    );
  });

  it("acepta los seis estados del contrato v5 y ninguno más (F-019 DA6)", async () => {
    for (const status of [
      "CONFIRMED",
      "READY",
      "IN_TRANSIT",
      "DELIVERED",
      "CANCELLED",
      "REJECTED_BY_STORE",
    ]) {
      expect((await post({ orderId: "1", status })).status).toBe(200);
    }
    // PENDING y PULLED los pone esta base, no el POS (spec § Datos y contrato).
    for (const status of ["PENDING", "PULLED"]) {
      expect((await post({ orderId: "1", status })).status).toBe(400);
    }
  });

  it("400 INVALID_BODY para AWAITING_CUSTOMER (E19): solo lo pone /orders/proposal", async () => {
    const response = await post({ orderId: "1", status: "AWAITING_CUSTOMER" });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_BODY");
    expect(setOrderStatus).not.toHaveBeenCalled();
  });
});

describe("POST /api/internal/orders/status — pedido inexistente o ajeno (E12)", () => {
  it("responde 404 cuando setOrderStatus no tocó ninguna fila", async () => {
    setOrderStatus.mockResolvedValue({ ok: false });
    const response = await post({ orderId: "999999999", status: "CONFIRMED" });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "UNKNOWN_ORDER" });
  });
});

describe("POST /api/internal/orders/status — cuerpos inválidos", () => {
  it("400 INVALID_JSON si el cuerpo no es JSON", async () => {
    const response = await post("no soy json");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "INVALID_JSON" });
    expect(setOrderStatus).not.toHaveBeenCalled();
  });

  it("400 INVALID_BODY si el status no está en el enum", async () => {
    const response = await post({ orderId: "1", status: "ENTREGADO" });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_BODY");
    expect(setOrderStatus).not.toHaveBeenCalled();
  });

  it("400 INVALID_ORDER_ID si el orderId no es convertible a BigInt", async () => {
    // Pasa el schema de Zod (es un string no vacío) y muere en el BigInt():
    // el orden de las dos validaciones es lo que se comprueba aquí.
    const response = await post({ orderId: "42.5", status: "CONFIRMED" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "INVALID_ORDER_ID" });
    expect(setOrderStatus).not.toHaveBeenCalled();
  });
});

describe("POST /api/internal/orders/status — credencial (E2–E6)", () => {
  it("401 sin cabecera Authorization, y sin llegar a setOrderStatus", async () => {
    const response = await post({ orderId: "1", status: "CONFIRMED" }, { token: null });

    expect(response.status).toBe(401);
    expect(setOrderStatus).not.toHaveBeenCalled();
  });

  it("401 con un token que no resuelve ningún negocio", async () => {
    resolveCaller.mockResolvedValue({ status: "unknown" });
    const response = await post({ orderId: "1", status: "CONFIRMED" }, { token: "x".repeat(48) });

    expect(response.status).toBe(401);
    expect(setOrderStatus).not.toHaveBeenCalled();
  });

  it("403 con el token de un negocio inactivo", async () => {
    resolveCaller.mockResolvedValue({ status: "inactive" });
    const response = await post({ orderId: "1", status: "CONFIRMED" });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "BUSINESS_INACTIVE" });
    expect(setOrderStatus).not.toHaveBeenCalled();
  });

  it("503, nunca 200 ni 401, si ningún negocio tiene syncTokenHash configurado", async () => {
    // Un deploy sin ningún token acuñado es error del operador, no del que
    // llama: un 401 silencioso lo haría parecer un problema de cuadrecaja
    // durante horas.
    syncConfigured.mockResolvedValue(false);
    const response = await post({ orderId: "1", status: "CONFIRMED" }, { token: null });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "SYNC_NOT_CONFIGURED" });
    expect(setOrderStatus).not.toHaveBeenCalled();
  });
});
