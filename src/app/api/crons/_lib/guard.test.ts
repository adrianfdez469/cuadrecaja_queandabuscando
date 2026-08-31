import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyCronSecret } from "./guard";

/**
 * Extracted from `purge-sso-tokens/route.ts` (F-019), used verbatim by both
 * cron routes now.
 */

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function request(authorization: string | null) {
  const headers: Record<string, string> = {};
  if (authorization !== null) headers.authorization = authorization;
  return new Request("http://localhost/api/crons/x", { headers });
}

beforeEach(() => {
  process.env.CRON_SECRET = "s3cr3t";
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

describe("verifyCronSecret()", () => {
  it("returns null (let the caller proceed) with the right bearer token", () => {
    expect(verifyCronSecret(request("Bearer s3cr3t"))).toBeNull();
  });

  it("401s when the header is missing", async () => {
    const response = verifyCronSecret(request(null));
    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({ error: "UNAUTHORIZED" });
  });

  it("401s when the token does not match", () => {
    expect(verifyCronSecret(request("Bearer wrong"))?.status).toBe(401);
  });

  it("401s when CRON_SECRET itself is not configured, even with a header present", () => {
    delete process.env.CRON_SECRET;
    expect(verifyCronSecret(request("Bearer s3cr3t"))?.status).toBe(401);
  });
});
