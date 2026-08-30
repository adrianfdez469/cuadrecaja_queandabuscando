import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyEmailOtp = vi.fn();
const ensureCustomerForUser = vi.fn();

vi.mock("@/lib/auth/customerSession", () => ({
  verifyEmailOtp: (...args: unknown[]) => verifyEmailOtp(...args),
}));

vi.mock("@/features/account/server/customers", () => ({
  ensureCustomerForUser: (...args: unknown[]) => ensureCustomerForUser(...args),
}));

const { POST } = await import("./route");

const URL_VERIFY = "http://localhost/api/account/otp/verify";

function post(body: unknown) {
  return POST(
    new Request(URL_VERIFY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const USER = { id: "u1", email: "ana@x.cu", fullName: "Ana Pérez" };
const PROFILE = { name: "Ana Pérez", phone: null, email: "ana@x.cu" };

beforeEach(() => {
  verifyEmailOtp.mockReset().mockResolvedValue({ ok: true, user: USER });
  ensureCustomerForUser.mockReset().mockResolvedValue(PROFILE);
});

describe("POST /api/account/otp/verify (E1, E5)", () => {
  it("200 { signedIn: true, profile } y crea el Customer del primer login", async () => {
    const response = await post({ email: "ana@x.cu", token: "123456" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ signedIn: true, profile: PROFILE });
    expect(verifyEmailOtp).toHaveBeenCalledWith("ana@x.cu", "123456");
    expect(ensureCustomerForUser).toHaveBeenCalledWith(USER);
  });

  it("400 INVALID_BODY con un token que no son 6 dígitos", async () => {
    const response = await post({ email: "ana@x.cu", token: "12a45" });
    expect(response.status).toBe(400);
    expect(ensureCustomerForUser).not.toHaveBeenCalled();
  });

  it("401 OTP_REJECTED con el reason del servidor (E21)", async () => {
    verifyEmailOtp.mockResolvedValue({ ok: false, reason: "invalid" });
    const response = await post({ email: "ana@x.cu", token: "000000" });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "OTP_REJECTED", reason: "invalid" });
    expect(ensureCustomerForUser).not.toHaveBeenCalled();
  });

  it("401 OTP_REJECTED con reason email_not_confirmed (E22)", async () => {
    verifyEmailOtp.mockResolvedValue({ ok: false, reason: "email_not_confirmed" });
    const response = await post({ email: "ana@x.cu", token: "000000" });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "OTP_REJECTED",
      reason: "email_not_confirmed",
    });
  });

  it("503 AUTH_UNAVAILABLE cuando Auth no está configurado (criterio 6)", async () => {
    verifyEmailOtp.mockResolvedValue({ ok: false, reason: "not_configured" });
    const response = await post({ email: "ana@x.cu", token: "000000" });
    expect(response.status).toBe(503);
  });
});
