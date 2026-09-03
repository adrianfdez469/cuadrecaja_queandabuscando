/**
 * Numbers and strings the admin panel would otherwise repeat as magic
 * literals (AGENTS.md § Prohibiciones).
 */

/** JSON write bodies of the panel. An `imageUrls` of 8 URLs plus a long
 *  description fit well under this. */
export const ADMIN_MAX_BODY_BYTES = 16 * 1024;

/** Page size for the paginated product listing (`architecture.md` § Lecturas del panel). */
export const ADMIN_PRODUCTS_PAGE_SIZE = 50;

/** R13: matches the length the storefront already renders without truncating. */
export const ADMIN_PRODUCT_DESCRIPTION_MAX_LENGTH = 1000;

/**
 * F-022 architecture.md § La exhaustividad del criterio 4: the six
 * `StoreProduct` columns the panel owns and the sync's `product.update` must
 * never touch ([ADR 0007] plus `priceOverrideCurrency`, which the ADR does
 * not name). Promoted from the literal that used to live only inside
 * `src/features/sync/server/handlers/product.test.ts` so there is ONE list —
 * `PanelProductColumn` in `src/features/admin/server/mutations.ts` derives
 * its type from it, and the sync test and the contract-exhaustiveness test
 * both import it, so the three cannot drift apart.
 */
export const PANEL_PRODUCT_COLUMNS = [
  "description",
  "imageUrls",
  "priceOverride",
  "priceOverrideCurrency",
  "visible",
  "featured",
] as const;
