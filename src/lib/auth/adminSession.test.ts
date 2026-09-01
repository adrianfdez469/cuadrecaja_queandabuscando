import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The opaque path E5 closes: `getAdminSession()` calls `secret()`, which
 * calls `serverEnv()`, inside a `try { … } catch { return null; }`. Today
 * that swallows the throw entirely — `/admin` redirects exactly like a
 * missing session. This file does NOT touch src/lib/auth/adminSession.ts
 * (F-008 is closed); the trace it asserts on is logged upstream, inside
 * `serverEnv()` itself.
 *
 * `.test.ts` runs in the `server` (node) vitest project, not `ui` (jsdom):
 * jsdom installs its own Uint8Array and jose's `instanceof` checks fail
 * against it (AGENTS.md § Cosas que muerden).
 */

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getAdminSession — the opaque path", () => {
  it("E5 — with the three secrets empty, returns null AND logs the invalid-environment line", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:pw@localhost:5432/db");
    vi.stubEnv("SSO_JWT_SECRET", "");
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");

    const { cookies } = await import("next/headers");
    // A cookie has to be PRESENT, or getAdminSession() returns null before
    // ever reaching secret() and this case would pass without testing
    // anything.
    vi.mocked(cookies).mockResolvedValue({
      get: () => ({ value: "some-token" }),
    } as unknown as Awaited<ReturnType<typeof cookies>>);

    const { getAdminSession } = await import("./adminSession");
    const result = await getAdminSession();

    expect(result).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
    const [line] = vi.mocked(console.warn).mock.calls[0];
    expect(line).toContain("Invalid server environment");
  });

  it("with valid secrets and an unreadable cookie, returns null and logs nothing", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:pw@localhost:5432/db");
    vi.stubEnv("SSO_JWT_SECRET", "s".repeat(32));
    vi.stubEnv("ADMIN_SESSION_SECRET", "a".repeat(32));
    vi.stubEnv("CRON_SECRET", "c".repeat(16));

    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: () => ({ value: "not-a-jwt" }),
    } as unknown as Awaited<ReturnType<typeof cookies>>);

    const { getAdminSession } = await import("./adminSession");
    const result = await getAdminSession();

    expect(result).toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
  });
});
