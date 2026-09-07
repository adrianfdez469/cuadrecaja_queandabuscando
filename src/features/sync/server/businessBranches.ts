import { prisma } from "@/lib/prisma";
import { expandBrandRevalidation } from "@/features/storefront/server/registry";
import type { PublicSlug } from "@/lib/publicSlug";

/**
 * F-035 (architecture.md § AD1, AD2, AD3). Answers "what renderable branches
 * does this BUSINESS have?" — the set any business-scoped sync event
 * (`CURRENCY`, `EXCHANGE_RATE`, and whichever comes next) has to invalidate.
 *
 * The query is rooted at `Storefront`, exactly like `loadPublishedStorefronts`
 * (`src/features/catalog/server/queries.ts`), which R4 cites as the model:
 * the `status: { not: "DRAFT" }` filter lives in the NESTED `where`, never in
 * a `.filter()` run after the fact — a `DRAFT` branch without its own
 * `Store.slug` (`el-trebol-almacén` in the seed) must never reach
 * `canonicalSlug()`, which is the only place that can throw here (R6).
 * Conversion to canonical slugs is delegated to `expandBrandRevalidation()`
 * (`src/features/storefront/server/registry.ts`) — never a hand-rolled
 * `.map()`, which is the exact prohibition in AGENTS.md § Prohibiciones.
 * `.brandSlugs` is ignored on purpose (R11): a brand's own selector paints no
 * amount, so `storefrontTag` never goes stale over a rate.
 *
 * Throws only if the ADR 0018 invariant is already broken in the database
 * (a non-`DRAFT` branch of a multi-branch brand with no `Store.slug` of its
 * own) — not swallowed here; see architecture.md § AP1.
 */
async function loadRenderableBranchSlugs(businessId: string): Promise<readonly PublicSlug[]> {
  const brands = await prisma.storefront.findMany({
    where: { businessId },
    select: {
      slug: true,
      stores: { where: { status: { not: "DRAFT" } }, select: { slug: true } },
    },
  });

  return brands.flatMap(
    (brand) => expandBrandRevalidation(brand.slug, brand.stores).canonicalSlugs,
  );
}

/** Memoized per BATCH — what the handlers receive, never `prisma` itself. */
export type RenderableBranchLookup = (businessId: string) => Promise<readonly PublicSlug[]>;

/**
 * Creates the memo (architecture.md § AD1): a `Map` held in a closure, built
 * ONCE per batch by `processCatalogBatch` and passed down to the handlers —
 * NEVER module-level state, which would leak one business's set into
 * another's request and never expire on a long-lived server. NEVER React's
 * `cache()` either: it only memoizes with a cache dispatcher installed, and
 * the route handler that carries this batch (`src/app/api/internal/sync/
 * catalog/route.ts`) does not have one — `cache()` would be a silent no-op
 * there (ficha `.agent/playbook/cache-de-react-es-un-no-op-en-un-route-handler.md`).
 *
 * The MAP stores the PROMISE, not the resolved value, so the 500th event of a
 * batch awaits the SAME in-flight query as the 2nd instead of racing a fresh
 * one. If that promise rejects (the database drops mid-batch), its entry is
 * deleted: the event that suffered the failure fails on its own, and the
 * NEXT event retries the query from scratch instead of every remaining event
 * in the batch inheriting the same rejected promise.
 *
 * Lazy on purpose: the query does not run until the first `CURRENCY`/
 * `EXCHANGE_RATE` of the batch calls the returned function, so a batch of
 * 500 `PRODUCT` events pays nothing for this at all.
 */
export function createRenderableBranchLookup(): RenderableBranchLookup {
  const memo = new Map<string, Promise<readonly PublicSlug[]>>();

  return (businessId: string) => {
    const existing = memo.get(businessId);
    if (existing) return existing;

    const promise = loadRenderableBranchSlugs(businessId);
    promise.catch(() => memo.delete(businessId));
    memo.set(businessId, promise);
    return promise;
  };
}
