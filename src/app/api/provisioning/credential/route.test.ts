import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashSyncToken } from "@/lib/syncAuth";

/**
 * Mocks `@/features/sync/server/provisioning`, not Prisma — the same
 * convention as `src/app/api/internal/sync/catalog/route.test.ts`. This is
 * the fast backstop for the four `ProvisionResult` -> HTTP mappings and for
 * E8 (the schema's five invalid-body shapes); the Postgres-real half lives
 * in `provisioning.db.test.ts`.
 */

const provisionCredential = vi.fn();

vi.mock("@/features/sync/server/provisioning", () => ({
  provisionCredential: (...args: unknown[]) => provisionCredential(...args),
}));

const { POST } = await import("./route");

const SECRET = "s3cr3t-of-the-provisioning-area-32+chars";
const SECRET_HASH = hashSyncToken(SECRET);
const ORIGINAL_SECRET = process.env.PROVISIONING_SECRET_SHA256;

function post(
  body: unknown,
  {
    token = SECRET,
    contentType = "application/json",
  }: { token?: string | null; contentType?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (contentType !== null) headers["content-type"] = contentType;
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return POST(
    new Request("http://localhost/api/provisioning/credential", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  provisionCredential.mockReset();
  process.env.PROVISIONING_SECRET_SHA256 = SECRET_HASH;
});

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.PROVISIONING_SECRET_SHA256;
  else process.env.PROVISIONING_SECRET_SHA256 = ORIGINAL_SECRET;
});

describe("POST /api/provisioning/credential — camino correcto", () => {
  it("E1: 201 con created: true, minted: true y el token devuelto", async () => {
    provisionCredential.mockResolvedValue({ status: "minted", created: true, token: "the-token" });

    const response = await post({ externalId: "f034-e1" });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      externalId: "f034-e1",
      created: true,
      minted: true,
      token: "the-token",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("E3: 201 con created: false, minted: true", async () => {
    provisionCredential.mockResolvedValue({ status: "minted", created: false, token: "the-token" });

    const response = await post({ externalId: "f034-e3" });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      externalId: "f034-e3",
      created: false,
      minted: true,
      token: "the-token",
    });
  });

  it("E4: 200 con created: false, minted: false, token: null", async () => {
    provisionCredential.mockResolvedValue({ status: "already_minted" });

    const response = await post({ externalId: "f034-e4" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      externalId: "f034-e4",
      created: false,
      minted: false,
      token: null,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("E9: 403 BUSINESS_INACTIVE", async () => {
    provisionCredential.mockResolvedValue({ status: "inactive" });

    const response = await post({ externalId: "f034-e9" });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "BUSINESS_INACTIVE" });
  });

  it("E12: 503 TOKEN_COLLISION", async () => {
    provisionCredential.mockResolvedValue({ status: "collision" });

    const response = await post({ externalId: "f034-e12" });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "TOKEN_COLLISION" });
  });

  it("E17: reenvía externalId recortado y name undefined cuando no viene", async () => {
    provisionCredential.mockResolvedValue({ status: "minted", created: true, token: "t" });

    await post({ externalId: "  f034-name-1  " });

    expect(provisionCredential).toHaveBeenCalledWith({ externalId: "f034-name-1" });
  });

  it("E17: reenvía name recortado cuando viene", async () => {
    provisionCredential.mockResolvedValue({ status: "minted", created: true, token: "t" });

    await post({ externalId: "f034-name-2", name: "  Bodega La Rampa  " });

    expect(provisionCredential).toHaveBeenCalledWith({
      externalId: "f034-name-2",
      name: "Bodega La Rampa",
    });
  });
});

describe("POST /api/provisioning/credential — el guard (E6, E7, E14): provisionCredential NUNCA se llama", () => {
  it("criterio 6, primera mitad: 503 sin el secreto configurado, y provisionCredential nunca se llama", async () => {
    delete process.env.PROVISIONING_SECRET_SHA256;

    const response = await post({ externalId: "f034-guard-503" });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "PROVISIONING_NOT_CONFIGURED" });
    expect(provisionCredential).not.toHaveBeenCalled();
  });

  it("401 sin cabecera Authorization, y provisionCredential nunca se llama", async () => {
    const response = await post({ externalId: "f034-guard-401a" }, { token: null });

    expect(response.status).toBe(401);
    expect(provisionCredential).not.toHaveBeenCalled();
  });

  it("401 con el secreto equivocado, y provisionCredential nunca se llama", async () => {
    const response = await post(
      { externalId: "f034-guard-401b" },
      { token: "wrong-value-that-is-still-32-characters-long" },
    );

    expect(response.status).toBe(401);
    expect(provisionCredential).not.toHaveBeenCalled();
  });
});

describe("POST /api/provisioning/credential — E8: cuerpo inválido, provisionCredential nunca se llama", () => {
  it("400 INVALID_BODY cuando falta externalId", async () => {
    const response = await post({});

    expect(response.status).toBe(400);
    const parsedBody = await response.json();
    expect(parsedBody.error).toBe("INVALID_BODY");
    expect(parsedBody.issues).toBeDefined();
    expect(provisionCredential).not.toHaveBeenCalled();
  });

  it("400 INVALID_BODY cuando externalId es solo espacios", async () => {
    const response = await post({ externalId: "   " });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_BODY");
    expect(provisionCredential).not.toHaveBeenCalled();
  });

  it("400 INVALID_BODY cuando externalId supera los 128 caracteres", async () => {
    const response = await post({ externalId: "x".repeat(129) });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_BODY");
    expect(provisionCredential).not.toHaveBeenCalled();
  });

  it("400 INVALID_BODY cuando el cuerpo no es JSON parseable", async () => {
    const response = await post("no soy json");

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_BODY");
    expect(provisionCredential).not.toHaveBeenCalled();
  });

  it("400 INVALID_BODY cuando no llega content-type: application/json", async () => {
    const response = await post({ externalId: "f034-no-ct" }, { contentType: null });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_BODY");
    expect(provisionCredential).not.toHaveBeenCalled();
  });
});

describe("POST /api/provisioning/credential — E16: solo POST", () => {
  it("el módulo no exporta GET, PUT, DELETE ni PATCH", async () => {
    const mod: Record<string, unknown> = await import("./route");

    expect(typeof mod.POST).toBe("function");
    expect(mod.GET).toBeUndefined();
    expect(mod.PUT).toBeUndefined();
    expect(mod.DELETE).toBeUndefined();
    expect(mod.PATCH).toBeUndefined();
  });
});
