/**
 * Supabase Auth error code → our own stable key.
 *
 * `lib/auth/customerSession.ts` is the only module that ever sees a raw
 * Supabase error; everything downstream (routes, islands) only ever sees one
 * of these strings (AGENTS.md § Prohibiciones: no magic strings scattered
 * across screens). Duck-typed the same way
 * `src/features/orders/server/prismaErrors.ts` reads a Prisma error: reading
 * the two fields that matter keeps this decoupled from exactly which class
 * `@supabase/auth-js` throws, and `@supabase/auth-js` is not a direct
 * dependency we can safely `import` from (only `@supabase/ssr` and
 * `@supabase/supabase-js` are).
 */
export type CustomerAuthError =
  | "not_configured" // E26
  | "invalid" // wrong code (E21)
  | "expired" // code/link expired or already used (E19, E21)
  | "cancelled" // the provider returned `error` (E20)
  | "email_not_confirmed" // E22
  | "provider_disabled" // E23
  | "rate_limited" // Supabase's own send limit (R5)
  | "unavailable"; // Supabase did not respond, or an unrecognized failure

type SupabaseErrorLike = { code?: unknown; status?: unknown; name?: unknown };

function isSupabaseErrorLike(error: unknown): error is SupabaseErrorLike {
  return typeof error === "object" && error !== null;
}

function codeOf(error: unknown): string | null {
  if (!isSupabaseErrorLike(error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

/**
 * Maps a failed `signInWithOtp` / `verifyOtp` error to our key.
 *
 * `otp_expired` is what GoTrue returns for a wrong, expired AND already-used
 * one-time code alike — it does not distinguish them server-side. Mapped to
 * `"invalid"` here because the UI's attempt counter (design.md § 2) is what
 * turns three of those in a row into the terminal "ese código ya no sirve"
 * state; a single `otp_expired` on its own is exactly what a mistyped digit
 * looks like.
 */
export function mapEmailOtpError(error: unknown): CustomerAuthError {
  const code = codeOf(error);
  switch (code) {
    case "email_not_confirmed":
      return "email_not_confirmed";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "rate_limited";
    case "otp_expired":
    case "invalid_credentials":
      return "invalid";
    case "email_provider_disabled":
    case "signup_disabled":
    case "otp_disabled":
      return "unavailable";
    default:
      return "unavailable";
  }
}

/** Maps a failed `signInWithOAuth` error. */
export function mapOAuthStartError(error: unknown): CustomerAuthError {
  const code = codeOf(error);
  switch (code) {
    case "provider_disabled":
    case "saml_provider_disabled":
      return "provider_disabled";
    default:
      return "unavailable";
  }
}

/**
 * Maps a failed `exchangeCodeForSession` error (the OAuth *return* trip,
 * E19). Anything here means the code the provider handed back could not be
 * redeemed — a stale link, a replayed callback, a missing PKCE verifier —
 * and the only recovery is asking the shopper to start over.
 */
export function mapCodeExchangeError(error: unknown): CustomerAuthError {
  const code = codeOf(error);
  switch (code) {
    case "email_not_confirmed":
      return "email_not_confirmed";
    default:
      return "expired";
  }
}
