import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * HD10-HD15: fixes the semantics AP5/AP6 chose, so nobody "fixes" the
 * handler back into the bug it was written to avoid — a routine STORE event
 * (a phone number edit, say) silently reopening a store the admin closed
 * from the panel.
 *
 * F-017: `existing` now carries its brand (`storefront: { slug, stores }`),
 * because `touchedStoreSlug`/`touchedBrandSlug` are computed from it, and a
 * brand-new store (`!existing`) is created through the registry
 * (`createStorefrontWithStore`), which is why `prisma.storefront.create` and
 * `prisma.slug.findUnique` are mocked here too — the SAME `@/lib/prisma`
 * module `registry.ts` imports.
 */

const businessUpsert = vi.fn();
const storeFindUnique = vi.fn();
const storeUpdate = vi.fn();
const storefrontCreate = vi.fn();
const slugFindUnique = vi.fn();
const businessCount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    business: {
      upsert: (...a: unknown[]) => businessUpsert(...a),
      count: (...a: unknown[]) => businessCount(...a),
    },
    store: {
      findUnique: (...a: unknown[]) => storeFindUnique(...a),
      update: (...a: unknown[]) => storeUpdate(...a),
    },
    storefront: {
      create: (...a: unknown[]) => storefrontCreate(...a),
    },
    slug: {
      findUnique: (...a: unknown[]) => slugFindUnique(...a),
    },
  },
}));

const { handleStore } = await import("./store");

/** An `existing` row the way the handler's own select shapes it — a single
 *  branch of a single-branch brand, unless the test says otherwise. */
function existingStore(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "store-1",
    slug: null,
    sourceUpdatedAt: null,
    sourceOptIn: true,
    storefront: { slug: "tienda-demo", stores: [{ id: "store-1" }] },
    ...overrides,
  };
}

function payload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    storeId: "seed-tienda-1",
    businessId: "seed-negocio-1",
    businessName: "La Rampa",
    name: "La Rampa · Vedado",
    slug: "tienda-demo",
    publishToStore: true,
    baseCurrency: "CUP",
    updatedAt: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  businessUpsert.mockReset().mockResolvedValue({ id: "business-1" });
  storeFindUnique.mockReset();
  storeUpdate.mockReset().mockResolvedValue({ slug: "tienda-demo" });
  storefrontCreate.mockReset();
  slugFindUnique.mockReset().mockResolvedValue(null);
  businessCount.mockReset().mockResolvedValue(0);
});

describe("handleStore() — stale-write guard (AP6)", () => {
  it("discards an event older than what is already stored", async () => {
    storeFindUnique.mockResolvedValue(
      existingStore({ sourceUpdatedAt: new Date("2026-08-27T12:00:00.000Z") }),
    );

    const outcome = await handleStore(payload({ updatedAt: "2026-08-27T00:00:00.000Z" }), "UPDATE");

    expect(outcome.status).toBe("stale");
    expect(storeUpdate).not.toHaveBeenCalled();
  });

  it("applies an event newer than what is stored", async () => {
    storeFindUnique.mockResolvedValue(
      existingStore({ sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z") }),
    );

    const outcome = await handleStore(payload({ updatedAt: "2026-08-27T00:00:00.000Z" }), "UPDATE");

    expect(outcome.status).toBe("processed");
    expect(outcome.touchedStoreSlug).toBe("tienda-demo");
    expect(outcome.touchedBrandSlug).toBe("tienda-demo");
    expect(storeUpdate).toHaveBeenCalledOnce();
  });
});

describe("handleStore() — opt-in-only writes (AP5, option b)", () => {
  it("a real opt-in flip to unpublish suspends and records the reason", async () => {
    storeFindUnique.mockResolvedValue(existingStore({ sourceUpdatedAt: null, sourceOptIn: true }));

    await handleStore(
      payload({ publishToStore: false, unpublishReason: "Cerrado por reformas" }),
      "UPDATE",
    );

    const data = storeUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("SUSPENDED");
    expect(data.disabledReasonCode).toBeNull();
    expect(data.disabledMessage).toBe("Cerrado por reformas");
    expect(data.sourceOptIn).toBe(false);
  });

  it("a routine edit with the SAME publishToStore does not touch status or the disabled columns", async () => {
    // Exactly the scenario AP5 exists for: the admin closed this store from
    // the panel (VACATION), sourceOptIn never changed because the panel
    // does not own that column, and now the POS sends an unrelated edit.
    storeFindUnique.mockResolvedValue(
      existingStore({ sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z"), sourceOptIn: true }),
    );

    await handleStore(payload({ publishToStore: true, phone: "+5350000099" }), "UPDATE");

    const data = storeUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("disabledReasonCode");
    expect(data).not.toHaveProperty("disabledMessage");
    expect(data).not.toHaveProperty("disabledAt");
    expect(data).not.toHaveProperty("publishedAt");
    // The sync-owned fields still update.
    expect(data.phone).toBe("+5350000099");
    expect(data.sourceOptIn).toBe(true);
  });

  it("a real opt-in flip to publish clears the disabled columns", async () => {
    storeFindUnique.mockResolvedValue(
      existingStore({ sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z"), sourceOptIn: false }),
    );

    await handleStore(payload({ publishToStore: true }), "UPDATE");

    const data = storeUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("PUBLISHED");
    expect(data.disabledReasonCode).toBeNull();
    expect(data.disabledMessage).toBeNull();
    expect(data.disabledAt).toBeNull();
    expect(data.sourceOptIn).toBe(true);
  });

  it("a repeated unpublish (opt-in already false) does not rewrite the reason", async () => {
    storeFindUnique.mockResolvedValue(
      existingStore({ sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z"), sourceOptIn: false }),
    );

    await handleStore(payload({ publishToStore: false }), "UPDATE");

    const data = storeUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("disabledReasonCode");
  });

  it("DELETE is treated as an unpublish regardless of publishToStore", async () => {
    storeFindUnique.mockResolvedValue(existingStore({ sourceUpdatedAt: null, sourceOptIn: true }));

    await handleStore(payload({ publishToStore: true }), "DELETE");

    const data = storeUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("SUSPENDED");
    expect(data.sourceOptIn).toBe(false);
  });

  it("a brand-new store creates its brand in the SAME event (E9), PUBLISHED, sourceOptIn true", async () => {
    storeFindUnique.mockResolvedValue(null);
    storefrontCreate.mockResolvedValue({
      id: "storefront-1",
      slug: "tienda-demo",
      stores: [{ id: "store-1" }],
    });

    const outcome = await handleStore(payload(), "CREATE");

    expect(outcome.status).toBe("processed");
    expect(outcome.touchedStoreSlug).toBe("tienda-demo");
    expect(outcome.touchedBrandSlug).toBe("tienda-demo");
    const call = storefrontCreate.mock.calls[0][0];
    expect(call.data.slug).toBe("tienda-demo");
    expect(call.data.stores.create.status).toBe("PUBLISHED");
    expect(call.data.stores.create.sourceOptIn).toBe(true);
  });

  it("DELETE with no existing row is skipped, not an error", async () => {
    storeFindUnique.mockResolvedValue(null);

    const outcome = await handleStore(payload(), "DELETE");

    expect(outcome.status).toBe("skipped_not_published");
    expect(storeUpdate).not.toHaveBeenCalled();
  });
});

describe("handleStore() — F-017 ALTA #3 (tests.md § Fallos encontrados #3): a routine sync update in a multi-branch brand reports the brand + every sibling", () => {
  it("a routine name/city edit on one branch of a two-branch brand reports the brand's own slug AND the sibling's own slug", async () => {
    storeFindUnique.mockResolvedValue(
      existingStore({
        slug: "bodega-dos",
        sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z"),
        storefront: {
          slug: "bodega-uno",
          stores: [
            { id: "store-1", slug: "bodega-uno-2" },
            { id: "store-2", slug: "bodega-dos" },
          ],
        },
      }),
    );
    storeUpdate.mockResolvedValue({ slug: "bodega-dos" });

    const outcome = await handleStore(
      payload({
        updatedAt: "2026-08-27T00:00:00.000Z",
        name: "Bodega Dos RENOMBRADA",
        city: "Nueva ciudad",
      }),
      "UPDATE",
    );

    expect(outcome.status).toBe("processed");
    expect(outcome.touchedStoreSlug).toBe("bodega-dos");
    // The MISSING piece before this fix: the brand's own slug (the
    // selector every visitor of `/bodega-uno` reads) and the sibling's own
    // slug (`/bodega-uno-2/sucursales`) — neither has a `Slug`/`Store` row
    // written FOR IT by this event, so nothing else would ever bust their
    // cached resolution.
    expect(outcome.touchedSlugValues).toEqual(["bodega-uno", "bodega-uno-2", "bodega-dos"]);
  });

  it("the same routine edit while UNPUBLISHING (opt-out branch) also reports the brand + sibling", async () => {
    storeFindUnique.mockResolvedValue(
      existingStore({
        slug: "bodega-dos",
        sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z"),
        storefront: {
          slug: "bodega-uno",
          stores: [
            { id: "store-1", slug: "bodega-uno-2" },
            { id: "store-2", slug: "bodega-dos" },
          ],
        },
      }),
    );

    const outcome = await handleStore(payload({ publishToStore: false }), "UPDATE");

    expect(outcome.status).toBe("processed");
    expect(outcome.touchedSlugValues).toEqual(["bodega-uno", "bodega-uno-2", "bodega-dos"]);
  });

  it("does not report touchedSlugValues when the brand has a single branch — nothing about a selector exists to go stale", async () => {
    storeFindUnique.mockResolvedValue(
      existingStore({ sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z") }),
    );

    const outcome = await handleStore(payload({ updatedAt: "2026-08-27T00:00:00.000Z" }), "UPDATE");

    expect(outcome.touchedSlugValues).toBeUndefined();
  });
});
