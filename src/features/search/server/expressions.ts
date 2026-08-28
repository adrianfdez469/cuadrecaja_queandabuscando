import { Prisma } from "@/generated/prisma/client";
import { SEARCH_TS_CONFIG } from "@/constants/search";

/**
 * THE one file under `src/` that composes `to_tsvector(...)` (guard G2,
 * `src/features/marketplace/server/boundaries.test.ts`), moved here from
 * `src/features/marketplace/server/searchVector.ts` (F-021 architecture.md
 * § I4). The marketplace search (F-015) and the store search (F-021) both
 * import from here instead of writing the literal themselves: if the
 * dictionary or the shape of the expression ever changes, there is exactly
 * one place to change it (ADR 0019 (b), extended by docs/adr/0021).
 *
 * `search` and not `lib`: composing `Prisma.sql` means importing the
 * generated Prisma client, and that is "touching Prisma" for
 * `AGENTS.md` § Arquitectura's layering — the same call ADR 0019 (a) already
 * made for the marketplace's own expressions.
 */

/** THE query expression (R8). Its twin is `canonicalSearchVectorOf`/
 *  `storeProductSearchVectorOf` below: if one changes, so must the other.
 *  `plainto_tsquery` never throws on a person's text — that is what
 *  R8/E12 require and `to_tsquery` cannot give. */
export const searchQueryOf = (term: string): Prisma.Sql =>
  Prisma.sql`plainto_tsquery(${SEARCH_TS_CONFIG}::regconfig, unaccent(${term}))`;

/**
 * THE write expression for an unweighted document — the canonical's (F-015)
 * and the building block `storeProductSearchVectorOf` wraps in `setweight`
 * below.
 *
 * `document` is either the literal text to bind as a parameter (a fixture's
 * or a handler's already-known string) or a raw `Prisma.Sql` fragment — a
 * column reference such as `d."namePart"` for a bulk `UPDATE ... FROM`
 * (R11: never a person's text string-interpolated; a `Prisma.Sql` fragment
 * here is always a column/table reference this module's own callers built,
 * never raw user input).
 */
export const canonicalSearchVectorOf = (document: Prisma.Sql | string): Prisma.Sql =>
  Prisma.sql`to_tsvector(${SEARCH_TS_CONFIG}::regconfig, unaccent(${document}))`;

/**
 * F-021: the weighted `tsvector` of a `StoreProduct`'s search index — A for
 * its own `localName`, B for this business's aliases of the canonical, C
 * for its `description` (spec.md R2, architecture.md § SQL — W3).
 */
export const storeProductSearchVectorOf = (parts: {
  namePart: Prisma.Sql | string;
  aliasPart: Prisma.Sql | string;
  descPart: Prisma.Sql | string;
}): Prisma.Sql =>
  Prisma.sql`setweight(${canonicalSearchVectorOf(parts.namePart)}, 'A')
          || setweight(${canonicalSearchVectorOf(parts.aliasPart)}, 'B')
          || setweight(${canonicalSearchVectorOf(parts.descPart)}, 'C')`;
