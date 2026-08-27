import { beforeEach, describe, expect, it, vi } from "vitest";

const slugFindUnique = vi.fn();
const storeFindUnique = vi.fn();
const storefrontFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    slug: { findUnique: (...a: unknown[]) => slugFindUnique(...a) },
    store: { findUnique: (...a: unknown[]) => storeFindUnique(...a) },
    storefront: { findUnique: (...a: unknown[]) => storefrontFindUnique(...a) },
  },
}));

// Same bypass cache.test.ts already uses: unstable_cache runs the loader
// immediately instead of actually caching, so these tests exercise the real
// resolution logic without a Next request context.
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));

const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));

const { resolvePublicSlug, requireResolution } = await import("./resolve");

beforeEach(() => {
  slugFindUnique.mockReset();
  storeFindUnique.mockReset();
  storefrontFindUnique.mockReset();
  notFound.mockClear();
});

function storefrontRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "storefront-1",
    slug: "la-rampa",
    name: "La Rampa",
    stores: [
      {
        id: "store-1",
        slug: null,
        name: "La Rampa · Vedado",
        city: "La Habana",
        address: "Calle 23",
        status: "PUBLISHED",
      },
    ],
    ...overrides,
  };
}

describe("resolvePublicSlug() — E1..E6, criterio 3", () => {
  it("null for a value not in the registry (E3)", async () => {
    slugFindUnique.mockResolvedValue(null);
    expect(await resolvePublicSlug("no-existe")).toBeNull();
  });

  it("null for a RETIRED value, never resolved (R13)", async () => {
    slugFindUnique.mockResolvedValue({
      kind: "STOREFRONT",
      retiredAt: new Date(),
      storefrontId: null,
      storeId: null,
    });
    expect(await resolvePublicSlug("vieja-marca")).toBeNull();
  });

  it("resolves a brand's own slug to its single branch, canonical = brand slug (E1)", async () => {
    slugFindUnique.mockResolvedValue({
      kind: "STOREFRONT",
      retiredAt: null,
      storefrontId: "storefront-1",
      storeId: null,
    });
    storefrontFindUnique.mockResolvedValue(storefrontRow());

    const resolution = await resolvePublicSlug("la-rampa");
    expect(resolution).toMatchObject({
      kind: "branch",
      storeId: "store-1",
      canonicalSlug: "la-rampa",
      brandSlug: "la-rampa",
      branchCount: 1,
      isAlias: false,
    });
  });

  it("resolves a live branch alias to the SAME canonical as the brand (criterio 3, E2)", async () => {
    slugFindUnique.mockResolvedValue({
      kind: "STORE",
      retiredAt: null,
      storefrontId: null,
      storeId: "store-1",
    });
    storeFindUnique.mockResolvedValue({ storefrontId: "storefront-1" });
    storefrontFindUnique.mockResolvedValue(
      storefrontRow({ stores: [{ ...storefrontRow().stores[0], slug: "bodega-central-vedado" }] }),
    );

    const resolution = await resolvePublicSlug("bodega-central-vedado");
    expect(resolution).toMatchObject({
      kind: "branch",
      canonicalSlug: "la-rampa",
      isAlias: true,
    });
  });

  it("null when the brand has zero renderable branches (E6)", async () => {
    slugFindUnique.mockResolvedValue({
      kind: "STOREFRONT",
      retiredAt: null,
      storefrontId: "storefront-1",
      storeId: null,
    });
    storefrontFindUnique.mockResolvedValue(storefrontRow({ stores: [] }));

    expect(await resolvePublicSlug("la-rampa")).toBeNull();
  });

  it("resolves a suspended single branch (E4) — the page decides what to render, not the resolver", async () => {
    slugFindUnique.mockResolvedValue({
      kind: "STOREFRONT",
      retiredAt: null,
      storefrontId: "storefront-1",
      storeId: null,
    });
    storefrontFindUnique.mockResolvedValue(
      storefrontRow({ stores: [{ ...storefrontRow().stores[0], status: "SUSPENDED" }] }),
    );

    const resolution = await resolvePublicSlug("la-rampa");
    expect(resolution).toMatchObject({ kind: "branch", branchCount: 1 });
  });

  it("null for a RESERVED value (never has an owner)", async () => {
    slugFindUnique.mockResolvedValue({
      kind: "RESERVED",
      retiredAt: null,
      storefrontId: null,
      storeId: null,
    });
    expect(await resolvePublicSlug("admin")).toBeNull();
  });
});

describe("requireResolution()", () => {
  it("throws Next's not-found boundary when there is no resolution", async () => {
    slugFindUnique.mockResolvedValue(null);
    await expect(requireResolution("no-existe")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("returns the resolution when there is one", async () => {
    slugFindUnique.mockResolvedValue({
      kind: "STOREFRONT",
      retiredAt: null,
      storefrontId: "storefront-1",
      storeId: null,
    });
    storefrontFindUnique.mockResolvedValue(storefrontRow());
    await expect(requireResolution("la-rampa")).resolves.toMatchObject({ kind: "branch" });
  });
});
