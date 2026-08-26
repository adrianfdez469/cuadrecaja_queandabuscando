import { describe, expect, it } from "vitest";
import type { AdminSession } from "@/lib/auth/adminSession";
import { authorizeStore } from "./authorization";

function session(storeIds: string[]): AdminSession {
  return {
    adminUserId: "admin-1",
    externalId: "ext-1",
    name: "Ana",
    businessId: "biz-1",
    storeIds,
  };
}

describe("authorizeStore()", () => {
  it("denies UNAUTHORIZED when there is no session", () => {
    const result = authorizeStore(null, "store-a");
    expect(result).toEqual({ ok: false, denial: "UNAUTHORIZED" });
  });

  it("denies FORBIDDEN when the store is outside session.storeIds", () => {
    const result = authorizeStore(session(["store-a"]), "store-b");
    expect(result).toEqual({ ok: false, denial: "FORBIDDEN" });
  });

  it("authorizes a store present in session.storeIds", () => {
    const s = session(["store-a", "store-b"]);
    const result = authorizeStore(s, "store-a");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.storeId).toBe("store-a");
      expect(result.session).toBe(s);
    }
  });

  it("denies a non-existent store the same way as an owned one that isn't in storeIds", () => {
    // No database lookup happens here: membership is a pure set comparison.
    const result = authorizeStore(session(["store-a"]), "no-such-store");
    expect(result).toEqual({ ok: false, denial: "FORBIDDEN" });
  });
});
