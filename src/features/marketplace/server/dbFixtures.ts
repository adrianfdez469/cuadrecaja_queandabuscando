import { createHash, randomBytes } from "node:crypto";
import { Availability, StoreStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { buildSearchDocument } from "@/lib/canonical";
import { writeSearchDocument } from "./searchVector";

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
 */
export function deriveEan(token: string, salt = 0): string {
  const hash = createHash("sha256").update(`${token}:${salt}`).digest("hex");
  return `9${hexToDigits(hash).slice(0, 12)}`;
}

export type FixtureCanonical = { id: string; ean: string; name: string };
export type FixtureStore = { id: string; externalId: string };

export type FixtureSession = {
  token: string;
  businessId: string;
  storefrontId: string;
  /** Creates a `Store` published by default (a live offer needs a
   *  `PUBLISHED` store, R5). */
  createStore(overrides?: { status?: StoreStatus }): Promise<FixtureStore>;
  /** Creates a `CanonicalProduct` and writes its search index through the
   *  SAME path the sync uses (`writeSearchDocument` — never a raw
   *  `data: { searchDocument }`, which is exactly what G1 forbids). The
   *  token is appended to `name` (and to every alias, via the caller) so a
   *  search for `<word> <token>` can only ever match this fixture. */
  createCanonical(opts: {
    name: string;
    aliases?: readonly string[];
    isExclusive?: boolean;
  }): Promise<FixtureCanonical>;
  /** Creates a `StoreProduct` offer. Defaults to a live one (AVAILABLE,
   *  visible, not deleted) so tests only have to override what they mean
   *  to break. */
  createOffer(
    storeId: string,
    canonicalProductId: string,
    overrides?: {
      availability?: Availability;
      visible?: boolean;
      deletedAt?: Date | null;
      localName?: string;
    },
  ): Promise<{ id: string }>;
  /** Registers a `CanonicalProduct` id this session did not create directly
   *  (e.g. one `handleProduct` created through the by-EAN path in
   *  `product.db.test.ts`), so `cleanup()` removes it too. Idempotent. */
  trackCanonical(id: string): void;
  /** Deletes everything this session created, in the order
   *  architecture.md § Pruebas contra Postgres real spells out:
   *  StoreProduct -> CanonicalProduct (ProductAlias cascades) -> Store ->
   *  Storefront -> Business. */
  cleanup(): Promise<void>;
};

export async function createFixtureSession(): Promise<FixtureSession> {
  const token = makeToken();
  const storeIds = new Set<string>();
  const canonicalIds = new Set<string>();
  let storeSalt = 0;
  let canonicalSalt = 0;

  const business = await prisma.business.create({
    data: { externalId: `${token}-business`, name: `F-015 fixture ${token}` },
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
  }): Promise<FixtureCanonical> {
    canonicalSalt += 1;
    const ean = deriveEan(token, canonicalSalt);
    const canonical = await prisma.canonicalProduct.create({
      data: { ean, name: opts.name, isExclusive: opts.isExclusive ?? false },
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
    } = {},
  ): Promise<{ id: string }> {
    const suffix = `${storeId}-${canonicalProductId}`;
    return prisma.storeProduct.create({
      data: {
        storeId,
        canonicalProductId,
        externalId: `${token}-offer-${suffix}`,
        slug: `${token}-offer-${suffix}`.toLowerCase(),
        localName: overrides.localName ?? `F-015 fixture offer ${token}`,
        syncedPrice: "1.00",
        syncedPriceCurrency: "CUP",
        availability: overrides.availability ?? Availability.AVAILABLE,
        visible: overrides.visible ?? true,
        deletedAt: overrides.deletedAt ?? null,
        sourceUpdatedAt: new Date(),
      },
      select: { id: true },
    });
  }

  function trackCanonical(id: string): void {
    canonicalIds.add(id);
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
    if (canonicalIdList.length > 0) {
      // ProductAlias cascades (onDelete: Cascade on its own relation).
      await prisma.canonicalProduct.deleteMany({ where: { id: { in: canonicalIdList } } });
    }
    if (storeIdList.length > 0) {
      await prisma.store.deleteMany({ where: { id: { in: storeIdList } } });
    }
    await prisma.storefront.delete({ where: { id: storefront.id } });
    await prisma.business.delete({ where: { id: business.id } });
  }

  return {
    token,
    businessId: business.id,
    storefrontId: storefront.id,
    createStore,
    createCanonical,
    createOffer,
    trackCanonical,
    cleanup,
  };
}

/**
 * Sweeps fixtures left behind by a run that died before its own `cleanup()`
 * ran — identified by the same token prefix, and old enough (10 minutes)
 * not to touch a run in flight in parallel. Same deletion order as
 * `cleanup()`.
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
