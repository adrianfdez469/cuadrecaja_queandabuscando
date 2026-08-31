import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-019 architecture.md DA2. Same envelope as `/orders/status`: mocked at
 * `@/features/sync/server/caller` (the guard's own dependency) and at
 * `@/features/orders/server/proposal` (the write), never at `@/lib/prisma`.
 */

const proposeOrderChange = vi.fn();
const resolveCaller = vi.fn();
const syncConfigured = vi.fn();

vi.mock("@/features/orders/server/proposal", () => ({
  proposeOrderChange: (...args: unknown[]) => proposeOrderChange(...args),
}));

vi.mock("@/features/sync/server/caller", () => ({
  resolveCaller: (...args: unknown[]) => resolveCaller(...args),
  syncConfigured: (...args: unknown[]) => syncConfigured(...args),
}));

const { POST } = await import("./route");

const TOKEN = "t".repeat(48);
const URL_PROPOSAL = "http://localhost/api/internal/orders/proposal";
const CALLER = { businessId: "business-a", externalId: "seed-negocio-1" };

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    orderId: "42",
    currencyCode: "CUP",
    subtotal: "1000.00",
    deliveryFee: "180.00",
    total: "1180.00",
    message: "El envío a Playa cuesta 180.",
    items: [
      {
        storeProductId: "b5b6c1de-1f9b-4d1a-9e4c-1a2b3c4d5e6f",
        name: "Café Cubita",
        unitPrice: "500.00",
        currencyCode: "CUP",
        quantity: "2",
        lineTotal: "1000.00",
      },
    ],
    ...overrides,
  };
}

function post(body: unknown, { token = TOKEN }: { token?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return POST(
    new Request(URL_PROPOSAL, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  proposeOrderChange.mockReset();
  resolveCaller.mockReset().mockResolvedValue({ status: "ok", caller: CALLER });
  syncConfigured.mockReset().mockResolvedValue(true);
});

describe("POST /api/internal/orders/proposal — camino correcto (E1)", () => {
  it("200 con el cuerpo de la propuesta, y llama con el businessId del caller", async () => {
    proposeOrderChange.mockResolvedValue({
      kind: "proposed",
      expiresAt: new Date("2026-08-31T14:19:43.000Z"),
      currencyCode: "CUP",
      previousTotal: "880.00",
      proposedTotal: "1180.00",
      orderUrl: "https://x/tienda-demo/pedido/A7K3M9PQR2",
      customerWhatsappUrl: "https://wa.me/123",
      customerWhatsappReason: null,
    });

    const response = await post(baseBody());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      status: "AWAITING_CUSTOMER",
      previousTotal: "880.00",
      proposedTotal: "1180.00",
    });
    expect(proposeOrderChange).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: "business-a", orderId: 42n, currencyCode: "CUP" }),
    );
  });
});

describe("POST /api/internal/orders/proposal — errores de negocio", () => {
  it("404 UNKNOWN_ORDER", async () => {
    proposeOrderChange.mockResolvedValue({ kind: "unknown_order" });
    const response = await post(baseBody());
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "UNKNOWN_ORDER" });
  });

  it("400 CURRENCY_MISMATCH", async () => {
    proposeOrderChange.mockResolvedValue({ kind: "currency_mismatch" });
    const response = await post(baseBody());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "CURRENCY_MISMATCH" });
  });

  it("409 ORDER_NOT_PROPOSABLE con el estado actual (E4)", async () => {
    proposeOrderChange.mockResolvedValue({ kind: "not_proposable", status: "DELIVERED" });
    const response = await post(baseBody());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "ORDER_NOT_PROPOSABLE",
      status: "DELIVERED",
    });
  });

  it("500 PROPOSAL_FAILED", async () => {
    proposeOrderChange.mockResolvedValue({ kind: "failed" });
    const response = await post(baseBody());
    expect(response.status).toBe(500);
  });
});

describe("POST /api/internal/orders/proposal — cuerpos inválidos", () => {
  it("400 INVALID_JSON", async () => {
    const response = await post("no soy json");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "INVALID_JSON" });
    expect(proposeOrderChange).not.toHaveBeenCalled();
  });

  it("400 INVALID_BODY cuando Σ lineTotal ≠ subtotal", async () => {
    const response = await post(baseBody({ subtotal: "999.00" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_BODY");
    expect(proposeOrderChange).not.toHaveBeenCalled();
  });

  it("400 INVALID_ORDER_ID si orderId no es convertible a BigInt", async () => {
    const response = await post(baseBody({ orderId: "42.5" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "INVALID_ORDER_ID" });
    expect(proposeOrderChange).not.toHaveBeenCalled();
  });
});

describe("POST /api/internal/orders/proposal — credencial", () => {
  it("401 sin cabecera Authorization", async () => {
    const response = await post(baseBody(), { token: null });
    expect(response.status).toBe(401);
    expect(proposeOrderChange).not.toHaveBeenCalled();
  });
});
