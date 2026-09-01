import { SignJWT } from "jose";
import { publicEnv, serverEnv } from "@/lib/env";
import {
  REALTIME_BELL_CHANNEL_PREFIX,
  REALTIME_BELL_EVENT,
  REALTIME_CREDENTIAL_TTL_SECONDS,
} from "@/constants/realtime";

/**
 * Mints the JWT a POS presents to Supabase Realtime to subscribe to its own
 * business channel (F-020, architecture.md DA5, spec E18).
 *
 * Pure — no Prisma, no HTTP — so it lives in `lib/`, next to
 * `src/lib/auth/ssoToken.ts`, which already signs a different kind of token
 * with the same library. The route
 * (`src/app/api/internal/realtime/credential/route.ts`) is the only caller:
 * it resolves `businessId` from the bearer via `withInternalAuth`, never
 * from anything the client sends.
 */

export type SubscriptionFailureReason =
  "missing_jwt_secret" | "missing_supabase_url" | "missing_anon_key";

export type SubscriptionAvailability =
  { ok: true } | { ok: false; reason: SubscriptionFailureReason };

/** Config-only check, same shape as `realtimeAvailability()`
 *  (src/lib/realtime/broadcast.ts): is there enough to even attempt to mint
 *  a credential. `SUPABASE_JWT_SECRET` stays `optional()` in `serverEnv()`
 *  — required would break every route that never touches Realtime. */
export function subscriptionAvailability(): SubscriptionAvailability {
  if (!publicEnv.supabaseUrl) return { ok: false, reason: "missing_supabase_url" };
  if (!publicEnv.supabaseAnonKey) return { ok: false, reason: "missing_anon_key" };
  if (!serverEnv().SUPABASE_JWT_SECRET) return { ok: false, reason: "missing_jwt_secret" };
  return { ok: true };
}

/**
 * The shape `POST /api/internal/realtime/credential` returns (DA5). A
 * single type shared by the route and its test (AGENTS.md § Prohibiciones,
 * "duplicar interfaces").
 */
export type RealtimeCredentialResponse = {
  url: string;
  apikey: string;
  channel: string;
  event: string;
  token: string;
  expiresAt: string; // ISO 8601 — R15: explicit, so the POS renews without guessing
  expiresInSeconds: number;
};

/**
 * `business_id` is a first-level claim WE mint, never `user_metadata` of
 * anyone — the classic Supabase warning ("never authorize off
 * `user_metadata`, a user can edit it") does not apply here because no user
 * can write into this token at all. It is exactly the claim
 * docker/realtime-policies.sql reads via `request.jwt.claims`.
 *
 * `role: authenticated` is what makes Realtime `SET ROLE authenticated`
 * before evaluating RLS — the policy is `to authenticated`, so without this
 * claim the subscription would be evaluated as `anon` and denied.
 *
 * Caller's responsibility: check `subscriptionAvailability()` first. This
 * function assumes `SUPABASE_JWT_SECRET` is present and would throw
 * otherwise (`serverEnv()`'s own contract) — never called unguarded from the
 * route.
 */
export async function mintSubscriptionToken(
  businessId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const secret = serverEnv().SUPABASE_JWT_SECRET as string;
  const expiresAt = new Date(Date.now() + REALTIME_CREDENTIAL_TTL_SECONDS * 1000);

  const token = await new SignJWT({
    role: "authenticated",
    business_id: businessId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("queandabuscando")
    .setAudience("authenticated")
    .setSubject(businessId)
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(new TextEncoder().encode(secret));

  return { token, expiresAt };
}

/**
 * Composes the full response DA5 defines. Assumes
 * `subscriptionAvailability().ok` was already checked by the caller — same
 * split `mintSubscriptionToken` uses, so the route can turn "not
 * configured" into `503 REALTIME_NOT_CONFIGURED` before ever calling this.
 */
export async function mintRealtimeCredential(
  businessId: string,
): Promise<RealtimeCredentialResponse> {
  const { token, expiresAt } = await mintSubscriptionToken(businessId);
  return {
    url: publicEnv.supabaseUrl,
    apikey: publicEnv.supabaseAnonKey,
    channel: `${REALTIME_BELL_CHANNEL_PREFIX}${businessId}`,
    event: REALTIME_BELL_EVENT,
    token,
    expiresAt: expiresAt.toISOString(),
    expiresInSeconds: REALTIME_CREDENTIAL_TTL_SECONDS,
  };
}
