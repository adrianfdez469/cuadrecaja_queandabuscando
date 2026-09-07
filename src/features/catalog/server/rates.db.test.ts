import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma";
import {
  createFixtureSession,
  type FixtureSession,
} from "@/features/marketplace/server/dbFixtures";
import { buildCurrentRatesSql } from "./rates";

/**
 * F-036 criterio 7 (spec.md C7; architecture.md AD1, AD4; docs/adr/0030):
 * `EXPLAIN` of the EXACT statement `loadCurrentRates` runs
 * (`buildCurrentRatesSql`) never `Seq Scan`s `ExchangeRate`, on a fixture
 * with enough volume for the planner to prefer
 * `ExchangeRate_current_rate_idx` BY COST — never `enable_seqscan = off`,
 * which would only prove the index CAN serve the plan, not that Postgres
 * chooses it (spec.md § Casos límite: "la tabla vacía al hacer el
 * EXPLAIN").
 *
 * Volume: architecture.md AD1 measured the switch between `Seq Scan` and
 * `Index Only Scan` at 121-321 TOTAL rows (21 of the target business, the
 * rest filler of another). 2000 filler rows of a THROWAWAY business plus
 * ~20 of the fixture's own business is an order of magnitude past that
 * switch, and the businessId of the filler is what makes the target's
 * `businessId` selective — a `Seq Scan` full of the target's own rows
 * would not exercise the index the same way.
 *
 * AD4 folded the storefront's reader and the checkout's reader into ONE
 * statement (`WHERE "businessId" = $1`, a plain equality — no relation
 * filter left over the `Store`/`Business` chain the storefront used to
 * run). There is exactly one plan to explain here, not two: I2 (spec.md)
 * no longer applies once the two readers share `buildCurrentRatesSql`.
 *
 * `VACUUM ANALYZE`, never plain `ANALYZE`, from the start — playbook
 * `.agent/playbook/explain-seq-scan-flaky-bajo-analyze-sin-vacuum.md`: the
 * `db` project runs its `*.db.test.ts` files in series
 * (`fileParallelism: false`, vitest.config.mts), so a bare `ANALYZE` run
 * after another file's `DELETE`s left dead tuples can tip the planner back
 * to `Seq Scan` by cost, flakily and depending on suite order.
 *
 * The assertion goes on the PLAN NODE — a `Seq Scan` whose `Relation Name`
 * is `ExchangeRate` — never on `Heap Fetches`: architecture.md AD1's own
 * warning, measured (`Heap Fetches` goes from 0 to a positive number after
 * only `ANALYZE` with no `VACUUM`, on the SAME `Index Only Scan` plan — it
 * tracks the visibility map, not the plan shape).
 */
const FILLER_CURRENCY = "WVX";

describe("buildCurrentRatesSql — el EXPLAIN usa el índice cubridor, nunca Seq Scan (criterio 7)", () => {
  let session: FixtureSession;
  let client: Client;
  let fillerBusinessId: string;

  beforeAll(async () => {
    session = await createFixtureSession();

    await prisma.currency.upsert({
      where: { code: FILLER_CURRENCY },
      create: { code: FILLER_CURRENCY, name: FILLER_CURRENCY, symbol: FILLER_CURRENCY },
      update: {},
    });

    // ~20 rows of the TARGET business — several `sourceUpdatedAt` values,
    // so `DISTINCT ON` has real work to do, not a single-row shortcut.
    await prisma.exchangeRate.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        businessId: session.businessId,
        currencyCode: FILLER_CURRENCY,
        rate: (100 + i).toFixed(6),
        sourceUpdatedAt: new Date(Date.now() - i * 1000),
      })),
    });

    // ~2000 rows of a DIFFERENT (throwaway) business — never the fixture's
    // own — so `businessId = $1` is selective. Cleaned up below; also
    // caught by `sweepStaleFixtures()` (its externalId carries the
    // fixture's own token prefix) if this run dies before its own
    // `afterAll`.
    const fillerBusiness = await prisma.business.create({
      data: { externalId: `f036-c7-filler-${session.token}`, name: "F-036 C7 filler business" },
      select: { id: true },
    });
    fillerBusinessId = fillerBusiness.id;
    await prisma.exchangeRate.createMany({
      data: Array.from({ length: 2000 }, (_, i) => ({
        businessId: fillerBusinessId,
        currencyCode: FILLER_CURRENCY,
        rate: (1 + (i % 500)).toFixed(6),
        sourceUpdatedAt: new Date(Date.now() - i * 1000),
      })),
    });

    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query('VACUUM ANALYZE "ExchangeRate"');
  }, 60_000);

  afterAll(async () => {
    await client.end();
    await prisma.exchangeRate.deleteMany({ where: { businessId: fillerBusinessId } });
    await prisma.business.delete({ where: { id: fillerBusinessId } });
    // The target's own ~20 rows cascade away with its `Business`
    // (`onDelete: Cascade`, prisma/schema.prisma), which `session.cleanup()`
    // removes.
    await session.cleanup();
    await prisma.currency.deleteMany({ where: { code: FILLER_CURRENCY } });
  }, 60_000);

  it("(a) el índice cubridor existe y su definición nombra sourceUpdatedAt", async () => {
    const { rows } = await client.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'ExchangeRate' AND indexname = 'ExchangeRate_current_rate_idx'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain("sourceUpdatedAt");
  });

  it("(b) el plan de la sentencia EXACTA de loadCurrentRates nunca hace Seq Scan sobre ExchangeRate, y nombra el índice", async () => {
    const sql = buildCurrentRatesSql(session.businessId);
    // `Prisma.Sql` carries its own text (with `$1`, …) and its own bound
    // values — exactly what `pg`'s `Client.query` takes, so this explains
    // the REAL statement `loadCurrentRates` runs, not a hand copy that
    // could silently drift.
    const { rows } = await client.query<{ "QUERY PLAN": Record<string, unknown>[] }>(
      `EXPLAIN (FORMAT JSON) ${sql.text}`,
      sql.values,
    );
    // `EXPLAIN (FORMAT JSON)` wraps the root node in `{ "Plan": … }`.
    const plan = (rows[0]?.["QUERY PLAN"]?.[0] as { Plan?: unknown } | undefined)?.Plan;
    expect(plan).toBeDefined();

    const planText = JSON.stringify(plan);
    expect(hasSeqScanOnExchangeRate(plan)).toBe(false);
    expect(planText).toContain("ExchangeRate_current_rate_idx");
  });
});

/** Walks an `EXPLAIN (FORMAT JSON)` plan tree looking for a `Seq Scan` node
 *  whose `Relation Name` is `ExchangeRate` — never a `toContain` on the
 *  plan's text, and never an assertion on `Heap Fetches` (see the block
 *  comment above). Same walker shape as
 *  `hasSeqScanOnStoreProduct` in `search.db.test.ts:471-485`. */
function hasSeqScanOnExchangeRate(node: unknown): boolean {
  if (node === null || typeof node !== "object") return false;
  const record = node as Record<string, unknown>;
  if (record["Node Type"] === "Seq Scan" && record["Relation Name"] === "ExchangeRate") {
    return true;
  }
  const plans = record["Plans"];
  if (Array.isArray(plans)) {
    return plans.some((child) => hasSeqScanOnExchangeRate(child));
  }
  return false;
}
