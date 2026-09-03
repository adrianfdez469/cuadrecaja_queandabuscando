import type { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { hashSyncToken, readBearerToken } from "@/lib/syncAuth";
import { provisioningResponse } from "./respond";

/**
 * The ONLY module in the repo that knows `PROVISIONING_SECRET_SHA256`
 * (architecture.md § Decisión, § Contratos → El guard). This secret
 * authenticates cuadrecaja AS AN INTEGRATOR (spec.md R5), never a
 * `Business` — that is exactly why this is its own guard and not
 * `withInternalAuth`: no identity travels here for a handler to receive,
 * and this route must never become part of `/api/internal/*`
 * (docs/adr/0029-alta-de-negocio-por-api.md, point 2 — "the trap").
 *
 * Order of checks (R7, R8, ADR 0008 § Detalle de implementación):
 * configuration -> header shape -> constant-time compare.
 */
const PROVISIONING_SECRET_HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Module-level, so a BURST of requests against a misconfigured server logs
 * the mistake once, not once per request. R11 is about never logging a
 * VALUE — this is about volume, and it never turns a real value into text.
 */
let warnedNotConfigured = false;

function unauthorized(): NextResponse {
  return provisioningResponse({ error: "UNAUTHORIZED" }, 401);
}

/**
 * `null` means "let the caller proceed" — same contract as
 * `src/app/api/crons/_lib/guard.ts`, deliberately NOT
 * `withInternalAuth`'s `NextRequestHandler`-wrapping shape (architecture.md
 * § Decisión: no identity is produced here for a handler parameter).
 */
export function verifyProvisioningSecret(request: Request): NextResponse | null {
  const configured = (process.env.PROVISIONING_SECRET_SHA256 ?? "").trim().toLowerCase();

  if (!PROVISIONING_SECRET_HASH_PATTERN.test(configured)) {
    if (!warnedNotConfigured) {
      warnedNotConfigured = true;
      // Names the VARIABLE, never a value (R11): the likeliest mistake this
      // guards against is pasting the plaintext secret where its SHA-256
      // hex digest belongs — a 401 would be indistinguishable from
      // cuadrecaja simply sending the wrong value (R8, E6).
      console.warn(
        "[provisioning] PROVISIONING_SECRET_SHA256 is missing or is not a 64-character SHA-256 hex digest",
      );
    }
    return provisioningResponse({ error: "PROVISIONING_NOT_CONFIGURED" }, 503);
  }

  const bearer = readBearerToken(request.headers.get("authorization"));
  if (!bearer.ok) return unauthorized();

  // Both buffers are 32 bytes BY CONSTRUCTION — `hashSyncToken` always
  // returns a SHA-256 hex digest, and `configured` just matched the pattern
  // above — so `timingSafeEqual` cannot throw on a length mismatch. The
  // throw itself would leak the length (ADR 0008 § Detalle de
  // implementación), which is exactly what hashing both sides avoids.
  const presented = Buffer.from(hashSyncToken(bearer.token), "hex");
  const expected = Buffer.from(configured, "hex");
  if (!timingSafeEqual(presented, expected)) return unauthorized();

  return null;
}
