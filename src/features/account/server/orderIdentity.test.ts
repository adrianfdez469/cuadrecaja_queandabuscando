import { beforeEach, describe, expect, it, vi } from "vitest";

const hasCustomerSessionCookie = vi.fn();
const getCustomerUser = vi.fn();
const findCustomerIdByUserId = vi.fn();

vi.mock("@/lib/auth/customerSession", () => ({
  hasCustomerSessionCookie: (...args: unknown[]) => hasCustomerSessionCookie(...args),
  getCustomerUser: (...args: unknown[]) => getCustomerUser(...args),
}));

vi.mock("./customers", () => ({
  findCustomerIdByUserId: (...args: unknown[]) => findCustomerIdByUserId(...args),
}));

const { resolveOrderCustomerId } = await import("./orderIdentity");

const USER = { id: "u1", email: "ana@x.cu", fullName: "Ana Pérez" };

beforeEach(() => {
  hasCustomerSessionCookie.mockReset();
  getCustomerUser.mockReset();
  findCustomerIdByUserId.mockReset();
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
