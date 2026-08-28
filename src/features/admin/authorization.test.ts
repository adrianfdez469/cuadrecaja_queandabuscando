import { describe, expect, it } from "vitest";
import type { AdminSession } from "@/lib/auth/adminSession";
import { authorizeBrandCoverage, authorizeStore, type CoverageBranch } from "./authorization";

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

describe("authorizeBrandCoverage() (F-011 tanda 3, HD16/R42)", () => {
  const centro: CoverageBranch = {
    id: "store-centro",
    name: "El Trébol · Centro",
    city: "La Habana",
  };
  const playa: CoverageBranch = { id: "store-playa", name: "El Trébol · Playa", city: "La Habana" };

  it("authorizes when every branch is in session.storeIds", () => {
    const s = session(["store-centro", "store-playa"]);
    const result = authorizeBrandCoverage(s, {
      storefrontId: "brand-1",
      branches: [centro, playa],
    });
    expect(result).toEqual({ ok: true, storefrontId: "brand-1" });
  });

  it("denies FORBIDDEN when a single branch is missing, naming it without a storeId", () => {
    const s = session(["store-centro"]);
    const result = authorizeBrandCoverage(s, {
      storefrontId: "brand-1",
      branches: [centro, playa],
    });
    expect(result).toEqual({
      ok: false,
      denial: "FORBIDDEN",
      missing: [{ name: "El Trébol · Playa", city: "La Habana" }],
    });
    if (!result.ok) {
      for (const entry of result.missing) {
        expect(entry).not.toHaveProperty("id");
      }
    }
  });

  it("authorizes a brand with no renderable branch yet — coverage of an empty list is trivially met", () => {
    const s = session([]);
    const result = authorizeBrandCoverage(s, { storefrontId: "brand-1", branches: [] });
    expect(result).toEqual({ ok: true, storefrontId: "brand-1" });
  });

  it("does not depend on the order of session.storeIds or of branches", () => {
    const s = session(["store-playa", "store-centro"]);
    const result = authorizeBrandCoverage(s, {
      storefrontId: "brand-1",
      branches: [playa, centro],
    });
    expect(result).toEqual({ ok: true, storefrontId: "brand-1" });
  });
});
