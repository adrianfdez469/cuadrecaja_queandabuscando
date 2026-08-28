import { prisma } from "@/lib/prisma";

/**
 * The identity the guard hands to every /api/internal/* handler (F-018).
 *
 * This module is the ONLY place that resolves a Business from a token hash
 * (R9): `src/lib/syncAuth.ts` stays pure and `src/app/api/internal/_lib/
 * guard.ts` only composes what this module returns.
 */
export type InternalCaller = {
  /** Business.id (uuid). What goes into every `where`. */
  businessId: string;
  /** Business.externalId — the POS's Negocio.id. The only thing compared
   *  against the payload, and the only thing written to
   *  SyncEvent.businessId (R7). */
  externalId: string;
};

export type CallerResolution =
  | { status: "ok"; caller: InternalCaller }
  | { status: "inactive" } // hash resolves, Business.active = false -> 403
  | { status: "unknown" } // hash resolves to nothing, but hashes exist -> 401
  | { status: "unconfigured" }; // no Business has any syncTokenHash -> 503

/**
 * `tokenHash` must always be a hex string — `readBearerToken` already
 * validated the header's shape before this is called. Prohibited: resolving
 * with `findFirst` on a value that could be `undefined`, which would match
 * the first row in the table and authenticate as an arbitrary business (E8).
 */
export async function resolveCaller(tokenHash: string): Promise<CallerResolution> {
  const row = await prisma.business.findUnique({
    where: { syncTokenHash: tokenHash },
    select: { id: true, externalId: true, active: true },
  });

  if (!row) {
    return (await syncConfigured()) ? { status: "unknown" } : { status: "unconfigured" };
  }
  if (!row.active) return { status: "inactive" };
  return { status: "ok", caller: { businessId: row.id, externalId: row.externalId } };
}

/**
 * A `LIMIT 1` probe, only ever executed on the failure path (a token that
 * did not resolve, or no header at all): does ANY business have a token
 * configured at all? Distinguishes "nobody has been minted a token yet"
 * (503) from "this particular token is wrong" (401) — R2.
 */
export async function syncConfigured(): Promise<boolean> {
  const row = await prisma.business.findFirst({
    where: { syncTokenHash: { not: null } },
    select: { id: true },
  });
  return row !== null;
}
