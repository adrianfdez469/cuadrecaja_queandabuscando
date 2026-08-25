/**
 * Slug generation for store and product URLs.
 *
 * Cuban business and product names are full of accents and ñ, and the slug ends
 * up in a public URL that people type and share, so normalisation matters more
 * here than in an internal system.
 */

const MAX_LENGTH = 80;

/** Words a slug may not consist of, because they collide with real routes. */
const RESERVED = new Set([
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
]);

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

export function isValidSlug(slug: string): boolean {
  return (
    slug.length > 0 &&
    slug.length <= MAX_LENGTH &&
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) &&
    !isReservedSlug(slug)
  );
}

/**
 * Produce a slug that does not collide with `taken`.
 *
 * `taken` is a predicate rather than a Set so the caller can hit the database
 * without this module knowing about Prisma.
 */
export async function uniqueSlug(
  input: string,
  taken: (candidate: string) => Promise<boolean> | boolean,
  options: { fallback?: string } = {},
): Promise<string> {
  const base = slugify(input) || options.fallback || "item";
  const seed = isReservedSlug(base) ? `${base}-tienda` : base;

  if (!(await taken(seed))) return seed;

  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${seed.slice(0, MAX_LENGTH - String(n).length - 1)}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }

  throw new Error(`Could not find a free slug for "${input}"`);
}
