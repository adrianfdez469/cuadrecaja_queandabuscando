import { jwtVerify } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Same module-scope-cache trap `src/lib/env.test.ts` documents: every case
 *  needs a fresh module graph via `vi.resetModules()` + a dynamic `import()`. */

const SECRET = "s".repeat(48);

const BASE_ENV = {
  DATABASE_URL: "postgresql://user:pw@localhost:5432/db",
  SSO_JWT_SECRET: "s".repeat(32),
  ADMIN_SESSION_SECRET: "a".repeat(32),
  NEXT_PUBLIC_SUPABASE_URL: "https://ref.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_JWT_SECRET: SECRET,
};

function stubBase() {
  for (const [key, value] of Object.entries(BASE_ENV)) vi.stubEnv(key, value);
}

beforeEach(() => {
  vi.resetModules();
  stubBase();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("subscriptionAvailability", () => {
  it("reason missing_supabase_url when absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const { subscriptionAvailability } = await import("./subscriptionToken");
    expect(subscriptionAvailability()).toEqual({ ok: false, reason: "missing_supabase_url" });
  });

  it("reason missing_anon_key when absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const { subscriptionAvailability } = await import("./subscriptionToken");
    expect(subscriptionAvailability()).toEqual({ ok: false, reason: "missing_anon_key" });
  });

  it("reason missing_jwt_secret when absent (I8/AP1: stays optional)", async () => {
    vi.stubEnv("SUPABASE_JWT_SECRET", undefined);
    const { subscriptionAvailability } = await import("./subscriptionToken");
    expect(subscriptionAvailability()).toEqual({ ok: false, reason: "missing_jwt_secret" });
  });

  it("ok when the three are present", async () => {
    const { subscriptionAvailability } = await import("./subscriptionToken");
    expect(subscriptionAvailability()).toEqual({ ok: true });
  });
});

describe("mintSubscriptionToken (DA5)", () => {
  it("signs a verifiable HS256 JWT with role=authenticated and the business_id claim", async () => {
    const { mintSubscriptionToken } = await import("./subscriptionToken");

    const { token, expiresAt } = await mintSubscriptionToken("biz-42");
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET));

    expect(payload.role).toBe("authenticated");
    expect(payload.business_id).toBe("biz-42");
    expect(payload.sub).toBe("biz-42");
    expect(payload.iss).toBe("queandabuscando");
    expect(payload.aud).toBe("authenticated");
    expect(payload.exp).toBe(Math.floor(expiresAt.getTime() / 1000));
  });

  it("R15 — expiresAt is REALTIME_CREDENTIAL_TTL_SECONDS from now, explicit", async () => {
    const { mintSubscriptionToken } = await import("./subscriptionToken");
    const { REALTIME_CREDENTIAL_TTL_SECONDS } = await import("@/constants/realtime");

    const before = Date.now();
    const { expiresAt } = await mintSubscriptionToken("biz-42");
    const after = Date.now();

    const deltaSeconds = (expiresAt.getTime() - before) / 1000;
    expect(deltaSeconds).toBeGreaterThanOrEqual(REALTIME_CREDENTIAL_TTL_SECONDS - 1);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + REALTIME_CREDENTIAL_TTL_SECONDS * 1000);
  });

  it("criterio 13 — a token minted for business B never claims business A's id", async () => {
    const { mintSubscriptionToken } = await import("./subscriptionToken");

    const { token } = await mintSubscriptionToken("business-B");
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET));

    expect(payload.business_id).not.toBe("business-A");
    expect(payload.business_id).toBe("business-B");
  });
});

describe("mintRealtimeCredential (DA5 § response shape)", () => {
  it("composes url, apikey, channel, event and the TTL alongside the token", async () => {
    const { mintRealtimeCredential } = await import("./subscriptionToken");
    const { REALTIME_BELL_EVENT, REALTIME_CREDENTIAL_TTL_SECONDS } =
      await import("@/constants/realtime");

    const credential = await mintRealtimeCredential("biz-42");

    expect(credential.url).toBe("https://ref.supabase.co");
    expect(credential.apikey).toBe("anon-key");
    expect(credential.channel).toBe("negocio:biz-42");
    expect(credential.event).toBe(REALTIME_BELL_EVENT);
    expect(credential.expiresInSeconds).toBe(REALTIME_CREDENTIAL_TTL_SECONDS);
    expect(typeof credential.token).toBe("string");
    expect(new Date(credential.expiresAt).toString()).not.toBe("Invalid Date");
  });
});
