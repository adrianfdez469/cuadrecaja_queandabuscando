import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const expireProposalsQuery = vi.fn();

vi.mock("@/features/orders/server/expiry", () => ({
  expireProposalsQuery: (...args: unknown[]) => expireProposalsQuery(...args),
}));

const { GET } = await import("./route");

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function request(authorization: string | null) {
  const headers: Record<string, string> = {};
  if (authorization !== null) headers.authorization = authorization;
  return new Request("http://localhost/api/crons/expire-proposals", { headers });
}

beforeEach(() => {
  process.env.CRON_SECRET = "s3cr3t";
  expireProposalsQuery.mockReset().mockResolvedValue(3);
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

describe("GET /api/crons/expire-proposals", () => {
  it("401 without the right bearer, never touching the sweep", async () => {
    const response = await GET(request(null));
    expect(response.status).toBe(401);
    expect(expireProposalsQuery).not.toHaveBeenCalled();
  });

  it("runs the sweep with NO businessId (every business) and reports the count", async () => {
    const response = await GET(request("Bearer s3cr3t"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ expired: 3 });
    expect(expireProposalsQuery).toHaveBeenCalledWith();
  });
});
