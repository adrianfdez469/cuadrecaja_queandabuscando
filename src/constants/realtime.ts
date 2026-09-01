/**
 * F-020 — the bell. Every number and literal the feature needs, so none of
 * them is a magic string/number scattered across `lib/realtime/**` and
 * `features/orders/server/bell.ts` (AGENTS.md § Prohibiciones).
 */

/** Spec § Datos y contrato: `negocio:{businessId}`. Composed in ONE place —
 *  the RLS policy (docker/realtime-policies.sql) repeats this same literal. */
export const REALTIME_BELL_CHANNEL_PREFIX = "negocio:";

export function realtimeBellChannel(businessId: string): string {
  return `${REALTIME_BELL_CHANNEL_PREFIX}${businessId}`;
}

/** Spec § Datos y contrato. One event, one channel, always the same name. */
export const REALTIME_BELL_EVENT = "pedidos";

/** R1: a constant, not a value derived from the order. Nothing to leak
 *  because there is nothing computed. `as const` so the shape is exact. */
export const REALTIME_BELL_PAYLOAD = { t: "pedidos" } as const;

/** Decision of the human (SP1): the coalescence window, fixed at 5 seconds
 *  (architecture.md DA3, R10). */
export const REALTIME_BELL_WINDOW_MS = 5000;

/** R3: caps the emitter's own `fetch`, measured against an address that
 *  swallows the connection rather than one that rejects it (E6). Same shape
 *  as `ORDER_CUSTOMER_LINK_TIMEOUT_MS` (src/constants/account.ts). */
export const REALTIME_BELL_EMIT_TIMEOUT_MS = 1000;

/**
 * Found running it (E9), not anticipated in architecture.md: `ringOrderBell`
 * sleeps against Node's OWN clock (`claim.closesAt.getTime() - Date.now()`)
 * to wake up exactly when the window is due, but `closeBellWindow`'s own
 * `WHERE "windowStartedAt" <= now() - …` is evaluated against POSTGRES'S
 * clock. The two are never perfectly in sync — a few milliseconds of drift,
 * or ordinary event-loop timer jitter, is enough for the wakeup to land a
 * hair BEFORE Postgres's own `now()` agrees the window is due. Without this
 * margin that single close attempt returns 0 rows and NOTHING retries it —
 * unlike "the instance died" (architecture.md's one accepted gap), the
 * instance is alive and the row is simply left `pendingSince` forever,
 * because no other event will ever see this window as `first_defer` again.
 * Small and inert: it only widens how long the callback WAITS before
 * asking, never what the SQL itself considers "due".
 */
export const REALTIME_BELL_CLOSE_MARGIN_MS = 250;

/** R15: TTL of the subscription credential — same as the local Auth
 *  emulator's own `GOTRUE_JWT_EXP` (docker-compose.yml). */
export const REALTIME_CREDENTIAL_TTL_SECONDS = 3600;
