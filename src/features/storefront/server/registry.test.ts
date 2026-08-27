import { beforeEach, describe, expect, it, vi } from "vitest";

const slugFindUnique = vi.fn();
const storefrontCreate = vi.fn();
const storeCount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    slug: { findUnique: (...a: unknown[]) => slugFindUnique(...a) },
    storefront: { create: (...a: unknown[]) => storefrontCreate(...a) },
    store: { count: (...a: unknown[]) => storeCount(...a) },
  },
}));

const { createStorefrontWithStore, previewSlug } = await import("./registry");

function storeData() {
  return {
    businessId: "business-1",
    externalId: "seed-tienda-x",
    name: "La Rampa · Nueva",
    status: "PUBLISHED" as const,
    sourceOptIn: true,
    sourceUpdatedAt: new Date("2026-08-27T00:00:00.000Z"),
  };
}

beforeEach(() => {
  slugFindUnique.mockReset().mockResolvedValue(null);
  storefrontCreate.mockReset();
  storeCount.mockReset().mockResolvedValue(0);
});

describe("createStorefrontWithStore() — criterio 8, E9, E14, E16", () => {
  it("rejects a RESERVED proposed slug with ZERO queries (criterio 8)", async () => {
    const result = await createStorefrontWithStore({
      businessId: "business-1",
      brandName: "Admin S.A.",
      proposedSlug: "admin",
      derivedFrom: "Admin S.A.",
      store: storeData(),
    });

    expect(result).toEqual({ ok: false, error: "RESERVED_SLUG" });
    expect(slugFindUnique).not.toHaveBeenCalled();
    expect(storefrontCreate).not.toHaveBeenCalled();
  });

  it("rejects a malformed proposed slug with zero queries", async () => {
    const result = await createStorefrontWithStore({
      businessId: "business-1",
      brandName: "Weird",
      proposedSlug: "Not Valid!",
      derivedFrom: "Weird",
      store: storeData(),
    });

    expect(result).toEqual({ ok: false, error: "INVALID_SLUG" });
    expect(storefrontCreate).not.toHaveBeenCalled();
  });

  it("creates the brand and its first store in one nested write (E9)", async () => {
    storefrontCreate.mockResolvedValue({
      id: "storefront-1",
      slug: "la-rampa-nueva",
      stores: [{ id: "store-1" }],
    });

    const result = await createStorefrontWithStore({
      businessId: "business-1",
      brandName: "La Rampa · Nueva",
      proposedSlug: null,
      derivedFrom: "La Rampa · Nueva",
      store: storeData(),
    });

    expect(result).toEqual({
      ok: true,
      storefrontId: "storefront-1",
      storeId: "store-1",
      canonicalSlug: "la-rampa-nueva",
    });
    expect(storefrontCreate).toHaveBeenCalledOnce();
    const call = storefrontCreate.mock.calls[0][0];
    expect(call.data.slug).toBe("la-rampa-nueva");
    expect(call.data.slugEntry).toEqual({
      create: { value: "la-rampa-nueva", kind: "STOREFRONT" },
    });
    expect(call.data.stores).toEqual({ create: storeData() });
  });

  it("derives a disguised slug for a reserved name, never fails the event (E14)", async () => {
    storefrontCreate.mockResolvedValue({
      id: "storefront-1",
      slug: "admin-tienda",
      stores: [{ id: "store-1" }],
    });

    const result = await createStorefrontWithStore({
      businessId: "business-1",
      brandName: "Admin",
      proposedSlug: null,
      derivedFrom: "Admin",
      store: storeData(),
    });

    expect(result).toEqual({
      ok: true,
      storefrontId: "storefront-1",
      storeId: "store-1",
      canonicalSlug: "admin-tienda",
    });
  });

  it("retries a derived slug on a P2002 collision instead of failing the event (E14)", async () => {
    slugFindUnique
      .mockResolvedValueOnce({ value: "la-rampa" }) // uniqueSlug()'s own taken-check finds it occupied
      .mockResolvedValueOnce(null); // second attempt after the retry is free
    storefrontCreate
      .mockRejectedValueOnce({ code: "P2002", meta: { target: ["value"] } })
      .mockResolvedValueOnce({
        id: "storefront-2",
        slug: "la-rampa-2",
        stores: [{ id: "store-2" }],
      });

    const result = await createStorefrontWithStore({
      businessId: "business-1",
      brandName: "La Rampa",
      proposedSlug: null,
      derivedFrom: "La Rampa",
      store: storeData(),
    });

    expect(result).toEqual({
      ok: true,
      storefrontId: "storefront-2",
      storeId: "store-2",
      canonicalSlug: "la-rampa-2",
    });
    expect(storefrontCreate).toHaveBeenCalledTimes(2);
  });

  it("rejects an explicit proposal that collides — never auto-suffixed", async () => {
    storefrontCreate.mockRejectedValue({ code: "P2002", meta: { target: ["slug"] } });

    const result = await createStorefrontWithStore({
      businessId: "business-1",
      brandName: "Tomada",
      proposedSlug: "tomada",
      derivedFrom: "Tomada",
      store: storeData(),
    });

    expect(result).toEqual({ ok: false, error: "SLUG_TAKEN" });
    expect(storefrontCreate).toHaveBeenCalledOnce();
  });
});

describe("previewSlug() — HS7", () => {
  it("reports free when nothing owns the candidate", async () => {
    slugFindUnique.mockResolvedValue(null);
    const result = await previewSlug({ slug: "la-rampa", name: null, storeExternalId: null });
    expect(result).toEqual({
      candidate: "la-rampa",
      available: true,
      reason: "free",
      resolvedSlug: "la-rampa",
      storeKnown: false,
    });
  });

  it("disguises a reserved word and forecasts the derived value", async () => {
    slugFindUnique.mockResolvedValue(null); // the disguised value is free
    const result = await previewSlug({ slug: "admin", name: null, storeExternalId: null });
    expect(result.reason).toBe("reserved");
    expect(result.available).toBe(false);
    expect(result.resolvedSlug).toBe("admin-tienda");
  });

  it("reports own when the caller's storeId already holds the value", async () => {
    slugFindUnique.mockResolvedValue({
      kind: "STORE",
      retiredAt: null,
      storefront: null,
      store: { externalId: "seed-tienda-1" },
    });
    const result = await previewSlug({
      slug: "tienda-demo",
      name: null,
      storeExternalId: "seed-tienda-1",
    });
    expect(result).toMatchObject({ available: true, reason: "own", resolvedSlug: "tienda-demo" });
  });

  it("reports taken and forecasts the next free slug when someone else owns it", async () => {
    slugFindUnique
      .mockResolvedValueOnce({
        kind: "STOREFRONT",
        retiredAt: null,
        storefront: { stores: [{ externalId: "seed-tienda-2" }] },
        store: null,
      })
      .mockResolvedValueOnce({ value: "tienda-demo" }) // uniqueSlug's taken-check on the base
      .mockResolvedValueOnce(null); // -2 is free
    const result = await previewSlug({
      slug: "tienda-demo",
      name: null,
      storeExternalId: "seed-tienda-1",
    });
    expect(result).toMatchObject({
      available: false,
      reason: "taken",
      resolvedSlug: "tienda-demo-2",
    });
  });

  it("reports retired and never returns the value to the pool (R13)", async () => {
    slugFindUnique
      .mockResolvedValueOnce({
        kind: "STOREFRONT",
        retiredAt: new Date(),
        storefront: null,
        store: null,
      })
      .mockResolvedValueOnce(null); // the fallback candidate is free
    const result = await previewSlug({ slug: "vieja-tienda", name: null, storeExternalId: null });
    expect(result).toMatchObject({ available: false, reason: "retired" });
  });

  it("reports invalid when nothing sluggable is given", async () => {
    slugFindUnique.mockResolvedValue(null);
    const result = await previewSlug({ slug: "¿?", name: null, storeExternalId: null });
    expect(result.reason).toBe("invalid");
  });
});
