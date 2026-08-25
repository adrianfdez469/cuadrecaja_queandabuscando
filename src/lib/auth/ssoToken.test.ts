import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { verifySsoToken } from "./ssoToken";

const SECRET = "s".repeat(48);
const key = new TextEncoder().encode(SECRET);

async function mint(
  claims: Record<string, unknown>,
  { expiresIn = "60s", secret = SECRET }: { expiresIn?: string; secret?: string } = {},
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
}

const validClaims = {
  jti: "token-0001",
  sub: "usuario-uuid",
  name: "Ana",
  email: "ana@example.com",
  businessId: "negocio-uuid",
  storeIds: ["tienda-1", "tienda-2"],
};

describe("verifySsoToken()", () => {
  it("accepts a well-formed token", async () => {
    const result = await verifySsoToken(await mint(validClaims), SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.sub).toBe("usuario-uuid");
      expect(result.payload.storeIds).toEqual(["tienda-1", "tienda-2"]);
    }
  });

  it("defaults storeIds to an empty list", async () => {
    const { storeIds: _omitted, ...withoutStores } = validClaims;
    const result = await verifySsoToken(await mint(withoutStores), SECRET);
    expect(result.ok && result.payload.storeIds).toEqual([]);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await mint(validClaims, { secret: "d".repeat(48) });
    expect(await verifySsoToken(token, SECRET)).toEqual({ ok: false, reason: "invalid" });
  });

  it("distinguishes an expired token from an invalid one", async () => {
    // Beyond the 30s clock tolerance.
    const token = await mint(validClaims, { expiresIn: "-120s" });
    expect(await verifySsoToken(token, SECRET)).toEqual({ ok: false, reason: "expired" });
  });

  it("tolerates small clock drift between the two deployments", async () => {
    const token = await mint(validClaims, { expiresIn: "-10s" });
    expect((await verifySsoToken(token, SECRET)).ok).toBe(true);
  });

  it("rejects a valid signature carrying an unusable payload", async () => {
    const token = await mint({ jti: "x", sub: "y" });
    expect(await verifySsoToken(token, SECRET)).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects garbage without throwing", async () => {
    expect(await verifySsoToken("not-a-jwt", SECRET)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a token whose email is not an email", async () => {
    const token = await mint({ ...validClaims, email: "nope" });
    expect(await verifySsoToken(token, SECRET)).toEqual({ ok: false, reason: "malformed" });
  });

  it("verifies the key material it was given, not an ambient one", async () => {
    const token = await new SignJWT(validClaims)
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("60s")
      .sign(key);
    expect((await verifySsoToken(token, SECRET)).ok).toBe(true);
  });
});
