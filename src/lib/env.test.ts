import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `cached` and `warned` (src/lib/env.ts) live at module scope, so every case
 * needs a fresh module graph — `vi.resetModules()` plus a dynamic `import()`
 * inside the case, exactly the pattern `src/lib/prisma.test.ts` already uses.
 * The `server` project does not load `dotenv/config` (vitest.config.mts
 * header), so `vi.stubEnv` is the only source of environment here — the
 * machine's real `.env` cannot leak in.
 */

const BASE_ENV = {
  DATABASE_URL: "postgresql://user:pw@localhost:5432/db",
};

function stubBase() {
  for (const [key, value] of Object.entries(BASE_ENV)) vi.stubEnv(key, value);
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  stubBase();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("serverEnv", () => {
  it("E6 — throws naming all three when the three are empty", async () => {
    vi.stubEnv("SSO_JWT_SECRET", "");
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");
    const { serverEnv } = await import("./env");

    expect(() => serverEnv()).toThrowError(/SSO_JWT_SECRET.*ADMIN_SESSION_SECRET.*CRON_SECRET/s);
  });

  it("E7 — parses without throwing or warning when all three meet the minimum", async () => {
    vi.stubEnv("SSO_JWT_SECRET", "s".repeat(32));
    vi.stubEnv("ADMIN_SESSION_SECRET", "a".repeat(32));
    vi.stubEnv("CRON_SECRET", "c".repeat(16));
    const { serverEnv } = await import("./env");

    expect(() => serverEnv()).not.toThrow();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("E7b — parses with CRON_SECRET absent (optional is absent, not empty)", async () => {
    vi.stubEnv("SSO_JWT_SECRET", "s".repeat(32));
    vi.stubEnv("ADMIN_SESSION_SECRET", "a".repeat(32));
    vi.stubEnv("CRON_SECRET", undefined);
    const { serverEnv } = await import("./env");

    expect(() => serverEnv()).not.toThrow();
  });

  it("R7 — warns exactly once per module instance, even across two failing calls", async () => {
    vi.stubEnv("SSO_JWT_SECRET", "");
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");
    const { serverEnv } = await import("./env");

    expect(() => serverEnv()).toThrow();
    expect(() => serverEnv()).toThrow();
    expect(console.warn).toHaveBeenCalledTimes(1);

    // A fresh module instance sees the failure again — the silence is per
    // instance, not a global effect of the spy.
    vi.resetModules();
    const { serverEnv: serverEnvAgain } = await import("./env");
    expect(() => serverEnvAgain()).toThrow();
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it("R8 — the logged line is plain text, never an Error, and never puts the smoke stage in the red", async () => {
    vi.stubEnv("SSO_JWT_SECRET", "");
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");
    const { serverEnv } = await import("./env");

    expect(() => serverEnv()).toThrow();

    expect(console.warn).toHaveBeenCalledTimes(1);
    const [line] = vi.mocked(console.warn).mock.calls[0];
    expect(typeof line).toBe("string");
    expect(line).not.toBeInstanceOf(Error);
    expect(line).toContain("[env]");
    expect(line).toContain("Invalid server environment");
    // .agent/verify.sh:295 and :380 fail the smoke stage on (⨯|Unhandled|Error:)
    // in the dev server's output.
    expect(line).not.toContain("⨯");
    expect(line).not.toContain("Unhandled");
    expect(line).not.toContain("Error:");
  });

  it("drift — the schema minimums the generator must replicate stay at 32/32/16", async () => {
    // Values one byte under each minimum must fail; at the minimum, pass.
    vi.stubEnv("SSO_JWT_SECRET", "s".repeat(31));
    vi.stubEnv("ADMIN_SESSION_SECRET", "a".repeat(32));
    vi.stubEnv("CRON_SECRET", "c".repeat(16));
    const { serverEnv } = await import("./env");
    expect(() => serverEnv()).toThrow(/SSO_JWT_SECRET/);

    vi.resetModules();
    vi.stubEnv("SSO_JWT_SECRET", "s".repeat(32));
    vi.stubEnv("ADMIN_SESSION_SECRET", "a".repeat(31));
    const { serverEnv: serverEnv2 } = await import("./env");
    expect(() => serverEnv2()).toThrow(/ADMIN_SESSION_SECRET/);

    vi.resetModules();
    vi.stubEnv("ADMIN_SESSION_SECRET", "a".repeat(32));
    vi.stubEnv("CRON_SECRET", "c".repeat(15));
    const { serverEnv: serverEnv3 } = await import("./env");
    expect(() => serverEnv3()).toThrow(/CRON_SECRET/);
  });
});
