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
const uploadStoreObject = vi.fn();
const storefrontFindUnique = vi.fn();
const regroupStoreIntoBrand = vi.fn();

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
vi.mock("@/lib/supabase/storage", () => ({
  uploadStoreObject: (...a: unknown[]) => uploadStoreObject(...a),
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

const {
  saveProduct,
  appendProductImage,
  setStoreEnabled,
  createPromotion,
  updatePromotion,
  deletePromotion,
  groupStoreIntoBrand,
} = await import("./mutations");

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
  uploadStoreObject.mockReset();
  storefrontFindUnique.mockReset();
  regroupStoreIntoBrand.mockReset();
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
      store: { slug: null, storefront: { slug: "tienda-demo", stores: [{ id: "store-1" }] } },
    });
    update.mockResolvedValue(row());

    await saveProduct("store-1" as never, "product-1", { ...WRITE_BODY, priceOverride: null });

    const data = update.mock.calls[0][0].data;
    expect(data.priceOverride).toBeNull();
    expect(data.priceOverrideCurrency).toBeNull();
  });
});

describe("appendProductImage()", () => {
  const file = { bytes: Buffer.from("fake"), mime: "image/jpeg" as const };

  it("uploads, pushes the url, and revalidates — in that order", async () => {
    uploadStoreObject.mockResolvedValue({ ok: true, url: "https://bucket/obj.jpg" });
    update.mockResolvedValue({ imageUrls: ["https://bucket/obj.jpg"] });

    const result = await appendProductImage(
      "store-1" as never,
      "product-1",
      "tienda-demo" as never,
      file,
    );

    expect(result).toEqual({
      kind: "created",
      value: { url: "https://bucket/obj.jpg", imageUrls: ["https://bucket/obj.jpg"] },
    });
    expect(revalidateStores).toHaveBeenCalledExactlyOnceWith(["tienda-demo"]);
  });

  it("never writes or revalidates when Storage rejects the upload", async () => {
    uploadStoreObject.mockResolvedValue({ ok: false, reason: "unreachable" });

    const result = await appendProductImage(
      "store-1" as never,
      "product-1",
      "tienda-demo" as never,
      file,
    );

    expect(result).toEqual({ kind: "storage_unavailable", reason: "unreachable" });
    expect(update).not.toHaveBeenCalled();
    expect(revalidateStores).not.toHaveBeenCalled();
  });
});

describe("setStoreEnabled()", () => {
  it("publishes and clears the disabled columns, then revalidates (HD10)", async () => {
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
    storeUpdate.mockRejectedValue({ code: "P2025" });

    const result = await setStoreEnabled("store-1" as never, { enabled: true });

    expect(result).toEqual({ kind: "not_found" });
    expect(revalidateStores).not.toHaveBeenCalled();
  });

  it("single-branch brand: never calls revalidateSlugs (nothing about a selector exists to go stale)", async () => {
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
