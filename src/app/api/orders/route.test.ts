import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-020, architecture.md DA2 — the FIRST trigger. `createOrder` and
 * `resolveOrderCustomerId` are the only DOMAIN mocks, same pattern as
 * `src/app/[slug]/pedido/[code]/respuesta/route.test.ts`.
 *
 * `next/server`'s `after` is mocked to invoke its callback synchronously —
 * the real `after()` throws "called outside a request scope" when a route
 * handler is invoked directly like this test does. `ringOrderBell` is
 * mocked too, so that synchronous call never reaches Postgres.
 */

const createOrder = vi.fn();
const resolveOrderCustomerId = vi.fn();
const ringOrderBell = vi.fn();

vi.mock("@/features/orders/server/createOrder", () => ({
  createOrder: (...args: unknown[]) => createOrder(...args),
}));

vi.mock("@/features/account/server/orderIdentity", () => ({
  resolveOrderCustomerId: (...args: unknown[]) => resolveOrderCustomerId(...args),
}));

vi.mock("@/features/orders/server/bell", () => ({
  ringOrderBell: (...args: unknown[]) => ringOrderBell(...args),
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (callback: () => unknown) => callback() };
});

const { POST } = await import("./route");

const VALID_BODY = {
  storeSlug: "tienda-demo",
  items: [{ storeProductId: "11111111-1111-4111-8111-111111111111", qty: 1 }],
  contact: { name: "Ana Pérez", phone: "+5355555555" },
  fulfillment: "PICKUP",
  expectedTotal: "100.00",
};

function postOrder(body: unknown = VALID_BODY, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  createOrder.mockReset();
  resolveOrderCustomerId.mockReset().mockResolvedValue(null);
  ringOrderBell.mockReset();
});

describe("POST /api/orders — el timbre, primer disparador (F-020, architecture.md DA2)", () => {
  it("kind created programa after(() => ringOrderBell(businessId)) tras un 201", async () => {
    createOrder.mockResolvedValue({
      kind: "created",
      code: "A7K3M9PQR2",
      orderUrl: "/tienda-demo/pedido/A7K3M9PQR2",
      whatsappUrl: null,
      businessId: "business-1",
    });

    const response = await postOrder();

    expect(response.status).toBe(201);
    expect(ringOrderBell).toHaveBeenCalledTimes(1);
    expect(ringOrderBell).toHaveBeenCalledWith("business-1");
  });

  // E16: a 200-idempotent response has no new row to pull.
  it("E16 — kind idempotent (mismo idempotencyKey, 200) NO timbra", async () => {
    createOrder.mockResolvedValue({
      kind: "idempotent",
      code: "A7K3M9PQR2",
      orderUrl: "/tienda-demo/pedido/A7K3M9PQR2",
      whatsappUrl: null,
    });

    const response = await postOrder();

    expect(response.status).toBe(200);
    expect(ringOrderBell).not.toHaveBeenCalled();
  });

  it("E16 — un 409 (items_unavailable) no timbra", async () => {
    createOrder.mockResolvedValue({ kind: "items_unavailable", lines: [] });

    const response = await postOrder();

    expect(response.status).toBe(409);
    expect(ringOrderBell).not.toHaveBeenCalled();
  });

  it("E16 — un 404 (store_not_found) no timbra", async () => {
    createOrder.mockResolvedValue({ kind: "store_not_found" });

    const response = await postOrder();

    expect(response.status).toBe(404);
    expect(ringOrderBell).not.toHaveBeenCalled();
  });

  it("E16 — un 429 (too_many_orders) no timbra", async () => {
    createOrder.mockResolvedValue({ kind: "too_many_orders", retryAfterSeconds: 30 });

    const response = await postOrder();

    expect(response.status).toBe(429);
    expect(ringOrderBell).not.toHaveBeenCalled();
  });

  it("400 (cuerpo inválido, nunca llama a createOrder) no timbra", async () => {
    const response = await postOrder({ storeSlug: "" });

    expect(response.status).toBe(400);
    expect(createOrder).not.toHaveBeenCalled();
    expect(ringOrderBell).not.toHaveBeenCalled();
  });

  // R2/R3 — estructural: el after() se agenda DESPUÉS de que la respuesta ya
  // se construyó, así que su ejecución nunca puede haber cambiado el status.
  it("R2 — el timbre corre después de que la respuesta ya está lista, nunca antes", async () => {
    const order: string[] = [];
    createOrder.mockImplementation(async () => {
      order.push("createOrder");
      return {
        kind: "created",
        code: "A7K3M9PQR2",
        orderUrl: "/tienda-demo/pedido/A7K3M9PQR2",
        whatsappUrl: null,
        businessId: "business-1",
      };
    });
    ringOrderBell.mockImplementation(async () => {
      order.push("ringOrderBell");
    });

    await postOrder();

    expect(order).toEqual(["createOrder", "ringOrderBell"]);
  });
});
