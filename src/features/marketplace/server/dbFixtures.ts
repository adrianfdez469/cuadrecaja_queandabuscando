import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Availability, OrderStatus, StoreStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { buildSearchDocument, normalizeBarcodes } from "@/lib/canonical";
import { writeSearchDocument } from "./searchVector";
import {
  reindexStoreProduct,
  reindexStoreProductsOfStore,
} from "@/features/catalog/server/searchIndex";
import { recordCanonicalBarcodes } from "@/features/sync/server/canonicalBarcodes";
import { mintSyncToken } from "@/lib/syncAuth";

/**
 * Fixtures for the `db` vitest project (F-015, architecture.md § Pruebas
 * contra Postgres real, decision 4). The local database is shared across
 * four worktrees and already seeded, so isolation is by a **token unique
 * per execution** that travels inside the fixture's own search term/document
 * — never by truncating a table (`prisma migrate reset` is prohibited, and
 * this repo's own base is not empty).
 *
 * `qab_f015_<hex>` is embedded in every fixture's name/externalId/slug. A
 * `search.db.test.ts` assertion combines the token with a real word in the
 * SAME term (`"cafe qab_f015_ab12"`), so `plainto_tsquery`'s implicit AND can
 * only match this run's own row — exact even on a shared, pre-populated
 * table, including order and pagination assertions (E12, E21).
 *
 * F-021 (architecture.md § Riesgos y plan B): this module is now shared by
 * THREE features' `db` tests (F-015, F-018, F-021) and keeps the
 * `qab_f015_` prefix on purpose — renaming it to something feature-neutral
 * is a cleanup that does not fit this feature's scope, and is written down
 * rather than done silently.
 */

const TOKEN_PREFIX = "qab_f015_";
const STALE_AFTER_MS = 10 * 60 * 1000;

export function makeToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(6).toString("hex")}`;
}

/** Every hex digit of `hash` mapped to a decimal digit (`0-9a-f` -> `0-9`). */
function hexToDigits(hash: string): string {
  return hash.replace(/[0-9a-f]/g, (char) => (parseInt(char, 16) % 10).toString());
}

/**
 * 13 digits derived from the token (`"9" + 12 digits`), valid for
 * `normalizeBarcode` (an 8/12/13/14-digit run) and never one of the seed's
 * EANs (`CanonicalProduct.ean` is unique). `salt` lets one execution mint
 * several canonicals without colliding with itself.
 *
 * F-024: `CanonicalProduct.ean` stays unique — still the one code that picks
 * the fusion (R5) — but a canonical can now carry MORE codes in
 * `CanonicalBarcode` (spec.md I6). `createCanonical`'s `extraEans` below is
 * how a fixture adds them, always through the same `deriveEan` so they never
 * collide with the seed or with another fixture's own codes.
 */
export function deriveEan(token: string, salt = 0): string {
  const hash = createHash("sha256").update(`${token}:${salt}`).digest("hex");
  return `9${hexToDigits(hash).slice(0, 12)}`;
}

export type FixtureCanonical = { id: string; ean: string; name: string };
export type FixtureStore = { id: string; externalId: string };
export type FixtureOrder = { id: bigint };
export type FixtureLocalCategory = { id: string; name: string };
export type FixtureGlobalCategory = { id: string; slug: string; name: string };

export type FixtureSession = {
  token: string;
  businessId: string;
  /** F-018: `Business.externalId` — what a mismatch check (`identity.ts`)
   *  compares the payload's `businessId` against. Same value the session's
   *  own `business.create` used, exposed so tests do not have to rebuild it. */
  businessExternalId: string;
  /** F-018: the plaintext token this session's own `Business` authenticates
   *  with — `Authorization: Bearer <syncToken>` resolves to `businessId`.
   *  Minted once per session with the SAME `mintSyncToken` the guard uses. */
  syncToken: string;
  storefrontId: string;
  /** Creates a `Store` published by default (a live offer needs a
   *  `PUBLISHED` store, R5). */
  createStore(overrides?: { status?: StoreStatus }): Promise<FixtureStore>;
  /** Creates a `CanonicalProduct` and writes its search index through the
   *  SAME path the sync uses (`writeSearchDocument` — never a raw
   *  `data: { searchDocument }`, which is exactly what G1 forbids). The
   *  token is appended to `name` (and to every alias, via the caller) so a
   *  search for `<word> <token>` can only ever match this fixture.
   *  F-024: `extraEans` records additional `CanonicalBarcode` rows beyond
   *  the returned `ean`, through the same `recordCanonicalBarcodes` the sync
   *  uses — a fixture that needs several codes on one canonical. */
  createCanonical(opts: {
    name: string;
    aliases?: readonly string[];
    isExclusive?: boolean;
    extraEans?: readonly string[];
    /** F-021 (SP3, R17): only ever assigned in the fixture explicitly —
     *  mirrors the seed's own rule that a canonical without an `ean` never
     *  gets one either, though the fixture leaves that choice to the caller. */
    globalCategoryId?: string | null;
  }): Promise<FixtureCanonical>;
  /** Creates a `StoreProduct` offer. Defaults to a live one (AVAILABLE,
   *  visible, not deleted) so tests only have to override what they mean
   *  to break. F-021: reindexes the offer's own search columns through the
   *  SAME writer the panel/sync use (`reindexStoreProduct` — never a raw
   *  `data: { searchDocument }`), so a freshly-created fixture is
   *  immediately findable by `searchStoreProducts`. */
  createOffer(
    storeId: string,
    canonicalProductId: string,
    overrides?: {
      availability?: Availability;
      visible?: boolean;
      deletedAt?: Date | null;
      localName?: string;
      description?: string | null;
      localCategoryId?: string | null;
    },
  ): Promise<{ id: string }>;
  /** Registers a `CanonicalProduct` id this session did not create directly
   *  (e.g. one `handleProduct` created through the by-EAN path in
   *  `product.db.test.ts`), so `cleanup()` removes it too. Idempotent. */
  trackCanonical(id: string): void;
  /** F-021 (R17, E2b): creates a `LocalCategory` scoped to this session's
   *  own business, optionally under a `GlobalCategory` (the cascade's first
   *  half) or with none (its second half, `LocalCategory` alone). */
  createLocalCategory(opts?: {
    name?: string;
    globalCategoryId?: string | null;
  }): Promise<FixtureLocalCategory>;
  /** F-021 (R17, criterio 2): creates a `GlobalCategory` — a platform-wide
   *  row, not scoped to any business — with a token-unique `slug`. */
  createGlobalCategory(opts?: { name?: string }): Promise<FixtureGlobalCategory>;
  /** F-018 (E9-E11): creates a real `Order` owned by this session's
   *  business/store, with the columns `pullOrders`/`setOrderStatus` read.
   *  `code`/`idempotencyKey` carry the session's token, which is unique, so
   *  two sessions never collide on `Order.code`'s own `@unique`. */
  createOrder(storeId: string, overrides?: { status?: OrderStatus }): Promise<FixtureOrder>;
  /** F-018 (PP1, C7): bulk-inserts `n` filler orders for another (throwaway)
   *  business/store — never this session's own — so the pull's `EXPLAIN`
   *  has enough OTHER-tenant rows to make the planner prefer
   *  `Order_businessId_status_id_idx` without touching `enable_seqscan`.
   *  Returns the filler business/store ids so the caller can clean them up. */
  createFillerOrders(n: number): Promise<{ businessId: string; storeId: string }>;
  /** F-021 (SP4, criterio 8): bulk-inserts `n` `StoreProduct` offers, each
   *  with its OWN throwaway canonical (`StoreProduct`'s own
   *  `@@unique([storeId, canonicalProductId])` means one store can never
   *  hold two offers of the same canonical, so `n` rows confined to one
   *  store cannot share one), reindexed with a SINGLE call to
   *  `reindexStoreProductsOfStore` rather than once per row. `target`
   *  absent inserts into a throwaway (filler) business/store — the SAME one
   *  `createFillerOrders` uses — so `storeId` stays selective; `target`
   *  present inserts into a store this session already owns, so the
   *  session's OWN store also gets enough rows for `storeId = $4` to have
   *  to skip past them, not just filter them out cheaply. Every filler
   *  `localName` carries the session's token (ADR 0019 (d)), so it can
   *  never match another execution's own search term. */
  createFillerOffers(
    n: number,
    target?: { storeId: string; businessId: string },
  ): Promise<{ businessId: string; storeId: string }>;
  /** Deletes everything this session created, in the order
   *  architecture.md § Pruebas contra Postgres real spells out:
   *  StoreProduct -> Order -> CanonicalProduct (ProductAlias cascades) ->
   *  Store -> Storefront -> Business. `Order` before `Store`: the FK is
   *  `RESTRICT`, so a leftover order would make the `Store` delete fail. */
  cleanup(): Promise<void>;
};

export async function createFixtureSession(): Promise<FixtureSession> {
  const token = makeToken();
  const storeIds = new Set<string>();
  const canonicalIds = new Set<string>();
  const orderIds = new Set<bigint>();
  const localCategoryIds = new Set<string>();
  const globalCategoryIds = new Set<string>();
  let storeSalt = 0;
  let canonicalSalt = 0;
  let orderSalt = 0;
  let fillerOrderSalt = 0;
  let localCategorySalt = 0;
  let globalCategorySalt = 0;
  let fillerCanonicalSalt = 0;
  let filler: { businessId: string; storeId: string } | null = null;

  const businessExternalId = `${token}-business`;
  // F-018: minted with the SAME function the guard/mint script use, so a
  // request that presents `syncToken` as Bearer resolves through the real
  // `resolveCaller` path, not a shortcut only the fixture understands.
  const { token: syncToken, hash: syncTokenHash } = mintSyncToken();

  const business = await prisma.business.create({
    data: {
      externalId: businessExternalId,
      name: `F-015 fixture ${token}`,
      syncTokenHash,
    },
    select: { id: true },
  });
  const storefront = await prisma.storefront.create({
    data: {
      businessId: business.id,
      name: `F-015 fixture ${token}`,
      slug: `${token}-storefront`,
    },
    select: { id: true },
  });

  async function createStore(overrides: { status?: StoreStatus } = {}): Promise<FixtureStore> {
    storeSalt += 1;
    const store = await prisma.store.create({
      data: {
        businessId: business.id,
        storefrontId: storefront.id,
        externalId: `${token}-store-${storeSalt}`,
        // A brand (Storefront) grouping more than one branch requires each
        // branch to have its OWN slug (`src/lib/publicSlug.ts::canonicalSlug`)
        // — a session that creates a second store would otherwise make
        // `handleProduct` throw for BOTH, since the check only looks at how
        // many branches the brand has, not which one is being resolved.
        slug: `${token}-store-${storeSalt}`,
        name: `F-015 fixture store ${token}-${storeSalt}`,
        status: overrides.status ?? StoreStatus.PUBLISHED,
      },
      select: { id: true, externalId: true },
    });
    storeIds.add(store.id);
    return store;
  }

  async function createCanonical(opts: {
    name: string;
    aliases?: readonly string[];
    isExclusive?: boolean;
    extraEans?: readonly string[];
    globalCategoryId?: string | null;
  }): Promise<FixtureCanonical> {
    canonicalSalt += 1;
    const ean = deriveEan(token, canonicalSalt);
    const canonical = await prisma.canonicalProduct.create({
      data: {
        ean,
        name: opts.name,
        isExclusive: opts.isExclusive ?? false,
        globalCategoryId: opts.globalCategoryId ?? null,
      },
      select: { id: true },
    });
    canonicalIds.add(canonical.id);
    // Same writer the sync uses (W1) — never `data: { searchDocument }`
    // directly, which is exactly what guard G1 forbids.
    await writeSearchDocument(
      prisma,
      canonical.id,
      buildSearchDocument(opts.name, opts.aliases ?? []),
    );
    // F-024: same writer the sync uses (`recordCanonicalBarcodes`), never a
    // bespoke `createMany` on this table.
    await recordCanonicalBarcodes(
      prisma,
      canonical.id,
      normalizeBarcodes([ean, ...(opts.extraEans ?? [])]),
    );
    return { id: canonical.id, ean, name: opts.name };
  }

  async function createOffer(
    storeId: string,
    canonicalProductId: string,
    overrides: {
      availability?: Availability;
      visible?: boolean;
      deletedAt?: Date | null;
      localName?: string;
      description?: string | null;
      localCategoryId?: string | null;
    } = {},
  ): Promise<{ id: string }> {
    const suffix = `${storeId}-${canonicalProductId}`;
    const offer = await prisma.storeProduct.create({
      data: {
        storeId,
        canonicalProductId,
        externalId: `${token}-offer-${suffix}`,
        slug: `${token}-offer-${suffix}`.toLowerCase(),
        localName: overrides.localName ?? `F-015 fixture offer ${token}`,
        description: overrides.description ?? null,
        localCategoryId: overrides.localCategoryId ?? null,
        syncedPrice: "1.00",
        syncedPriceCurrency: "CUP",
        availability: overrides.availability ?? Availability.AVAILABLE,
        visible: overrides.visible ?? true,
        deletedAt: overrides.deletedAt ?? null,
        sourceUpdatedAt: new Date(),
      },
      select: { id: true },
    });
    // F-021: the SAME writer the panel/sync use (never a raw
    // `data: { searchDocument }`) — a fixture offer is immediately
    // findable by `searchStoreProducts`, same as `createCanonical` above
    // already does for the marketplace search.
    await reindexStoreProduct(prisma, offer.id);
    return offer;
  }

  function trackCanonical(id: string): void {
    canonicalIds.add(id);
  }

  async function createOrder(
    storeId: string,
    overrides: { status?: OrderStatus } = {},
  ): Promise<FixtureOrder> {
    orderSalt += 1;
    const order = await prisma.order.create({
      data: {
        code: `${token}-order-${orderSalt}`,
        idempotencyKey: `${token}-order-key-${orderSalt}`,
        storeId,
        businessId: business.id,
        contactName: `F-018 fixture ${token}`,
        contactPhone: "+5350000000",
        status: overrides.status ?? OrderStatus.PENDING,
        currencyCode: "CUP",
        subtotal: "1.00",
        discountTotal: "0",
        deliveryFee: "0",
        total: "1.00",
        rateSnapshot: { base: "CUP", capturedAt: new Date().toISOString(), rates: {} },
      },
      select: { id: true },
    });
    orderIds.add(order.id);
    return order;
  }

  /** Lazily creates the throwaway (never this session's own) business/store
   *  both `createFillerOrders` (F-018) and `createFillerOffers` (F-021)
   *  fill — one filler tenant per session, however many times either is
   *  called. */
  async function ensureFillerTenant(): Promise<{ businessId: string; storeId: string }> {
    if (!filler) {
      const fillerBusiness = await prisma.business.create({
        data: { externalId: `${token}-filler-business`, name: `F-018/F-021 filler ${token}` },
        select: { id: true },
      });
      const fillerStorefront = await prisma.storefront.create({
        data: {
          businessId: fillerBusiness.id,
          name: `F-018/F-021 filler ${token}`,
          slug: `${token}-filler-storefront`,
        },
        select: { id: true },
      });
      const fillerStore = await prisma.store.create({
        data: {
          businessId: fillerBusiness.id,
          storefrontId: fillerStorefront.id,
          externalId: `${token}-filler-store`,
          slug: `${token}-filler-store`,
          name: `F-018/F-021 filler store ${token}`,
          status: StoreStatus.PUBLISHED,
        },
        select: { id: true },
      });
      filler = { businessId: fillerBusiness.id, storeId: fillerStore.id };
    }
    return filler;
  }

  async function createFillerOrders(n: number): Promise<{ businessId: string; storeId: string }> {
    const target = await ensureFillerTenant();

    const rows = Array.from({ length: n }, () => {
      fillerOrderSalt += 1;
      return { salt: fillerOrderSalt };
    }).map(({ salt }) => ({
      code: `${token}-filler-order-${salt}`,
      storeId: target.storeId,
      businessId: target.businessId,
      contactName: `F-018 filler ${token}`,
      contactPhone: "+5350000000",
      status: OrderStatus.PENDING,
      currencyCode: "CUP",
      subtotal: "1.00",
      discountTotal: "0",
      deliveryFee: "0",
      total: "1.00",
      rateSnapshot: { base: "CUP", capturedAt: new Date().toISOString(), rates: {} },
    }));
    await prisma.order.createMany({ data: rows });

    return target;
  }

  async function createLocalCategory(
    opts: { name?: string; globalCategoryId?: string | null } = {},
  ): Promise<FixtureLocalCategory> {
    localCategorySalt += 1;
    const name = opts.name ?? `F-021 fixture category ${token}-${localCategorySalt}`;
    const category = await prisma.localCategory.create({
      data: {
        businessId: business.id,
        externalId: `${token}-local-category-${localCategorySalt}`,
        name,
        slug: `${token}-local-category-${localCategorySalt}`,
        globalCategoryId: opts.globalCategoryId ?? null,
      },
      select: { id: true, name: true },
    });
    localCategoryIds.add(category.id);
    return category;
  }

  async function createGlobalCategory(
    opts: { name?: string } = {},
  ): Promise<FixtureGlobalCategory> {
    globalCategorySalt += 1;
    const name = opts.name ?? `F-021 fixture global category ${token}-${globalCategorySalt}`;
    const category = await prisma.globalCategory.create({
      data: { slug: `${token}-global-category-${globalCategorySalt}`, name },
      select: { id: true, slug: true, name: true },
    });
    globalCategoryIds.add(category.id);
    return category;
  }

  async function createFillerOffers(
    n: number,
    target?: { storeId: string; businessId: string },
  ): Promise<{ businessId: string; storeId: string }> {
    const tenant = target ?? (await ensureFillerTenant());

    fillerCanonicalSalt += 1;
    const batchSalt = fillerCanonicalSalt;

    // Each row gets its OWN throwaway canonical (id generated client-side
    // so `createMany` can be used for both tables without a round trip to
    // read back generated ids): `StoreProduct`'s own
    // `@@unique([storeId, canonicalProductId])` means `n` offers confined
    // to ONE store cannot all point at the same canonical.
    const canonicalRows = Array.from({ length: n }, (_, i) => ({
      id: randomUUID(),
      // Offset well past `createCanonical`'s own salt range so the two
      // never derive the same `ean` inside one session, and multiplied so
      // two different `createFillerOffers` calls in the same session never
      // collide with each other either.
      ean: deriveEan(token, 5000 + batchSalt * 100_000 + i),
      name: `F-021 filler canonical ${token} ${batchSalt}-${i}`,
      isExclusive: false,
    }));
    if (canonicalRows.length > 0) {
      await prisma.canonicalProduct.createMany({ data: canonicalRows });
    }
    for (const row of canonicalRows) canonicalIds.add(row.id);

    const offerRows = canonicalRows.map((canonical, i) => ({
      storeId: tenant.storeId,
      canonicalProductId: canonical.id,
      externalId: `${token}-filler-offer-${batchSalt}-${i}`,
      slug: `${token}-filler-offer-${batchSalt}-${i}`.toLowerCase(),
      localName: `F-021 filler offer ${token} ${i}`,
      syncedPrice: "1.00",
      syncedPriceCurrency: "CUP",
      availability: Availability.AVAILABLE,
      visible: true,
      sourceUpdatedAt: new Date(),
    }));
    if (offerRows.length > 0) {
      await prisma.storeProduct.createMany({ data: offerRows });
    }

    // ONE round trip reindexes every filler row just inserted, whatever
    // canonical each one uses — the store-scoped variant, not `n`
    // individual `reindexStoreProduct` calls (architecture.md § "El
    // fixture de volumen del criterio 8").
    await reindexStoreProductsOfStore(prisma, tenant.storeId);

    return { businessId: tenant.businessId, storeId: tenant.storeId };
  }

  async function cleanup(): Promise<void> {
    const storeIdList = [...storeIds];
    const canonicalIdList = [...canonicalIds];
    if (storeIdList.length > 0 || canonicalIdList.length > 0) {
      await prisma.storeProduct.deleteMany({
        where: {
          OR: [
            storeIdList.length > 0 ? { storeId: { in: storeIdList } } : undefined,
            canonicalIdList.length > 0
              ? { canonicalProductId: { in: canonicalIdList } }
              : undefined,
          ].filter((clause): clause is NonNullable<typeof clause> => clause !== undefined),
        },
      });
    }
    // Order before Store: the FK is RESTRICT, so a leftover order would
    // make the Store delete below fail.
    await prisma.order.deleteMany({ where: { businessId: business.id } });
    if (canonicalIdList.length > 0) {
      // ProductAlias cascades (onDelete: Cascade on its own relation).
      await prisma.canonicalProduct.deleteMany({ where: { id: { in: canonicalIdList } } });
    }
    // F-021: explicit, even though `LocalCategory`'s own FK to `Business`
    // cascades — `GlobalCategory` has NO business relation at all, so it
    // needs its own delete, and it has to come after every `CanonicalProduct`/
    // `LocalCategory` row that could still reference it (both do, above).
    if (localCategoryIds.size > 0) {
      await prisma.localCategory.deleteMany({ where: { id: { in: [...localCategoryIds] } } });
    }
    if (globalCategoryIds.size > 0) {
      await prisma.globalCategory.deleteMany({ where: { id: { in: [...globalCategoryIds] } } });
    }
    if (storeIdList.length > 0) {
      await prisma.store.deleteMany({ where: { id: { in: storeIdList } } });
    }
    await prisma.storefront.delete({ where: { id: storefront.id } });
    await prisma.business.delete({ where: { id: business.id } });

    if (filler) {
      await prisma.order.deleteMany({ where: { businessId: filler.businessId } });
      await prisma.store.delete({ where: { id: filler.storeId } });
      await prisma.storefront.deleteMany({ where: { businessId: filler.businessId } });
      await prisma.business.delete({ where: { id: filler.businessId } });
    }
  }

  return {
    token,
    businessId: business.id,
    businessExternalId,
    syncToken,
    storefrontId: storefront.id,
    createStore,
    createCanonical,
    createOffer,
    trackCanonical,
    createLocalCategory,
    createGlobalCategory,
    createOrder,
    createFillerOrders,
    createFillerOffers,
    cleanup,
  };
}

/**
 * Sweeps fixtures left behind by a run that died before its own `cleanup()`
 * ran — identified by the same token prefix, and old enough (10 minutes)
 * not to touch a run in flight in parallel. Same deletion order as
 * `cleanup()`.
 *
 * Does NOT sweep `GlobalCategory` (F-021's `createGlobalCategory`):
 * `GlobalCategory` has no `createdAt` column, so this function's
 * age-based staleness check has nothing to compare against for it, and
 * guessing would risk deleting a fixture a run in flight still owns. A
 * leaked row from a test that crashed before its own `cleanup()` ran stays
 * as a bounded, low-volume cost — every session that finishes normally
 * still removes exactly the `GlobalCategory` rows it created.
 */
export async function sweepStaleFixtures(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS);

  const staleCanonicals = await prisma.canonicalProduct.findMany({
    where: { name: { contains: TOKEN_PREFIX }, createdAt: { lt: staleBefore } },
    select: { id: true },
  });
  const staleStores = await prisma.store.findMany({
    where: { externalId: { contains: TOKEN_PREFIX }, createdAt: { lt: staleBefore } },
    select: { id: true },
  });
  const canonicalIds = staleCanonicals.map((c) => c.id);
  const storeIds = staleStores.map((s) => s.id);

  if (canonicalIds.length > 0 || storeIds.length > 0) {
    await prisma.storeProduct.deleteMany({
      where: {
        OR: [
          canonicalIds.length > 0 ? { canonicalProductId: { in: canonicalIds } } : undefined,
          storeIds.length > 0 ? { storeId: { in: storeIds } } : undefined,
        ].filter((clause): clause is NonNullable<typeof clause> => clause !== undefined),
      },
    });
  }
  // F-018: Order before Store (RESTRICT FK) — without this, a run that died
  // mid-test with orders still on a stale store makes the deleteMany below
  // fail, and the sweep stops working for everyone sharing this database.
  if (storeIds.length > 0) {
    await prisma.order.deleteMany({ where: { storeId: { in: storeIds } } });
  }
  if (canonicalIds.length > 0) {
    await prisma.canonicalProduct.deleteMany({ where: { id: { in: canonicalIds } } });
  }
  if (storeIds.length > 0) {
    await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
  }

  const staleBusinesses = await prisma.business.findMany({
    where: { externalId: { contains: TOKEN_PREFIX }, createdAt: { lt: staleBefore } },
    select: { id: true },
  });
  const staleBusinessIds = staleBusinesses.map((b) => b.id);

  // Found through the stale BUSINESS, not by matching Storefront.slug
  // directly: that text shape (`where: { slug: ...`) is exactly what
  // `src/features/storefront/server/boundaries.test.ts` (a different
  // feature's guard, I6) flags outside `resolve.ts`/`registry.ts` — this
  // sweep has nothing to do with resolving a store by its public slug.
  const staleStorefronts =
    staleBusinessIds.length > 0
      ? await prisma.storefront.findMany({
          where: { businessId: { in: staleBusinessIds } },
          select: { id: true },
        })
      : [];

  if (staleStorefronts.length > 0) {
    await prisma.storefront.deleteMany({
      where: { id: { in: staleStorefronts.map((s) => s.id) } },
    });
  }
  if (staleBusinessIds.length > 0) {
    await prisma.business.deleteMany({ where: { id: { in: staleBusinessIds } } });
  }
}
