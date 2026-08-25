import { timingSafeEqual, createHash } from "node:crypto";

/**
 * Authentication for /api/internal/*.
 *
 * Baseline is a long random bearer token compared in constant time. TLS already
 * provides confidentiality and integrity in transit, and the only caller is a
 * cron in a Vercel project we control.
 *
 * The upgrade path is HMAC-SHA256 over `timestamp + "." + rawBody` with a
 * ±5 minute window, which buys body integrity and a bounded replay window if
 * the token ever surfaces in a log. See docs/adr/0008. It is deliberately not
 * the starting point, but the verification is isolated here so switching does
 * not touch a single route.
 */

export const SYNC_AUTH_SCHEME = "Bearer";

export type SyncAuthResult =
  { ok: true } | { ok: false; reason: "missing" | "malformed" | "mismatch" | "unconfigured" };

/** Constant-time compare that does not leak length through early return. */
function safeEqual(a: string, b: string): boolean {
  // Hash both sides first: timingSafeEqual throws on length mismatch, and the
  // throw itself would leak whether the lengths matched.
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

export function verifySyncToken(
  authorizationHeader: string | null | undefined,
  expectedToken: string | undefined,
): SyncAuthResult {
  if (!expectedToken || expectedToken.length < 32) {
    return { ok: false, reason: "unconfigured" };
  }
  if (!authorizationHeader) {
    return { ok: false, reason: "missing" };
  }

  const prefix = `${SYNC_AUTH_SCHEME} `;
  if (!authorizationHeader.startsWith(prefix)) {
    return { ok: false, reason: "malformed" };
  }

  const presented = authorizationHeader.slice(prefix.length).trim();
  if (!presented) {
    return { ok: false, reason: "malformed" };
  }

  return safeEqual(presented, expectedToken) ? { ok: true } : { ok: false, reason: "mismatch" };
}

/** Stored on Business so a per-business token can be rotated independently. */
export function hashSyncToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
