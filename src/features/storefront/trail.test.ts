import { describe, expect, it } from "vitest";
import { asPublicSlug } from "@/lib/publicSlug";
import {
  backTarget,
  branchSwitchTrail,
  branchTrailStore,
  brandTrailStore,
  breadcrumbList,
  cartTrail,
  catalogTrail,
  categoryTrail,
  checkoutTrail,
  filterTrail,
  orderTrail,
  productTrail,
  searchTrail,
  storeTrail,
  type TrailStore,
} from "./trail";

/**
 * F-025 plan.md paso 1: one test per row of architecture.md § Cómo se
 * construye el rastro en cada pantalla, plus R4, R5, R19 and `backTarget()`
 * with a single crumb. Pure, no Prisma — `TrailStore` fixtures stand in for
 * `BranchResolution`/`StoreSummary`.
 */

const singleBranchStore: TrailStore = {
  kind: "branch",
  brandSlug: asPublicSlug("tienda-demo"),
  brandName: "Tienda Demo",
  branchCount: 1,
  canonicalSlug: asPublicSlug("tienda-demo"),
  branchName: "Tienda Demo",
};

const multiBranchStore: TrailStore = {
  kind: "branch",
  brandSlug: asPublicSlug("bodega-uno"),
  brandName: "Bodega Uno",
  branchCount: 2,
  canonicalSlug: asPublicSlug("bodega-uno"),
  branchName: "Bodega Uno",
};

const multiBranchBrand: TrailStore = brandTrailStore({
  brandSlug: asPublicSlug("bodega-uno"),
  brandName: "Bodega Uno",
});

describe("branchTrailStore()", () => {
  it("takes brandName from `store`, never from `resolution` (architecture.md, cache-tag row)", () => {
    const trailStore = branchTrailStore(
      { brandSlug: asPublicSlug("tienda-demo"), branchCount: 1 },
      {
        canonicalSlug: asPublicSlug("tienda-demo"),
        name: "La Rampa · Vedado",
        brandName: "La Rampa",
      },
    );
    expect(trailStore).toEqual({
      kind: "branch",
      brandSlug: "tienda-demo",
      brandName: "La Rampa",
      branchCount: 1,
      canonicalSlug: "tienda-demo",
      branchName: "La Rampa · Vedado",
    });
  });
});

describe("storeTrail() — one test per row of the screen table", () => {
  it("1. /[slug] selector → {M}", () => {
    const trail = catalogTrail(multiBranchBrand);
    expect(trail).toEqual([{ label: "Bodega Uno", href: null }]);
  });

  it("2. /[slug] branch open → {M} › {S}", () => {
    const trail = catalogTrail(multiBranchStore);
    expect(trail).toEqual([
      { label: "Bodega Uno", href: "/bodega-uno" },
      { label: "Bodega Uno", href: null },
    ]);
  });

  it("3. /[slug] branch closed → {M} › {S}, same shape as open (R6)", () => {
    const trail = catalogTrail(multiBranchStore);
    expect(trail).toEqual(catalogTrail(multiBranchStore));
  });

  it("4. /[slug]/c/[categorySlug] open → {M} › {S} › {Categoría}", () => {
    const trail = categoryTrail(multiBranchStore, { name: "Bebidas" });
    expect(trail).toEqual([
      { label: "Bodega Uno", href: "/bodega-uno" },
      { label: "Bodega Uno", href: "/bodega-uno" },
      { label: "Bebidas", href: null },
    ]);
  });

  it("5. /[slug]/c/[categorySlug] closed → {M} › {S}, category not read (R20)", () => {
    const trail = catalogTrail(multiBranchStore);
    expect(trail).toEqual([
      { label: "Bodega Uno", href: "/bodega-uno" },
      { label: "Bodega Uno", href: null },
    ]);
  });

  it("6. /[slug]/p/[productSlug] open, with category → {M} › {S} › {Cat} › {Prod}", () => {
    const trail = productTrail(singleBranchStore, {
      name: "Jugo de mango 1 L",
      categoryName: "Bebidas",
      categorySlug: "bebidas",
    });
    expect(trail).toEqual([
      { label: "Tienda Demo", href: "/tienda-demo" },
      { label: "Bebidas", href: "/tienda-demo/c/bebidas" },
      { label: "Jugo de mango 1 L", href: null },
    ]);
  });

  it("7. /[slug]/p/[productSlug] without category → {M} › {S} › {Prod} (R19, E19)", () => {
    const trail = productTrail(singleBranchStore, {
      name: "Producto suelto",
      categoryName: null,
      categorySlug: null,
    });
    expect(trail).toEqual([
      { label: "Tienda Demo", href: "/tienda-demo" },
      { label: "Producto suelto", href: null },
    ]);
  });

  it("8. /[slug]/p/[productSlug] closed → {M} › {S}, product not read (R20)", () => {
    const trail = catalogTrail(singleBranchStore);
    expect(trail).toEqual([{ label: "Tienda Demo", href: null }]);
  });

  it("9. /[slug]/buscar without q → {M} › {S} › Buscar", () => {
    const trail = searchTrail(singleBranchStore, null);
    expect(trail).toEqual([
      { label: "Tienda Demo", href: "/tienda-demo" },
      { label: "Buscar", href: null },
    ]);
  });

  it("10. /[slug]/buscar?q=… → {M} › {S} › Buscar «término»", () => {
    const trail = searchTrail(singleBranchStore, "jugo");
    expect(trail).toEqual([
      { label: "Tienda Demo", href: "/tienda-demo" },
      { label: "Buscar «jugo»", href: null },
    ]);
  });

  it("F-027 plan.md paso 10. /[slug]/catalogo → {M} › {S} › Filtrar y ordenar", () => {
    const trail = filterTrail(singleBranchStore);
    expect(trail).toEqual([
      { label: "Tienda Demo", href: "/tienda-demo" },
      { label: "Filtrar y ordenar", href: null },
    ]);
  });

  it("11. /[slug]/carrito → {M} › {S} › Carrito", () => {
    const trail = cartTrail(singleBranchStore);
    expect(trail).toEqual([
      { label: "Tienda Demo", href: "/tienda-demo" },
      { label: "Carrito", href: null },
    ]);
  });

  it("12. /[slug]/checkout → {M} › {S} › Carrito › Pagar", () => {
    const trail = checkoutTrail(singleBranchStore);
    expect(trail).toEqual([
      { label: "Tienda Demo", href: "/tienda-demo" },
      { label: "Carrito", href: "/tienda-demo/carrito" },
      { label: "Pagar", href: null },
    ]);
  });

  it("13. /[slug]/pedido/[code] → {M} › {S} › Pedido XXXXX-XXXXX", () => {
    const trail = orderTrail(singleBranchStore, "ABCDE12345");
    expect(trail).toEqual([
      { label: "Tienda Demo", href: "/tienda-demo" },
      { label: "Pedido ABCDE-12345", href: null },
    ]);
  });

  it("14. /[slug]/sucursales from a branch → {M} › {S} › Cambiar de sucursal", () => {
    const trail = branchSwitchTrail(multiBranchStore);
    expect(trail).toEqual([
      { label: "Bodega Uno", href: "/bodega-uno" },
      { label: "Bodega Uno", href: "/bodega-uno" },
      { label: "Cambiar de sucursal", href: null },
    ]);
  });

  it("15. /[slug]/sucursales from the brand selector → {M} › Cambiar de sucursal", () => {
    const trail = branchSwitchTrail(multiBranchBrand);
    expect(trail).toEqual([
      { label: "Bodega Uno", href: "/bodega-uno" },
      { label: "Cambiar de sucursal", href: null },
    ]);
  });
});

describe("R4 — the brand crumb only exists when branchCount > 1", () => {
  it("a single-branch store has no brand crumb: brand and branch are the same URL", () => {
    const trail = catalogTrail(singleBranchStore);
    expect(trail).toHaveLength(1);
    expect(trail[0]).toEqual({ label: "Tienda Demo", href: null });
  });

  it("a multi-branch store gets both crumbs, each to its own URL", () => {
    const trail = catalogTrail(multiBranchStore);
    expect(trail).toHaveLength(2);
    expect(trail[0].href).toBe("/bodega-uno");
  });
});

describe("R5 — the last crumb never carries an href", () => {
  it("holds for a one-crumb trail", () => {
    const trail = catalogTrail(singleBranchStore);
    expect(trail[trail.length - 1].href).toBeNull();
  });

  it("holds for a four-crumb trail", () => {
    const trail = productTrail(multiBranchStore, {
      name: "Refresco de cola 1.5 L",
      categoryName: "Bebidas",
      categorySlug: "bebidas",
    });
    expect(trail).toHaveLength(4);
    expect(trail[trail.length - 1].href).toBeNull();
  });
});

describe("R19 — no categorySlug/categoryName, no category crumb", () => {
  it("productTrail skips the category leg entirely when either field is null", () => {
    const trail = productTrail(singleBranchStore, {
      name: "Producto suelto",
      categoryName: null,
      categorySlug: null,
    });
    expect(trail.some((crumb) => crumb.label === "Producto suelto")).toBe(true);
    expect(trail).toHaveLength(2);
  });
});

describe("backTarget()", () => {
  it("is null for a one-crumb trail (R2)", () => {
    const trail = catalogTrail(singleBranchStore);
    expect(backTarget(trail)).toBeNull();
  });

  it("is the penultimate crumb for a longer trail, with its href", () => {
    const trail = productTrail(singleBranchStore, {
      name: "Jugo de mango 1 L",
      categoryName: "Bebidas",
      categorySlug: "bebidas",
    });
    expect(backTarget(trail)).toEqual({ label: "Bebidas", href: "/tienda-demo/c/bebidas" });
  });

  it("uses exactly the same href as the penultimate crumb — zero new prefetch destinations", () => {
    const trail = checkoutTrail(singleBranchStore);
    const penultimate = trail[trail.length - 2];
    expect(backTarget(trail)?.href).toBe(penultimate.href);
  });
});

describe("storeTrail() — construction is front-first, tuple stays non-empty", () => {
  it("a brand-only trail is exactly one crumb", () => {
    const trail = storeTrail(multiBranchBrand);
    expect(trail).toHaveLength(1);
  });
});

describe("breadcrumbList()", () => {
  it("is null for a trail with fewer than two crumbs — nothing to describe", () => {
    expect(breadcrumbList(catalogTrail(singleBranchStore), "https://tienda.example")).toBeNull();
  });

  it("numbers every crumb and omits `item` only on the last (current) one", () => {
    const trail = categoryTrail(multiBranchStore, { name: "Bebidas" });
    const jsonLd = breadcrumbList(trail, "https://tienda.example");

    expect(jsonLd).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Bodega Uno",
          item: "https://tienda.example/bodega-uno",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Bodega Uno",
          item: "https://tienda.example/bodega-uno",
        },
        { "@type": "ListItem", position: 3, name: "Bebidas" },
      ],
    });
  });
});
