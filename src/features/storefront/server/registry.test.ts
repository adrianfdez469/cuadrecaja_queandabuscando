import { beforeEach, describe, expect, it, vi } from "vitest";

const slugFindUnique = vi.fn();
const slugUpdate = vi.fn();
const slugCreate = vi.fn();
const storefrontCreate = vi.fn();
const storefrontDelete = vi.fn();
const storeCount = vi.fn();
const storeFindUnique = vi.fn();
const storeUpdate = vi.fn();
const transaction = vi.fn(async (writes: unknown[]) => writes);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    slug: {
      findUnique: (...a: unknown[]) => slugFindUnique(...a),
      update: (...a: unknown[]) => slugUpdate(...a),
      create: (...a: unknown[]) => slugCreate(...a),
    },
    storefront: {
      create: (...a: unknown[]) => storefrontCreate(...a),
      delete: (...a: unknown[]) => storefrontDelete(...a),
    },
    store: {
      count: (...a: unknown[]) => storeCount(...a),
      findUnique: (...a: unknown[]) => storeFindUnique(...a),
      update: (...a: unknown[]) => storeUpdate(...a),
    },
    $transaction: (...a: unknown[]) => transaction(...(a as [unknown[]])),
  },
}));

const { createStorefrontWithStore, previewSlug, regroupStoreIntoBrand } =
  await import("./registry");

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
  slugUpdate.mockReset();
  slugCreate.mockReset();
  storefrontCreate.mockReset();
  storefrontDelete.mockReset();
  storeCount.mockReset().mockResolvedValue(0);
  storeFindUnique.mockReset();
  storeUpdate.mockReset();
  transaction.mockReset().mockImplementation(async (writes: unknown[]) => writes);
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
    const result = await previewSlug({
      slug: "la-rampa",
      name: null,
      storeExternalId: null,
      businessId: "business-1",
    });
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
    const result = await previewSlug({
      slug: "admin",
      name: null,
      storeExternalId: null,
      businessId: "business-1",
    });
    expect(result.reason).toBe("reserved");
    expect(result.available).toBe(false);
    expect(result.resolvedSlug).toBe("admin-tienda");
  });

  it("reports own when the caller's storeId already holds the value", async () => {
    storeCount.mockResolvedValue(1); // seed-tienda-1 belongs to business-1
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
      businessId: "business-1",
    });
    expect(result).toMatchObject({ available: true, reason: "own", resolvedSlug: "tienda-demo" });
  });

  it("reports taken and forecasts the next free slug when someone else owns it", async () => {
    storeCount.mockResolvedValue(1); // seed-tienda-1 belongs to business-1
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
      businessId: "business-1",
    });
    expect(result).toMatchObject({
      available: false,
      reason: "taken",
      resolvedSlug: "tienda-demo-2",
    });
  });

  it("treats a storeExternalId owned by ANOTHER business as unknown (R10)", async () => {
    storeCount.mockResolvedValue(0); // seed-tienda-1 does not belong to business-2
    slugFindUnique
      .mockResolvedValueOnce({
        kind: "STORE",
        retiredAt: null,
        storefront: null,
        store: { externalId: "seed-tienda-1" },
      })
      .mockResolvedValueOnce(null); // -2 is free, for uniqueSlug's forecast
    const result = await previewSlug({
      slug: "tienda-demo",
      name: null,
      storeExternalId: "seed-tienda-1",
      businessId: "business-2",
    });
    expect(result).toMatchObject({ available: false, reason: "taken", storeKnown: false });
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
    const result = await previewSlug({
      slug: "vieja-tienda",
      name: null,
      storeExternalId: null,
      businessId: "business-1",
    });
    expect(result).toMatchObject({ available: false, reason: "retired" });
  });

  it("reports invalid when nothing sluggable is given", async () => {
    slugFindUnique.mockResolvedValue(null);
    const result = await previewSlug({
      slug: "¿?",
      name: null,
      storeExternalId: null,
      businessId: "business-1",
    });
    expect(result.reason).toBe("invalid");
  });
});

function primaryRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "store-a",
    name: "La Rampa · Vedado",
    businessId: "business-1",
    storefrontId: "sf-a",
    slug: null,
    // Default: A's brand has ONLY A, before this call — the common case.
    // Tests of a REPEAT grouping (the primary already multi-branch) pass a
    // `storefront.stores` override with more than one entry.
    storefront: { id: "sf-a", slug: "la-rampa", stores: [{ id: "store-a", slug: null }] },
    ...overrides,
  };
}

function joiningRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "store-b",
    businessId: "business-1",
    storefrontId: "sf-b",
    slug: null,
    storefront: { id: "sf-b", slug: "tienda-dos", stores: [{ id: "store-b" }] },
    ...overrides,
  };
}

function mockStores(primary: { id: string } | null, joining: { id: string } | null) {
  storeFindUnique.mockImplementation(({ where }: { where: { id: string } }) => {
    if (primary && where.id === primary.id) return primary;
    if (joining && where.id === joining.id) return joining;
    return null;
  });
}

describe("regroupStoreIntoBrand() — HS8, § Agrupar dos tiendas bajo una marca", () => {
  it("NOT_FOUND when either store vanished", async () => {
    mockStores(null, joiningRow());
    const result = await regroupStoreIntoBrand({
      primaryStoreId: "store-a",
      joiningStoreId: "store-b",
    });
    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("DIFFERENT_BUSINESS when the two stores belong to different businesses", async () => {
    mockStores(primaryRow(), joiningRow({ businessId: "business-2" }));
    const result = await regroupStoreIntoBrand({
      primaryStoreId: "store-a",
      joiningStoreId: "store-b",
    });
    expect(result).toEqual({ ok: false, error: "DIFFERENT_BUSINESS" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("ALREADY_IN_BRAND when both stores already share a storefront", async () => {
    mockStores(primaryRow(), joiningRow({ storefrontId: "sf-a" }));
    const result = await regroupStoreIntoBrand({
      primaryStoreId: "store-a",
      joiningStoreId: "store-b",
    });
    expect(result).toEqual({ ok: false, error: "ALREADY_IN_BRAND" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("single-branch joining store: reassigns its brand's slug, mints the primary's, deletes the emptied brand — in order", async () => {
    mockStores(primaryRow(), joiningRow());
    slugFindUnique.mockResolvedValue(null); // the primary's derived slug is free

    const result = await regroupStoreIntoBrand({
      primaryStoreId: "store-a",
      joiningStoreId: "store-b",
    });

    expect(result).toMatchObject({ ok: true, storefrontId: "sf-a" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.revalidate.canonicalSlugs).toEqual(["la-rampa", "la-rampa-vedado", "tienda-dos"]);
    expect(result.revalidate.brandSlugs).toEqual(["la-rampa"]);
    expect(result.revalidate.slugValues).toEqual(["la-rampa", "la-rampa-vedado", "tienda-dos"]);

    // Order: reassign B's brand slug BEFORE deleting B's now-empty brand
    // (architecture.md: otherwise the registry row loses its owner and the
    // URL 404s).
    expect(slugUpdate).toHaveBeenCalledWith({
      where: { value: "tienda-dos" },
      data: { kind: "STORE", storefrontId: null, storeId: "store-b" },
    });
    expect(storeUpdate).toHaveBeenCalledWith({
      where: { id: "store-b" },
      data: { slug: "tienda-dos", storefrontId: "sf-a" },
    });
    expect(storeUpdate).toHaveBeenCalledWith({
      where: { id: "store-a" },
      data: { slug: "la-rampa-vedado" },
    });
    expect(slugCreate).toHaveBeenCalledWith({
      data: { value: "la-rampa-vedado", kind: "STORE", storeId: "store-a" },
    });
    expect(storefrontDelete).toHaveBeenCalledWith({ where: { id: "sf-b" } });

    const slugUpdateCallOrder = slugUpdate.mock.invocationCallOrder[0];
    const deleteCallOrder = storefrontDelete.mock.invocationCallOrder[0];
    expect(slugUpdateCallOrder).toBeLessThan(deleteCallOrder);

    expect(transaction).toHaveBeenCalledOnce();
  });

  it("skips minting a slug for the primary when it already has its own (repeat grouping)", async () => {
    mockStores(primaryRow({ slug: "la-rampa-vedado" }), joiningRow());

    const result = await regroupStoreIntoBrand({
      primaryStoreId: "store-a",
      joiningStoreId: "store-b",
    });

    expect(result).toMatchObject({ ok: true });
    expect(storeUpdate).not.toHaveBeenCalledWith({
      where: { id: "store-a" },
      data: { slug: expect.anything() },
    });
    expect(slugCreate).not.toHaveBeenCalled();
  });

  it("joining an already multi-branch store only moves storefrontId — no Slug writes, its old brand survives", async () => {
    mockStores(
      primaryRow({ slug: "la-rampa-vedado" }),
      joiningRow({
        slug: "tienda-dos",
        storefront: {
          id: "sf-b",
          slug: "otra-marca",
          stores: [
            { id: "store-b", slug: "tienda-dos" },
            { id: "store-c", slug: "otra-sucursal" },
          ],
        },
      }),
    );

    const result = await regroupStoreIntoBrand({
      primaryStoreId: "store-a",
      joiningStoreId: "store-b",
    });

    expect(result).toMatchObject({ ok: true });
    expect(slugUpdate).not.toHaveBeenCalled();
    expect(slugCreate).not.toHaveBeenCalled();
    expect(storefrontDelete).not.toHaveBeenCalled();
    expect(storeUpdate).toHaveBeenCalledWith({
      where: { id: "store-b" },
      data: { storefrontId: "sf-a" },
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.revalidate.brandSlugs).toEqual(["la-rampa", "otra-marca"]);
    // The sibling LEFT BEHIND in B's old (still multi-branch, or not
    // anymore) brand: its resolution can change (e.g. branchCount dropping
    // to 1 flips its canonical from its own slug to the brand's), so its
    // slug tag has to be revalidated too, even though nothing wrote its row.
    expect(result.revalidate.canonicalSlugs).toContain("otra-sucursal");
    expect(result.revalidate.slugValues).toContain("otra-sucursal");
    // BUG (sdd-tester, [ALTA]): the OLD brand's OWN slug ("otra-marca") is
    // in `brandSlugs` (storefrontTag) but has to ALSO be in `slugValues`
    // (slugTag) — its cached `resolvePublicSlug("otra-marca")` result
    // changes (it just lost a member; if that drops it to exactly one, its
    // canonical becomes THIS string) even though no `Slug` row for it was
    // written. Missing this left a shrunk-to-one brand serving its stale
    // multi-branch selector forever — reported against a live repro by
    // `sdd-tester`, `tests.md` § Fallos encontrados #1.
    expect(result.revalidate.slugValues).toContain("otra-marca");
    expect(result.revalidate.canonicalSlugs).toContain("otra-marca");
  });

  it("three branches across two brands (sdd-tester's exact repro): revalidates the shrinking OLD brand's own slug AND the primary's PRE-EXISTING sibling", async () => {
    // Mirrors tests.md § Fallos encontrados #1 y #2, cargado en una sola
    // llamada: D (primary) YA tiene a B como sucursal (grupo shrink
    // primario, multi-branch desde antes) y E se une viniendo de su propia
    // marca de una sola sucursal.
    mockStores(
      primaryRow({
        id: "store-d",
        name: "Grupo Shrink Primary Test",
        storefrontId: "sf-d",
        slug: "grupo-shrink-primary",
        storefront: {
          id: "sf-d",
          slug: "grupo-shrink-primary",
          stores: [
            { id: "store-d", slug: "grupo-shrink-primary" },
            { id: "store-b", slug: "grupo-joining-test" },
          ],
        },
      }),
      joiningRow({
        id: "store-e",
        storefrontId: "sf-e",
        slug: null,
        storefront: {
          id: "sf-e",
          slug: "grupo-third-test",
          stores: [{ id: "store-e", slug: null }],
        },
      }),
    );

    const result = await regroupStoreIntoBrand({
      primaryStoreId: "store-d",
      joiningStoreId: "store-e",
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected ok");
    // BUG (sdd-tester, [ALTA], mismo origen): B ya estaba en la marca de D
    // ANTES de esta llamada — su propio slug ("grupo-joining-test") tiene
    // que revalidarse aunque esta escritura no le toque ni una fila, o su
    // `/sucursales` (y su resolución "branch" con `branches[]`) se queda
    // sin enterarse de que E se unió. `tests.md` § Fallos encontrados #2.
    expect(result.revalidate.slugValues).toContain("grupo-joining-test");
    expect(result.revalidate.canonicalSlugs).toContain("grupo-joining-test");
  });
});
