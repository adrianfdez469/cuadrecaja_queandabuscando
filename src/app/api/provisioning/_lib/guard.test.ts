import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashSyncToken, mintSyncToken } from "@/lib/syncAuth";

/**
 * E6, E7, E14 without a database (architecture.md § Pruebas → server). Every
 * test imports a FRESH copy of the guard (`vi.resetModules()`): the module
 * keeps a one-shot `console.warn` flag (guard.ts), and resetting is what
 * makes that flag's state predictable per test instead of order-dependent.
 */

const ORIGINAL_SECRET = process.env.PROVISIONING_SECRET_SHA256;
const SECRET = "s3cr3t-of-the-provisioning-area-32+chars";
const SECRET_HASH = hashSyncToken(SECRET);
const WRONG_BUT_LONG_ENOUGH = "wrong-value-that-is-still-32-characters-long";

function request(authorization: string | null): Request {
  const headers: Record<string, string> = {};
  if (authorization !== null) headers.authorization = authorization;
  return new Request("http://localhost/api/provisioning/credential", { headers });
}

async function freshGuard() {
  vi.resetModules();
  return import("./guard");
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_SECRET === undefined) delete process.env.PROVISIONING_SECRET_SHA256;
  else process.env.PROVISIONING_SECRET_SHA256 = ORIGINAL_SECRET;
});

describe("verifyProvisioningSecret() — el secreto cuadra", () => {
  it("returns null (let the caller proceed) with the right bearer secret", async () => {
    process.env.PROVISIONING_SECRET_SHA256 = SECRET_HASH;
    const { verifyProvisioningSecret } = await freshGuard();
    expect(verifyProvisioningSecret(request(`Bearer ${SECRET}`))).toBeNull();
  });

  it("never calls console.error — only console.warn, and only on misconfiguration", async () => {
    process.env.PROVISIONING_SECRET_SHA256 = SECRET_HASH;
    const { verifyProvisioningSecret } = await freshGuard();
    verifyProvisioningSecret(request(`Bearer ${SECRET}`));
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe("verifyProvisioningSecret() — E6/R8: secreto ausente o con forma incorrecta → 503, nunca 401", () => {
  it("503 PROVISIONING_NOT_CONFIGURED when the variable is missing entirely", async () => {
    delete process.env.PROVISIONING_SECRET_SHA256;
    const { verifyProvisioningSecret } = await freshGuard();
    const response = verifyProvisioningSecret(request(`Bearer ${SECRET}`));
    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({ error: "PROVISIONING_NOT_CONFIGURED" });
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it("503, not 401, when the configured value is the SECRET IN PLAIN TEXT — criterio 19, R9's diagnostic", async () => {
    process.env.PROVISIONING_SECRET_SHA256 = SECRET; // not 64 hex characters
    const { verifyProvisioningSecret } = await freshGuard();
    const response = verifyProvisioningSecret(request(`Bearer ${SECRET}`));
    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({ error: "PROVISIONING_NOT_CONFIGURED" });
  });

  it("503 with 63 hex characters (one short of a real SHA-256 digest)", async () => {
    process.env.PROVISIONING_SECRET_SHA256 = SECRET_HASH.slice(0, 63);
    const { verifyProvisioningSecret } = await freshGuard();
    expect(verifyProvisioningSecret(request(`Bearer ${SECRET}`))?.status).toBe(503);
  });

  it("503 with an empty string", async () => {
    process.env.PROVISIONING_SECRET_SHA256 = "";
    const { verifyProvisioningSecret } = await freshGuard();
    expect(verifyProvisioningSecret(request(`Bearer ${SECRET}`))?.status).toBe(503);
  });

  it("warns with console.warn, naming the VARIABLE and never the secret's value", async () => {
    process.env.PROVISIONING_SECRET_SHA256 = SECRET; // misconfigured
    const { verifyProvisioningSecret } = await freshGuard();
    verifyProvisioningSecret(request(`Bearer ${SECRET}`));

    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
    const [message] = vi.mocked(console.warn).mock.calls[0] as [string];
    expect(message.startsWith("[provisioning]")).toBe(true);
    expect(message).toContain("PROVISIONING_SECRET_SHA256");
    expect(message).not.toContain(SECRET);
  });

  it("warns only ONCE across repeated misconfigured calls in the same process", async () => {
    process.env.PROVISIONING_SECRET_SHA256 = "";
    const { verifyProvisioningSecret } = await freshGuard();
    verifyProvisioningSecret(request(`Bearer ${SECRET}`));
    verifyProvisioningSecret(request(`Bearer ${SECRET}`));
    verifyProvisioningSecret(request(`Bearer ${SECRET}`));
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});

describe("verifyProvisioningSecret() — E7: las tres formas de fallar la cabecera dan 401 con el MISMO cuerpo", () => {
  beforeEach(() => {
    process.env.PROVISIONING_SECRET_SHA256 = SECRET_HASH;
  });

  it.each<[string, string | null]>([
    ["missing header", null],
    ["another scheme (Basic)", `Basic ${SECRET}`],
    ["the bare value, no scheme at all", SECRET],
    ["Bearer with the wrong value", `Bearer ${WRONG_BUT_LONG_ENOUGH}`],
  ])("401 UNAUTHORIZED — %s", async (_label, authorization) => {
    const { verifyProvisioningSecret } = await freshGuard();
    const response = verifyProvisioningSecret(request(authorization));
    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({ error: "UNAUTHORIZED" });
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it("the three failures serialize to the EXACTLY same body — a caller cannot learn which one failed (criterio 7)", async () => {
    const { verifyProvisioningSecret } = await freshGuard();
    const responses = [
      verifyProvisioningSecret(request(null)),
      verifyProvisioningSecret(request(`Basic ${SECRET}`)),
      verifyProvisioningSecret(request(`Bearer ${WRONG_BUT_LONG_ENOUGH}`)),
    ];
    const bodies = await Promise.all(responses.map((response) => response?.json()));
    expect(bodies[0]).toEqual({ error: "UNAUTHORIZED" });
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });
});

describe("verifyProvisioningSecret() — E14: un token de negocio no autentica esta ruta", () => {
  it("401 when a real sync token (48 base64url characters) is presented instead of the secret", async () => {
    process.env.PROVISIONING_SECRET_SHA256 = SECRET_HASH;
    const { verifyProvisioningSecret } = await freshGuard();
    const { token } = mintSyncToken();
    expect(verifyProvisioningSecret(request(`Bearer ${token}`))?.status).toBe(401);
  });
});
