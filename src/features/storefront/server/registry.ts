import { prisma } from "@/lib/prisma";
import { isReservedSlug, slugify, uniqueSlug } from "@/lib/slug";
import { canonicalSlug, type PublicSlug } from "@/lib/publicSlug";
import { isUniqueViolation } from "@/features/orders/server/prismaErrors";
import type { Prisma } from "@/generated/prisma/client";
import { assertProposableSlug, type SlugProposalRejection } from "../schemas";

/**
 * The SINGLE writer of `Slug` and `Storefront` (architecture.md § El
 * registro). Nothing else in `src/` creates a row in either table —
 * `boundaries.test.ts` in this directory proves it by grep, the same
 * mechanism that already guards the admin panel's write funnel.
 */

const MAX_SLUG_RETRIES = 3;

export type SlugRejection = SlugProposalRejection | "SLUG_TAKEN";

/**
 * Exactly the `Store` columns `handleStore` already sets when creating a
 * branch — no `storefrontId` (the nested write assigns it) and no `slug`
 * (a brand-new branch never keeps one of its own; etapa 2's "agrupar" is
 * what gives a branch a `slug` of its own).
 */
export type StoreCreateData = Omit<
  Prisma.StoreUncheckedCreateWithoutStorefrontInput,
  "slugEntry" | "products" | "promotions" | "orders" | "adminAccess"
>;

export type CreateBrandInput = {
  /** From the caller, NEVER from the payload (F-018 will change who the
   *  caller is, not this signature). */
  businessId: string;
  brandName: string;
  /** An explicit candidate (validated and REJECTED if bad) or `null` to
   *  derive one the way the sync always has. */
  proposedSlug: string | null;
  /** Seed for derivation when `proposedSlug` is `null`. */
  derivedFrom: string;
  store: StoreCreateData;
};

export type CreateBrandResult =
  | { ok: true; storefrontId: string; storeId: string; canonicalSlug: PublicSlug }
  | { ok: false; error: SlugRejection };

async function slugTaken(candidate: string): Promise<boolean> {
  // R13: a RETIRED row still occupies its value — it must never look free.
  const row = await prisma.slug.findUnique({
    where: { value: candidate },
    select: { value: true },
  });
  return row !== null;
}

/**
 * Creates a brand and its first branch in ONE nested write (architecture.md
 * § Escritura del registro). Deliberately not a `$transaction`: Prisma
 * wraps a nested `create` in its own server-side transaction, and using the
 * global client inside a `$transaction` callback is exactly what deadlocks
 * against the pooler in transaction mode (ficha pooler-transaccion-deadlock).
 *
 * A `proposedSlug` is validated with ZERO queries before anything is
 * touched (criterio 8) and rejected outright if it collides later
 * (`SLUG_TAKEN`) — it is never auto-suffixed. A derived slug (the sync's
 * path) never fails: a collision retries with the next candidate, up to
 * `MAX_SLUG_RETRIES` times, because a sync event must never fail over an
 * unfortunate name (E14).
 */
export async function createStorefrontWithStore(
  input: CreateBrandInput,
): Promise<CreateBrandResult> {
  let slug: string;
  if (input.proposedSlug !== null) {
    const rejection = assertProposableSlug(input.proposedSlug);
    if (rejection) return { ok: false, error: rejection };
    slug = input.proposedSlug;
  } else {
    slug = await uniqueSlug(input.derivedFrom, slugTaken, { fallback: "tienda" });
  }

  for (let attempt = 0; attempt < MAX_SLUG_RETRIES; attempt += 1) {
    try {
      const created = await prisma.storefront.create({
        data: {
          businessId: input.businessId,
          name: input.brandName,
          slug,
          slugEntry: { create: { value: slug, kind: "STOREFRONT" } },
          stores: { create: input.store },
        },
        select: { id: true, slug: true, stores: { select: { id: true } } },
      });
      const storeId = created.stores[0]?.id;
      // Programmer-error guard: the nested create above always creates
      // exactly one store, so this can only fire if that changes.
      if (!storeId)
        throw new Error("createStorefrontWithStore: nested store create returned no id");

      return {
        ok: true,
        storefrontId: created.id,
        storeId,
        canonicalSlug: canonicalSlug({
          storeSlug: null,
          brandSlug: created.slug,
          brandBranchCount: 1,
        }),
      };
    } catch (error) {
      const collided = isUniqueViolation(error, "slug") || isUniqueViolation(error, "value");
      if (!collided) throw error;
      if (input.proposedSlug !== null) return { ok: false, error: "SLUG_TAKEN" };
      // Lost a race against another event deriving the same value: the DB
      // now knows it is taken, so asking uniqueSlug again (fresh query)
      // finds the next free candidate.
      slug = await uniqueSlug(input.derivedFrom, slugTaken, { fallback: "tienda" });
    }
  }

  return { ok: false, error: "SLUG_TAKEN" };
}

export type PreviewSlugReason = "free" | "own" | "taken" | "reserved" | "retired" | "invalid";

export type PreviewSlugResult = {
  candidate: string;
  available: boolean;
  reason: PreviewSlugReason;
  resolvedSlug: string;
  storeKnown: boolean;
};

export type PreviewSlugInput = {
  /** Explicit candidate, already what the caller wants tried first. */
  slug: string | null;
  /** Used to derive a candidate when `slug` yields nothing sluggable. */
  name: string | null;
  /** The POS's `Tienda.id` (our `Store.externalId`) — decides `own` vs
   *  `taken`. `null` when the caller does not know it yet. */
  storeExternalId: string | null;
};

/**
 * HS7 — tells cuadrecaja what slug WOULD result, without reserving
 * anything. Calls the exact same `uniqueSlug`/`slugTaken` pair the creator
 * uses: if the forecast and the creation were two implementations, this
 * would lie the day someone changed one without the other.
 */
export async function previewSlug(input: PreviewSlugInput): Promise<PreviewSlugResult> {
  const seed = input.slug || input.name || "";
  const candidate = slugify(seed);

  const storeKnown = input.storeExternalId
    ? (await prisma.store.count({ where: { externalId: input.storeExternalId } })) > 0
    : false;

  if (!candidate) {
    const resolvedSlug = await uniqueSlug(seed, slugTaken, { fallback: "tienda" });
    return { candidate: seed, available: false, reason: "invalid", resolvedSlug, storeKnown };
  }

  if (isReservedSlug(candidate)) {
    const resolvedSlug = await uniqueSlug(candidate, slugTaken, { fallback: "tienda" });
    return { candidate, available: false, reason: "reserved", resolvedSlug, storeKnown };
  }

  const row = await prisma.slug.findUnique({
    where: { value: candidate },
    select: {
      kind: true,
      retiredAt: true,
      storefront: { select: { stores: { select: { externalId: true } } } },
      store: { select: { externalId: true } },
    },
  });

  if (!row) {
    return { candidate, available: true, reason: "free", resolvedSlug: candidate, storeKnown };
  }

  if (row.retiredAt) {
    // R13: a retired value never goes back into the pool.
    const resolvedSlug = await uniqueSlug(candidate, slugTaken, { fallback: "tienda" });
    return { candidate, available: false, reason: "retired", resolvedSlug, storeKnown };
  }

  const ownedByCaller =
    input.storeExternalId != null &&
    (row.store?.externalId === input.storeExternalId ||
      row.storefront?.stores.some((store) => store.externalId === input.storeExternalId) === true);

  if (ownedByCaller) {
    return { candidate, available: true, reason: "own", resolvedSlug: candidate, storeKnown };
  }

  const resolvedSlug = await uniqueSlug(candidate, slugTaken, { fallback: "tienda" });
  return { candidate, available: false, reason: "taken", resolvedSlug, storeKnown };
}
