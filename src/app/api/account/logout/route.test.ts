import { beforeEach, describe, expect, it, vi } from "vitest";

const signOutCustomer = vi.fn();

vi.mock("@/lib/auth/customerSession", () => ({
  signOutCustomer: (...args: unknown[]) => signOutCustomer(...args),
}));

const { POST } = await import("./route");

beforeEach(() => {
  signOutCustomer.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/account/logout (E4, E18)", () => {
  it("cierra la sesión y redirige 303 a /", async () => {
    const response = await POST(
      new Request("http://localhost/api/account/logout", { method: "POST" }),
    );
    expect(signOutCustomer).toHaveBeenCalledOnce();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
