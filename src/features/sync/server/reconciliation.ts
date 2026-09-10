import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  byteOrderedEntries,
  md5OfEntries,
  tariffReconciliation,
} from "@/features/sync/reconciliationHash";

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
 * Prisma's `select` for the shipping tariff half of the hash (F-044, R3-R10):
 * `TariffRow` of `src/features/zones/precedence.ts` is exactly this shape,
 * so the rows `zoneTariff.findMany` returns need no mapping before
 * `tariffReconciliation` consumes them.
 */
const TARIFF_SELECT = {
  zoneCode: true,
  rule: true,
  deliveryFee: true,
} as const;

/**
 * Hash the published catalogue AND the shipping tariff of one store
 * (F-044): both hashes describe the same `Store`, resolved exactly once.
 *
 * The catalogue's input is deliberately the source-side identity, price and
 * availability — exactly the fields the sync is responsible for. Admin-owned
 * fields (description, images, overrides) are excluded, because they
 * legitimately differ between the two systems and would make every store
 * look divergent.
 *
 * Row order for both hashes is fixed by byte order (R8, products; R8 of
 * F-044, tariff), computed in Node rather than delegated to `ORDER BY`: two
 * collations over the same bytes give different hashes, and the two
 * databases belong to two different organisations. Both go through the
 * SAME `byteOrderedEntries`/`md5OfEntries` skeleton
 * (`src/features/sync/reconciliationHash.ts`, architecture.md D1) — not two
 * lookalike implementations.
 *
 * The two `findMany` below run with `Promise.all`, NEVER inside a
 * `$transaction` (R16, AGENTS.md § Cosas que muerden: the pooler runs in
 * transaction mode and a `$transaction` over the shared client deadlocks
 * against the pool). `Promise.all` over two independent statements opens no
 * transaction: two round-trips in parallel, paid once, at the cost of the
 * slower of the two rather than their sum.
 */
export async function storeReconciliationHash(
  businessId: string,
  storeExternalId: string,
): Promise<{ products: number; hash: string; tariffs: number; tariffHash: string } | null> {
  const store = await prisma.store.findFirst({
    where: { externalId: storeExternalId, businessId },
    select: { id: true },
  });
  if (!store) return null;

  const [products, tariffRows] = await Promise.all([
    prisma.storeProduct.findMany({
      where: { storeId: store.id, deletedAt: null },
      select: RECONCILIATION_SELECT,
    }),
    prisma.zoneTariff.findMany({
      where: { storeId: store.id },
      select: TARIFF_SELECT,
    }),
  ]);

  const entries = byteOrderedEntries(
    products,
    (product) => product.externalId,
    reconciliationEntry,
  );
  const hash = md5OfEntries(entries);

  const { tariffs, tariffHash } = tariffReconciliation(tariffRows);

  return { products: products.length, hash, tariffs, tariffHash };
}
