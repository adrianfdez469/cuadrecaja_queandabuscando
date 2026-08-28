import { createHash, randomBytes } from "node:crypto";

/**
 * Pure helpers for /api/internal/* authentication (F-018).
 *
 * This module only ever looks at the SHAPE of the bearer credential (scheme,
 * length) and the cryptographic transforms on it (hash, mint). It never
 * touches Prisma and never knows what a Business is — resolving a hash to an
 * identity lives in src/features/sync/server/caller.ts (R9, AGENTS.md §
 * Arquitectura).
 *
 * Identity used to be checked in memory against a single global shared
 * secret,
 * which is why a constant-time compare (`timingSafeEqual`) used to live here.
 * F-018 replaces that comparison with an equality lookup on a `@unique`
 * index (`Business.syncTokenHash`), so there is no longer a comparison "in
 * memory" to protect — R4 stays the rule for the day one exists again. The
 * residual timing signal of a btree lookup is accepted explicitly: what is
 * being searched for is the SHA-256 of the presented token, not the token
 * itself, and ADR 0008's path to HMAC is untouched.
 */

export const SYNC_AUTH_SCHEME = "Bearer";
export const MIN_BEARER_TOKEN_LENGTH = 32;

export type BearerRead =
  { ok: true; token: string } | { ok: false; reason: "missing" | "malformed" };

/**
 * Validates only the FORM of the `Authorization` header: scheme, non-empty,
 * minimum length. Never resolves anything against a database.
 */
export function readBearerToken(header: string | null | undefined): BearerRead {
  if (!header) return { ok: false, reason: "missing" };

  const prefix = `${SYNC_AUTH_SCHEME} `;
  if (!header.startsWith(prefix)) return { ok: false, reason: "malformed" };

  const presented = header.slice(prefix.length).trim();
  if (!presented || presented.length < MIN_BEARER_TOKEN_LENGTH) {
    return { ok: false, reason: "malformed" };
  }

  return { ok: true, token: presented };
}

/** SHA-256 hex digest. What gets stored in `Business.syncTokenHash`. */
export function hashSyncToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Mints a fresh token and its hash. The plaintext is returned once, to the
 * caller — never stored anywhere (R11): scripts/mint-sync-token.ts and
 * prisma/seed.ts are the only two callers, and both print it and discard it.
 * 36 random bytes -> 48 base64url characters (E23).
 */
export function mintSyncToken(): { token: string; hash: string } {
  const token = randomBytes(36).toString("base64url");
  return { token, hash: hashSyncToken(token) };
}
