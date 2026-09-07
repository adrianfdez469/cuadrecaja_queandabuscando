import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * The ONE read that decides which row of `ExchangeRate` is CURRENT for a
 * (business, currency) pair (F-036, architecture.md AD1/AD3, docs/adr/0030).
 *
 * Both the storefront (`getStoreRates`, `features/catalog/server/queries.ts`)
 * and the checkout (`quoteCart`, `features/orders/server/quote.ts`) call this
 * SAME function with the SAME sentence — never a second `ORDER BY` written by
 * hand somewhere else. That is what turns "the two readers agree" (spec.md
 * R4, criterion 6) from a discipline into a compiler-enforced property: there
 * is exactly one place this could drift, and it is this file.
 */

/** A raw row of the `DISTINCT ON`. `rate` arrives as `Prisma.Decimal` — the
 *  same shape `findMany` already returned, checked under the driver adapter. */
export type CurrentRateRow = { currencyCode: string; rate: Prisma.Decimal };

/**
 * The ONLY statement that decides which row is CURRENT for a
 * (businessId, currencyCode) pair. Exported so criterion 7's `EXPLAIN` test
 * explains THIS sentence, never a hand-copied one that could silently drift
 * (`Prisma.Sql` carries its own `.text` with `$1` and its `.values`).
 *
 * `sourceUpdatedAt` is nullable (human decision, F-036 plan.md PD1: Prisma
 * cannot generate a backfill migration, and its own workaround for that case
 * is hand-editing the generated file — which this schema shape avoids
 * entirely). `NULLS LAST` on this, the FIRST ordering key, is what stands in
 * for the backfill: a row without a mark sorts after every row that has one
 * and therefore never wins, migrated or not (R6..R8, criterion 5). Nowhere
 * else in the codebase orders by this column — do not add a second `ORDER
 * BY` that reads it; extend this function's caller instead.
 */
export function buildCurrentRatesSql(businessId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT DISTINCT ON ("currencyCode") "currencyCode", "rate"
      FROM "ExchangeRate"
     WHERE "businessId" = ${businessId}
     ORDER BY "currencyCode" ASC,
              "sourceUpdatedAt" DESC NULLS LAST,
              "createdAt" DESC,
              "id" DESC
  `;
}

/**
 * `{ USD: "440", MLC: "210.5" }`. `{}` when the business has no row at all
 * (E11) — ordering zero rows gives zero rows, no special case needed.
 */
export async function loadCurrentRates(businessId: string): Promise<Record<string, string>> {
  const rows = await prisma.$queryRaw<CurrentRateRow[]>(buildCurrentRatesSql(businessId));

  const rates: Record<string, string> = {};
  for (const row of rows) rates[row.currencyCode] = row.rate.toString();
  return rates;
}
