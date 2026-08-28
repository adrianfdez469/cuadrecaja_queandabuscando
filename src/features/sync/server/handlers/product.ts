import { prisma } from "@/lib/prisma";
import { buildSearchDocument, resolveCanonicalIdentity } from "@/lib/canonical";
import { uniqueSlug } from "@/lib/slug";
import { canonicalSlug } from "@/lib/publicSlug";
import { writeSearchDocument } from "@/features/marketplace/server/searchVector";
import { reindexStoreProductsOfCanonical } from "@/features/catalog/server/searchIndex";
import { recordCanonicalBarcodes } from "../canonicalBarcodes";
import type { ProductPayload } from "../../schemas";
import { SKIPPED, STALE, type HandlerOutcome } from "./types";

/**
 * The core of the contract. Steps mirror docs/sync-contract.md:
 *
 *   1. publishToStore = false  -> soft-delete and stop
 *   2. resolve canonical identity (explicit id | EAN | orphan)
 *   3. upsert StoreProduct by (storeId, canonicalProductId)
 *   4. record every valid barcode against the resolved canonical (F-024)
 *   5. upsert ProductAlias, useCount++
 *   6. if the alias is new, recompute the canonical's searchDocument
 *   7. recompute this business's OFFERS' own search index (F-021)
 *
 * Step 6 is the one that is easy to forget and degrades search silently, so it
 * lives here as an explicit effect rather than as the caller's responsibility.
 * F-015: every write of `searchDocument` (the three canonical creates below,
 * and the alias-recompute at the end of `recordAlias`) goes through
 * `writeSearchDocument` (`@/features/marketplace/server/searchVector`), which
 * writes `searchDocument` AND `searchVector` in the same UPDATE — there is no
 * separate reindex pass, and no other place in the repo writes either column.
 *
 * Step 7 (F-021, R3, E9): the sync owns `StoreProduct.localName`, which is
 * the main source of a StoreProduct's OWN search index — a derived column
 * neither side writes directly (`src/features/catalog/server/
 * searchIndex.ts`). `reindexStoreProductsOfCanonical` runs after
 * `recordAlias` because a new alias also changes the document, and it is
 * scoped by BUSINESS, not by this one offer, so every sibling offer that
 * just inherited the alias gets recomputed too (R2). Never reached on the
 * STALE or soft-delete paths, which both return before identity is even
 * resolved.
 *
 * F-024 (R10): step 4 goes AFTER the StoreProduct write and BEFORE the alias,
 * never before the stale-write guard and never on the DELETE/unpublish path
 * (both return earlier, above where identity is even resolved) — a stale
 * event or a soft delete must not write any barcode (E14, E15).
 *
 * Note the absence of a $transaction: the Supavisor pooler runs in transaction
 * mode, where a query on the global client inside $transaction deadlocks. Each
 * step is its own round trip, and the whole handler is idempotent, so a partial
 * application is corrected by the next delivery of the same event.
 */
export async function handleProduct(
  payload: ProductPayload,
  operation: "CREATE" | "UPDATE" | "DELETE",
  businessId: string,
): Promise<HandlerOutcome> {
  const store = await prisma.store.findUnique({
    where: { externalId: payload.storeId },
    select: {
      id: true,
      slug: true,
      businessId: true,
      storefront: {
        select: {
          slug: true,
          stores: { where: { status: { not: "DRAFT" } }, select: { id: true } },
        },
      },
    },
  });

  // Not an error: this is exactly what makes per-location opt-in work without
  // the two systems having to coordinate. A store that belongs to ANOTHER
  // business is treated the same way — never a new query, just the
  // `businessId` this `select` already carried (F-018, R1).
  if (!store || store.businessId !== businessId) return SKIPPED;

  const canonical = canonicalSlug({
    storeSlug: store.slug,
    brandSlug: store.storefront.slug,
    brandBranchCount: store.storefront.stores.length,
  });

  const existing = await prisma.storeProduct.findUnique({
    where: { storeId_externalId: { storeId: store.id, externalId: payload.storeProductId } },
    select: { id: true, sourceUpdatedAt: true, canonicalProductId: true },
  });

  const payloadUpdatedAt = new Date(payload.updatedAt);

  // Stale-write guard. With this in place the delivery order stops mattering,
  // which is what makes retries and the `attempts < 6` head-of-line filter safe.
  if (existing && existing.sourceUpdatedAt.getTime() >= payloadUpdatedAt.getTime()) {
    return STALE;
  }

  if (operation === "DELETE" || !payload.publishToStore) {
    if (!existing) return SKIPPED;
    await prisma.storeProduct.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), visible: false, sourceUpdatedAt: payloadUpdatedAt },
    });
    return {
      status: "processed",
      touchedStoreSlug: canonical,
      touchedBrandSlug: store.storefront.slug,
      touchedProductId: existing.id,
    };
  }

  const { canonicalId, barcodes } = await resolveCanonical(payload, store.id);
  const localCategoryId = await resolveLocalCategory(payload, store.businessId);

  const synced = {
    localName: payload.localName,
    syncedPrice: payload.price.toFixed(2),
    syncedPriceCurrency: payload.currency,
    localCategoryId,
    sourceUpdatedAt: payloadUpdatedAt,
    syncedAt: new Date(),
    // A product reappearing after a soft delete is un-deleted.
    deletedAt: null,
  };

  // Explicit create/update rather than upsert. The slug is only generated for a
  // new row, and an upsert would still validate — and therefore demand — a
  // complete `create` payload even on the update path.
  const product = existing
    ? await prisma.storeProduct.update({
        where: { id: existing.id },
        // Deliberately narrow: description, imageUrls, priceOverride, visible
        // and featured belong to the admin panel; the sync must never touch them.
        data: { canonicalProductId: canonicalId, ...synced },
        select: { id: true },
      })
    : await prisma.storeProduct.create({
        data: {
          storeId: store.id,
          canonicalProductId: canonicalId,
          externalId: payload.storeProductId,
          slug: await uniqueSlug(
            payload.localName,
            async (candidate) =>
              (await prisma.storeProduct.count({
                where: { storeId: store.id, slug: candidate },
              })) > 0,
            { fallback: "producto" },
          ),
          ...synced,
        },
        select: { id: true },
      });

  // F-024 (R10): between the StoreProduct write and the alias, so a stale
  // event or a soft delete (both returned above) never write a barcode, and
  // so a StoreProduct that failed to write (a `@unique` clash) never leaves
  // codes attached to an offer that does not exist.
  await recordCanonicalBarcodes(prisma, canonicalId, barcodes);

  await recordAlias(canonicalId, payload.localName, store.businessId);

  // F-021 (R3, E9): the sync owns `localName`, so it recomputes the search
  // index of every offer of this canonical for this business — never
  // reached on the STALE or soft-delete paths above, both of which return
  // before identity is even resolved.
  await reindexStoreProductsOfCanonical(prisma, canonicalId, store.businessId);

  return {
    status: "processed",
    touchedStoreSlug: canonical,
    touchedBrandSlug: store.storefront.slug,
    touchedProductId: product.id,
  };
}

/**
 * Three branches, and the third is the point: a product with neither a
 * canonical id nor a usable barcode still gets published, as an orphan
 * canonical that is excluded from the marketplace. There is never a product
 * that cannot be published.
 *
 * F-024: also returns the normalized/deduplicated/sorted barcode list so the
 * caller can record it against whichever canonical id this resolves to —
 * including the explicit-id branch, where the identity does not come from
 * the list at all but the codes still get stored (E13). Never write
 * `CanonicalProduct.ean` here beyond what already happens on create: setting
 * it to `barcodes[0]` on the explicit branch could collide with another
 * canonical's `@unique` and strand the event in `failed` forever, since a
 * retry hits the same collision (§ Antipatrones, architecture.md).
 */
async function resolveCanonical(
  payload: ProductPayload,
  storeId: string,
): Promise<{ canonicalId: string; barcodes: readonly string[] }> {
  const resolution = resolveCanonicalIdentity({
    canonicalProductId: payload.canonicalProductId,
    barcodes: payload.barcodes,
  });
  const { identity, barcodes } = resolution;

  if (identity.strategy === "explicit") {
    const found = await prisma.canonicalProduct.findUnique({
      where: { id: identity.canonicalProductId },
      select: { id: true },
    });
    if (found) return { canonicalId: found.id, barcodes };
    // The POS pointed at a canonical this side has never seen. Create it with
    // the id the POS chose, so both systems agree on the identity.
    const created = await prisma.canonicalProduct.create({
      data: {
        id: identity.canonicalProductId,
        name: payload.localName,
        imageUrl: payload.imageUrl ?? null,
      },
      select: { id: true },
    });
    await writeSearchDocument(prisma, created.id, buildSearchDocument(payload.localName, []));
    return { canonicalId: created.id, barcodes };
  }

  if (identity.strategy === "by-ean") {
    const existing = await prisma.canonicalProduct.findUnique({
      where: { ean: identity.ean },
      select: { id: true },
    });
    if (existing) return { canonicalId: existing.id, barcodes };

    const created = await prisma.canonicalProduct.create({
      data: {
        ean: identity.ean,
        name: payload.localName,
        imageUrl: payload.imageUrl ?? null,
      },
      select: { id: true },
    });
    await writeSearchDocument(prisma, created.id, buildSearchDocument(payload.localName, []));
    return { canonicalId: created.id, barcodes };
  }

  // Orphan. Reuse the one already attached to this product if there is one,
  // so repeated updates do not spawn a new canonical every time.
  //
  // F-018 (PP6): scoped by `storeId`, not global. `StoreProduct.externalId`
  // is unique PER STORE (`@@unique([storeId, externalId])`), and two
  // different POS installs number their products from 1 — the same
  // `externalId` in two stores is the normal case, not a coincidence. An
  // unscoped `findFirst` here handed the first matching row's canonical to
  // whichever store asked second, a real cross-tenant (and cross-branch)
  // leak this fixes by construction: `(storeId, externalId)` is the actual
  // identity of the product. Orphans are `isExclusive: true` and excluded
  // from the marketplace by design, so this never touches the by-ean merge
  // F-015 relies on.
  const reusable = await prisma.storeProduct.findFirst({
    where: { storeId, externalId: payload.storeProductId },
    select: { canonicalProductId: true },
  });
  if (reusable) return { canonicalId: reusable.canonicalProductId, barcodes };

  const created = await prisma.canonicalProduct.create({
    data: {
      name: payload.localName,
      imageUrl: payload.imageUrl ?? null,
      isExclusive: true,
    },
    select: { id: true },
  });
  await writeSearchDocument(prisma, created.id, buildSearchDocument(payload.localName, []));
  return { canonicalId: created.id, barcodes };
}

async function resolveLocalCategory(
  payload: ProductPayload,
  businessId: string,
): Promise<string | null> {
  if (!payload.localCategoryId) return null;
  const category = await prisma.localCategory.findUnique({
    where: { businessId_externalId: { businessId, externalId: payload.localCategoryId } },
    select: { id: true },
  });
  // A product may arrive before its category's own event. Leaving it
  // uncategorised is better than failing the event; the category event will
  // land and the next product update will attach it.
  return category?.id ?? null;
}

/**
 * Record how this business names the canonical product, and recompute the
 * search document when that name is new to it.
 */
async function recordAlias(
  canonicalProductId: string,
  text: string,
  businessId: string,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  const existing = await prisma.productAlias.findUnique({
    where: {
      canonicalProductId_text_businessId: { canonicalProductId, text: trimmed, businessId },
    },
    select: { id: true },
  });

  if (existing) {
    await prisma.productAlias.update({
      where: { id: existing.id },
      data: { useCount: { increment: 1 } },
    });
    return;
  }

  await prisma.productAlias.create({
    data: { canonicalProductId, text: trimmed, businessId },
  });

  // New alias => the search document is now out of date. Recomputed and
  // written — with the vector, in the same UPDATE — right here, not in a
  // separate reindexing pass (E2).
  const canonical = await prisma.canonicalProduct.findUnique({
    where: { id: canonicalProductId },
    select: { name: true, aliases: { select: { text: true } } },
  });
  if (!canonical) return;

  await writeSearchDocument(
    prisma,
    canonicalProductId,
    buildSearchDocument(
      canonical.name,
      canonical.aliases.map((alias) => alias.text),
    ),
  );
}
