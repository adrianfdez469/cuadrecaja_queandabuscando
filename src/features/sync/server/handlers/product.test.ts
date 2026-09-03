import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSearchDocument } from "@/lib/canonical";
import { PANEL_PRODUCT_COLUMNS } from "@/constants/admin";

/**
 * Criterio 3, escrito por primera vez: `handleProduct` de `UPDATE` no toca
 * los seis campos del panel. Hasta este cambio la invariante solo vivía en
 * un comentario (`product.ts:83-86`) y no tenía ninguna prueba
 * (`find src/features/sync -name "*.test.ts"` solo listaba `inbox.test.ts`).
 *
 * F-015 (etapa 2, E1-E4): `writeSearchDocument` is mocked as a unit here —
 * the SQL it runs (W1, a real UPDATE against a real `tsvector`) is only
 * verifiable against Postgres, and that suite belongs to etapa 5
 * (`src/features/sync/server/handlers/product.db.test.ts`, not written by
 * this cycle). What IS a unit fact, and what these tests hold the line on:
 * whether `handleProduct` calls the writer at all, how many times, and with
 * which document.
 */

const storeFindUnique = vi.fn();
const storeProductFindUnique = vi.fn();
const storeProductUpdate = vi.fn();
const canonicalProductFindUnique = vi.fn();
const canonicalProductCreate = vi.fn();
const localCategoryFindUnique = vi.fn();
const productAliasFindUnique = vi.fn();
const productAliasUpdate = vi.fn();
const productAliasCreate = vi.fn();
const writeSearchDocumentMock = vi.fn();
const canonicalBarcodeCreateMany = vi.fn();
const reindexStoreProductsOfCanonicalMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findUnique: (...a: unknown[]) => storeFindUnique(...a) },
    storeProduct: {
      findUnique: (...a: unknown[]) => storeProductFindUnique(...a),
      update: (...a: unknown[]) => storeProductUpdate(...a),
    },
    canonicalProduct: {
      findUnique: (...a: unknown[]) => canonicalProductFindUnique(...a),
      create: (...a: unknown[]) => canonicalProductCreate(...a),
    },
    canonicalBarcode: {
      createMany: (...a: unknown[]) => canonicalBarcodeCreateMany(...a),
    },
    localCategory: { findUnique: (...a: unknown[]) => localCategoryFindUnique(...a) },
    productAlias: {
      findUnique: (...a: unknown[]) => productAliasFindUnique(...a),
      update: (...a: unknown[]) => productAliasUpdate(...a),
      create: (...a: unknown[]) => productAliasCreate(...a),
    },
  },
}));

vi.mock("@/features/marketplace/server/searchVector", () => ({
  writeSearchDocument: (...a: unknown[]) => writeSearchDocumentMock(...a),
}));

// F-021: the store's own reindexer is mocked as a unit here — the SQL it
// runs (W3, a real UPDATE against a real tsvector) is only verifiable
// against Postgres, in `product.db.test.ts`. What this file holds the
// line on: whether `handleProduct` calls it at all, and never on the
// STALE/soft-delete paths.
vi.mock("@/features/catalog/server/searchIndex", () => ({
  reindexStoreProductsOfCanonical: (...a: unknown[]) => reindexStoreProductsOfCanonicalMock(...a),
}));

const { handleProduct } = await import("./product");

function payload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    storeProductId: "seed-tienda-1-p0",
    productId: "seed-producto-0",
    businessId: "seed-negocio-1",
    storeId: "seed-tienda-1",
    localName: "Refresco de cola 1.5 L",
    barcodes: ["7501031311309"],
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
  // Default: the explicit canonical id already exists, so resolveCanonical
  // never creates and never has to write a search document itself.
  canonicalProductFindUnique.mockReset().mockResolvedValue({ id: "canon-1" });
  canonicalProductCreate.mockReset();
  localCategoryFindUnique.mockReset().mockResolvedValue(null);
  // Default: the business already used this exact name for this canonical,
  // so recordAlias only increments useCount and never writes either.
  productAliasFindUnique.mockReset().mockResolvedValue({ id: "alias-1" });
  productAliasUpdate.mockReset().mockResolvedValue({ id: "alias-1" });
  productAliasCreate.mockReset();
  writeSearchDocumentMock.mockReset().mockResolvedValue(1);
  canonicalBarcodeCreateMany.mockReset().mockResolvedValue({ count: 1 });
  reindexStoreProductsOfCanonicalMock.mockReset().mockResolvedValue(1);
});

// F-022 architecture.md § La exhaustividad del criterio 4, punto 5: ONE list,
// not three — `PANEL_PRODUCT_COLUMNS` is promoted to `src/constants/admin.ts`
// so this test, `mutations.ts`'s own `PanelProductColumn` type, and
// `fieldOwnership.test.ts`'s cross-check against the contract document
// cannot drift apart. Not re-declared here as a literal (AC5).
const PANEL_COLUMNS: readonly string[] = PANEL_PRODUCT_COLUMNS;

describe("handleProduct() UPDATE", () => {
  it("changes syncedPrice but never touches any of the six panel-owned fields", async () => {
    const outcome = await handleProduct(payload({ price: 499 }), "UPDATE", "business-1");

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

    const outcome = await handleProduct(payload(), "UPDATE", "business-1");

    expect(outcome.status).toBe("stale");
    expect(storeProductUpdate).not.toHaveBeenCalled();
  });
});

describe("handleProduct() search indexing (F-015, E1-E4)", () => {
  it("a stale event never calls the search-index writer (E4)", async () => {
    // Same setup as the STALE test above: the guard that protects the index
    // is the existing `return STALE`, not a second copy inside the writer.
    storeProductFindUnique.mockResolvedValue({
      id: "product-1",
      sourceUpdatedAt: new Date("2026-08-26T12:00:00.000Z"),
      canonicalProductId: "canon-1",
    });

    const outcome = await handleProduct(payload(), "UPDATE", "business-1");

    expect(outcome.status).toBe("stale");
    expect(writeSearchDocumentMock).not.toHaveBeenCalled();
  });

  it("a repeated alias does not call the writer", async () => {
    // Default mocks: the explicit canonical already exists and the alias
    // already exists for this business — nothing is new.
    const outcome = await handleProduct(payload(), "UPDATE", "business-1");

    expect(outcome.status).toBe("processed");
    expect(writeSearchDocumentMock).not.toHaveBeenCalled();
  });

  it("creating a new canonical calls the writer once with its search document (E1)", async () => {
    // The explicit canonical id is not found -> resolveCanonical creates it.
    canonicalProductFindUnique.mockResolvedValueOnce(null);
    canonicalProductCreate.mockResolvedValueOnce({ id: "canon-new" });

    const outcome = await handleProduct(payload(), "UPDATE", "business-1");

    expect(outcome.status).toBe("processed");
    expect(writeSearchDocumentMock).toHaveBeenCalledOnce();
    expect(writeSearchDocumentMock).toHaveBeenCalledWith(
      expect.anything(),
      "canon-new",
      buildSearchDocument("Refresco de cola 1.5 L", []),
    );
  });

  it("a new alias recomputes the search document in the same write, once (E2)", async () => {
    // The canonical already exists (default), but this business has never
    // used this exact name for it before.
    productAliasFindUnique.mockResolvedValueOnce(null);
    productAliasCreate.mockResolvedValueOnce({ id: "alias-2" });
    canonicalProductFindUnique.mockResolvedValueOnce({ id: "canon-1" }).mockResolvedValueOnce({
      name: "Refresco de cola 1.5 L",
      aliases: [{ text: "Coca-Cola 1.5L" }],
    });

    const outcome = await handleProduct(
      payload({ localName: "Coca-Cola 1.5L" }),
      "UPDATE",
      "business-1",
    );

    expect(outcome.status).toBe("processed");
    expect(writeSearchDocumentMock).toHaveBeenCalledOnce();
    expect(writeSearchDocumentMock).toHaveBeenCalledWith(
      expect.anything(),
      "canon-1",
      buildSearchDocument("Refresco de cola 1.5 L", ["Coca-Cola 1.5L"]),
    );
  });
});

describe("handleProduct() store search reindex (F-021, R3, E9)", () => {
  it("a normal UPDATE reindexes this business's offers of the resolved canonical", async () => {
    const outcome = await handleProduct(
      payload({ localName: "Refresco de pomo" }),
      "UPDATE",
      "business-1",
    );

    expect(outcome.status).toBe("processed");
    expect(reindexStoreProductsOfCanonicalMock).toHaveBeenCalledOnce();
    expect(reindexStoreProductsOfCanonicalMock).toHaveBeenCalledWith(
      expect.anything(),
      "canon-1",
      "business-1",
    );
  });

  it("a stale event never calls the store reindexer", async () => {
    storeProductFindUnique.mockResolvedValue({
      id: "product-1",
      sourceUpdatedAt: new Date("2026-08-26T12:00:00.000Z"),
      canonicalProductId: "canon-1",
    });

    const outcome = await handleProduct(payload(), "UPDATE", "business-1");

    expect(outcome.status).toBe("stale");
    expect(reindexStoreProductsOfCanonicalMock).not.toHaveBeenCalled();
  });

  it("a DELETE (soft delete) never calls the store reindexer", async () => {
    const outcome = await handleProduct(payload(), "DELETE", "business-1");

    expect(outcome.status).toBe("processed");
    expect(reindexStoreProductsOfCanonicalMock).not.toHaveBeenCalled();
  });

  it("publishToStore: false (soft delete) never calls the store reindexer", async () => {
    const outcome = await handleProduct(payload({ publishToStore: false }), "UPDATE", "business-1");

    expect(outcome.status).toBe("processed");
    expect(reindexStoreProductsOfCanonicalMock).not.toHaveBeenCalled();
  });
});

describe("handleProduct() image lifecycle (F-023 E11/E12/R10) — the handler never calls Storage", () => {
  it("a terminal DELETE empties imageUrls and reports the product's bucket prefix", async () => {
    const outcome = await handleProduct(payload(), "DELETE", "business-1");

    expect(outcome.status).toBe("processed");
    expect(outcome.purgeObjectPrefix).toBe("stores/store-1/products/product-1/");

    const data = storeProductUpdate.mock.calls[0][0].data;
    expect(data.imageUrls).toEqual([]);
  });

  it("publishToStore: false conserves the images — no imageUrls write, no prefix to purge (R10)", async () => {
    const outcome = await handleProduct(payload({ publishToStore: false }), "UPDATE", "business-1");

    expect(outcome.status).toBe("processed");
    expect(outcome.purgeObjectPrefix).toBeUndefined();

    const data = storeProductUpdate.mock.calls[0][0].data;
    expect(Object.keys(data)).not.toContain("imageUrls");
  });

  it("a stale DELETE never reaches the update, so nothing is purged (E13)", async () => {
    storeProductFindUnique.mockResolvedValue({
      id: "product-1",
      sourceUpdatedAt: new Date("2026-08-26T12:00:00.000Z"),
      canonicalProductId: "canon-1",
    });

    const outcome = await handleProduct(payload(), "DELETE", "business-1");

    expect(outcome.status).toBe("stale");
    expect(outcome.purgeObjectPrefix).toBeUndefined();
    expect(storeProductUpdate).not.toHaveBeenCalled();
  });
});

describe("handleProduct() barcode recording (F-024, R10)", () => {
  it("records the normalized barcodes against the resolved canonical, between the offer write and the alias", async () => {
    const callOrder: string[] = [];
    storeProductUpdate.mockImplementation(async () => {
      callOrder.push("storeProduct.update");
      return { id: "product-1" };
    });
    canonicalBarcodeCreateMany.mockImplementation(async () => {
      callOrder.push("canonicalBarcode.createMany");
      return { count: 1 };
    });
    productAliasUpdate.mockImplementation(async () => {
      callOrder.push("productAlias.update");
      return { id: "alias-1" };
    });

    const outcome = await handleProduct(
      payload({ barcodes: ["7501031311309", "7501031311316"] }),
      "UPDATE",
      "business-1",
    );

    expect(outcome.status).toBe("processed");
    expect(canonicalBarcodeCreateMany).toHaveBeenCalledWith({
      data: [
        { canonicalProductId: "canon-1", ean: "7501031311309" },
        { canonicalProductId: "canon-1", ean: "7501031311316" },
      ],
      skipDuplicates: true,
    });
    expect(callOrder).toEqual([
      "storeProduct.update",
      "canonicalBarcode.createMany",
      "productAlias.update",
    ]);
  });

  it("a stale event never calls the barcode writer (E15)", async () => {
    storeProductFindUnique.mockResolvedValue({
      id: "product-1",
      sourceUpdatedAt: new Date("2026-08-26T12:00:00.000Z"),
      canonicalProductId: "canon-1",
    });

    const outcome = await handleProduct(payload(), "UPDATE", "business-1");

    expect(outcome.status).toBe("stale");
    expect(canonicalBarcodeCreateMany).not.toHaveBeenCalled();
  });

  it("a DELETE never calls the barcode writer, even with barcodes in the payload (E14)", async () => {
    const outcome = await handleProduct(payload(), "DELETE", "business-1");

    expect(outcome.status).toBe("processed");
    expect(canonicalBarcodeCreateMany).not.toHaveBeenCalled();
  });

  it("publishToStore: false never calls the barcode writer (E14)", async () => {
    const outcome = await handleProduct(payload({ publishToStore: false }), "UPDATE", "business-1");

    expect(outcome.status).toBe("processed");
    expect(canonicalBarcodeCreateMany).not.toHaveBeenCalled();
  });

  it("an empty barcodes list never calls the writer — no round trip (E9)", async () => {
    const outcome = await handleProduct(payload({ barcodes: [] }), "UPDATE", "business-1");

    expect(outcome.status).toBe("processed");
    expect(canonicalBarcodeCreateMany).not.toHaveBeenCalled();
  });
});
