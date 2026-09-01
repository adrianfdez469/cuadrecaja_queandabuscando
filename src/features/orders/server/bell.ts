import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { broadcastBell } from "@/lib/realtime/broadcast";
import { REALTIME_BELL_CLOSE_MARGIN_MS, REALTIME_BELL_WINDOW_MS } from "@/constants/realtime";

/**
 * The coalescence window (F-020, architecture.md DA3, I5).
 *
 * The state that decides "ring now / defer / do nothing" lives in ONE row of
 * Postgres per business (`OrderBellWindow`), never in process memory: with N
 * ephemeral serverless instances, a `Map` at module scope would only ever
 * see the events THIS process received, and R10 ("coalescence measured from
 * the subscriber") would pass locally with a single `next dev` while being
 * false in production (ADR 0015 closes the door to a broker — Postgres is
 * what is left). `bell.db.test.ts` is the test that actually catches this:
 * it opens the window with SQL from OUTSIDE this process.
 *
 * Both statements below are ONE round-trip each, with no `$transaction`
 * (AGENTS.md § Cosas que muerden — the pooler runs in transaction mode and
 * the global client cannot enter a transactional block). `respond.ts` uses
 * the exact same shape for the same reason.
 */

export type BellClaim =
  { kind: "ring" } | { kind: "first_defer"; closesAt: Date } | { kind: "defer" };

type ClaimRow = { rang: bigint; deferred: bigint; window_started_at: Date | null };

/**
 * Reclaims the window for `businessId`, deciding atomically between the
 * three outcomes DA3 names. Postgres's own row lock (the `ON CONFLICT DO
 * UPDATE`'s implicit `FOR UPDATE`) is what makes two concurrent callers on
 * the SAME business serialize: the second re-evaluates its `WHERE` against
 * the row the first just wrote (READ COMMITTED), so at most one call per
 * open window ever sees `ring`.
 *
 * `client` defaults to the shared singleton (`src/lib/prisma.ts`) — every
 * production call site (this module's own `ringOrderBell`) uses it that
 * way. The parameter exists so `bell.db.test.ts`'s concurrency case can
 * drive this SAME statement through two independently constructed
 * `PrismaClient`s (two separate pooled connections), which is what actually
 * simulates two serverless instances racing on one row — a single shared
 * client's own connection pool would not prove that.
 */
export async function claimBell(
  businessId: string,
  client: PrismaClient = prisma,
): Promise<BellClaim> {
  const [row] = await client.$queryRaw<ClaimRow[]>(Prisma.sql`
    WITH rang AS (
      INSERT INTO "OrderBellWindow" ("businessId", "windowStartedAt", "pendingSince")
      VALUES (${businessId}, now(), NULL)
      ON CONFLICT ("businessId") DO UPDATE
         SET "windowStartedAt" = now(),
             "pendingSince"    = NULL
       WHERE "OrderBellWindow"."windowStartedAt" <= now() - (${REALTIME_BELL_WINDOW_MS}::numeric * interval '1 millisecond')
      RETURNING "windowStartedAt"
    ), deferred AS (
      UPDATE "OrderBellWindow"
         SET "pendingSince" = now()
       WHERE "businessId" = ${businessId}
         AND "pendingSince" IS NULL
         AND NOT EXISTS (SELECT 1 FROM rang)
      RETURNING "windowStartedAt"
    )
    SELECT (SELECT count(*) FROM rang)                    AS rang,
           (SELECT count(*) FROM deferred)                AS deferred,
           (SELECT "windowStartedAt" FROM deferred)        AS window_started_at
  `);

  if (row.rang > 0n) return { kind: "ring" };
  if (row.deferred > 0n && row.window_started_at) {
    return {
      kind: "first_defer",
      closesAt: new Date(row.window_started_at.getTime() + REALTIME_BELL_WINDOW_MS),
    };
  }
  return { kind: "defer" };
}

/**
 * Closes the window, if it is still this caller's to close and it is
 * actually due. Also OPENS the next window at the same instant (E8): the
 * `SET "windowStartedAt" = now()` is what a subsequent `claimBell` compares
 * against. Returns `true` exactly once per window — a race between two
 * callers (two instances both waking up for the same `first_defer`) leaves
 * exactly one `RETURNING` row, because the `WHERE` re-checks
 * `"pendingSince" IS NOT NULL` against whatever the winner already cleared.
 */
export async function closeBellWindow(
  businessId: string,
  client: PrismaClient = prisma,
): Promise<boolean> {
  const rows = await client.$queryRaw<{ businessId: string }[]>(Prisma.sql`
    UPDATE "OrderBellWindow"
       SET "windowStartedAt" = now(), "pendingSince" = NULL
     WHERE "businessId" = ${businessId}
       AND "pendingSince" IS NOT NULL
       AND "windowStartedAt" <= now() - (${REALTIME_BELL_WINDOW_MS}::numeric * interval '1 millisecond')
    RETURNING "businessId"
  `);
  return rows.length > 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Same rule as `src/lib/realtime/broadcast.ts` (DA2): one plain-string line
 *  starting with `[realtime]`, never the `Error` object. */
function logBellFailure(stage: "claim" | "close", businessId: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[realtime] bell ${stage} failed`, { businessId, reason });
}

/**
 * Orchestrates reclaim -> emit -> scheduled close. Called from `after()`
 * (architecture.md DA2), so it runs AFTER the HTTP response already left —
 * R2 (never fails the write) and R3 (never delays it) are structural here,
 * not discipline. NEVER rejects: an `after()` callback that throws would
 * make Next print the exception itself, which is exactly what
 * `.agent/verify.sh`'s server-error guard watches for (criterio 3 exercises
 * a broken emitter under that same guard on purpose).
 *
 * The `first_defer` branch `await`s its own delay rather than firing a
 * detached `setTimeout`: `after()` keeps the invocation alive only while the
 * promise it was given is still pending, so the close has to be part of
 * THIS awaited chain, not scheduled outside it (architecture.md § Riesgos,
 * riesgo 4). Neither calling route exports `maxDuration` today: that is the
 * documented way out from the platform's side IF its invocation ceiling ever
 * falls below (request duration + the coalescing window), and until then a
 * dropped close bell is harmless — the 2-minute pull still delivers (R11, E17).
 */
export async function ringOrderBell(businessId: string): Promise<void> {
  let claim: BellClaim;
  try {
    claim = await claimBell(businessId);
  } catch (error) {
    logBellFailure("claim", businessId, error);
    return;
  }

  if (claim.kind === "defer") return;

  if (claim.kind === "ring") {
    await broadcastBell(businessId);
    return;
  }

  // "first_defer": nothing rings now (E8) — wait for the window to actually
  // close, then ring once if this call is the one that wins the race.
  // REALTIME_BELL_CLOSE_MARGIN_MS pads the wakeup past `claim.closesAt`
  // (Node's clock) so it lands safely after Postgres's OWN `now()` agrees
  // the window is due — see its doc comment for what a bare `Date.now()`
  // comparison gets wrong (found running it, E9).
  const delayMs = Math.max(
    0,
    claim.closesAt.getTime() - Date.now() + REALTIME_BELL_CLOSE_MARGIN_MS,
  );
  await sleep(delayMs);
  try {
    const closed = await closeBellWindow(businessId);
    if (closed) await broadcastBell(businessId);
  } catch (error) {
    logBellFailure("close", businessId, error);
  }
}
