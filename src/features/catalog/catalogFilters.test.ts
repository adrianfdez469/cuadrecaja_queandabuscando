import { describe, expect, it } from "vitest";
import {
  applyCatalogFilters,
  catalogFilterHref,
  describeCatalogFilters,
  hasAnyCatalogFilter,
  parseCatalogFilters,
  type CatalogFilterContext,
  type CatalogFilterState,
} from "./catalogFilters";
import type { CatalogProduct } from "./server/queries";
import type { StoreCategory } from "./storeCategories";

/**
 * F-027, plan.md pasos 4-5: pure tests over fixed `CatalogProduct[]`, no
 * Prisma — same convention `storeCategories.test.ts` set for F-026. Covers
 * `Cómo se verifica`: union/intersection (E4/E5), override 900→300 (E6),
 * promo 600→300 (E6b), no-rate-last in both directions (E7), "ácido/Agua/
 * azúcar" (E9), garbage parameters (E15/R10), and RD3's price brackets.
 */

let nextId = 0;

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  nextId += 1;
  return {
    id: `product-${String(nextId).padStart(3, "0")}`,
    slug: `product-${nextId}`,
    name: `Producto ${nextId}`,
    description: null,
    imageUrls: [],
    availability: "AVAILABLE",
    featured: false,
    categoryName: null,
    categorySlug: null,
    syncedPrice: "1.00",
    syncedPriceCurrency: "CUP",
    priceOverride: null,
    priceOverrideCurrency: null,
    promotions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// Pre-sorted by Spanish collation, exactly as `deriveStoreCategories` (F-026)
// hands them to this module in the real path — `describeCatalogFilters`
// relies on that ordering rather than re-sorting itself.
const CATEGORIES: readonly StoreCategory[] = [
  { slug: "aseo", name: "Aseo", productCount: 0 },
  { slug: "bebidas", name: "Bebidas", productCount: 0 },
  { slug: "panaderia", name: "Panadería", productCount: 0 },
];

function context(overrides: Partial<CatalogFilterContext> = {}): CatalogFilterContext {
  return {
    displayCurrency: "CUP",
    rates: {},
    categories: CATEGORIES,
    basePath: "/tienda-demo/catalogo",
    ...overrides,
  };
}

const DEFAULT_STATE: CatalogFilterState = {
  term: null,
  categorySlugs: [],
  inStockOnly: false,
  promotedOnly: false,
  featuredOnly: false,
  priceMin: null,
  priceMax: null,
  sort: null,
  page: 1,
};

function state(overrides: Partial<CatalogFilterState> = {}): CatalogFilterState {
  return { ...DEFAULT_STATE, ...overrides };
}

describe("parseCatalogFilters()", () => {
  it("parses a canonical URL with two categories, availability and a price ceiling", () => {
    const parsed = parseCatalogFilters({
      categorySlug: ["bebidas", "panaderia"],
      disponibilidad: "hay",
      precio_max: "500",
      sort: "precio_asc",
    });

    expect(parsed.categorySlugs).toEqual(["bebidas", "panaderia"]);
    expect(parsed.inStockOnly).toBe(true);
    expect(parsed.priceMax).toBe(500);
    expect(parsed.sort).toBe("precio_asc");
  });

  it("ignores an unknown parameter, an unrecognized value and a non-numeric price (E15, R10)", () => {
    const parsed = parseCatalogFilters({
      categorySlug: "bebidas",
      disponibilidad: "algo-raro",
      precio_min: "no-es-un-numero",
      color: "azul",
    });

    expect(parsed.inStockOnly).toBe(false);
    expect(parsed.priceMin).toBeNull();
    expect(parsed.categorySlugs).toEqual(["bebidas"]);
  });

  it("drops BOTH price limits when precio_min > precio_max", () => {
    const parsed = parseCatalogFilters({ precio_min: "500", precio_max: "100" });
    expect(parsed.priceMin).toBeNull();
    expect(parsed.priceMax).toBeNull();
  });

  it("caps a faceta with more than CATALOG_FILTER_VALUES_MAX values, after deduping and sorting", () => {
    const many = Array.from({ length: 40 }, (_, i) => `cat-${i}`);
    const parsed = parseCatalogFilters({ categorySlug: many });
    expect(parsed.categorySlugs).toHaveLength(12);
    expect(parsed.categorySlugs).toEqual([...parsed.categorySlugs].sort());
  });

  it("normalizes sort=relevancia to null, same as omitting it (E11)", () => {
    expect(parseCatalogFilters({ sort: "relevancia" }).sort).toBeNull();
    expect(parseCatalogFilters({}).sort).toBeNull();
  });

  it("accepts the empty-string values a plain <form method=get> writes for untouched fields (design.md § Decisión 7)", () => {
    const parsed = parseCatalogFilters({ precio_min: "", precio_max: "", sort: "" });
    expect(parsed.priceMin).toBeNull();
    expect(parsed.priceMax).toBeNull();
    expect(parsed.sort).toBeNull();
  });

  it("clamps the page to [1, 50]", () => {
    expect(parseCatalogFilters({ p: "0" }).page).toBe(1);
    expect(parseCatalogFilters({ p: "999" }).page).toBe(50);
  });
});

describe("catalogFilterHref()", () => {
  it("builds a bare basePath with no filters applied", () => {
    expect(catalogFilterHref("/tienda-demo/catalogo", DEFAULT_STATE)).toBe("/tienda-demo/catalogo");
  });

  it("orders parameters fixed (R11): q, categorySlug, disponibilidad, promocion, destacados, precio_min, precio_max, sort, p", () => {
    const href = catalogFilterHref(
      "/tienda-demo/catalogo",
      state({
        categorySlugs: ["panaderia", "bebidas"],
        inStockOnly: true,
        promotedOnly: true,
        featuredOnly: true,
        priceMin: 100,
        priceMax: 500,
        sort: "nombre",
        page: 2,
      }),
      { page: 2 },
    );
    expect(href).toBe(
      "/tienda-demo/catalogo?categorySlug=bebidas&categorySlug=panaderia&disponibilidad=hay&promocion=si&destacados=si&precio_min=100&precio_max=500&sort=nombre&p=2",
    );
  });

  it("resets to page 1 when the patch changes anything other than page (R9, E13)", () => {
    const onPageThree = state({ page: 3, inStockOnly: true });
    const href = catalogFilterHref("/tienda-demo/catalogo", onPageThree, { featuredOnly: true });
    expect(href).not.toContain("p=");
  });

  it("keeps an explicit page patch (pagination links)", () => {
    const href = catalogFilterHref("/tienda-demo/catalogo", state({ inStockOnly: true }), {
      page: 2,
    });
    expect(href).toContain("p=2");
  });
});

describe("applyCatalogFilters() — union within a facet, intersection across facets (E4, E5, R2)", () => {
  const drinks = product({ categorySlug: "bebidas", categoryName: "Bebidas" });
  const bakery = product({ categorySlug: "panaderia", categoryName: "Panadería" });
  const cleaning = product({ categorySlug: "aseo", categoryName: "Aseo" });
  const outOfStockDrink = product({
    categorySlug: "bebidas",
    categoryName: "Bebidas",
    availability: "OUT_OF_STOCK",
  });
  const products = [drinks, bakery, cleaning, outOfStockDrink];

  it("two categories return the UNION, not the intersection", () => {
    const result = applyCatalogFilters(
      products,
      state({ categorySlugs: ["bebidas", "panaderia"] }),
      context(),
    );
    expect(result.items.map((p) => p.id).sort()).toEqual(
      [drinks.id, bakery.id, outOfStockDrink.id].sort(),
    );
  });

  it("a category and availability cut across (intersection)", () => {
    const result = applyCatalogFilters(
      products,
      state({ categorySlugs: ["bebidas"], inStockOnly: true }),
      context(),
    );
    expect(result.items.map((p) => p.id)).toEqual([drinks.id]);
  });

  it("an unknown categorySlug is ignored, not zero results (I-A1)", () => {
    const result = applyCatalogFilters(
      products,
      state({ categorySlugs: ["marca-ajena"] }),
      context(),
    );
    expect(result.applied.categorySlugs).toEqual([]);
    expect(result.items).toHaveLength(products.length);
  });
});

describe("applyCatalogFilters() — price is the SHOWN price (E6, E6b, R4)", () => {
  it("an override wins over the synced price: 900 with an override of 300 appears under 'hasta 500'", () => {
    const overridden = product({ syncedPrice: "900", priceOverride: "300" });
    const result = applyCatalogFilters([overridden], state({ priceMax: 500 }), context());
    expect(result.items).toHaveLength(1);

    const excluded = applyCatalogFilters([overridden], state({ priceMin: 500 }), context());
    expect(excluded.items).toHaveLength(0);
  });

  it("a vigent 50% promotion moves a 600 product into 'hasta 500' (300 shown)", () => {
    const promoted = product({
      syncedPrice: "600",
      promotions: [
        {
          id: "promo-1",
          type: "PERCENTAGE",
          value: "50",
          startsAt: new Date("2020-01-01"),
          endsAt: null,
          active: true,
          scope: "PRODUCT",
        },
      ],
    });
    const result = applyCatalogFilters([promoted], state({ priceMax: 500 }), context());
    expect(result.items).toHaveLength(1);
  });
});

describe("applyCatalogFilters() — a product with no resolvable price (E7, R5)", () => {
  const noRate = product({ syncedPriceCurrency: "USD", syncedPrice: "10" });
  const priced = [product({ syncedPrice: "100" }), product({ syncedPrice: "200" }), noRate];

  it("never appears under any price range", () => {
    const result = applyCatalogFilters(
      priced,
      state({ priceMin: 0, priceMax: 100_000 }),
      context(),
    );
    expect(result.items.map((p) => p.id)).not.toContain(noRate.id);
  });

  it("sorts LAST under precio_asc AND precio_desc", () => {
    const asc = applyCatalogFilters(priced, state({ sort: "precio_asc" }), context());
    expect(asc.items.at(-1)?.id).toBe(noRate.id);

    const desc = applyCatalogFilters(priced, state({ sort: "precio_desc" }), context());
    expect(desc.items.at(-1)?.id).toBe(noRate.id);
  });

  it("still appears, unbadged, when no price filter is applied", () => {
    const result = applyCatalogFilters(priced, state(), context());
    expect(result.items.map((p) => p.id)).toContain(noRate.id);
  });
});

describe("applyCatalogFilters() — sort=nombre ignores accents and case (E9)", () => {
  it("orders 'ácido', 'Agua', 'azúcar' exactly in that order", () => {
    const acido = product({ name: "ácido" });
    const agua = product({ name: "Agua" });
    const azucar = product({ name: "azúcar" });
    const result = applyCatalogFilters([azucar, acido, agua], state({ sort: "nombre" }), context());
    expect(result.items.map((p) => p.name)).toEqual(["ácido", "Agua", "azúcar"]);
  });
});

describe("applyCatalogFilters() — sort=reciente is a total order (E10, R8)", () => {
  it("the union of page 1 and page 2 has as many distinct ids as rows, with the same createdAt", () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      product({
        createdAt: "2026-01-01T00:00:00.000Z",
        name: `Producto ${String(i).padStart(2, "0")}`,
      }),
    );
    const page1 = applyCatalogFilters(items, state({ sort: "reciente", page: 1 }), context());
    const page2 = applyCatalogFilters(items, state({ sort: "reciente", page: 2 }), context());
    const ids = new Set([...page1.items, ...page2.items].map((p) => p.id));
    expect(ids.size).toBe(page1.items.length + page2.items.length);
  });
});

describe("applyCatalogFilters() — garbage never crashes and never applies (E15, R10)", () => {
  it("responds with everything applied when nothing valid was parsed", () => {
    const parsed = parseCatalogFilters({
      color: "azul",
      categorySlug: "marca-ajena",
      precio_min: "abc",
      precio_max: "xyz",
    });
    const result = applyCatalogFilters([product(), product()], parsed, context());
    expect(result.applied.categorySlugs).toEqual([]);
    expect(describeCatalogFilters(result.applied, context())).toEqual([]);
  });
});

describe("applyCatalogFilters() — visibility never widens (E21, R7)", () => {
  it("never applies to a hidden or deleted product — those never reach this module at all", () => {
    // `applyCatalogFilters` only ever sees what `getStoreCatalog` already
    // filtered (deletedAt IS NULL, visible = TRUE, PUBLISHED store, R7) — a
    // hidden product is not a case this module can leak, by construction.
    const visible = product();
    const result = applyCatalogFilters([visible], state(), context());
    expect(result.items).toEqual([visible]);
  });
});

describe("applyCatalogFilters() — facet counts (design.md § Decisión 4)", () => {
  it("a category's count is what marking it would ADD, not the current selection", () => {
    const drinks = Array.from({ length: 4 }, () => product({ categorySlug: "bebidas" }));
    const bakery = Array.from({ length: 3 }, () => product({ categorySlug: "panaderia" }));
    const result = applyCatalogFilters(
      [...drinks, ...bakery],
      state({ categorySlugs: ["panaderia"] }),
      context(),
    );
    const drinksCount = result.facets.categories.find((c) => c.value === "bebidas");
    expect(drinksCount?.count).toBe(4);
  });
});

describe("applyCatalogFilters() — RD3, the price range and the three brackets", () => {
  // tienda-demo's real prices, from design.md § Se miraron los precios de
  // verdad — this is a fixture, not a database read.
  const PRICES = [90, 120, 230, 260, 350, 380, 410, 450, 528, 540, 620, 737, 780, 890, 1150];

  it("gives min 90, max 1150 and 5/5/5 brackets over the 15 real prices", () => {
    const products = PRICES.map((price) => product({ syncedPrice: String(price) }));
    const result = applyCatalogFilters(products, state(), context());
    expect(result.facets.price?.min).toBe(90);
    expect(result.facets.price?.max).toBe(1150);
    expect(result.facets.price?.pricedCount).toBe(15);
    expect(result.facets.price?.brackets?.map((b) => b.count)).toEqual([5, 5, 5]);
    expect(result.facets.price?.brackets?.[0]?.label).toBe("Hasta $350");
    expect(result.facets.price?.brackets?.[1]?.label).toBe("De $350 a $540");
    expect(result.facets.price?.brackets?.[2]?.label).toBe("Más de $540");
  });

  it("draws no brackets under 12 priced products (tienda-dos: n=5)", () => {
    const products = [245, 470, 600, 880, 1400].map((price) =>
      product({ syncedPrice: String(price) }),
    );
    const result = applyCatalogFilters(products, state(), context());
    expect(result.facets.price?.pricedCount).toBe(5);
    expect(result.facets.price?.brackets).toBeNull();
  });

  it("is null entirely when nothing has a resolvable price", () => {
    const products = [
      product({ syncedPriceCurrency: "USD" }),
      product({ syncedPriceCurrency: "USD" }),
    ];
    const result = applyCatalogFilters(products, state(), context());
    expect(result.facets.price).toBeNull();
  });
});

describe("describeCatalogFilters()", () => {
  it("only describes what was actually applied, never a discarded value (R18)", () => {
    const applied = state({ categorySlugs: ["bebidas"], priceMin: 100, inStockOnly: true });
    const chips = describeCatalogFilters(applied, context());
    expect(chips.map((c) => c.label)).toEqual([
      "Categoría: Bebidas",
      "Desde $100",
      "Solo lo que hay ahora",
    ]);
  });

  it("orders categories by name, not by slug", () => {
    const applied = state({ categorySlugs: ["aseo", "bebidas"] });
    const chips = describeCatalogFilters(applied, context());
    expect(chips.map((c) => c.label)).toEqual(["Categoría: Aseo", "Categoría: Bebidas"]);
  });
});

describe("hasAnyCatalogFilter()", () => {
  it("is false for the default state", () => {
    expect(hasAnyCatalogFilter(DEFAULT_STATE)).toBe(false);
  });

  it("is true as soon as any single field is set", () => {
    expect(hasAnyCatalogFilter(state({ sort: "nombre" }))).toBe(true);
    expect(hasAnyCatalogFilter(state({ priceMax: 100 }))).toBe(true);
  });
});
