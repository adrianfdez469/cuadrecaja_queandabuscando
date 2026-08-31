import { describe, expect, it } from "vitest";
import { deriveStoreCategories, productsOfCategory, storeCategoryPath } from "./storeCategories";
import type { CatalogProduct } from "./server/queries";
import type { PublicSlug } from "@/lib/publicSlug";

/**
 * F-026, plan.md paso 4: pruebas puras sobre `CatalogProduct[]` fijos, sin
 * Prisma. Cubren lo que `Cómo se verifica` pide: agrupación por slug y no
 * por nombre (criterio 11), colación española, exclusión de categoría nula
 * (E6) y que el orden de `productsOfCategory` conserve el de entrada
 * (`featured` desc, nombre asc — ya resuelto por `getStoreCatalog`).
 */

let nextId = 0;

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  nextId += 1;
  return {
    id: `product-${nextId}`,
    slug: `product-${nextId}`,
    name: `Producto ${nextId}`,
    description: null,
    imageUrls: [],
    availability: "AVAILABLE",
    featured: false,
    categoryName: null,
    categorySlug: null,
    syncedPrice: "1.00",
    syncedPriceCurrency: "USD",
    priceOverride: null,
    priceOverrideCurrency: null,
    promotions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("deriveStoreCategories()", () => {
  it("groups by categorySlug, not by categoryName", () => {
    const products = [
      product({ categorySlug: "bebidas", categoryName: "Bebidas" }),
      product({ categorySlug: "bebidas", categoryName: "Bebidas" }),
    ];

    const categories = deriveStoreCategories(products);

    expect(categories).toEqual([{ slug: "bebidas", name: "Bebidas", productCount: 2 }]);
  });

  it("keeps two entries for two categories that share a name but not a slug (criterio 11)", () => {
    const products = [
      product({ categorySlug: "bebidas", categoryName: "Bebidas" }),
      product({ categorySlug: "bebidas-2", categoryName: "Bebidas" }),
    ];

    const categories = deriveStoreCategories(products);

    expect(categories.map((c) => c.slug).sort()).toEqual(["bebidas", "bebidas-2"]);
    expect(categories.every((c) => c.name === "Bebidas")).toBe(true);
  });

  it("excludes products with no category (E6, R6: no invented bucket)", () => {
    const products = [
      product({ categorySlug: "bebidas", categoryName: "Bebidas" }),
      product({ categorySlug: null, categoryName: null }),
    ];

    const categories = deriveStoreCategories(products);

    expect(categories).toHaveLength(1);
    expect(categories[0]?.slug).toBe("bebidas");
  });

  it("orders by name with Spanish collation (RD1)", () => {
    const products = [
      product({ categorySlug: "ninos", categoryName: "Niños" }),
      product({ categorySlug: "aseo", categoryName: "Aseo" }),
      product({ categorySlug: "nueces", categoryName: "Nueces" }),
    ];

    const categories = deriveStoreCategories(products);

    // "Aseo" < "Niños" < "Nueces" for a Spanish reader — "ñ" sorts after "n"
    // and before "o", never after "z" the way a naive code-point sort would.
    expect(categories.map((c) => c.name)).toEqual(["Aseo", "Niños", "Nueces"]);
  });

  it("returns an empty list when nothing has a category", () => {
    expect(deriveStoreCategories([product(), product()])).toEqual([]);
  });
});

describe("productsOfCategory()", () => {
  it("filters by categorySlug and preserves input order (featured desc, name asc)", () => {
    const featured = product({ categorySlug: "bebidas", featured: true, name: "Agua" });
    const other = product({ categorySlug: "bebidas", featured: false, name: "Zumo" });
    const elsewhere = product({ categorySlug: "aseo" });

    const result = productsOfCategory([featured, other, elsewhere], "bebidas");

    expect(result).toEqual([featured, other]);
  });

  it("returns an empty array for a categorySlug nothing matches", () => {
    const products = [product({ categorySlug: "bebidas" })];
    expect(productsOfCategory(products, "inexistente")).toEqual([]);
  });
});

describe("storeCategoryPath()", () => {
  it("builds /[slug]/c/[categorySlug] from the canonical slug", () => {
    expect(storeCategoryPath("tienda-demo" as PublicSlug, "bebidas")).toBe(
      "/tienda-demo/c/bebidas",
    );
  });
});
