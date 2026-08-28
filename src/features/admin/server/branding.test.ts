import { beforeEach, describe, expect, it, vi } from "vitest";

const storeFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: {
      findUnique: (...a: unknown[]) => storeFindUnique(...a),
    },
  },
}));

const { loadBrandingTarget } = await import("./branding");

beforeEach(() => {
  storeFindUnique.mockReset();
});

describe("loadBrandingTarget() — F-011 tanda 3 (R43)", () => {
  it("returns the brand's tokens and its renderable branches, filtering DRAFT", async () => {
    storeFindUnique.mockResolvedValue({
      name: "El Trébol · Centro",
      storefront: {
        id: "storefront-1",
        slug: "el-trebol",
        name: "El Trébol",
        themeTokens: { brand: "#0f62fe" },
        stores: [
          {
            id: "store-centro",
            name: "El Trébol · Centro",
            city: "La Habana",
            status: "PUBLISHED",
            slug: "el-trebol-centro",
          },
          {
            id: "store-playa",
            name: "El Trébol · Playa",
            city: "La Habana",
            status: "SUSPENDED",
            slug: "el-trebol-playa",
          },
        ],
      },
    });

    const target = await loadBrandingTarget("store-centro" as never);

    expect(target).toEqual({
      storeName: "El Trébol · Centro",
      storefrontId: "storefront-1",
      brandSlug: "el-trebol",
      brandName: "El Trébol",
      themeTokens: { brand: "#0f62fe" },
      branches: [
        {
          id: "store-centro",
          name: "El Trébol · Centro",
          city: "La Habana",
          status: "PUBLISHED",
          slug: "el-trebol-centro",
        },
        {
          id: "store-playa",
          name: "El Trébol · Playa",
          city: "La Habana",
          status: "SUSPENDED",
          slug: "el-trebol-playa",
        },
      ],
    });
    // The `where` on the nested `stores` filters DRAFT out — asserted by
    // construction: the mock above never returns a DRAFT row, and the call
    // itself is checked below to use the one, single, renderable filter.
    const call = storeFindUnique.mock.calls[0][0];
    expect(call.select.storefront.select.stores.where).toEqual({ status: { not: "DRAFT" } });
  });

  it("returns null when the store vanished between login and this read", async () => {
    storeFindUnique.mockResolvedValue(null);
    expect(await loadBrandingTarget("gone" as never)).toBeNull();
  });
});
