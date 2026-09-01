import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/lib/env.ts`'s `cached` lives at module scope, same trap
 * `src/lib/env.test.ts` documents: every case needs `vi.resetModules()` plus
 * a dynamic `import()`. The `server` project does not load `dotenv/config`,
 * so `vi.stubEnv` is the only source of environment here.
 */

const BASE_ENV = {
  DATABASE_URL: "postgresql://user:pw@localhost:5432/db",
  SSO_JWT_SECRET: "s".repeat(32),
  ADMIN_SESSION_SECRET: "a".repeat(32),
  NEXT_PUBLIC_SUPABASE_URL: "https://ref.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

function stubBase() {
  for (const [key, value] of Object.entries(BASE_ENV)) vi.stubEnv(key, value);
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
  stubBase();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("realtimeAvailability", () => {
  it("reason missing_supabase_url when NEXT_PUBLIC_SUPABASE_URL is absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const { realtimeAvailability } = await import("./broadcast");
    expect(realtimeAvailability()).toEqual({ ok: false, reason: "missing_supabase_url" });
  });

  it("reason missing_service_role_key when SUPABASE_SERVICE_ROLE_KEY is absent (I8: stays optional)", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", undefined);
    const { realtimeAvailability } = await import("./broadcast");
    expect(realtimeAvailability()).toEqual({ ok: false, reason: "missing_service_role_key" });
  });

  it("ok when both are present", async () => {
    const { realtimeAvailability } = await import("./broadcast");
    expect(realtimeAvailability()).toEqual({ ok: true });
  });
});

describe("broadcastBell — never rejects, always a discriminated result (R2)", () => {
  it("does not even attempt fetch when misconfigured, and logs the reason", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { broadcastBell } = await import("./broadcast");

    const result = await broadcastBell("biz-1");

    expect(result).toEqual({ ok: false, reason: "missing_supabase_url" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("DA1 — POSTs the exact broadcast URL, apikey and constant payload", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { broadcastBell } = await import("./broadcast");

    const result = await broadcastBell("9f3c1234");

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      "https://ref.supabase.co/realtime/v1/api/broadcast/negocio%3A9f3c1234/events/pedidos?private=true",
    );
    expect(init.method).toBe("POST");
    expect(init.headers.apikey).toBe("service-role-key");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ t: "pedidos" });
  });

  it("R1 — the body sent is byte-for-byte REALTIME_BELL_PAYLOAD, nothing derived from businessId", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { broadcastBell } = await import("./broadcast");
    const { REALTIME_BELL_PAYLOAD } = await import("@/constants/realtime");

    await broadcastBell("any-business-id-at-all");

    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual(REALTIME_BELL_PAYLOAD);
  });

  it("reason rejected on a non-2xx response, and never throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    const { broadcastBell } = await import("./broadcast");

    await expect(broadcastBell("biz-1")).resolves.toEqual({ ok: false, reason: "rejected" });
  });

  it("E5 — reason unreachable when fetch throws a network error (address that REJECTS)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const { broadcastBell } = await import("./broadcast");

    await expect(broadcastBell("biz-1")).resolves.toEqual({ ok: false, reason: "unreachable" });
  });

  it("E6 — reason timeout when the signal aborts (address that SWALLOWS the connection)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("The operation was aborted.", "TimeoutError")),
    );
    const { broadcastBell } = await import("./broadcast");

    await expect(broadcastBell("biz-1")).resolves.toEqual({ ok: false, reason: "timeout" });
  });

  it("R3 — passes an AbortSignal so the call cannot hang past REALTIME_BELL_EMIT_TIMEOUT_MS", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { broadcastBell } = await import("./broadcast");

    await broadcastBell("biz-1");

    const [, init] = fetchSpy.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("architecture.md DA2 — logs one line starting with [realtime], never the Error object", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const { broadcastBell } = await import("./broadcast");

    await broadcastBell("biz-1");

    expect(console.error).toHaveBeenCalledTimes(1);
    const [line, detail] = vi.mocked(console.error).mock.calls[0];
    expect(typeof line).toBe("string");
    expect(line).toMatch(/^\[realtime\]/);
    expect(line).not.toBeInstanceOf(Error);
    expect(detail).not.toBeInstanceOf(Error);
    // .agent/verify.sh's SERVIDOR_ERROR_RE guard trips on a line beginning
    // with an Error-shaped word — this must never be one.
    expect(line).not.toMatch(/^[A-Z][A-Za-z]*Error/);
  });
});
