import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-007, criterio 3: `POST /api/internal/orders/status` actualiza el estado y
 * responde 404 para un pedido inexistente.
 *
 * Hasta aquí esta ruta no tenía ninguna prueba. Es la única escritura que
 * cuadrecaja hace sobre esta base, así que un 404 que en realidad fuera un 200
 * silencioso dejaría al POS creyendo que reportó algo que nunca se guardó.
 *
 * El guard NO se mockea: se le da un token de verdad en `process.env` y se
 * ejerce el camino real, porque la mitad de los casos de esta tabla son
 * precisamente los de credencial (401) y de servidor mal configurado (503).
 */

const orderUpdateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { order: { updateMany: (...args: unknown[]) => orderUpdateMany(...args) } },
}));

const { POST } = await import("./route");

/** `verifySyncToken` descarta cualquier token de menos de 32 caracteres. */
const TOKEN = "t".repeat(48);
const URL_STATUS = "http://localhost/api/internal/orders/status";

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
  orderUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  process.env.SYNC_TOKEN = TOKEN;
});

describe("POST /api/internal/orders/status — camino correcto (E6)", () => {
  it("responde 200 { ok: true } y actualiza por id", async () => {
    const response = await post({ orderId: "42", status: "CONFIRMED" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(orderUpdateMany).toHaveBeenCalledWith({
      // El id viaja como string porque es BIGINT y no cabe en un Number, pero
      // la consulta tiene que ir con un bigint de verdad o no encuentra la fila.
      where: { id: 42n },
      data: { status: "CONFIRMED", cancelReason: null },
    });
  });

  it("guarda `reason` en cancelReason al cancelar", async () => {
    await post({ orderId: "7", status: "CANCELLED", reason: "sin existencias" });

    expect(orderUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "CANCELLED", cancelReason: "sin existencias" },
      }),
    );
  });

  it("acepta los cuatro estados del contrato y ninguno más", async () => {
    for (const status of ["CONFIRMED", "READY", "DELIVERED", "CANCELLED"]) {
      expect((await post({ orderId: "1", status })).status).toBe(200);
    }
    // PENDING y PULLED los pone esta base, no el POS (spec § Datos y contrato).
    for (const status of ["PENDING", "PULLED"]) {
      expect((await post({ orderId: "1", status })).status).toBe(400);
    }
  });
});

describe("POST /api/internal/orders/status — pedido inexistente (E7)", () => {
  it("responde 404 cuando el UPDATE no tocó ninguna fila", async () => {
    orderUpdateMany.mockResolvedValue({ count: 0 });
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
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });

  it("400 INVALID_BODY si el status no está en el enum", async () => {
    const response = await post({ orderId: "1", status: "ENTREGADO" });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_BODY");
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });

  it("400 INVALID_ORDER_ID si el orderId no es convertible a BigInt", async () => {
    // Pasa el schema de Zod (es un string no vacío) y muere en el BigInt():
    // el orden de las dos validaciones es lo que se comprueba aquí.
    const response = await post({ orderId: "42.5", status: "CONFIRMED" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "INVALID_ORDER_ID" });
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/internal/orders/status — credencial (E8)", () => {
  it("401 sin cabecera Authorization, y sin llegar a la base", async () => {
    const response = await post({ orderId: "1", status: "CONFIRMED" }, { token: null });

    expect(response.status).toBe(401);
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });

  it("401 con un token que no es el configurado", async () => {
    const response = await post({ orderId: "1", status: "CONFIRMED" }, { token: "x".repeat(48) });

    expect(response.status).toBe(401);
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });

  it("503, nunca 200 ni 401, si el servidor no tiene SYNC_TOKEN configurado", async () => {
    // Un deploy sin el token es error del operador, no del que llama: un 401
    // silencioso lo haría parecer un problema de cuadrecaja durante horas.
    delete process.env.SYNC_TOKEN;
    const response = await post({ orderId: "1", status: "CONFIRMED" });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "SYNC_NOT_CONFIGURED" });
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });
});
