import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-035 (architecture.md § AD3, "Lo único que queda equivocable"). Two
 * fixtures from the seed drive the two things that are easy to get wrong
 * when the `status: { not: "DRAFT" }` filter does not live in the NESTED
 * `where`:
 *
 * - `el-trebol` (R6): a `DRAFT` branch with no `Store.slug` of its own must
 *   never reach `canonicalSlug()` — if it did, it would throw, and the whole
 *   `EXCHANGE_RATE`/`CURRENCY` event would land in `failed[]`.
 * - `bodega-central` (R4): a brand with exactly ONE renderable branch must
 *   resolve to the BRAND's own slug, never the branch's own `Store.slug` —
 *   it is the one repo fixture where both possible answers are live slugs,
 *   so only an exact-equality assertion tells the correct count from the
 *   wrong one.
 *
 * `expandBrandRevalidation` (the real, unmocked function) does the actual
 * conversion — this file only proves the QUERY feeds it the right shape.
 */

const storefrontFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    storefront: {
      findMany: (...a: unknown[]) => storefrontFindMany(...a),
    },
  },
}));

const { createRenderableBranchLookup } = await import("./businessBranches");

beforeEach(() => {
  storefrontFindMany.mockReset();
});

describe("createRenderableBranchLookup() — the query (AD3)", () => {
  it("el-trebol: a DRAFT branch without its own slug is excluded and the event does not throw (R6, E9)", async () => {
    storefrontFindMany.mockResolvedValue([
      {
        slug: "el-trebol",
        stores: [{ slug: "el-trebol-centro" }, { slug: "el-trebol-playa" }],
      },
    ]);

    const lookup = createRenderableBranchLookup();
    const result = await lookup("business-1");

    expect(result).toEqual(["el-trebol-centro", "el-trebol-playa"]);
    expect(storefrontFindMany).toHaveBeenCalledExactlyOnceWith({
      where: { businessId: "business-1" },
      select: {
        slug: true,
        stores: { where: { status: { not: "DRAFT" } }, select: { slug: true } },
      },
    });
  });

  it("bodega-central: a brand with exactly one renderable branch resolves to the BRAND's own slug, never the branch's (R4)", async () => {
    // `bodega-central-vedado` is the branch's OWN `Store.slug`
    // (`prisma/seed.ts`) — the wrong implementation returns it instead of
    // the brand's `bodega-central`, and both are live slugs, so only an
    // exact match catches the miscount.
    storefrontFindMany.mockResolvedValue([
      { slug: "bodega-central", stores: [{ slug: "bodega-central-vedado" }] },
    ]);

    const lookup = createRenderableBranchLookup();
    const result = await lookup("business-1");

    expect(result).toEqual(["bodega-central"]);
  });

  it("zero brands resolves to an empty set, not a throw (E5)", async () => {
    storefrontFindMany.mockResolvedValue([]);

    const lookup = createRenderableBranchLookup();
    const result = await lookup("business-1");

    expect(result).toEqual([]);
  });
});

describe("createRenderableBranchLookup() — the memo (AD1)", () => {
  it("one findMany per batch: two calls for the same business share the same in-flight query", async () => {
    storefrontFindMany.mockResolvedValue([]);

    const lookup = createRenderableBranchLookup();
    await Promise.all([lookup("business-1"), lookup("business-1")]);

    expect(storefrontFindMany).toHaveBeenCalledOnce();
  });

  it("a rejected query deletes its own entry: the next call retries instead of inheriting the rejection", async () => {
    storefrontFindMany.mockRejectedValueOnce(new Error("connection dropped"));
    storefrontFindMany.mockResolvedValueOnce([]);

    const lookup = createRenderableBranchLookup();

    await expect(lookup("business-1")).rejects.toThrow("connection dropped");
    await expect(lookup("business-1")).resolves.toEqual([]);
    expect(storefrontFindMany).toHaveBeenCalledTimes(2);
  });

  it("two different businesses never share an entry", async () => {
    storefrontFindMany
      .mockResolvedValueOnce([{ slug: "negocio-uno", stores: [{ slug: null }] }])
      .mockResolvedValueOnce([{ slug: "negocio-dos", stores: [{ slug: null }] }]);

    const lookup = createRenderableBranchLookup();
    const [first, second] = await Promise.all([lookup("business-1"), lookup("business-2")]);

    expect(first).toEqual(["negocio-uno"]);
    expect(second).toEqual(["negocio-dos"]);
    expect(storefrontFindMany).toHaveBeenCalledTimes(2);
  });
});
