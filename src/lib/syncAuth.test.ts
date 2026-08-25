import { describe, expect, it } from "vitest";
import { hashSyncToken, verifySyncToken } from "./syncAuth";

const TOKEN = "a".repeat(48);

describe("verifySyncToken()", () => {
  it("accepts the configured token", () => {
    expect(verifySyncToken(`Bearer ${TOKEN}`, TOKEN)).toEqual({ ok: true });
  });

  it("rejects a wrong token of the same length", () => {
    expect(verifySyncToken(`Bearer ${"b".repeat(48)}`, TOKEN)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("rejects a wrong token of a different length without throwing", () => {
    // timingSafeEqual throws on unequal buffer lengths; hashing first is what
    // keeps this from being both a crash and a length oracle.
    expect(() => verifySyncToken("Bearer short", TOKEN)).not.toThrow();
    expect(verifySyncToken("Bearer short", TOKEN).ok).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifySyncToken(null, TOKEN)).toEqual({ ok: false, reason: "missing" });
    expect(verifySyncToken(undefined, TOKEN)).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects a header without the Bearer scheme", () => {
    expect(verifySyncToken(TOKEN, TOKEN)).toEqual({ ok: false, reason: "malformed" });
    expect(verifySyncToken(`Basic ${TOKEN}`, TOKEN)).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects an empty bearer value", () => {
    expect(verifySyncToken("Bearer    ", TOKEN)).toEqual({ ok: false, reason: "malformed" });
  });

  it("fails closed when the server has no token configured", () => {
    // An unset SYNC_TOKEN must never mean "let everything through".
    expect(verifySyncToken(`Bearer ${TOKEN}`, undefined)).toEqual({
      ok: false,
      reason: "unconfigured",
    });
    expect(verifySyncToken("Bearer x", "short")).toEqual({ ok: false, reason: "unconfigured" });
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
