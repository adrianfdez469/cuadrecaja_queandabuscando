import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * HS7, criterio propuesto: `GET /api/internal/slug-availability` con token
 * válido para libre/tomado/reservado/propio; sin token → 401; sin `slug` ni
 * `name` → 400.
 */

const previewSlug = vi.fn();

vi.mock("@/features/storefront/server/registry", () => ({
  previewSlug: (...args: unknown[]) => previewSlug(...args),
}));

const { GET } = await import("./route");

/** `verifySyncToken` descarta cualquier token de menos de 32 caracteres. */
const TOKEN = "t".repeat(48);

function get(query: string, { token = TOKEN }: { token?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return GET(new Request(`http://localhost/api/internal/slug-availability${query}`, { headers }));
}

beforeEach(() => {
  previewSlug.mockReset();
  process.env.SYNC_TOKEN = TOKEN;
});

describe("GET /api/internal/slug-availability", () => {
  it("responde 401 sin token", async () => {
    const response = await get("?slug=la-rampa", { token: null });
    expect(response.status).toBe(401);
    expect(previewSlug).not.toHaveBeenCalled();
  });

  it("responde 400 sin slug ni name", async () => {
    const response = await get("");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "MISSING_QUERY" });
    expect(previewSlug).not.toHaveBeenCalled();
  });

  it("responde libre (free) y nunca reserva", async () => {
    previewSlug.mockResolvedValue({
      candidate: "la-rampa",
      available: true,
      reason: "free",
      resolvedSlug: "la-rampa",
      storeKnown: false,
    });

    const response = await get("?slug=la-rampa");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      candidate: "la-rampa",
      available: true,
      reason: "free",
      resolvedSlug: "la-rampa",
      storeKnown: false,
      reserving: false,
    });
    expect(body.url).toMatch(/\/la-rampa$/);
    expect(previewSlug).toHaveBeenCalledWith({
      slug: "la-rampa",
      name: null,
      storeExternalId: null,
    });
  });

  it("responde tomado (taken) con el siguiente slug libre pronosticado", async () => {
    previewSlug.mockResolvedValue({
      candidate: "tienda-demo",
      available: false,
      reason: "taken",
      resolvedSlug: "tienda-demo-2",
      storeKnown: false,
    });

    const response = await get("?slug=tienda-demo&storeId=seed-tienda-9");
    const body = await response.json();
    expect(body.reason).toBe("taken");
    expect(body.resolvedSlug).toBe("tienda-demo-2");
    expect(body.reserving).toBe(false);
    expect(previewSlug).toHaveBeenCalledWith({
      slug: "tienda-demo",
      name: null,
      storeExternalId: "seed-tienda-9",
    });
  });

  it("responde reservado (reserved) con el disfraz que crearía el sync", async () => {
    previewSlug.mockResolvedValue({
      candidate: "admin",
      available: false,
      reason: "reserved",
      resolvedSlug: "admin-tienda",
      storeKnown: false,
    });

    const response = await get("?slug=admin");
    const body = await response.json();
    expect(body.reason).toBe("reserved");
    expect(body.resolvedSlug).toBe("admin-tienda");
  });

  it("responde propio (own) cuando el storeId ya tiene ese slug", async () => {
    previewSlug.mockResolvedValue({
      candidate: "tienda-demo",
      available: true,
      reason: "own",
      resolvedSlug: "tienda-demo",
      storeKnown: true,
    });

    const response = await get("?slug=tienda-demo&storeId=seed-tienda-1");
    const body = await response.json();
    expect(body).toMatchObject({ reason: "own", available: true, storeKnown: true });
  });

  it("usa name cuando no viene slug", async () => {
    previewSlug.mockResolvedValue({
      candidate: "cafe-cubita",
      available: true,
      reason: "free",
      resolvedSlug: "cafe-cubita",
      storeKnown: false,
    });

    await get("?name=Caf%C3%A9%20Cubita");
    expect(previewSlug).toHaveBeenCalledWith({
      slug: null,
      name: "Café Cubita",
      storeExternalId: null,
    });
  });
});
