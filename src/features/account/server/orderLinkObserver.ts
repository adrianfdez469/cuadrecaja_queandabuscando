import {
  ORDER_CUSTOMER_LINK_SLOW_MS,
  ORDER_CUSTOMER_LINK_TIMEOUT_MS,
  ORDER_LINK_OUTCOME,
  type OrderLinkOutcome,
} from "@/constants/account";

/**
 * F-030: what `resolveOrderCustomerId()` (`./orderIdentity.ts`) saw while
 * racing the identity lookup against its ceiling. This is the ONLY module in
 * the repo that calls `console.warn` with the `[orders] customer link`
 * prefix (architecture.md DA1). The prefix is written literal here, and
 * again in the test, on purpose (DA9) — it is a contract with whoever greps
 * the server output, not a value shared in code.
 */

export type OrderLinkResolution =
  | { kind: "linked"; customerId: string }
  | { kind: "unverified" }
  | { kind: "no_customer" }
  | { kind: "error" };

export type OrderLinkWatch = {
  /**
   * The lookup won the race. Emits slow | unverified | no_customer | error,
   * or NOTHING if it linked under `ORDER_CUSTOMER_LINK_SLOW_MS` (E2). NEVER
   * throws.
   */
  settled(resolution: OrderLinkResolution): void;
  /**
   * The timer won. Emits `timeout` now, while the request is still alive,
   * and attaches the `late` continuation to `attempt` — which can no longer
   * reject (R13, architecture.md DA2). NEVER throws.
   */
  timedOut(attempt: Promise<OrderLinkResolution>): void;
};

function emit(outcome: OrderLinkOutcome, fields: Record<string, unknown>): void {
  console.warn("[orders] customer link", { outcome, ...fields });
}

function outcomeForSettled(resolution: OrderLinkResolution): OrderLinkOutcome | null {
  switch (resolution.kind) {
    case "linked":
      // `slow` is exclusive to the link that DID happen — decided in
      // `settled()` itself against the elapsed clock, not here.
      return null;
    case "unverified":
      return ORDER_LINK_OUTCOME.UNVERIFIED;
    case "no_customer":
      return ORDER_LINK_OUTCOME.NO_CUSTOMER;
    case "error":
      return ORDER_LINK_OUTCOME.ERROR;
  }
}

/** One clock per attempt. No module-level state (R10, E11). */
export function startOrderLinkWatch(): OrderLinkWatch {
  const t0 = performance.now();
  const ceilingMs = ORDER_CUSTOMER_LINK_TIMEOUT_MS;

  return {
    settled(resolution) {
      // DA4: the whole body is swallowed. `watch.settled()` runs INSIDE
      // `resolveOrderCustomerId()`'s own try/catch, so a `console.warn` that
      // throws (a closed stdout, an EPIPE) would otherwise fall into that
      // outer catch and return null — losing a link that already resolved
      // correctly. Measuring can never change what is measured.
      try {
        const elapsedMs = Math.round(performance.now() - t0);
        if (resolution.kind === "linked") {
          if (elapsedMs < ORDER_CUSTOMER_LINK_SLOW_MS) return; // E2: nothing to say
          emit(ORDER_LINK_OUTCOME.SLOW, { elapsedMs, ceilingMs });
          return;
        }
        const outcome = outcomeForSettled(resolution);
        if (outcome) emit(outcome, { elapsedMs, ceilingMs });
      } catch {
        // See above: never let the line take down a resolved link.
      }
    },
    timedOut(attempt) {
      try {
        const elapsedMs = Math.round(performance.now() - t0);
        emit(ORDER_LINK_OUTCOME.TIMEOUT, { elapsedMs, ceilingMs });

        // `attempt` cannot reject — the `.catch` at its creation already
        // turned any rejection into `{ kind: "error" }` — so this `.then()`
        // is attached for good the moment `timedOut()` runs, independent of
        // whether the caller's `after()` call succeeds (architecture.md
        // DA2). If the runtime freezes the invocation before `attempt`
        // settles, this callback simply never fires: `lateMs` is lost, not
        // the `timeout` line already emitted above.
        void attempt.then((resolution) => {
          try {
            const lateElapsedMs = Math.round(performance.now() - t0);
            // The `max(1)` exists because the contract promises `lateMs > 0`
            // and a timer that fires a fraction of a millisecond early would
            // otherwise print `0`, reading as "arrived on time".
            const lateMs = Math.max(1, Math.round(lateElapsedMs - ceilingMs));
            emit(ORDER_LINK_OUTCOME.LATE, {
              elapsedMs: lateElapsedMs,
              ceilingMs,
              lateMs,
              resolved: resolution.kind === "linked",
            });
          } catch {
            // Same rule as settled(): this runs after the response already
            // left, so there is nothing left to protect but still nothing
            // that should be allowed to throw unhandled.
          }
        });
      } catch {
        // See settled(): never lets a bad log break the ceiling's return.
      }
    },
  };
}
