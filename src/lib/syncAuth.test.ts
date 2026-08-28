import { describe, expect, it } from "vitest";
import { hashSyncToken, mintSyncToken, readBearerToken } from "./syncAuth";

const TOKEN = "a".repeat(48);

describe("readBearerToken() — F-018, only the SHAPE of the header", () => {
  it("accepts a well-formed bearer token", () => {
    expect(readBearerToken(`Bearer ${TOKEN}`)).toEqual({ ok: true, token: TOKEN });
  });

  it("rejects a missing header", () => {
    expect(readBearerToken(null)).toEqual({ ok: false, reason: "missing" });
    expect(readBearerToken(undefined)).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects a header without the Bearer scheme", () => {
    expect(readBearerToken(TOKEN)).toEqual({ ok: false, reason: "malformed" });
    expect(readBearerToken(`Basic ${TOKEN}`)).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects an empty bearer value", () => {
    expect(readBearerToken("Bearer    ")).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a token shorter than 32 characters", () => {
    expect(readBearerToken("Bearer short")).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("hashSyncToken()", () => {
  it("is stable and hex-encoded", () => {
    expect(hashSyncToken("abc")).toBe(hashSyncToken("abc"));
    expect(hashSyncToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different tokens", () => {
    expect(hashSyncToken("abc")).not.toBe(hashSyncToken("abd"));
  });
});

describe("mintSyncToken() — E23", () => {
  it("mints a token of at least 48 characters and its matching hash", () => {
    const { token, hash } = mintSyncToken();
    expect(token.length).toBeGreaterThanOrEqual(48);
    expect(hash).toBe(hashSyncToken(token));
  });

  it("never mints the same token twice", () => {
    expect(mintSyncToken().token).not.toBe(mintSyncToken().token);
  });
});
