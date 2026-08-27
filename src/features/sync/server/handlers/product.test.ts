import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Criterio 3, escrito por primera vez: `handleProduct` de `UPDATE` no toca
 * los seis campos del panel. Hasta este cambio la invariante solo vivía en
 * un comentario (`product.ts:83-86`) y no tenía ninguna prueba
 * (`find src/features/sync -name "*.test.ts"` solo listaba `inbox.test.ts`).
 */

const storeFindUnique = vi.fn();
const storeProductFindUnique = vi.fn();
const storeProductUpdate = vi.fn();
const canonicalProductFindUnique = vi.fn();
const localCategoryFindUnique = vi.fn();
const productAliasFindUnique = vi.fn();
const productAliasUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findUnique: (...a: unknown[]) => storeFindUnique(...a) },
    storeProduct: {
      findUnique: (...a: unknown[]) => storeProductFindUnique(...a),
      update: (...a: unknown[]) => storeProductUpdate(...a),
    },
    canonicalProduct: { findUnique: (...a: unknown[]) => canonicalProductFindUnique(...a) },
    localCategory: { findUnique: (...a: unknown[]) => localCategoryFindUnique(...a) },
    productAlias: {
      findUnique: (...a: unknown[]) => productAliasFindUnique(...a),
      update: (...a: unknown[]) => productAliasUpdate(...a),
    },
  },
}));

const { handleProduct } = await import("./product");

function payload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    storeProductId: "seed-tienda-1-p0",
    productId: "seed-producto-0",
    businessId: "seed-negocio-1",
    storeId: "seed-tienda-1",
    localName: "Refresco de cola 1.5 L",
    barcode: "7501031311309",
    localCategoryId: null,
    price: 499,
    currency: "CUP",
    canonicalProductId: "canon-1",
    imageUrl: null,
    publishToStore: true,
    updatedAt: "2026-08-26T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  storeFindUnique.mockReset().mockResolvedValue({
    id: "store-1",
    slug: null,
    businessId: "business-1",
    storefront: { slug: "tienda-demo", stores: [{ id: "store-1" }] },
  });
  storeProductFindUnique.mockReset().mockResolvedValue({
    id: "product-1",
    sourceUpdatedAt: new Date("2026-08-26T00:00:00.000Z"), // older than the payload
    canonicalProductId: "canon-1",
  });
  storeProductUpdate.mockReset().mockResolvedValue({ id: "product-1" });
  canonicalProductFindUnique.mockReset().mockResolvedValue({ id: "canon-1" });
  localCategoryFindUnique.mockReset().mockResolvedValue(null);
  productAliasFindUnique.mockReset().mockResolvedValue({ id: "alias-1" });
  productAliasUpdate.mockReset().mockResolvedValue({ id: "alias-1" });
});

const PANEL_COLUMNS = [
  "description",
  "imageUrls",
  "priceOverride",
  "priceOverrideCurrency",
  "visible",
  "featured",
];

describe("handleProduct() UPDATE", () => {
  it("changes syncedPrice but never touches any of the six panel-owned fields", async () => {
    const outcome = await handleProduct(payload({ price: 499 }), "UPDATE");

    expect(outcome.status).toBe("processed");
    expect(storeProductUpdate).toHaveBeenCalledOnce();

    const data = storeProductUpdate.mock.calls[0][0].data;
    expect(data.syncedPrice).toBe("499.00");
    for (const column of PANEL_COLUMNS) {
      expect(Object.keys(data)).not.toContain(column);
    }
  });

  it("is idempotent: a second call with the same payload is stale, not reapplied", async () => {
    // The second delivery arrives with a payload timestamp equal to what is
    // already stored — the stale-write guard, not the panel fields, is what
    // makes retries safe.
    storeProductFindUnique.mockResolvedValue({
      id: "product-1",
      sourceUpdatedAt: new Date("2026-08-26T12:00:00.000Z"),
      canonicalProductId: "canon-1",
    });

    const outcome = await handleProduct(payload(), "UPDATE");

    expect(outcome.status).toBe("stale");
    expect(storeProductUpdate).not.toHaveBeenCalled();
  });
});
