/**
 * Byte-order comparison for strings that cross the frontier with cuadrecaja
 * (F-014, R8). "Order of bytes" means the order of the UTF-8 ENCODING, not
 * JavaScript's default string order, which compares UTF-16 code units — the
 * two differ on anything outside the Basic Multilingual Plane (a surrogate
 * pair). Postgres with `COLLATE "C"` agrees with this comparator; the
 * database's declared collation (`en_US.utf8`, or JavaScript's own `<`/
 * `.localeCompare()`/`Intl.Collator`) do not, in general.
 *
 * Pure and Prisma-free on purpose: its test has to run identically on musl
 * (where the local database happens to collate as `C` by accident) and on
 * glibc (production), and on the CI runner — none of which can be trusted to
 * expose the bug this function exists to prevent.
 *
 * Split into two primitives, not one function, so that the production sort
 * (`storeReconciliationHash()` in `reconciliation.ts`) and the test below
 * exercise the SAME code, not two implementations that happen to agree
 * today. `reconciliation.ts` needs the key precomputed once per row (measured:
 * 132ms with a precomputed key against 312ms re-encoding inside the
 * comparator on every pairwise call, over 100,000 UUIDs) — so it imports
 * `utf8SortKey`/`compareUtf8Keys` directly, and `compareUtf8Bytes` below is
 * defined in terms of those same two calls. If `reconciliation.ts` ever
 * regressed to `.sort()` or `.localeCompare()`, it would stop calling either
 * of these two exports, and this file's own import would go unused — a
 * compile-time signal, not just a comment nobody re-reads.
 */
export function utf8SortKey(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

export function compareUtf8Keys(a: Buffer, b: Buffer): number {
  return Buffer.compare(a, b);
}

export function compareUtf8Bytes(a: string, b: string): number {
  return compareUtf8Keys(utf8SortKey(a), utf8SortKey(b));
}
