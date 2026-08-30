import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import {
  CUSTOMER_COOKIE,
  CUSTOMER_HINT_COOKIE,
  CUSTOMER_HINT_MAX_AGE_DAYS,
} from "@/constants/account";
import { publicEnv } from "@/lib/env";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  mapCodeExchangeError,
  mapEmailOtpError,
  mapOAuthStartError,
  type CustomerAuthError,
} from "@/features/account/authErrors";
import type { OAuthProvider } from "@/features/account/types";

/**
 * Shopper session — the ONLY module that reads or writes it, and the ONLY
 * one that talks to Supabase Auth (R19, I6; architecture.md § Componentes).
 * Every route under `src/app/api/account/**` and `src/app/auth/callback/**`
 * goes through this file; none of them reads a cookie by name on its own.
 *
 * `next/headers` is imported LAZILY inside each function that needs it
 * (contrato note 3): `src/proxy.ts` imports this same module for
 * `refreshCustomerSession`, and that function never touches `next/headers` —
 * it builds its own client straight over the request/response cookie jars.
 * A top-of-file import would drag an API the proxy runtime does not have
 * into its bundle for no reason.
 */

export { CUSTOMER_COOKIE, CUSTOMER_HINT_COOKIE };
export type { CustomerAuthError };

export type CustomerUser = {
  id: string;
  email: string | null;
  fullName: string | null;
};

export type CustomerAuthResult =
  { ok: true; user: CustomerUser } | { ok: false; reason: CustomerAuthError };

function isSessionCookieName(name: string): boolean {
  // `@supabase/ssr`'s chunker splits a long value into `<name>.0`, `<name>.1`, …
  return name === CUSTOMER_COOKIE || name.startsWith(`${CUSTOMER_COOKIE}.`);
}

/** Broader than `isSessionCookieName`: also matches the PKCE verifier cookies. */
function isAnyCustomerCookieName(name: string): boolean {
  return isSessionCookieName(name) || name.startsWith(`${CUSTOMER_COOKIE}-`);
}

function fullNameFromMetadata(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const record = metadata as Record<string, unknown>;
  const fullName = typeof record.full_name === "string" ? record.full_name.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  return fullName || name || null;
}

type UserLike = { id?: unknown; sub?: unknown; email?: unknown; user_metadata?: unknown };

function toCustomerUser(source: UserLike): CustomerUser {
  const id =
    typeof source.id === "string" ? source.id : typeof source.sub === "string" ? source.sub : "";
  return {
    id,
    email: typeof source.email === "string" ? source.email : null,
    fullName: fullNameFromMetadata(source.user_metadata),
  };
}

function cookieSecure(): boolean {
  return process.env.NODE_ENV === "production";
}

async function setHintCookie(): Promise<void> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  try {
    store.set(CUSTOMER_HINT_COOKIE, "1", {
      httpOnly: false,
      secure: cookieSecure(),
      sameSite: "lax",
      path: "/",
      maxAge: CUSTOMER_HINT_MAX_AGE_DAYS * 24 * 60 * 60,
    });
  } catch {
    // Called from a Server Component: cookies are read-only there. The
    // route handlers that establish a session are never Server Components,
    // so this only matters defensively.
  }
}

/** ¿Hay alguna cookie NUESTRA en esta petición? Sin red, sin base. */
export async function hasCustomerSessionCookie(): Promise<boolean> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  return store.getAll().some((cookie) => isSessionCookieName(cookie.name));
}

/**
 * The verified identity, or null. NEVER throws (E17, E26): a missing
 * configuration, an expired token or Supabase being unreachable all look
 * identical from the outside — "no session".
 */
export async function getCustomerUser(): Promise<CustomerUser | null> {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return null;

    // getClaims(), not getUser(): it checks `exp` locally BEFORE any network
    // call, so an expired cookie costs nothing. It does not, however, verify
    // the signature locally: this project signs with HS256, and auth-js falls
    // back to `getUser(token)` — one `GET /auth/v1/user` per call, uncached —
    // for any `HS*` algorithm. Verified in @supabase/auth-js's own source.
    // Only asymmetric keys (ES256/RS256) fetch a JWKS and verify offline, and
    // the day this project moves to them the round trip disappears with no
    // change here (architecture.md § Contratos, nota 1, corrected 2026-08-30;
    // playbook: getclaims-hs256-sale-a-la-red).
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data) return null;

    return toCustomerUser(data.claims as UserLike);
  } catch {
    return null;
  }
}

/** Email, step 1 (E1). */
export async function sendEmailOtp(
  email: string,
): Promise<{ ok: true } | { ok: false; reason: CustomerAuthError }> {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return { ok: false, reason: "not_configured" };

    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) return { ok: false, reason: mapEmailOtpError(error) };
    return { ok: true };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Email, step 2 (E1, E21, E22). Writes the session and hint cookies. */
export async function verifyEmailOtp(email: string, token: string): Promise<CustomerAuthResult> {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return { ok: false, reason: "not_configured" };

    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    if (error || !data.user) return { ok: false, reason: mapEmailOtpError(error) };

    await setHintCookie();
    return { ok: true, user: toCustomerUser(data.user) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * OAuth, outbound leg (E2, E23). Returns the provider's URL; never redirects
 * itself — `skipBrowserRedirect: true` is what keeps `signInWithOAuth` from
 * trying to (it only auto-redirects when it detects a browser, which a
 * server process never is, but this is explicit anyway).
 */
export async function startOAuth(
  provider: OAuthProvider,
  redirectTo: string,
): Promise<{ ok: true; url: string } | { ok: false; reason: CustomerAuthError }> {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return { ok: false, reason: "not_configured" };

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data?.url) return { ok: false, reason: mapOAuthStartError(error) };
    return { ok: true, url: data.url };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** OAuth, return leg (E3, E19). Writes the session and hint cookies. */
export async function exchangeCustomerCode(code: string): Promise<CustomerAuthResult> {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return { ok: false, reason: "not_configured" };

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) return { ok: false, reason: mapCodeExchangeError(error) };

    await setHintCookie();
    return { ok: true, user: toCustomerUser(data.user) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * Closes the session and removes ONLY the shopper's own cookies (E4, E18,
 * R19). `qab-admin-session` starts with neither `qab-shopper-auth` nor a
 * prefix of it (R21), so it never matches `isAnyCustomerCookieName` and is
 * never touched here.
 */
export async function signOutCustomer(): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    if (supabase) await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Best-effort: the explicit sweep below is what actually guarantees
    // every one of our cookies is gone even if the network call fails.
  }

  const { cookies } = await import("next/headers");
  const store = await cookies();
  for (const cookie of store.getAll()) {
    if (isAnyCustomerCookieName(cookie.name)) store.delete(cookie.name);
  }
  store.delete(CUSTOMER_HINT_COOKIE);
}

/**
 * Only for `src/proxy.ts`: refreshes the session cookie of an in-flight
 * request. Never reads identity, never decides anything, never redirects
 * (architecture.md § DA4) — `getSession()` reads the cookie and only reaches
 * the network if the access token actually expired.
 *
 * Builds its OWN `createServerClient`, over `request.cookies` /
 * `response.cookies`, deliberately NOT reusing `createSupabaseServerClient`
 * (which needs `next/headers`, unavailable to the proxy runtime).
 */
export async function refreshCustomerSession(
  request: NextRequest,
  response: NextResponse,
): Promise<void> {
  if (!isSupabaseAuthConfigured()) return;

  try {
    const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
      cookieOptions: { name: CUSTOMER_COOKIE },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value, options } of toSet) {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          }
        },
      },
    });

    const { data } = await supabase.auth.getSession();
    if (!data.session) response.cookies.delete(CUSTOMER_HINT_COOKIE);
  } catch {
    // Best-effort: a proxy is not the place to surface an auth failure, and
    // the page underneath treats "no session" the same way regardless.
  }
}
