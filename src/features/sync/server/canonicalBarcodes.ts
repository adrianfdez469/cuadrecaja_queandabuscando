import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { CANONICAL_BARCODE_INSERT_CHUNK } from "@/constants/sync";

/**
 * F-024 (ADR 0020): the ONE place in the repo that touches `CanonicalBarcode`
 * — both the write and the measurement live here, same pattern ADR 0019 (b)
 * fixed for `searchVector.ts` (the expression that writes and the one that
 * reads are twins, so they live together). The day the graph feature needs
 * another query, this is where it goes (guard G7,
 * `src/app/api/internal/boundaries.test.ts`).
 */

/** What the writer needs, so the global client of `src/lib/prisma.ts`, and
 *  the standalone `PrismaClient` that `prisma/seed.ts` and
 *  `scripts/count-canonical-barcodes.ts` construct, all satisfy it. Same
 *  trick as `SearchIndexWriter`. */
export type CanonicalBarcodeWriter = Pick<PrismaClient, "canonicalBarcode">;

/**
 * R6 + R8: additive, idempotent, ONE statement, no `$transaction` — the
 * Supavisor pooler runs in transaction mode and a query on the global client
 * inside `$transaction` deadlocks (AGENTS.md § Cosas que muerden).
 *
 * Returns how many rows were actually inserted: 0 means "all of them were
 * already there", which is what makes a resend a no-op (E2) and the final
 * set independent of delivery order (E16).
 */
export async function recordCanonicalBarcodes(
  db: CanonicalBarcodeWriter,
  canonicalProductId: string,
  eans: readonly string[],
): Promise<number> {
  if (eans.length === 0) return 0; // E7/E9: not even a round trip.

  let inserted = 0;
  for (let i = 0; i < eans.length; i += CANONICAL_BARCODE_INSERT_CHUNK) {
    const { count } = await db.canonicalBarcode.createMany({
      data: eans
        .slice(i, i + CANONICAL_BARCODE_INSERT_CHUNK)
        .map((ean) => ({ canonicalProductId, ean })),
      skipDuplicates: true, // INSERT … ON CONFLICT DO NOTHING
    });
    inserted += count;
  }
  return inserted;
}

/** A plain `count()`, exported so `prisma/seed.ts`'s own `Done:` line can
 *  report the table's size without becoming a second place that names the
 *  `canonicalBarcode` delegate (G7). */
export async function countCanonicalBarcodes(db: CanonicalBarcodeWriter): Promise<number> {
  return db.canonicalBarcode.count();
}

export type CanonicalBarcodeStats = {
  canonicalTotal: number;
  canonicalsWithBarcodes: number;
  canonicalsWithMultipleBarcodes: number;
  /** >= 1 barcode AND live offers from >= 2 businesses. */
  canonicalsWithBarcodesAcrossBusinesses: number;
  /** >= 2 barcodes AND live offers from >= 2 businesses — the number that
   *  actually describes the human's scenario (spec.md N1). */
  canonicalsWithMultipleBarcodesAcrossBusinesses: number;
  /** How many canonicals have 1, 2, 3… barcodes. Ascending by `barcodes`. */
  histogram: { barcodes: number; canonicals: number }[];
};

type StatsRow = {
  canonicalTotal: bigint | number | string;
  canonicalsWithBarcodes: bigint | number | string;
  canonicalsWithMultipleBarcodes: bigint | number | string;
  canonicalsWithBarcodesAcrossBusinesses: bigint | number | string;
  canonicalsWithMultipleBarcodesAcrossBusinesses: bigint | number | string;
};

type HistogramRow = { barcodes: bigint | number | string; canonicals: bigint | number | string };

/**
 * The criterio 6 measurement: two round trips, both composed only with
 * `Prisma.sql` (ADR 0019 (a), never `Unsafe`, even with no interpolated
 * value). `deletedAt IS NULL`: a business that soft-deleted its offer no
 * longer asserts anything about the canonical (spec.md § Datos y contrato).
 */
export async function countCanonicalBarcodeStats(
  db: Pick<PrismaClient, "$queryRaw">,
): Promise<CanonicalBarcodeStats> {
  const [statsRow] = await db.$queryRaw<StatsRow[]>(Prisma.sql`
    WITH per_canonical AS (
      SELECT "canonicalProductId" AS id, count(*) AS n
        FROM "CanonicalBarcode"
       GROUP BY "canonicalProductId"
    ),
    per_business AS (
      SELECT sp."canonicalProductId" AS id, count(DISTINCT s."businessId") AS b
        FROM "StoreProduct" sp
        JOIN "Store" s ON s."id" = sp."storeId"
       WHERE sp."deletedAt" IS NULL
       GROUP BY sp."canonicalProductId"
    )
    SELECT (SELECT count(*) FROM "CanonicalProduct")                       AS "canonicalTotal",
           (SELECT count(*) FROM per_canonical)                            AS "canonicalsWithBarcodes",
           (SELECT count(*) FROM per_canonical WHERE n >= 2)               AS "canonicalsWithMultipleBarcodes",
           (SELECT count(*) FROM per_canonical c
              JOIN per_business b ON b.id = c.id WHERE b.b >= 2)           AS "canonicalsWithBarcodesAcrossBusinesses",
           (SELECT count(*) FROM per_canonical c
              JOIN per_business b ON b.id = c.id
             WHERE c.n >= 2 AND b.b >= 2)                                  AS "canonicalsWithMultipleBarcodesAcrossBusinesses"
  `);

  const histogramRows = await db.$queryRaw<HistogramRow[]>(Prisma.sql`
    SELECT n AS "barcodes", count(*) AS "canonicals"
      FROM (SELECT "canonicalProductId", count(*) AS n
              FROM "CanonicalBarcode" GROUP BY "canonicalProductId") t
     GROUP BY n
     ORDER BY n
  `);

  return {
    canonicalTotal: Number(statsRow?.canonicalTotal ?? 0),
    canonicalsWithBarcodes: Number(statsRow?.canonicalsWithBarcodes ?? 0),
    canonicalsWithMultipleBarcodes: Number(statsRow?.canonicalsWithMultipleBarcodes ?? 0),
    canonicalsWithBarcodesAcrossBusinesses: Number(
      statsRow?.canonicalsWithBarcodesAcrossBusinesses ?? 0,
    ),
    canonicalsWithMultipleBarcodesAcrossBusinesses: Number(
      statsRow?.canonicalsWithMultipleBarcodesAcrossBusinesses ?? 0,
    ),
    histogram: histogramRows.map((row) => ({
      barcodes: Number(row.barcodes),
      canonicals: Number(row.canonicals),
    })),
  };
}

/** The exact text criterio 6 prints. Pure, so its format has a test without
 *  Postgres. One `clave: valor` line per figure, greppable and pastable into
 *  `.agent/specs/F-024/tests.md`. */
export function formatCanonicalBarcodeStats(stats: CanonicalBarcodeStats): string {
  const lines = [
    `canonicalTotal: ${stats.canonicalTotal}`,
    `canonicalsWithBarcodes: ${stats.canonicalsWithBarcodes}`,
    `canonicalsWithMultipleBarcodes: ${stats.canonicalsWithMultipleBarcodes}`,
    `canonicalsWithBarcodesAcrossBusinesses: ${stats.canonicalsWithBarcodesAcrossBusinesses}`,
    `canonicalsWithMultipleBarcodesAcrossBusinesses: ${stats.canonicalsWithMultipleBarcodesAcrossBusinesses}`,
    ...stats.histogram.map((row) => `histogram[${row.barcodes}]: ${row.canonicals}`),
  ];
  return lines.join("\n");
}
