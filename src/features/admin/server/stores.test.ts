import { beforeEach, describe, expect, it, vi } from "vitest";

const storeFindMany = vi.fn();
const storeFindUnique = vi.fn();
const storefrontFindUnique = vi.fn();
const previewSlug = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: {
      findMany: (...a: unknown[]) => storeFindMany(...a),
      findUnique: (...a: unknown[]) => storeFindUnique(...a),
    },
    storefront: {
      findUnique: (...a: unknown[]) => storefrontFindUnique(...a),
    },
  },
}));
vi.mock("@/features/storefront/server/registry", () => ({
  previewSlug: (...a: unknown[]) => previewSlug(...a),
}));

const { listBrandBranches, listGroupCandidates, previewGrouping } = await import("./stores");

beforeEach(() => {
  storeFindMany.mockReset();
  storeFindUnique.mockReset();
  storefrontFindUnique.mockReset();
  previewSlug.mockReset();
});

describe("listBrandBranches() — DP2/HS12", () => {
  it("never returns a storeId, even though the underlying query has one (I7)", async () => {
    storefrontFindUnique.mockResolvedValue({
      slug: "la-rampa",
      stores: [
        {
          name: "La Rampa · Vedado",
          city: "La Habana",
          slug: "la-rampa-vedado",
          status: "PUBLISHED",
        },
        {
          name: "La Rampa · Playa",
          city: "La Habana",
          slug: "tienda-dos",
          status: "SUSPENDED",
        },
      ],
    });

    const branches = await listBrandBranches("storefront-1");

    expect(branches).toEqual([
      {
        name: "La Rampa · Vedado",
        city: "La Habana",
        status: "PUBLISHED",
        canonicalSlug: "la-rampa-vedado",
      },
      {
        name: "La Rampa · Playa",
        city: "La Habana",
        status: "SUSPENDED",
        canonicalSlug: "tienda-dos",
      },
    ]);
    // The condition itself: no key on any returned object can be a storeId,
    // under any name a careless rename might give it.
    for (const branch of branches) {
      expect(Object.keys(branch)).toEqual(["name", "city", "status", "canonicalSlug"]);
    }
  });

  it("returns empty for an unknown storefront", async () => {
    storefrontFindUnique.mockResolvedValue(null);
    expect(await listBrandBranches("gone")).toEqual([]);
  });
});

describe("listGroupCandidates() — HS8, filtro por sesión/negocio/marca", () => {
  it("returns empty with an empty session (criterio 1 of F-011: never businessId alone)", async () => {
    const candidates = await listGroupCandidates({ storeIds: [] } as never, "store-a" as never);
    expect(candidates).toEqual([]);
    expect(storeFindMany).not.toHaveBeenCalled();
  });

  it("filters by session.storeIds AND businessId AND a different storefront", async () => {
    storeFindUnique.mockResolvedValue({ businessId: "biz-1", storefrontId: "sf-a" });
    storeFindMany.mockResolvedValue([
      {
        id: "store-b",
        name: "Bodega Dos",
        city: "La Habana",
        slug: "bodega-dos",
        storefront: { slug: "bodega-dos", stores: [{ id: "store-b" }] },
      },
    ]);

    const candidates = await listGroupCandidates(
      { storeIds: ["store-a", "store-b"] } as never,
      "store-a" as never,
    );

    expect(storeFindMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        id: { in: ["store-a", "store-b"], not: "store-a" },
        businessId: "biz-1",
        storefrontId: { not: "sf-a" },
      },
      select: expect.anything(),
      orderBy: { name: "asc" },
    });
    expect(candidates).toEqual([
      { id: "store-b", name: "Bodega Dos", city: "La Habana", canonicalSlug: "bodega-dos" },
    ]);
  });
});

describe("previewGrouping() — DP5, la vista previa usa previewSlug()", () => {
  it("mints a new branch slug via previewSlug() when the primary has none yet", async () => {
    storeFindUnique.mockResolvedValue({
      name: "La Rampa · Vedado",
      slug: null,
      storefront: { slug: "la-rampa" },
    });
    previewSlug.mockResolvedValue({ resolvedSlug: "la-rampa-vedado" });

    const preview = await previewGrouping("store-a" as never);

    expect(preview).toEqual({
      primaryBrandSlug: "la-rampa",
      primaryBranchSlug: "la-rampa-vedado",
      primaryBranchAlreadyExists: false,
    });
    expect(previewSlug).toHaveBeenCalledExactlyOnceWith({
      slug: null,
      name: "La Rampa · Vedado",
      storeExternalId: null,
    });
  });

  it("reports the EXISTING slug (never mints) when the primary already has one — a live alias, or a repeat grouping", async () => {
    storeFindUnique.mockResolvedValue({
      name: "Bodega Central · Vedado",
      slug: "bodega-central-vedado",
      storefront: { slug: "bodega-central" },
    });

    const preview = await previewGrouping("store-a" as never);

    expect(preview).toEqual({
      primaryBrandSlug: "bodega-central",
      primaryBranchSlug: "bodega-central-vedado",
      primaryBranchAlreadyExists: true,
    });
    expect(previewSlug).not.toHaveBeenCalled();
  });

  it("returns null when the store vanished between the guard and this read", async () => {
    storeFindUnique.mockResolvedValue(null);
    expect(await previewGrouping("gone" as never)).toBeNull();
  });
});
