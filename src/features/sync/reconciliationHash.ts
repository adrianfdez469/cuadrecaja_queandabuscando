import { createHash } from "node:crypto";
import { compareUtf8Keys, utf8SortKey } from "@/lib/byteOrder";
import type { TariffRow } from "@/features/zones/precedence";

/**
 * F-044 (architecture.md § D1): the skeleton the two § ⑤ reconciliation
 * hashes share — order by bytes of a caller-supplied key, then md5 the
 * ordered entries. Extracted out of `server/reconciliation.ts`, not
 * duplicated, for the same reason `src/lib/byteOrder.ts`'s own header
 * already gives for splitting sort primitives in two: production and its
 * test have to exercise the SAME code, not two implementations that happen
 * to agree today. This module is pure and Prisma-free on purpose — the
 * vector test below runs in the `server` vitest project, without a
 * database.
 */

/**
 * Precomputes `utf8SortKey(keyOf(row))` once per row (never re-encoded
 * inside the comparator — see `src/lib/byteOrder.ts` on why that costs
 * 132ms vs 312ms over 100,000 rows), orders by `compareUtf8Keys` (R8), and
 * returns the already-serialized entries in that order.
 */
export function byteOrderedEntries<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  entryOf: (row: T) => string,
): string[] {
  const withKey = rows.map((row) => ({ row, key: utf8SortKey(keyOf(row)) }));
  withKey.sort((a, b) => compareUtf8Keys(a.key, b.key));
  return withKey.map(({ row }) => entryOf(row));
}

/**
 * md5 hex of the entries, concatenated in the order given. Zero entries
 * digests the empty string — `d41d8cd98f00b204e9800998ecf8427e` — with no
 * special case (R9): `createHash("md5").digest("hex")` on an empty digest
 * already gives that value.
 */
export function md5OfEntries(entries: readonly string[]): string {
  const digest = createHash("md5");
  for (const entry of entries) digest.update(entry);
  return digest.digest("hex");
}

/**
 * `String(value)` — the same primitive `reconciliationEntry` uses for
 * `syncedPrice` (a Prisma `Decimal`, which already strips trailing zeroes) —
 * followed by an IDEMPOTENT trim of trailing zeroes (R5, architecture.md §
 * D2). On a `Decimal(14,2)` this is a no-op: `toString()` already gives
 * "300", "250.5", "0". On the contract vector's two-decimal string
 * ("300.00") it strips down to "300". The guard on the dot is mandatory:
 * without it, "1000" (no dot) would become "1".
 *
 * `toDecimalString` of `src/lib/money.ts` (always two fraction digits) is
 * explicitly NOT used here (R5): it is the serialization the tariff
 * *resolution* needs, for a different purpose, and reusing it here would
 * make the same amount hash two different ways depending on whether it came
 * from Postgres or from the vector's cadena.
 */
function trimTrailingZeroes(value: NonNullable<TariffRow["deliveryFee"]>): string {
  const text = String(value);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

/**
 * The canonical per-row entry for the shipping tariff (R4, R6, R7):
 * `<zoneCode>:<rule>:<importe>|`. `rule` travels verbatim (R7); the amount
 * is the empty string unless `rule` is `FEE` and an amount is present (R6)
 * — written over `rule`, never over the column's nullability, because
 * cuadrecaja's own table does not exist yet (D1) and might declare the
 * column `NOT NULL DEFAULT 0`.
 */
export function tariffEntry(row: TariffRow): string {
  const amount =
    row.rule === "FEE" && row.deliveryFee != null ? trimTrailingZeroes(row.deliveryFee) : "";
  return `${row.zoneCode}:${row.rule}:${amount}|`;
}

/**
 * The tariff half of § ⑤. `INHERIT` rows are filtered out HERE — never in
 * the caller's Prisma `where` (architecture.md § D3) — because `INHERIT`
 * and "no row" are the same verdict for `resolveZoneTariff` (R3), and this
 * is the ONE place that decision is implemented; a `where` would be a
 * second implementation of R3 that the contract vector never exercises.
 */
export function tariffReconciliation(rows: readonly TariffRow[]): {
  tariffs: number;
  entries: readonly string[];
  tariffHash: string;
} {
  const included = rows.filter((row) => row.rule !== "INHERIT");
  const entries = byteOrderedEntries(included, (row) => row.zoneCode, tariffEntry);
  return { tariffs: included.length, entries, tariffHash: md5OfEntries(entries) };
}
