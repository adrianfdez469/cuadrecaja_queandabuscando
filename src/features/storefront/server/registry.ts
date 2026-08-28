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
  /** F-018: the token's own business. `storeExternalId` is treated as
   *  unknown (R10) unless it names a store that belongs to THIS business —
   *  the rest of the response (`candidate`/`available`/`resolvedSlug`/`url`)
   *  stays unscoped: the slug namespace is global and public (E21, E22). */
  businessId: string;
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

  // R10: a storeExternalId that belongs to someone else is treated as if it
  // had never been sent — never as an oracle of another tenant's stores.
  const ownStoreExternalId =
    input.storeExternalId &&
    (await prisma.store.count({
      where: { externalId: input.storeExternalId, businessId: input.businessId },
    })) > 0
      ? input.storeExternalId
      : null;
  const storeKnown = ownStoreExternalId !== null;

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
    ownStoreExternalId != null &&
    (row.store?.externalId === ownStoreExternalId ||
      row.storefront?.stores.some((store) => store.externalId === ownStoreExternalId) === true);

  if (ownedByCaller) {
    return { candidate, available: true, reason: "own", resolvedSlug: candidate, storeKnown };
  }

  const resolvedSlug = await uniqueSlug(candidate, slugTaken, { fallback: "tienda" });
  return { candidate, available: false, reason: "taken", resolvedSlug, storeKnown };
}

/** A brand member the way every writer that touches `storefront.stores`
 *  already selects it — this file never needs more than the own slug. */
export type BrandMemberSlug = { slug: string | null };

declare const slugTouchSetBrand: unique symbol;
/**
 * The array `expandBrandTouch()` returns, and nothing else. Nominally
 * typed on purpose (`unique symbol`, erased at runtime — same trick as
 * `PublicSlug` in `lib/publicSlug.ts`), so a hand-rolled array that
 * happens to end up `string[]`-shaped — no matter which of the many
 * equivalent ways someone writes "project this members list down to its
 * slugs" (`.map`, destructuring, a `for` loop, `.reduce`, a named helper
 * function…) — does NOT satisfy this type. `RegroupResult.revalidate.
 * slugValues` and `HandlerOutcome.touchedSlugValues` (`features/sync/
 * server/handlers/types.ts`) both require it, which makes writing the bug
 * `.agent/playbook/revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md`
 * fichó three times over a TYPE ERROR at those two sites, not something
 * that depends on `boundaries.test.ts`'s grep noticing the right syntax
 * shape. That grep test stays as a second, admittedly partial, line of
 * defense — see its own comment for exactly what it does and does not
 * catch, and why the real guarantee is this type, not the pattern match.
 *
 * `setStoreEnabled` (`features/admin/server/mutations.ts`) calls
 * `revalidateSlugs(expandBrandTouch(...))` inline, with no field in
 * between to brand — `revalidateSlugs` itself must keep accepting a plain
 * `Iterable<string>` because most of its callers have nothing to do with
 * a brand touch at all (a single canonical slug, a sync batch's mixed
 * set…), so narrowing ITS signature would force every unrelated caller to
 * contort its own array into this brand for no reason. That one call site
 * is the one instance of the historical defect this type does not turn
 * into a compile error; the grep test is what still watches it.
 */
export type SlugTouchSet = readonly string[] & { readonly [slugTouchSetBrand]: true };

/**
 * THE single place that turns "a brand's own slug, plus the FULL list of
 * its members as they stand at this moment" into every slug VALUE whose
 * cached resolution (`resolvePublicSlug`, `slugTag`) may have just changed
 * meaning — not only the row a caller's write touched.
 *
 * `.agent/playbook/revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md`
 * fichó the same defect three times over (`regroupStoreIntoBrand`,
 * `setStoreEnabled`, the sync's routine `STORE` update) before this
 * function existed — each writer had its own inline
 * `.map((s) => s.slug).filter(...)`, and each forgot a different case
 * (the brand's own slug, a preexisting sibling, a shrinking brand). Every
 * one of them now calls THIS instead of hand-rolling the array again —
 * and, for the two callers that store the result in a typed field instead
 * of firing it inline, `SlugTouchSet` (above) makes a hand-rolled
 * replacement fail to compile, in any syntactic shape, not only the one
 * `boundaries.test.ts`'s grep happens to recognize.
 *
 * Zero queries: every caller already has `members` in memory from the SAME
 * `select` it used to compute its own write — this only reshapes what is
 * already loaded.
 */
export function expandBrandTouch(
  brandSlug: string,
  members: readonly BrandMemberSlug[],
): SlugTouchSet {
  const ownSlugValues = members
    .map((member) => member.slug)
    .filter((slug): slug is string => slug !== null);
  return [brandSlug, ...ownSlugValues] as unknown as SlugTouchSet;
}

declare const brandRevalidationBrand: unique symbol;
/**
 * F-011 tanda 3 (R36, R37, I12): what `expandBrandRevalidation()` returns,
 * and nothing else. Same nominal trick as `SlugTouchSet` above — a
 * hand-rolled object with this exact shape does NOT satisfy this type, so
 * building the revalidation set any other way is a compile error at
 * `saveBrandTheme`'s signature, not something that depends on a grep
 * recognizing the right syntax.
 */
export type BrandRevalidationSet = {
  /** Canonical slug of every RENDERABLE branch — for `revalidateStores`. */
  readonly canonicalSlugs: readonly PublicSlug[];
  /** The brand's own slug — for `revalidateStorefronts`. */
  readonly brandSlugs: readonly string[];
} & { readonly [brandRevalidationBrand]: true };

/**
 * THE single place that turns "a brand's own slug, plus its RENDERABLE
 * members as they stand right now" into what a branding write has to
 * revalidate (R36): every member's own canonical slug, plus the brand's own.
 * Gemela of `expandBrandTouch` — a branding write does not change any
 * slug's RESOLUTION (§ Cinco cosas que solo se ven leyendo, punto 3 de
 * architecture.md), so this never calls `revalidateSlugs`, only
 * `revalidateStores`/`revalidateStorefronts`.
 *
 * No cast: every canonical slug is produced by `canonicalSlug()` itself, so
 * a brand with exactly one renderable member returns `[brandSlug]` with no
 * special case, and `canonicalSlug()` throws if a member of a multi-branch
 * brand somehow lacks its own `slug` — the ADR 0018 invariant broken
 * upstream, not swallowed here.
 */
export function expandBrandRevalidation(
  brandSlug: string,
  members: readonly BrandMemberSlug[],
): BrandRevalidationSet {
  const canonicalSlugs = members.map((member) =>
    canonicalSlug({
      storeSlug: member.slug,
      brandSlug,
      brandBranchCount: members.length,
    }),
  );
  return {
    canonicalSlugs,
    brandSlugs: [brandSlug],
  } as unknown as BrandRevalidationSet;
}

export type RegroupInput = { primaryStoreId: string; joiningStoreId: string };

export type RegroupRejection = "DIFFERENT_BUSINESS" | "ALREADY_IN_BRAND" | "NOT_FOUND";

export type RegroupResult =
  | {
      ok: true;
      storefrontId: string;
      /** Every slug value whose RESOLUTION changed — the brand's own value
       *  did not necessarily move rows, but its resolver output did (1
       *  branch → selector), which is exactly what `slugTag` exists to
       *  invalidate (R18). `slugValues` is a `SlugTouchSet`: it can only
       *  be built by concatenating `expandBrandTouch()` calls, never a
       *  hand-rolled array (see that type's own comment). */
      revalidate: { canonicalSlugs: PublicSlug[]; brandSlugs: string[]; slugValues: SlugTouchSet };
    }
  | { ok: false; error: RegroupRejection };

/**
 * Agrupar (HS8, architecture.md § Agrupar dos tiendas bajo una marca): moves
 * `joiningStoreId` under `primaryStoreId`'s brand. The five writes and their
 * ORDER live here, not in `features/admin/server/mutations.ts` — this file
 * is the only one allowed to touch `Slug` (`boundaries.test.ts`), and the
 * admin feature's own mutation calls this instead of duplicating it.
 *
 * Two shapes, decided by whether the joining store is the ONLY member of its
 * current brand:
 *
 * - **Single-branch** (the common case, § Qué les pasa a los slugs): its
 *   brand's slug is reassigned to the store itself (`kind: STOREFRONT` →
 *   `STORE`) and the now-empty brand is deleted. Order matters: the
 *   reassignment happens BEFORE the delete, or the registry row would lose
 *   its owner and the URL would 404.
 * - **Already multi-branch** (§ "Si B ya era una de varias sucursales de su
 *   marca"): it already owns its own `Store.slug` by the multi-branch
 *   invariant — only its `storefrontId` moves, and its old brand survives
 *   with whichever siblings remain.
 *
 * Either way, if `primaryStoreId` had no `Store.slug` of its own yet (its
 * brand had exactly one branch before this call), it mints one — but only
 * once: a SECOND grouping onto an already-multi-branch primary skips this.
 *
 * One `prisma.$transaction([...])` in ARRAY form, never the interactive
 * callback (ficha `pooler-transaccion-deadlock`): the pooler runs in
 * transaction mode, and the global client has no "inside" to misuse in the
 * array form.
 */
export async function regroupStoreIntoBrand(input: RegroupInput): Promise<RegroupResult> {
  const [primary, joining] = await Promise.all([
    prisma.store.findUnique({
      where: { id: input.primaryStoreId },
      select: {
        id: true,
        name: true,
        businessId: true,
        storefrontId: true,
        slug: true,
        // The FULL list of A's brand as it stood BEFORE this write — every
        // one of them (except A itself, whose own tag is already handled
        // separately) has to be revalidated too: their cached "branch"
        // resolution carries the sibling list `/[slug]/sucursales` reads
        // (resolve.ts's `branches?`), and that list is now stale the moment
        // a new member joins (§ Tabla de errores no dice esto, pero I5/R18
        // sí lo exigen — un fallo real, ver ficha
        // `regroupStoreIntoBrand-revalida-solo-lo-que-escribe`).
        storefront: {
          select: { id: true, slug: true, stores: { select: { id: true, slug: true } } },
        },
      },
    }),
    prisma.store.findUnique({
      where: { id: input.joiningStoreId },
      select: {
        id: true,
        businessId: true,
        storefrontId: true,
        slug: true,
        storefront: {
          select: { id: true, slug: true, stores: { select: { id: true, slug: true } } },
        },
      },
    }),
  ]);

  if (!primary || !joining) return { ok: false, error: "NOT_FOUND" };
  if (primary.businessId !== joining.businessId) return { ok: false, error: "DIFFERENT_BUSINESS" };
  if (primary.storefrontId === joining.storefrontId)
    return { ok: false, error: "ALREADY_IN_BRAND" };

  const joiningBrandSlug = joining.storefront.slug;
  const joiningBrandIsSingle = joining.storefront.stores.length === 1;
  // The joining store ends this call with its OWN `Store.slug` either way:
  // it already had one (multi-branch case) or it inherits its old brand's
  // (single-branch case).
  const joiningOwnSlug = joining.slug ?? joiningBrandSlug;

  const writes: Prisma.PrismaPromise<unknown>[] = [];

  if (joiningBrandIsSingle) {
    writes.push(
      prisma.slug.update({
        where: { value: joiningBrandSlug },
        data: { kind: "STORE", storefrontId: null, storeId: joining.id },
      }),
      prisma.store.update({
        where: { id: joining.id },
        data: { slug: joiningBrandSlug, storefrontId: primary.storefrontId },
      }),
    );
  } else {
    writes.push(
      prisma.store.update({
        where: { id: joining.id },
        data: { storefrontId: primary.storefrontId },
      }),
    );
  }

  let primaryOwnSlug = primary.slug;
  if (!primaryOwnSlug) {
    // DP5: the SAME function the preview screen calls (§ Agrupar dos
    // tiendas, "de dónde sale ese qué va a cambiar") — never a second
    // derivation that could promise a string this write does not produce.
    primaryOwnSlug = (
      await previewSlug({
        slug: null,
        name: primary.name,
        storeExternalId: null,
        businessId: primary.businessId,
      })
    ).resolvedSlug;
    writes.push(
      prisma.store.update({ where: { id: primary.id }, data: { slug: primaryOwnSlug } }),
      prisma.slug.create({ data: { value: primaryOwnSlug, kind: "STORE", storeId: primary.id } }),
    );
  }

  // The now-empty brand disappears LAST: by the time this runs, its slug
  // row was already re-pointed at the joining store (or never touched, in
  // the multi-branch case) — never the other way around, or `/b` would 404
  // between the two writes (architecture.md § Cómo se escribe).
  if (joiningBrandIsSingle) {
    writes.push(prisma.storefront.delete({ where: { id: joining.storefront.id } }));
  }

  await prisma.$transaction(writes);

  const primaryBrandSlug = primary.storefront.slug;

  // Every string whose CACHED RESOLUTION changes meaning, not only the ones
  // this call writes a row for (I5/R18 — the trap this whole feature exists
  // to close, and the one a first pass of this function still fell into).
  // `expandBrandTouch` is given the membership AFTER this write, for BOTH
  // brands that could still exist once it settles:
  //
  // 1. A's brand, with its pre-existing members (`primary.storefront.stores`,
  //    self included) PLUS the joining store — covers A's own slug (or the
  //    brand slug, if A had none yet), every PRE-EXISTING sibling of A (a
  //    repeat grouping's `branches[]` they did not know about yet), and B's
  //    final own slug.
  // 2. B's OLD brand, but ONLY when it survives (it was already
  //    multi-branch): its own slug — a selector that just lost a member, or
  //    that dropped to exactly one and started resolving that ONE remaining
  //    branch AS the brand slug — and every sibling LEFT BEHIND.
  //
  // Neither snapshot gets every one of its entries a `Slug`/`Store` row
  // written FOR IT in this call — exactly why revalidating "only what I
  // wrote" is not enough here.
  const primaryMembersAfterJoin: BrandMemberSlug[] = [
    ...primary.storefront.stores.map((store) =>
      store.id === primary.id ? { slug: primaryOwnSlug } : store,
    ),
    { slug: joiningOwnSlug },
  ];
  const joiningRemainingMembers: BrandMemberSlug[] = joiningBrandIsSingle
    ? []
    : joining.storefront.stores.filter((store) => store.id !== joining.id);

  // Concatenating two `SlugTouchSet`s with `[...a, ...b]` re-widens the
  // result to a plain `string[]` (spread erases the brand) — re-asserting
  // it here is safe because BOTH operands already went through
  // `expandBrandTouch()`, and this is the one place in the whole codebase
  // allowed to make that claim.
  const touchedSlugValues = [
    ...expandBrandTouch(primaryBrandSlug, primaryMembersAfterJoin),
    ...(joiningBrandIsSingle ? [] : expandBrandTouch(joiningBrandSlug, joiningRemainingMembers)),
  ] as unknown as SlugTouchSet;

  return {
    ok: true,
    storefrontId: primary.storefrontId,
    revalidate: {
      canonicalSlugs: touchedSlugValues as unknown as PublicSlug[],
      brandSlugs: joiningBrandIsSingle ? [primaryBrandSlug] : [primaryBrandSlug, joiningBrandSlug],
      slugValues: touchedSlugValues,
    },
  };
}
