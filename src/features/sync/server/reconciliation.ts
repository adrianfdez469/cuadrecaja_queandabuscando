import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { compareUtf8Keys, utf8SortKey } from "@/lib/byteOrder";

/**
 * The four columns the hash is computed over, and nothing more (R9, I3): the
 * six admin-owned columns and the two derived search columns are
 * deliberately excluded, because they legitimately differ between the two
 * systems and would make every store look divergent.
 */
const RECONCILIATION_SELECT = {
  externalId: true,
  syncedPrice: true,
  syncedPriceCurrency: true,
  availability: true,
} as const;

/**
 * Derived from the `select` itself, not written by hand: a column rename in
 * `prisma/schema.prisma` breaks the build here instead of silently changing
 * what the hash means (architecture.md § Contratos).
 */
export type ReconciliationRow = Prisma.StoreProductGetPayload<{
  select: typeof RECONCILIATION_SELECT;
}>;

/**
 * The canonical per-row entry (R1), the ONE place in this codebase where the
 * shape `<externalId>:<price>:<currency>:<availability>|` is written in
 * TypeScript. `docs/sync-contract.md` § ⑤ documents this same shape for
 * cuadrecaja to reproduce in SQL — see R4/R5 in spec.md for why
 * `syncedPrice.toString()` (Prisma's `Decimal`, which strips trailing
 * zeroes) is the only correct serialization here, never
 * `src/lib/money.ts`'s `Money.amount` (always 2 fraction digits, which is
 * exactly the wrong hash).
 */
export function reconciliationEntry(row: ReconciliationRow): string {
  return `${row.externalId}:${row.syncedPrice.toString()}:${row.syncedPriceCurrency}:${row.availability}|`;
}

/**
 * Hash the published catalogue of one store.
 *
 * The input is deliberately the source-side identity, price and availability —
 * exactly the fields the sync is responsible for. Admin-owned fields
 * (description, images, overrides) are excluded, because they legitimately
 * differ between the two systems and would make every store look divergent.
 *
 * Row order is fixed by byte order of `externalId` (R8), computed in Node
 * rather than delegated to `ORDER BY`: two collations over the same bytes
 * give different hashes, and the two databases belong to two different
 * organisations. The sort below calls `utf8SortKey`/`compareUtf8Keys`
 * directly (`src/lib/byteOrder.ts`, architecture.md D1) — the same two
 * primitives `compareUtf8Bytes` is defined in terms of — so the astral-pair
 * test in `byteOrder.test.ts` covers this exact code path, not a
 * lookalike: a regression to `.sort()` or `.localeCompare()` here would stop
 * using either import and fail to compile as unused, not just drift quietly
 * from what is tested.
 */
export async function storeReconciliationHash(
  businessId: string,
  storeExternalId: string,
): Promise<{ products: number; hash: string } | null> {
  const store = await prisma.store.findFirst({
    where: { externalId: storeExternalId, businessId },
    select: { id: true },
  });
  if (!store) return null;

  const products = await prisma.storeProduct.findMany({
    where: { storeId: store.id, deletedAt: null },
    select: RECONCILIATION_SELECT,
  });

  // The sort key is precomputed once per row with `utf8SortKey` (not
  // re-encoded inside the comparator on every pairwise call): measured over
  // 100,000 UUIDs, 132ms with a precomputed key against 312ms encoding
  // inside the comparator (architecture.md § Contratos).
  const withKey = products.map((product) => ({
    product,
    key: utf8SortKey(product.externalId),
  }));
  withKey.sort((a, b) => compareUtf8Keys(a.key, b.key));

  const digest = createHash("md5");
  for (const { product } of withKey) {
    digest.update(reconciliationEntry(product));
  }

  return { products: products.length, hash: digest.digest("hex") };
}
