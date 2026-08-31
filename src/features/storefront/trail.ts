import type { PublicSlug } from "@/lib/publicSlug";
import { storeCategoryPath } from "@/features/catalog/storeCategories";
import { formatOrderCode } from "@/lib/orderCode";

/**
 * The navigation trail (breadcrumb) shown on every public storefront screen,
 * and the "back" control derived from it (architecture.md § Contratos).
 * Pure functions only: no Prisma, no React, no `await`. Every page builds
 * its `TrailStore` from data it already has in hand (R7) and calls one
 * screen wrapper below.
 */

/** A single link. `href: null` marks the current page — and only the last
 *  crumb of a `Trail` can be that. */
export type Crumb = { readonly label: string; readonly href: string | null };

/** Never empty: every public storefront screen has at least its own crumb. */
export type Trail = readonly [Crumb, ...Crumb[]];

/** A step as the caller declares it: label and where it WOULD go. The
 *  constructor strips the `href` off the last one, so R5/E16 never depends
 *  on a caller remembering to pass `null`. */
export type TrailStep = { readonly label: string; readonly href: string };

/** The "back" destination. Never `href: null`, by construction. */
export type BackTarget = { readonly label: string; readonly href: string };

/** The minimal context any trail hangs off. Same discriminant as
 *  `PublicResolution`, so there is only one vocabulary. */
export type TrailStore =
  | { readonly kind: "brand"; readonly brandSlug: PublicSlug; readonly brandName: string }
  | {
      readonly kind: "branch";
      readonly brandSlug: PublicSlug;
      readonly brandName: string;
      readonly branchCount: number;
      readonly canonicalSlug: PublicSlug;
      readonly branchName: string;
    };

/** Adapters. Structural types on purpose: a `BranchResolution` and a
 *  `StoreSummary` satisfy them without this module importing the resolver
 *  or the query layer. `brandName` comes from `store`, never from
 *  `resolution` — see architecture.md § Cómo se construye el rastro, the
 *  cache-tag row in bold. */
export function branchTrailStore(
  resolution: { brandSlug: PublicSlug; branchCount: number },
  store: { canonicalSlug: PublicSlug; name: string; brandName: string },
): TrailStore {
  return {
    kind: "branch",
    brandSlug: resolution.brandSlug,
    brandName: store.brandName,
    branchCount: resolution.branchCount,
    canonicalSlug: store.canonicalSlug,
    branchName: store.name,
  };
}

export function brandTrailStore(resolution: {
  brandSlug: PublicSlug;
  brandName: string;
}): TrailStore {
  return { kind: "brand", brandSlug: resolution.brandSlug, brandName: resolution.brandName };
}

/** R4, verbatim: the brand crumb only exists when the brand renders more
 *  than one branch — otherwise brand and branch are the same URL. */
function trailSpine(store: TrailStore): TrailStep[] {
  if (store.kind === "brand") {
    return [{ label: store.brandName, href: `/${store.brandSlug}` }];
  }
  if (store.branchCount > 1) {
    return [
      { label: store.brandName, href: `/${store.brandSlug}` },
      { label: store.branchName, href: `/${store.canonicalSlug}` },
    ];
  }
  return [{ label: store.branchName, href: `/${store.canonicalSlug}` }];
}

/** The href a branch (or, in selector mode, a brand) is reached at — what
 *  "Carrito" and the other screen-local steps hang off. */
function storeHref(store: TrailStore): string {
  return store.kind === "branch" ? `/${store.canonicalSlug}` : `/${store.brandSlug}`;
}

/**
 * THE constructor. `steps` are intermediate legs, all linked; `current` is
 * the current screen's label. Without `current`, the last of (spine +
 * steps) loses its `href` and becomes the current crumb instead.
 *
 * Built front-first (`[first, ...rest]`) on purpose — architecture.md § La
 * trampa del tipo tupla: `[...rest, last]` and a `.map()` over the whole
 * list both lose the `[Crumb, ...Crumb[]]` tuple shape under `tsc --strict`.
 */
export function storeTrail(
  store: TrailStore,
  options?: { readonly steps?: readonly TrailStep[]; readonly current?: string },
): Trail {
  const linkedSteps: TrailStep[] = [...trailSpine(store), ...(options?.steps ?? [])];
  const crumbs: Crumb[] = linkedSteps.map((step) => ({ label: step.label, href: step.href }));

  if (options?.current !== undefined) {
    crumbs.push({ label: options.current, href: null });
  } else {
    const lastIndex = crumbs.length - 1;
    crumbs[lastIndex] = { label: crumbs[lastIndex].label, href: null };
  }

  const [first, ...rest] = crumbs;
  return [first, ...rest];
}

/** The penultimate crumb, or `null` when the trail has just one (R2). */
export function backTarget(trail: Trail): BackTarget | null {
  if (trail.length < 2) return null;
  const penultimate = trail[trail.length - 2];
  if (penultimate.href === null) return null; // structurally unreachable — only the last crumb is ever null
  return { label: penultimate.label, href: penultimate.href };
}

/**
 * The category leg of a product's trail, isolated so the day
 * `LocalCategory` grows a parent, the subcategory is two more lines HERE
 * and zero elsewhere (architecture.md § La prueba de la subcategoría).
 * `store.kind !== "branch"` never happens for a product screen — guarded
 * anyway because `TrailStore` is a union and a product page always has a
 * branch, never a selector.
 */
function categorySteps(
  store: TrailStore,
  product: { categoryName: string | null; categorySlug: string | null },
): TrailStep[] {
  if (store.kind !== "branch") return [];
  if (product.categoryName === null || product.categorySlug === null) return [];
  return [
    {
      label: product.categoryName,
      href: storeCategoryPath(store.canonicalSlug, product.categorySlug),
    },
  ];
}

/** Fixed labels, R11. One place, in Spanish. Variable labels
 *  (`Buscar «término»`, `Pedido XXXXX-XXXXX`) are composed in their own
 *  wrapper below, not here — they are not constants. */
export const TRAIL_LABEL = {
  cart: "Carrito",
  checkout: "Pagar",
  branchSwitch: "Cambiar de sucursal",
  search: "Buscar",
} as const;

export function catalogTrail(store: TrailStore): Trail {
  return storeTrail(store);
}

export function categoryTrail(store: TrailStore, category: { name: string }): Trail {
  return storeTrail(store, { current: category.name });
}

export function productTrail(
  store: TrailStore,
  product: {
    name: string;
    categoryName: string | null;
    categorySlug: string | null;
  },
): Trail {
  return storeTrail(store, { steps: categorySteps(store, product), current: product.name });
}

export function searchTrail(store: TrailStore, term: string | null): Trail {
  return storeTrail(store, {
    current: term === null ? TRAIL_LABEL.search : `${TRAIL_LABEL.search} «${term}»`,
  });
}

export function cartTrail(store: TrailStore): Trail {
  return storeTrail(store, { current: TRAIL_LABEL.cart });
}

export function checkoutTrail(store: TrailStore): Trail {
  return storeTrail(store, {
    steps: [{ label: TRAIL_LABEL.cart, href: `${storeHref(store)}/carrito` }],
    current: TRAIL_LABEL.checkout,
  });
}

export function orderTrail(store: TrailStore, code: string): Trail {
  return storeTrail(store, { current: `Pedido ${formatOrderCode(code)}` });
}

export function branchSwitchTrail(store: TrailStore): Trail {
  return storeTrail(store, { current: TRAIL_LABEL.branchSwitch });
}

/**
 * `BreadcrumbList` (schema.org), built from the SAME `Trail` the `<ol>`
 * renders — it is impossible for the structured data and what the shopper
 * sees to disagree. `null` for a one-crumb trail: nothing to describe
 * (architecture.md § El JSON-LD).
 */
export type BreadcrumbListJsonLd = {
  readonly "@context": "https://schema.org";
  readonly "@type": "BreadcrumbList";
  readonly itemListElement: readonly {
    readonly "@type": "ListItem";
    readonly position: number;
    readonly name: string;
    /** Absolute. Absent on the last crumb: schema.org allows it and the
     *  current crumb has no URL of its own to declare. */
    readonly item?: string;
  }[];
};

export function breadcrumbList(trail: Trail, siteUrl: string): BreadcrumbListJsonLd | null {
  if (trail.length < 2) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem" as const,
      position: index + 1,
      name: crumb.label,
      ...(crumb.href !== null ? { item: new URL(crumb.href, siteUrl).toString() } : {}),
    })),
  };
}
