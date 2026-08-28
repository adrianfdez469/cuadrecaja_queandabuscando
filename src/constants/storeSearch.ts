/**
 * Store search (F-021): everything about the three-layer read and its
 * pagination that is NOT shared with the marketplace search — the tokens
 * here are `StoreSearch`'s alone (architecture.md § Componentes, "etapa 1").
 */

/** A2/A4 (design.md): the number of results per page. 24 is a multiple of
 *  2, 3 and 4 — the catalogue's own grid at 360/768/1280px — so the last row
 *  never sits half-empty. */
export const STORE_SEARCH_PAGE_SIZE = 24;

/** Caps the candidates pulled by the lexical and the fuzzy layer BEFORE
 *  ordering (R1's CTEs, architecture.md § SQL — Q1). Bounds the cost of a
 *  very common term without changing the order of what is actually
 *  returned. */
export const STORE_SEARCH_LAYER_MAX = 200;

/** The category-expansion layer is context, not a match: it can never flood
 *  the result (spec.md § Alcance, R1). */
export const STORE_SEARCH_EXPANSION_MAX = 24;

/** `ts_rank` weights, IN THE ORDER POSTGRES REQUIRES: [D, C, B, A].
 *  A = localName, B = this business's aliases, C = description, D unused.
 *  Tuned later with the query log (spec.md § No decidido a propósito) —
 *  living here makes that a one-line change, not a SQL rewrite. */
export const STORE_SEARCH_RANK_WEIGHTS = [0.1, 0.4, 0.7, 1.0] as const;

/** Caps how deep pagination's OFFSET can go (architecture.md § Escalabilidad,
 *  point 4). Never reached raw — `clampSearchPage` enforces it before a `p`
 *  value ever gets near SQL. */
export const STORE_SEARCH_MAX_PAGE = 50;
