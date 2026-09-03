import { prisma } from "@/lib/prisma";
import { mintSyncToken } from "@/lib/syncAuth";
import { isUniqueViolation } from "@/features/orders/server/prismaErrors";
import type { ProvisionCredentialInput } from "@/features/sync/schemas";

/**
 * The ONLY module that touches Prisma for F-034 (R13, AGENTS.md §
 * Arquitectura). `src/app/api/provisioning/credential/route.ts` calls this
 * and translates its result to HTTP; nothing here knows what a status code
 * is.
 */
export type ProvisionResult =
  | { status: "minted"; created: boolean; token: string }
  | { status: "already_minted" }
  | { status: "inactive" }
  | { status: "collision" };

/**
 * Bounds the recursion below to ONE retry. The two windows it covers are
 * both other-writer races that can only open BETWEEN this call's own
 * compare-and-set and its tie-break read (the row disappearing, or its
 * `syncTokenHash` being cleared by something else, in that exact gap) — not
 * anything this function's own concurrent invocations can cause, which is
 * what E10/E11 already cover without ever reaching this path.
 */
const MAX_RETRY_ATTEMPTS = 1;

/**
 * Create-if-missing + compare-and-set, over TWO autocommit statements with
 * NO `$transaction` (architecture.md § R12): the pooler runs in transaction
 * mode, and a query on the global client inside an interactive transaction
 * deadlocks against it (AGENTS.md § Cosas que muerden). Registering is
 * idempotent and NEVER rotates (R3/R4): a repeated call for a `Business`
 * that already has a `syncTokenHash` never gets a new one, and that
 * idempotence is the property that makes a lost/duplicated cuadrecaja
 * request harmless.
 */
export async function provisionCredential(
  input: ProvisionCredentialInput,
  attempt = 0,
): Promise<ProvisionResult> {
  const { externalId, name } = input;
  const { token, hash } = mintSyncToken(); // R2 — never reimplemented

  // --- step 1: try the alta ------------------------------------------------
  try {
    await prisma.business.create({
      data: { externalId, name: name ?? externalId, syncTokenHash: hash }, // E17
      select: { id: true },
    });
    return { status: "minted", created: true, token }; // E1
  } catch (error) {
    if (isUniqueViolation(error, "externalId")) {
      // Ordinary race: the Business already exists — fall through to the
      // compare-and-set below.
    } else if (isUniqueViolation(error, "syncTokenHash")) {
      // E12: the whole INSERT aborted — no Business row survives either,
      // not even the one this call would otherwise have created.
      return { status: "collision" };
    } else {
      throw error; // a real failure, not a race
    }
  }

  // --- step 2: compare-and-set, no SELECT before it (ADR 0018 (a)) --------
  let applied: number;
  try {
    const result = await prisma.business.updateMany({
      where: { externalId, syncTokenHash: null, active: true },
      data: { syncTokenHash: hash },
    });
    applied = result.count;
  } catch (error) {
    if (isUniqueViolation(error, "syncTokenHash")) return { status: "collision" }; // E12
    throw error;
  }
  if (applied === 1) return { status: "minted", created: false, token }; // E3

  // --- step 3: tie-break read, only reached when step 2 applied to 0 rows -
  const row = await prisma.business.findUnique({
    where: { externalId },
    select: { active: true, syncTokenHash: true },
  });

  // `active` is checked BEFORE `syncTokenHash`: a business that was taken
  // down WITH a token already minted must answer 403, never 200
  // (architecture.md § Flujo de datos, "el 403 de E9 gana al 200 de E4").
  if (row && !row.active) return { status: "inactive" }; // E9, never re-activates
  if (row && row.syncTokenHash) return { status: "already_minted" }; // E4 / E10 / E11

  // Only reachable if the row vanished, or its hash was cleared, in the gap
  // between step 2 and this read — a window opened by SOME OTHER writer,
  // never by two concurrent calls of this same function (those are already
  // resolved by step 2's compare-and-set). Retried once; a second miss is a
  // 500, which is more honest than a 200 that would be lying.
  if (attempt >= MAX_RETRY_ATTEMPTS) {
    throw new Error(
      "provisionCredential: externalId's row changed shape mid-flight after one retry",
    );
  }
  return provisionCredential(input, attempt + 1);
}
