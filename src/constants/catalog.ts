/**
 * F-026: the fallback base `uniqueSlug()` falls back to when a category's
 * `name` slugifies to the empty string (e.g. a name made only of emoji or
 * punctuation). Matches the fallback the migration's higiene step
 * (`prisma/migrations/20260831033437_local_category_slug_unique/migration.sql`)
 * applies to pre-existing rows, so a category created before and after this
 * feature never gets two different empty-name conventions.
 */
export const CATEGORY_SLUG_FALLBACK = "categoria";

/**
 * F-026: the second-level route segment for the category view,
 * `/[slug]/c/[categorySlug]` — the sibling of `p` in
 * `src/app/[slug]/p/[productSlug]/page.tsx`. Not in `RESERVED_SLUGS`: it is
 * a segment one level DOWN from a store's own slug, so it never competes
 * with a first-level value the way `p` doesn't either
 * (architecture.md § Alternativas descartadas).
 */
export const CATEGORY_ROUTE_SEGMENT = "c";
