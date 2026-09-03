import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const update = vi.fn();
const storeUpdate = vi.fn();
const storeFindUnique = vi.fn();
const storeProductCount = vi.fn();
const localCategoryCount = vi.fn();
const promotionFindFirst = vi.fn();
const promotionCreate = vi.fn();
const promotionUpdate = vi.fn();
const promotionDelete = vi.fn();
const revalidateStores = vi.fn();
const revalidateStorefronts = vi.fn();
const revalidateSlugs = vi.fn();
const uploadStoreObjects = vi.fn();
const removeStoreObjects = vi.fn();
const storefrontFindUnique = vi.fn();
const storefrontUpdate = vi.fn();
const regroupStoreIntoBrand = vi.fn();
const reindexStoreProductMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    storeProduct: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      update: (...a: unknown[]) => update(...a),
      count: (...a: unknown[]) => storeProductCount(...a),
    },
    localCategory: {
      count: (...a: unknown[]) => localCategoryCount(...a),
    },
    store: {
      update: (...a: unknown[]) => storeUpdate(...a),
      findUnique: (...a: unknown[]) => storeFindUnique(...a),
    },
    storefront: {
      findUnique: (...a: unknown[]) => storefrontFindUnique(...a),
      update: (...a: unknown[]) => storefrontUpdate(...a),
    },
    promotion: {
      findFirst: (...a: unknown[]) => promotionFindFirst(...a),
      create: (...a: unknown[]) => promotionCreate(...a),
      update: (...a: unknown[]) => promotionUpdate(...a),
      delete: (...a: unknown[]) => promotionDelete(...a),
    },
  },
}));
vi.mock("@/lib/cache", () => ({
  revalidateStores: (...a: unknown[]) => revalidateStores(...a),
  revalidateStorefronts: (...a: unknown[]) => revalidateStorefronts(...a),
  revalidateSlugs: (...a: unknown[]) => revalidateSlugs(...a),
}));
const FAKE_BUCKET_PREFIX = "https://bucket/";
vi.mock("@/lib/supabase/storage", () => ({
  uploadStoreObjects: (...a: unknown[]) => uploadStoreObjects(...a),
  removeStoreObjects: (...a: unknown[]) => removeStoreObjects(...a),
  // Real enough to round-trip with the REAL (unmocked) `deriveImageVariants`:
  // `appendProductImage` builds a URL with `publicUrlFor`, feeds it straight
  // back through `deriveImageVariants`, and needs `objectPathOf` to invert it.
  publicUrlFor: (path: string) => `${FAKE_BUCKET_PREFIX}${path}`,
  objectPathOf: (url: string) =>
    url.startsWith(FAKE_BUCKET_PREFIX) ? url.slice(FAKE_BUCKET_PREFIX.length) : null,
}));
vi.mock("@/features/storefront/server/registry", async (importOriginal) => {
  // `expandBrandTouch` is pure (no Prisma, no I/O) — keep the REAL
  // implementation so this file exercises the same funnel production code
  // does, and only stub the one export that touches the database.
  const actual = await importOriginal<typeof import("@/features/storefront/server/registry")>();
  return {
    ...actual,
    regroupStoreIntoBrand: (...a: unknown[]) => regroupStoreIntoBrand(...a),
  };
});
// F-021: the store's own reindexer is mocked as a unit here — the SQL it
// runs (W3) is only verifiable against Postgres, in
// `src/features/catalog/server/search.db.test.ts`. This file only holds the
// line on whether `saveProduct` calls it, once, after its own typed update.
vi.mock("@/features/catalog/server/searchIndex", () => ({
  reindexStoreProduct: (...a: unknown[]) => reindexStoreProductMock(...a),
}));

const {
  saveProduct,
  appendProductImage,
  setStoreEnabled,
  saveBrandTheme,
  createPromotion,
  updatePromotion,
  deletePromotion,
  groupStoreIntoBrand,
} = await import("./mutations");
const { expandBrandRevalidation } = await import("@/features/storefront/server/registry");

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "product-1",
    slug: "producto-1",
    localName: "Producto 1",
    localCategory: null,
    availability: "AVAILABLE",
    syncedAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
    syncedPrice: "10.00",
    syncedPriceCurrency: "USD",
    description: null,
    imageUrls: [],
    priceOverride: null,
    priceOverrideCurrency: null,
    visible: true,
    featured: false,
    ...overrides,
  };
}

beforeEach(() => {
  findFirst.mockReset();
  update.mockReset();
  storeUpdate.mockReset();
  storeFindUnique.mockReset();
  storeProductCount.mockReset();
  localCategoryCount.mockReset();
  promotionFindFirst.mockReset();
  promotionCreate.mockReset();
  promotionUpdate.mockReset();
  promotionDelete.mockReset();
  revalidateStores.mockReset();
  revalidateStorefronts.mockReset();
  revalidateSlugs.mockReset();
  uploadStoreObjects.mockReset();
  removeStoreObjects.mockReset().mockResolvedValue({ ok: true, removed: 0 });
  storefrontFindUnique.mockReset();
  storefrontUpdate.mockReset();
  regroupStoreIntoBrand.mockReset();
  reindexStoreProductMock.mockReset().mockResolvedValue(1);
});

const WRITE_BODY = {
  description: "Una descripción",
  imageUrls: [] as string[],
  priceOverride: "8.00",
  visible: true,
  featured: true,
};

describe("saveProduct()", () => {
  it("returns product_not_in_store and never revalidates when the row isn't found", async () => {
    findFirst.mockResolvedValue(null);
    const result = await saveProduct("store-1" as never, "product-1", WRITE_BODY);
    expect(result).toEqual({ kind: "product_not_in_store" });
    expect(update).not.toHaveBeenCalled();
    expect(revalidateStores).not.toHaveBeenCalled();
  });

  it("returns product_deleted for a soft-deleted row and never writes", async () => {
    findFirst.mockResolvedValue({
      id: "product-1",
      deletedAt: new Date(),
      syncedPriceCurrency: "USD",
      store: { slug: null, storefront: { slug: "tienda-demo", stores: [{ id: "store-1" }] } },
    });
    const result = await saveProduct("store-1" as never, "product-1", WRITE_BODY);
    expect(result).toEqual({ kind: "product_deleted" });
    expect(update).not.toHaveBeenCalled();
  });

  it("saves and revalidates the product's own store slug", async () => {
    findFirst.mockResolvedValue({
      id: "product-1",
      deletedAt: null,
      syncedPriceCurrency: "USD",
      imageUrls: [],
      store: { slug: null, storefront: { slug: "tienda-demo", stores: [{ id: "store-1" }] } },
    });
    update.mockResolvedValue(
      row({ description: "Una descripción", priceOverride: "8.00", priceOverrideCurrency: "USD" }),
    );

    const result = await saveProduct("store-1" as never, "product-1", WRITE_BODY);

    expect(result.kind).toBe("saved");
    expect(revalidateStores).toHaveBeenCalledExactlyOnceWith(["tienda-demo"]);
    // R14: priceOverrideCurrency is always the product's synced currency, never
    // accepted from the client.
    const data = update.mock.calls[0][0].data;
    expect(data.priceOverrideCurrency).toBe("USD");
  });

  it("clears both override columns when priceOverride is null (R14)", async () => {
    findFirst.mockResolvedValue({
      id: "product-1",
      deletedAt: null,
      syncedPriceCurrency: "USD",
      imageUrls: [],
      store: { slug: null, storefront: { slug: "tienda-demo", stores: [{ id: "store-1" }] } },
    });
    update.mockResolvedValue(row());

    await saveProduct("store-1" as never, "product-1", { ...WRITE_BODY, priceOverride: null });

    const data = update.mock.calls[0][0].data;
    expect(data.priceOverride).toBeNull();
    expect(data.priceOverrideCurrency).toBeNull();
  });

  it("F-021 (R3, E8): reindexes this offer's own search index once, after the typed update", async () => {
    findFirst.mockResolvedValue({
      id: "product-1",
      deletedAt: null,
      syncedPriceCurrency: "USD",
      imageUrls: [],
      store: { slug: null, storefront: { slug: "tienda-demo", stores: [{ id: "store-1" }] } },
    });
    update.mockResolvedValue(row());

    await saveProduct("store-1" as never, "product-1", WRITE_BODY);

    expect(reindexStoreProductMock).toHaveBeenCalledOnce();
    expect(reindexStoreProductMock).toHaveBeenCalledWith(expect.anything(), "product-1");
  });
});

/** A successful `EncodeResult` shaped exactly like the real encoder's:
 *  4 variants (two widths × two formats). */
function encodedFixture(warning?: "heavy_image") {
  return {
    ok: true as const,
    heaviestCardBytes: 100,
    warning,
    variants: [
      { width: 400, format: "avif" as const, contentType: "image/avif", bytes: Buffer.from("a") },
      { width: 400, format: "webp" as const, contentType: "image/webp", bytes: Buffer.from("b") },
      { width: 800, format: "avif" as const, contentType: "image/avif", bytes: Buffer.from("c") },
      { width: 800, format: "webp" as const, contentType: "image/webp", bytes: Buffer.from("d") },
    ],
  };
}

describe("appendProductImage() (F-023)", () => {
  const file = {
    bytes: Buffer.from("fake"),
    mime: "image/jpeg" as const,
    encoded: encodedFixture(),
  };

  it("uploads the original AND all four variants in one batch, pushes the original's url, and revalidates — in that order", async () => {
    uploadStoreObjects.mockImplementation(
      async (objects: { path: string; bytes: Buffer; contentType: string }[]) => ({
        ok: true,
        urls: objects.map((o) => `https://bucket/${o.path}`),
      }),
    );
    update.mockResolvedValue({ imageUrls: ["will be overwritten below"] });

    const result = await appendProductImage(
      "store-1" as never,
      "product-1",
      "tienda-demo" as never,
      file,
    );

    expect(uploadStoreObjects).toHaveBeenCalledOnce();
    const uploadedObjects = uploadStoreObjects.mock.calls[0][0] as { path: string }[];
    expect(uploadedObjects).toHaveLength(5);
    expect(uploadedObjects[0].path).toMatch(/\/original\.jpg$/);
    expect(
      uploadedObjects
        .slice(1)
        .map((o) => o.path)
        .sort(),
    ).toEqual(
      [
        uploadedObjects[0].path.replace("original.jpg", "w400.avif"),
        uploadedObjects[0].path.replace("original.jpg", "w400.webp"),
        uploadedObjects[0].path.replace("original.jpg", "w800.avif"),
        uploadedObjects[0].path.replace("original.jpg", "w800.webp"),
      ].sort(),
    );

    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error("unreachable");
    expect(result.value.url).toBe(`https://bucket/${uploadedObjects[0].path}`);
    expect(revalidateStores).toHaveBeenCalledExactlyOnceWith(["tienda-demo"]);
  });

  it("carries the E3 warning through when the encoder flagged a heavy card variant", async () => {
    uploadStoreObjects.mockResolvedValue({ ok: true, urls: [] });
    update.mockResolvedValue({ imageUrls: [] });

    const result = await appendProductImage(
      "store-1" as never,
      "product-1",
      "tienda-demo" as never,
      {
        ...file,
        encoded: encodedFixture("heavy_image"),
      },
    );

    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error("unreachable");
    expect(result.value.warning).toBe("heavy_image");
  });

  it("never writes or revalidates when Storage rejects the batch, and cleans up whatever DID land (R6/E2)", async () => {
    uploadStoreObjects.mockResolvedValue({
      ok: false,
      reason: "unreachable",
      uploadedPaths: ["stores/store-1/products/product-1/uuid/original.jpg"],
    });

    const result = await appendProductImage(
      "store-1" as never,
      "product-1",
      "tienda-demo" as never,
      file,
    );

    expect(result).toEqual({ kind: "storage_unavailable", reason: "unreachable" });
    expect(update).not.toHaveBeenCalled();
    expect(revalidateStores).not.toHaveBeenCalled();
    expect(removeStoreObjects).toHaveBeenCalledExactlyOnceWith([
      "stores/store-1/products/product-1/uuid/original.jpg",
    ]);
  });

  it("never calls removeStoreObjects when nothing landed before the failure", async () => {
    uploadStoreObjects.mockResolvedValue({ ok: false, reason: "unreachable", uploadedPaths: [] });

    await appendProductImage("store-1" as never, "product-1", "tienda-demo" as never, file);

    expect(removeStoreObjects).not.toHaveBeenCalled();
  });
});

describe("saveProduct() — purging removed images (F-023 R9/R14)", () => {
  // Real UUID v4 shape — `deriveImageVariants` requires it (R11's second
  // condition) to tell a F-023 directory image apart from a legacy one.
  const REMOVED_UUID = "b6f1c2a4-7e3d-4a10-9c2e-1f0a5d6e7b8c";
  const KEPT_UUID = "c7f2d3b5-8e4e-4b21-ad3f-2f1b6e7f8c9d";
  const REMOVED_URL = `https://bucket/stores/store-1/products/product-1/${REMOVED_UUID}/original.jpg`;
  const KEPT_URL = `https://bucket/stores/store-1/products/product-1/${KEPT_UUID}/original.jpg`;

  function existingRow(imageUrls: string[]) {
    return {
      id: "product-1",
      deletedAt: null,
      syncedPriceCurrency: "USD",
      imageUrls,
      store: { slug: null, storefront: { slug: "tienda-demo", stores: [{ id: "store-1" }] } },
    };
  }

  it("purges exactly the URLs (and their derived variants) that disappeared, AFTER commit", async () => {
    findFirst.mockResolvedValue(existingRow([REMOVED_URL, KEPT_URL]));
    update.mockResolvedValue(row({ imageUrls: [KEPT_URL] }));

    const callOrder: string[] = [];
    revalidateStores.mockImplementation(() => callOrder.push("revalidate"));
    removeStoreObjects.mockImplementation(async () => {
      callOrder.push("purge");
      return { ok: true, removed: 5 };
    });

    await saveProduct("store-1" as never, "product-1", { ...WRITE_BODY, imageUrls: [KEPT_URL] });

    expect(removeStoreObjects).toHaveBeenCalledOnce();
    const purgedKeys = removeStoreObjects.mock.calls[0][0] as string[];
    // The removed URL derives 5 keys (original + 4 variants); the kept one
    // contributes none.
    expect(purgedKeys).toHaveLength(5);
    expect(purgedKeys.every((k) => k.includes(REMOVED_UUID))).toBe(true);
    expect(callOrder).toEqual(["revalidate", "purge"]);
  });

  it("never calls removeStoreObjects when no URL was removed", async () => {
    findFirst.mockResolvedValue(existingRow([KEPT_URL]));
    update.mockResolvedValue(row({ imageUrls: [KEPT_URL] }));

    await saveProduct("store-1" as never, "product-1", { ...WRITE_BODY, imageUrls: [KEPT_URL] });

    expect(removeStoreObjects).not.toHaveBeenCalled();
  });
});

describe("setStoreEnabled()", () => {
  it("publishes and clears the disabled columns, then revalidates (HD10)", async () => {
    // F-022 R12: the `enabled: true` branch now reads `timezone` before
    // writing — a canonical value here is what lets the flip through,
    // exercising the gate rather than bypassing it (impl.md § Qué necesita
    // quien pruebe).
    storeFindUnique.mockResolvedValue({ timezone: "America/Havana" });
    storeUpdate.mockResolvedValue({
      id: "store-1",
      slug: null,
      storefront: { slug: "tienda-demo", stores: [{ id: "store-1" }] },
      status: "PUBLISHED",
      disabledReasonCode: null,
      disabledMessage: null,
      disabledAt: null,
    });

    const result = await setStoreEnabled("store-1" as never, { enabled: true });

    expect(result.kind).toBe("saved");
    const data = storeUpdate.mock.calls[0][0].data;
    expect(data).toEqual({
      status: "PUBLISHED",
      disabledReasonCode: null,
      disabledMessage: null,
      disabledAt: null,
    });
    expect(revalidateStores).toHaveBeenCalledExactlyOnceWith(["tienda-demo"]);
  });

  it("suspends with the chosen reason code and message, then revalidates", async () => {
    storeUpdate.mockResolvedValue({
      id: "store-1",
      slug: null,
      storefront: { slug: "tienda-demo", stores: [{ id: "store-1" }] },
      status: "SUSPENDED",
      disabledReasonCode: "VACACIONES",
      disabledMessage: "Volvemos el 5",
      disabledAt: new Date("2026-08-27T00:00:00.000Z"),
    });

    const result = await setStoreEnabled("store-1" as never, {
      enabled: false,
      reasonCode: "VACACIONES",
      message: "Volvemos el 5",
    });

    expect(result.kind).toBe("saved");
    const data = storeUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("SUSPENDED");
    expect(data.disabledReasonCode).toBe("VACACIONES");
    expect(data.disabledMessage).toBe("Volvemos el 5");
    expect(revalidateStores).toHaveBeenCalledExactlyOnceWith(["tienda-demo"]);
  });

  it("returns not_found and never revalidates when the row vanished (P2025)", async () => {
    // F-022: the timezone read must find a row (so this exercises the
    // UPDATE's own P2025, not the new "no row to read" early return, which
    // has its own case right below).
    storeFindUnique.mockResolvedValue({ timezone: "America/Havana" });
    storeUpdate.mockRejectedValue({ code: "P2025" });

    const result = await setStoreEnabled("store-1" as never, { enabled: true });

    expect(result).toEqual({ kind: "not_found" });
    expect(revalidateStores).not.toHaveBeenCalled();
  });

  it("F-022 E5: returns not_found when the row vanished BEFORE the timezone read itself", async () => {
    storeFindUnique.mockResolvedValue(null);

    const result = await setStoreEnabled("store-1" as never, { enabled: true });

    expect(result).toEqual({ kind: "not_found" });
    expect(storeUpdate).not.toHaveBeenCalled();
  });

  it("F-022 E5/R12: an unreadable timezone returns invalid_timezone and never writes", async () => {
    storeFindUnique.mockResolvedValue({ timezone: "Nowhere/Nothing" });

    const result = await setStoreEnabled("store-1" as never, { enabled: true });

    expect(result).toEqual({ kind: "invalid_timezone" });
    expect(storeUpdate).not.toHaveBeenCalled();
    expect(revalidateStores).not.toHaveBeenCalled();
  });

  it("F-022 E5: closing (enabled: false) never reads timezone and always works, even with an unreadable zone on file", async () => {
    storeFindUnique.mockResolvedValue({ timezone: "Nowhere/Nothing" });
    storeUpdate.mockResolvedValue({
      id: "store-1",
      slug: null,
      storefront: { slug: "tienda-demo", stores: [{ id: "store-1" }] },
      status: "SUSPENDED",
      disabledReasonCode: "VACACIONES",
      disabledMessage: "Volvemos el 5",
      disabledAt: new Date("2026-08-27T00:00:00.000Z"),
    });

    const result = await setStoreEnabled("store-1" as never, {
      enabled: false,
      reasonCode: "VACACIONES",
      message: "Volvemos el 5",
    });

    expect(result.kind).toBe("saved");
    expect(storeFindUnique).not.toHaveBeenCalled();
  });

  it("single-branch brand: never calls revalidateSlugs (nothing about a selector exists to go stale)", async () => {
    // F-022: without this, the `enabled: true` branch's timezone read
    // resolves `undefined` and returns `not_found` BEFORE reaching
    // `storeUpdate` — the assertion below would then pass vacuously, on a
    // call that never happened, rather than on the real single-branch path.
    storeFindUnique.mockResolvedValue({ timezone: "America/Havana" });
    storeUpdate.mockResolvedValue({
      id: "store-1",
      slug: null,
      storefront: { slug: "tienda-demo", stores: [{ id: "store-1", slug: null }] },
      status: "PUBLISHED",
      disabledReasonCode: null,
      disabledMessage: null,
      disabledAt: null,
    });

    await setStoreEnabled("store-1" as never, { enabled: true });

    expect(revalidateSlugs).not.toHaveBeenCalled();
  });

  it("multi-branch brand: a status flip revalidates the BRAND's slug and every sibling's own slug too — not only this store's own canonical", async () => {
    // The same "revalidar solo lo que escribí" gap `regroupStoreIntoBrand`
    // had: a status flip changes the Badge every cached selector page (and
    // every sibling's own `branches[]`) shows for THIS store, without
    // moving a single `Slug` row of its own.
    storeUpdate.mockResolvedValue({
      id: "store-1",
      slug: "la-rampa-vedado",
      storefront: {
        slug: "la-rampa",
        stores: [
          { id: "store-1", slug: "la-rampa-vedado" },
          { id: "store-2", slug: "la-rampa-playa" },
        ],
      },
      status: "SUSPENDED",
      disabledReasonCode: "VACACIONES",
      disabledMessage: "Volvemos el 5",
      disabledAt: new Date("2026-01-01T00:00:00Z"),
    });

    await setStoreEnabled("store-1" as never, {
      enabled: false,
      reasonCode: "VACACIONES",
      message: "Volvemos el 5",
    });

    expect(revalidateStores).toHaveBeenCalledExactlyOnceWith(["la-rampa-vedado"]);
    expect(revalidateSlugs).toHaveBeenCalledExactlyOnceWith([
      "la-rampa",
      "la-rampa-vedado",
      "la-rampa-playa",
    ]);
  });
});

const PROMOTION_BODY_PRODUCT = {
  name: "20% en bebidas",
  type: "PERCENTAGE" as const,
  scope: "PRODUCT" as const,
  value: "20",
  startsAt: "2026-01-01T00:00:00Z",
  endsAt: null,
  active: true,
  conditions: { storeProductIds: ["sp-1", "sp-2"] },
};

describe("createPromotion()", () => {
  it("creates and revalidates when every product id belongs to the store", async () => {
    storeFindUnique.mockResolvedValue({
      businessId: "biz-1",
      slug: null,
      storefront: { slug: "tienda-demo", stores: [{ id: "store-1" }] },
    });
    storeProductCount.mockResolvedValue(2);
    promotionCreate.mockResolvedValue({
      id: "promo-1",
      name: "20% en bebidas",
      type: "PERCENTAGE",
      scope: "PRODUCT",
      value: { toString: () => "20.00" },
      conditions: { storeProductIds: ["sp-1", "sp-2"] },
      startsAt: new Date("2026-01-01T00:00:00Z"),
      endsAt: null,
      active: true,
    });

    const result = await createPromotion("store-1" as never, PROMOTION_BODY_PRODUCT);

    expect(result.kind).toBe("created");
    expect(revalidateStores).toHaveBeenCalledExactlyOnceWith(["tienda-demo"]);
  });

  it("R30: rejects (400-shaped) when a product id belongs to another store, and never writes", async () => {
    storeFindUnique.mockResolvedValue({
      businessId: "biz-1",
      slug: null,
      storefront: { slug: "tienda-demo", stores: [{ id: "store-1" }] },
    });
    storeProductCount.mockResolvedValue(1); // only one of the two ids matched

    const result = await createPromotion("store-1" as never, PROMOTION_BODY_PRODUCT);

    expect(result.kind).toBe("invalid_conditions");
    expect(promotionCreate).not.toHaveBeenCalled();
    expect(revalidateStores).not.toHaveBeenCalled();
  });

  it("returns not_found when the authorized store vanished", async () => {
    storeFindUnique.mockResolvedValue(null);
    const result = await createPromotion("store-1" as never, PROMOTION_BODY_PRODUCT);
    expect(result).toEqual({ kind: "not_found" });
  });
});

describe("updatePromotion()", () => {
  it("returns promotion_not_in_store for a promotion of another store", async () => {
    promotionFindFirst.mockResolvedValue(null);
    const result = await updatePromotion("store-1" as never, "promo-1", PROMOTION_BODY_PRODUCT);
    expect(result).toEqual({ kind: "promotion_not_in_store" });
    expect(promotionUpdate).not.toHaveBeenCalled();
  });

  it("updates and revalidates when conditions are valid", async () => {
    promotionFindFirst.mockResolvedValue({
      id: "promo-1",
      store: {
        businessId: "biz-1",
        slug: null,
        storefront: { slug: "tienda-demo", stores: [{ id: "store-1" }] },
      },
    });
    storeProductCount.mockResolvedValue(2);
    promotionUpdate.mockResolvedValue({
      id: "promo-1",
      name: "20% en bebidas",
      type: "PERCENTAGE",
      scope: "PRODUCT",
      value: { toString: () => "20.00" },
      conditions: { storeProductIds: ["sp-1", "sp-2"] },
      startsAt: new Date("2026-01-01T00:00:00Z"),
      endsAt: null,
      active: true,
    });

    const result = await updatePromotion("store-1" as never, "promo-1", PROMOTION_BODY_PRODUCT);

    expect(result.kind).toBe("saved");
    expect(revalidateStores).toHaveBeenCalledExactlyOnceWith(["tienda-demo"]);
  });
});

describe("deletePromotion()", () => {
  it("returns promotion_not_in_store for a promotion of another store", async () => {
    promotionFindFirst.mockResolvedValue(null);
    const result = await deletePromotion("store-1" as never, "promo-1");
    expect(result).toEqual({ kind: "promotion_not_in_store" });
    expect(promotionDelete).not.toHaveBeenCalled();
  });

  it("deletes and revalidates when the promotion belongs to the store", async () => {
    promotionFindFirst.mockResolvedValue({
      id: "promo-1",
      store: { slug: null, storefront: { slug: "tienda-demo", stores: [{ id: "store-1" }] } },
    });
    promotionDelete.mockResolvedValue({});

    const result = await deletePromotion("store-1" as never, "promo-1");

    expect(result).toEqual({ kind: "saved", value: { id: "promo-1" } });
    expect(revalidateStores).toHaveBeenCalledExactlyOnceWith(["tienda-demo"]);
  });
});

describe("groupStoreIntoBrand() — HS8, etapa 2", () => {
  it("maps DIFFERENT_BUSINESS/ALREADY_IN_BRAND/NOT_FOUND straight through", async () => {
    regroupStoreIntoBrand.mockResolvedValueOnce({ ok: false, error: "DIFFERENT_BUSINESS" });
    expect(await groupStoreIntoBrand("store-a" as never, "store-b" as never)).toEqual({
      kind: "different_business",
    });

    regroupStoreIntoBrand.mockResolvedValueOnce({ ok: false, error: "ALREADY_IN_BRAND" });
    expect(await groupStoreIntoBrand("store-a" as never, "store-b" as never)).toEqual({
      kind: "already_in_brand",
    });

    regroupStoreIntoBrand.mockResolvedValueOnce({ ok: false, error: "NOT_FOUND" });
    expect(await groupStoreIntoBrand("store-a" as never, "store-b" as never)).toEqual({
      kind: "not_found",
    });

    expect(revalidateStores).not.toHaveBeenCalled();
  });

  it("on success, revalidates the three tag families and rereads the brand for the real URLs", async () => {
    regroupStoreIntoBrand.mockResolvedValue({
      ok: true,
      storefrontId: "sf-a",
      revalidate: {
        canonicalSlugs: ["la-rampa", "la-rampa-vedado", "tienda-dos"],
        brandSlugs: ["la-rampa"],
        slugValues: ["la-rampa", "la-rampa-vedado", "tienda-dos"],
      },
    });
    storefrontFindUnique.mockResolvedValue({
      slug: "la-rampa",
      stores: [
        { id: "store-a", slug: "la-rampa-vedado" },
        { id: "store-b", slug: "tienda-dos" },
      ],
    });

    const result = await groupStoreIntoBrand("store-a" as never, "store-b" as never);

    expect(revalidateStores).toHaveBeenCalledExactlyOnceWith([
      "la-rampa",
      "la-rampa-vedado",
      "tienda-dos",
    ]);
    expect(revalidateStorefronts).toHaveBeenCalledExactlyOnceWith(["la-rampa"]);
    expect(revalidateSlugs).toHaveBeenCalledExactlyOnceWith([
      "la-rampa",
      "la-rampa-vedado",
      "tienda-dos",
    ]);

    expect(result).toEqual({
      kind: "saved",
      value: {
        storefrontId: "sf-a",
        brandSlug: "la-rampa",
        branches: [
          { storeId: "store-a", slug: "la-rampa-vedado", url: "/la-rampa-vedado" },
          { storeId: "store-b", slug: "tienda-dos", url: "/tienda-dos" },
        ],
      },
    });
  });
});

describe("saveBrandTheme() — F-011 tanda 3 (R33-R36)", () => {
  it("revalidates ALL canonical slugs of the brand's renderable branches and the brand's own slug — never revalidateSlugs", async () => {
    storefrontUpdate.mockResolvedValue({
      id: "storefront-1",
      slug: "el-trebol",
      themeTokens: { brand: "#0f62fe" },
    });
    const touch = expandBrandRevalidation("el-trebol", [
      { slug: "el-trebol-centro" },
      { slug: "el-trebol-playa" },
    ]);

    const result = await saveBrandTheme("storefront-1" as never, touch, {
      brand: "#0f62fe",
    } as never);

    expect(storefrontUpdate).toHaveBeenCalledExactlyOnceWith({
      where: { id: "storefront-1" },
      data: { themeTokens: { brand: "#0f62fe" } },
      select: { id: true, slug: true, themeTokens: true },
    });
    expect(revalidateStores).toHaveBeenCalledExactlyOnceWith([
      "el-trebol-centro",
      "el-trebol-playa",
    ]);
    expect(revalidateStorefronts).toHaveBeenCalledExactlyOnceWith(["el-trebol"]);
    expect(revalidateSlugs).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: "saved",
      value: {
        storefrontId: "storefront-1",
        brandSlug: "el-trebol",
        themeTokens: { brand: "#0f62fe" },
        branchCount: 2,
      },
    });
  });

  it("maps a vanished storefront (P2025) to not_found, without revalidating anything", async () => {
    storefrontUpdate.mockRejectedValue({ code: "P2025" });
    const touch = expandBrandRevalidation("tienda-demo", [{ slug: null }]);

    const result = await saveBrandTheme("gone" as never, touch, {} as never);

    expect(result).toEqual({ kind: "not_found" });
    expect(revalidateStores).not.toHaveBeenCalled();
    expect(revalidateStorefronts).not.toHaveBeenCalled();
  });
});
