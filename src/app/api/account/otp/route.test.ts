import { beforeEach, describe, expect, it, vi } from "vitest";

const sendEmailOtp = vi.fn();

vi.mock("@/lib/auth/customerSession", () => ({
  sendEmailOtp: (...args: unknown[]) => sendEmailOtp(...args),
}));

const { POST } = await import("./route");

const URL_OTP = "http://localhost/api/account/otp";

function post(body: unknown, contentType = "application/json") {
  return POST(
    new Request(URL_OTP, {
      method: "POST",
      headers: { "content-type": contentType },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  sendEmailOtp.mockReset().mockResolvedValue({ ok: true });
});

describe("POST /api/account/otp (E1)", () => {
  it("responde 200 { sent: true } y llama a sendEmailOtp con el correo", async () => {
    const response = await post({ email: "ana@x.cu" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sent: true });
    expect(sendEmailOtp).toHaveBeenCalledWith("ana@x.cu");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("400 INVALID_BODY con un correo mal formado, sin llamar a Supabase", async () => {
    const response = await post({ email: "not-an-email" });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("INVALID_BODY");
    expect(sendEmailOtp).not.toHaveBeenCalled();
  });

  it("400 con un content-type distinto de application/json", async () => {
    const response = await post({ email: "ana@x.cu" }, "text/plain");
    expect(response.status).toBe(400);
  });

  it("429 RATE_LIMITED cuando Supabase reporta el límite de envíos (R5)", async () => {
    sendEmailOtp.mockResolvedValue({ ok: false, reason: "rate_limited" });
    const response = await post({ email: "ana@x.cu" });
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: "RATE_LIMITED" });
  });

  it("503 AUTH_UNAVAILABLE en cualquier otro fallo (E26)", async () => {
    sendEmailOtp.mockResolvedValue({ ok: false, reason: "not_configured" });
    const response = await post({ email: "ana@x.cu" });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "AUTH_UNAVAILABLE" });
  });
});
