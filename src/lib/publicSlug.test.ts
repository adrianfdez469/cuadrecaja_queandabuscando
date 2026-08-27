import { describe, expect, it } from "vitest";
import { canonicalSlug } from "./publicSlug";

/**
 * The corner F-017 depends on for correctness, not convenience: a branch
 * reachable by two URLs must resolve to the SAME canonical slug through
 * both paths, or one of the two goes stale forever (architecture.md § El
 * slug canónico).
 */
describe("canonicalSlug()", () => {
  it("is the brand's slug when the brand renders exactly one branch", () => {
    const canonical = canonicalSlug({
      storeSlug: null,
      brandSlug: "tienda-demo",
      brandBranchCount: 1,
    });
    expect(canonical).toBe("tienda-demo");
  });

  it("gives the SAME canonical for the brand slug and for a live branch alias", () => {
    // Two different "requested" values, one branch: both must land on the
    // one string the resolver, the sync and the panel all tag and cache with.
    const viaBrand = canonicalSlug({
      storeSlug: "bodega-central-vedado",
      brandSlug: "bodega-central",
      brandBranchCount: 1,
    });
    const viaBranchAlias = canonicalSlug({
      storeSlug: "bodega-central-vedado",
      brandSlug: "bodega-central",
      brandBranchCount: 1,
    });
    expect(viaBrand).toBe("bodega-central");
    expect(viaBrand).toBe(viaBranchAlias);
  });

  it("falls back to the branch's own slug once the brand groups more than one", () => {
    const canonical = canonicalSlug({
      storeSlug: "la-rampa-vedado",
      brandSlug: "la-rampa",
      brandBranchCount: 2,
    });
    expect(canonical).toBe("la-rampa-vedado");
  });

  it("refuses to invent a canonical for a multi-branch brand with no branch slug", () => {
    expect(() =>
      canonicalSlug({ storeSlug: null, brandSlug: "la-rampa", brandBranchCount: 2 }),
    ).toThrow();
  });
});
