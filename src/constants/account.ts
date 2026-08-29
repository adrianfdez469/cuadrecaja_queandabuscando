/**
 * Shopper account: cookie names, timeouts, body caps and the OTP flow.
 *
 * The two cookie names are the literal that `lib/auth/customerSession.ts`
 * re-exports verbatim (architecture.md § DA3) — nothing else should hardcode
 * either string (AGENTS.md § Prohibiciones: magic strings).
 */

/**
 * `@supabase/ssr`'s default cookie name (`sb-<ref>-auth-token`) depends on
 * `NEXT_PUBLIC_SUPABASE_URL`, which is `""` in the environment criterio 6
 * exercises — there is no `<ref>` to derive anything from, and the name
 * would not be stable enough for R21's comparison anyway. Fixed here and
 * wired through `cookieOptions.name` (`storageKey`) instead.
 */
export const CUSTOMER_COOKIE = "qab-shopper-auth";

/**
 * A boolean, no-credential "there is a session" hint (design.md § Tokens,
 * architecture.md § DA3, NC1). Readable from the client without importing
 * anything from `@supabase/*` — that is the whole point of it existing.
 */
export const CUSTOMER_HINT_COOKIE = "qab-shopper-hint";

/** Days the hint cookie lives before it needs a fresh session to renew it. */
export const CUSTOMER_HINT_MAX_AGE_DAYS = 30;

/** R7/E27: length past which `next` is rejected outright, no matter its shape. */
export const NEXT_PATH_MAX_LENGTH = 512;

/** R3/D5: the email code is always this many digits. */
export const OTP_CODE_LENGTH = 6;

/** R5: this many wrong tries in a row exhaust the current code (E21). */
export const OTP_MAX_ATTEMPTS = 3;

/** design.md § 2: how long "Reenviar el código" stays disabled after a send. */
export const OTP_RESEND_COOLDOWN_SECONDS = 30;

/** design.md § DA1 / architecture.md § DA1: the checkout's profile fetch never blocks the form. */
export const PROFILE_FETCH_TIMEOUT_MS = 3000;

/**
 * R14 / architecture.md § DA2: resolving the signed-in shopper's identity for
 * an order can never delay or fail the order itself — cut short at this
 * ceiling and treated as "no session".
 */
export const ORDER_CUSTOMER_LINK_TIMEOUT_MS = 600;

/** design.md § Defensa de las cuatro rutas POST: plenty for an email + 6 digits. */
export const ACCOUNT_MAX_BODY_BYTES = 4 * 1024;
