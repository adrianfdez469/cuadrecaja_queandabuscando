/**
 * Slug generation for store and product URLs.
 *
 * Cuban business and product names are full of accents and ñ, and the slug ends
 * up in a public URL that people type and share, so normalisation matters more
 * here than in an internal system.
 */

const MAX_LENGTH = 80;

/**
 * Words a slug may not consist of, because they collide with real routes.
 *
 * Exported (F-017, R11): the storefront registry, the seed and the
 * migration's `RESERVED` rows all need the exact same list — duplicating it
 * anywhere is how a route ships without ever being reserved (I3 happened
 * exactly this way: F-011 added `sesion-cerrada` to `src/app/` and nobody
 * remembered this file).
 *
 * `sesion-cerrada` (F-011's top-level "session expired" page) and
 * `sucursales` (F-017 etapa 2's `/[slug]/sucursales`) are added here even
 * though the first exists in `src/app/` today and the second does not yet:
 * reserving early is free, discovering the collision after a brand has
 * taken the slug is not.
 */
export const RESERVED_SLUGS: readonly string[] = [
  "admin",
  "api",
  "app",
  "auth",
  "buscar",
  "carrito",
  "checkout",
  "cuenta",
  "login",
  "logout",
  "pedido",
  "public",
  "static",
  "_next",
  "sesion-cerrada",
  "sucursales",
];

const RESERVED = new Set(RESERVED_SLUGS);

export function slugify(input: string): string {
  const slug = input
    .normalize("NFD")
    // Strip combining marks: "Café" -> "Cafe". ñ decomposes to n + tilde, so
    // this handles it without a special case.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LENGTH)
    .replace(/-+$/g, "");

  return slug;
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug);
}

/**
 * Shape only — length and character set, with no opinion on whether the
 * value is reserved. Split out from `isValidSlug` (F-017) so a caller that
 * has to tell "malformed" apart from "reserved" (`features/storefront/`'s
 * `assertProposableSlug`, I4) does not re-derive the regex.
 */
export function isWellFormedSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= MAX_LENGTH && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}

export function isValidSlug(slug: string): boolean {
  return isWellFormedSlug(slug) && !isReservedSlug(slug);
}

/**
 * Produce a slug that does not collide with `taken`.
 *
 * `taken` is a predicate rather than a Set so the caller can hit the database
 * without this module knowing about Prisma.
 *
 * F-026: `honorReserved` defaults to `true` so no existing caller changes
 * behaviour. `RESERVED_SLUGS` exists to protect the FIRST level of a URL
 * (`/tienda`, `/buscar`, …) from ever being reassigned to a brand or a
 * branch; a category slug lives one level DOWN
 * (`/[slug]/c/[categorySlug]`), where `/tienda/c/buscar` does not compete
 * with `/tienda/buscar` at all (R11). A caller that scopes its own
 * namespace below the first level — today only `handleCategory` — passes
 * `honorReserved: false` so a category literally named "Buscar" keeps the
 * slug `buscar` instead of the permanently-frozen `buscar-tienda`.
 */
export async function uniqueSlug(
  input: string,
  taken: (candidate: string) => Promise<boolean> | boolean,
  options: { fallback?: string; honorReserved?: boolean } = {},
): Promise<string> {
  const { fallback, honorReserved = true } = options;
  const base = slugify(input) || fallback || "item";
  const seed = honorReserved && isReservedSlug(base) ? `${base}-tienda` : base;

  if (!(await taken(seed))) return seed;

  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${seed.slice(0, MAX_LENGTH - String(n).length - 1)}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }

  throw new Error(`Could not find a free slug for "${input}"`);
}
