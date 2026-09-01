import { publicEnv, serverEnv } from "@/lib/env";
import {
  REALTIME_BELL_CHANNEL_PREFIX,
  REALTIME_BELL_EMIT_TIMEOUT_MS,
  REALTIME_BELL_EVENT,
  REALTIME_BELL_PAYLOAD,
} from "@/constants/realtime";

/**
 * The only module that talks to Supabase Realtime's Broadcast REST endpoint
 * (F-020, architecture.md DA1).
 *
 * `fetch`, not `@supabase/supabase-js`: a `RealtimeClient` builds a
 * websocket with its own timers to do, internally, this SAME HTTP request —
 * unnecessary in a server runtime and it would complicate R3's hard cap.
 * Also why R13/criterio 14 stay green for free: this module imports nothing
 * from `@supabase/*`, so there is no fifth importer to add to
 * `src/features/account/boundaries.test.ts`.
 *
 * Never throws: every failure — missing config, Realtime down, a
 * black-holed address, a rejected request — comes back as a discriminated
 * result, same contract as `src/lib/supabase/storage.ts`. The caller
 * (`src/features/orders/server/bell.ts`) never lets a rejection reach
 * `after()` (DA2): an `after()` callback that throws would print the
 * exception itself and trip `.agent/verify.sh`'s server-error guard.
 */

/** Why a bell could not even be attempted, or was refused. Same vocabulary
 *  as `StorageFailureReason` on purpose (architecture.md § Contratos) — `timeout`
 *  is split from `unreachable` because the spec distinguishes them: E5 is an
 *  address that REJECTS the connection, E6 is one that SWALLOWS it. */
export type BellFailureReason =
  "missing_service_role_key" | "missing_supabase_url" | "unreachable" | "rejected" | "timeout";

export type BellAvailability = { ok: true } | { ok: false; reason: BellFailureReason };

export type BellResult = { ok: true } | { ok: false; reason: BellFailureReason };

/** Config-only check: is there enough to even attempt to talk to Realtime.
 *  `SUPABASE_SERVICE_ROLE_KEY` stays `optional()` in `serverEnv()` — making
 *  it required would break every route that never touches Realtime either. */
export function realtimeAvailability(): BellAvailability {
  if (!publicEnv.supabaseUrl) return { ok: false, reason: "missing_supabase_url" };
  if (!serverEnv().SUPABASE_SERVICE_ROLE_KEY)
    return { ok: false, reason: "missing_service_role_key" };
  return { ok: true };
}

/**
 * `?private=true` is REQUIRED and symmetric with the RLS policy
 * (docker/realtime-policies.sql): "a public broadcast only reaches public
 * channels and a private broadcast only reaches private channels" — the
 * Supabase Realtime docs' own words. Verified end to end against the local
 * emulator (architecture.md's URL shape, confirmed by running it): a real
 * subscriber on `negocio:{businessId}` receives exactly this payload.
 */
function broadcastUrl(businessId: string): string {
  const channel = `${REALTIME_BELL_CHANNEL_PREFIX}${businessId}`;
  return `${publicEnv.supabaseUrl}/realtime/v1/api/broadcast/${encodeURIComponent(channel)}/events/${REALTIME_BELL_EVENT}?private=true`;
}

/**
 * Fires the bell for one business. Never rejects (R2): every branch below
 * returns a `BellResult`, and the one place this can still throw —
 * `serverEnv()`, if the process's env is malformed in some OTHER field — is
 * why `ringOrderBell()` (src/features/orders/server/bell.ts) wraps the whole
 * call in try/catch too, belt and suspenders.
 */
export async function broadcastBell(businessId: string): Promise<BellResult> {
  const availability = realtimeAvailability();
  if (!availability.ok) {
    logFailure(businessId, availability.reason);
    return availability;
  }

  try {
    const response = await fetch(broadcastUrl(businessId), {
      method: "POST",
      headers: {
        apikey: serverEnv().SUPABASE_SERVICE_ROLE_KEY as string,
        "content-type": "application/json",
      },
      body: JSON.stringify(REALTIME_BELL_PAYLOAD),
      signal: AbortSignal.timeout(REALTIME_BELL_EMIT_TIMEOUT_MS),
    });

    if (!response.ok) {
      logFailure(businessId, "rejected");
      return { ok: false, reason: "rejected" };
    }
    return { ok: true };
  } catch (error) {
    // DOMException("TimeoutError") is what AbortSignal.timeout() produces
    // (E6 — an address that swallows the connection instead of rejecting
    // it). Anything else reaching here is a network-level failure — refused,
    // unresolvable, or a closed emulator (E5).
    const reason: BellFailureReason =
      error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "unreachable";
    logFailure(businessId, reason);
    return { ok: false, reason };
  }
}

/**
 * ONE line, plain string, starting with `[realtime]`, and NEVER the `Error`
 * object itself (architecture.md DA2): `.agent/verify.sh`'s
 * `SERVIDOR_ERROR_RE` marks the smoke stage red on a server log line that
 * starts with `Error` — and Node would print exactly that if the object
 * were passed here. Same rule `src/lib/env.ts` already documents.
 */
function logFailure(businessId: string, reason: BellFailureReason): void {
  console.error("[realtime] bell not emitted", { businessId, reason });
}
