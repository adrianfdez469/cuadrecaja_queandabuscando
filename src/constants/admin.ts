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
