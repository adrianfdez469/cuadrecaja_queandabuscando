import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hasCustomerSessionCookie = vi.fn();
const getCustomerUser = vi.fn();
const findCustomerIdByUserId = vi.fn();
const isSupabaseAuthConfigured = vi.fn();

vi.mock("@/lib/auth/customerSession", () => ({
  hasCustomerSessionCookie: (...args: unknown[]) => hasCustomerSessionCookie(...args),
  getCustomerUser: (...args: unknown[]) => getCustomerUser(...args),
}));

vi.mock("./customers", () => ({
  findCustomerIdByUserId: (...args: unknown[]) => findCustomerIdByUserId(...args),
}));

vi.mock("@/lib/supabase/config", () => ({
  isSupabaseAuthConfigured: (...args: unknown[]) => isSupabaseAuthConfigured(...args),
}));

const { resolveOrderCustomerId } = await import("./orderIdentity");

const USER = { id: "u1", email: "ana@x.cu", fullName: "Ana Pérez" };

beforeEach(() => {
  hasCustomerSessionCookie.mockReset();
  getCustomerUser.mockReset();
  findCustomerIdByUserId.mockReset();
  // Left unconfigured (undefined -> falsy) by default: the six tests below
  // this line never set it, so they keep exercising the "Auth not
  // configured" branch exactly like before F-030, with no observer created
  // and no console.warn call — that is what keeps them green untouched.
  isSupabaseAuthConfigured.mockReset();
});

describe("resolveOrderCustomerId() (D6, R14, architecture.md § DA2)", () => {
  it("no cookie: resolves to null with 0 network calls (guest pays nothing)", async () => {
    hasCustomerSessionCookie.mockResolvedValue(false);
    const id = await resolveOrderCustomerId();
    expect(id).toBeNull();
    expect(getCustomerUser).not.toHaveBeenCalled();
    expect(findCustomerIdByUserId).not.toHaveBeenCalled();
  });

  it("with a valid session: resolves to the Customer.id (E28)", async () => {
    hasCustomerSessionCookie.mockResolvedValue(true);
    getCustomerUser.mockResolvedValue(USER);
    findCustomerIdByUserId.mockResolvedValue("customer-1");

    const id = await resolveOrderCustomerId();
    expect(id).toBe("customer-1");
    expect(findCustomerIdByUserId).toHaveBeenCalledWith("u1");
  });

  it("cookie present but the session cannot be verified: resolves to null (E17)", async () => {
    hasCustomerSessionCookie.mockResolvedValue(true);
    getCustomerUser.mockResolvedValue(null);

    const id = await resolveOrderCustomerId();
    expect(id).toBeNull();
    expect(findCustomerIdByUserId).not.toHaveBeenCalled();
  });

  it("NEVER rejects, even if the lookup throws", async () => {
    hasCustomerSessionCookie.mockResolvedValue(true);
    getCustomerUser.mockRejectedValue(new Error("boom"));

    await expect(resolveOrderCustomerId()).resolves.toBeNull();
  });

  it("NEVER rejects, even if hasCustomerSessionCookie itself throws", async () => {
    hasCustomerSessionCookie.mockRejectedValue(new Error("boom"));
    await expect(resolveOrderCustomerId()).resolves.toBeNull();
  });

  it("resolves to null if the lookup takes longer than the timeout, without waiting for it", async () => {
    hasCustomerSessionCookie.mockResolvedValue(true);
    getCustomerUser.mockImplementation(() => new Promise(() => {})); // never resolves

    const started = Date.now();
    const id = await resolveOrderCustomerId();
    const elapsedMs = Date.now() - started;

    expect(id).toBeNull();
    // Comfortably under a second — the real ceiling is 600 ms.
    expect(elapsedMs).toBeLessThan(1000);
  });
});

describe("resolveOrderCustomerId() customer link observation (F-030, spec.md § Mitad determinista)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("guest (no cookie): resolves to null with 0 console.* calls and 0 calls to Auth/Prisma", async () => {
    hasCustomerSessionCookie.mockResolvedValue(false);

    const id = await resolveOrderCustomerId();

    expect(id).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(getCustomerUser).not.toHaveBeenCalled();
    expect(findCustomerIdByUserId).not.toHaveBeenCalled();
  });

  it("normal link, under the threshold: resolves to the Customer.id with 0 console.* calls", async () => {
    hasCustomerSessionCookie.mockResolvedValue(true);
    isSupabaseAuthConfigured.mockReturnValue(true);
    getCustomerUser.mockResolvedValue(USER);
    findCustomerIdByUserId.mockResolvedValue("customer-1");

    const id = await resolveOrderCustomerId();

    expect(id).toBe("customer-1");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("`slow`: links past ORDER_CUSTOMER_LINK_SLOW_MS but under the ceiling", async () => {
    hasCustomerSessionCookie.mockResolvedValue(true);
    isSupabaseAuthConfigured.mockReturnValue(true);
    getCustomerUser.mockImplementation(
      () => new Promise((resolvePromise) => setTimeout(() => resolvePromise(USER), 320)),
    );
    findCustomerIdByUserId.mockResolvedValue("customer-1");

    const id = await resolveOrderCustomerId();

    expect(id).toBe("customer-1");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [prefix, fields] = warnSpy.mock.calls[0]!;
    expect(prefix).toBe("[orders] customer link");
    expect(fields).toMatchObject({ outcome: "slow", ceilingMs: 600 });
    expect((fields as { elapsedMs: number }).elapsedMs).toBeGreaterThanOrEqual(300);
  });

  it("`timeout`: the lookup never resolves, so the ceiling wins the race", async () => {
    hasCustomerSessionCookie.mockResolvedValue(true);
    isSupabaseAuthConfigured.mockReturnValue(true);
    getCustomerUser.mockImplementation(() => new Promise(() => {})); // never resolves

    const id = await resolveOrderCustomerId();

    expect(id).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [prefix, fields] = warnSpy.mock.calls[0]!;
    expect(prefix).toBe("[orders] customer link");
    expect(fields).toMatchObject({ outcome: "timeout", ceilingMs: 600 });
    expect((fields as { elapsedMs: number }).elapsedMs).toBeGreaterThanOrEqual(600);
  });

  it("`late`: the losing branch settles after the ceiling, and reports how late it was", async () => {
    hasCustomerSessionCookie.mockResolvedValue(true);
    isSupabaseAuthConfigured.mockReturnValue(true);
    getCustomerUser.mockImplementation(
      () => new Promise((resolvePromise) => setTimeout(() => resolvePromise(USER), 650)),
    );
    findCustomerIdByUserId.mockResolvedValue("customer-1");

    const id = await resolveOrderCustomerId();

    expect(id).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![1]).toMatchObject({ outcome: "timeout", ceilingMs: 600 });

    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(2), { timeout: 1000 });
    const [prefix, fields] = warnSpy.mock.calls[1]!;
    expect(prefix).toBe("[orders] customer link");
    expect(fields).toMatchObject({ outcome: "late", ceilingMs: 600, resolved: true });
    expect((fields as { lateMs: number }).lateMs).toBeGreaterThan(0);
  });

  it("`unverified`: there was a cookie and Auth is configured, but no identity came back", async () => {
    hasCustomerSessionCookie.mockResolvedValue(true);
    isSupabaseAuthConfigured.mockReturnValue(true);
    getCustomerUser.mockResolvedValue(null);

    const id = await resolveOrderCustomerId();

    expect(id).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![1]).toMatchObject({ outcome: "unverified", ceilingMs: 600 });
  });

  it("`no_customer`: identity verified but there is no matching Customer row", async () => {
    hasCustomerSessionCookie.mockResolvedValue(true);
    isSupabaseAuthConfigured.mockReturnValue(true);
    getCustomerUser.mockResolvedValue(USER);
    findCustomerIdByUserId.mockResolvedValue(null);

    const id = await resolveOrderCustomerId();

    expect(id).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![1]).toMatchObject({ outcome: "no_customer", ceilingMs: 600 });
  });

  it("`error`: the lookup rejects, and the line carries neither the message nor the exception", async () => {
    hasCustomerSessionCookie.mockResolvedValue(true);
    isSupabaseAuthConfigured.mockReturnValue(true);
    getCustomerUser.mockResolvedValue(USER);
    findCustomerIdByUserId.mockRejectedValue(new Error("boom, Customer.id abc123"));

    const id = await resolveOrderCustomerId();

    expect(id).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [prefix, fields] = warnSpy.mock.calls[0]!;
    expect(prefix).toBe("[orders] customer link");
    expect(fields).toMatchObject({ outcome: "error", ceilingMs: 600 });
    expect(Object.keys(fields as object).sort()).toEqual(["ceilingMs", "elapsedMs", "outcome"]);
    expect(JSON.stringify(fields)).not.toMatch(/boom|abc123/);
  });

  it("Auth not configured: resolves to null with 0 console.* calls, even with a cookie", async () => {
    hasCustomerSessionCookie.mockResolvedValue(true);
    isSupabaseAuthConfigured.mockReturnValue(false);
    getCustomerUser.mockResolvedValue(null);

    const id = await resolveOrderCustomerId();

    expect(id).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
