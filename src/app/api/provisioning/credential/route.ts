import { readJsonBody, serializableIssues } from "@/lib/httpJson";
import { provisionCredentialSchema } from "@/features/sync/schemas";
import { provisionCredential } from "@/features/sync/server/provisioning";
import { PROVISIONING_MAX_BODY_BYTES } from "@/constants/sync";
import { verifyProvisioningSecret } from "../_lib/guard";
import { provisioningResponse } from "../_lib/respond";

export const dynamic = "force-dynamic";

/**
 * The alta of a business and the minting of its sync token, over HTTP —
 * replacing the terminal session `npm run mint:token` used to require
 * (spec.md § Problema). `POST` only: it mints a credential and creates a
 * row, the same reasoning as
 * `POST /api/internal/realtime/credential`
 * (src/app/api/internal/realtime/credential/route.ts:13-16) — never a `GET`
 * (E16): no other verb is exported, so the framework itself answers 405.
 *
 * Composes HTTP only, in this order: guard -> body -> schema -> the server
 * module -> status code. Zero Prisma here, zero business logic (R13,
 * AGENTS.md § Arquitectura) — `src/features/sync/server/provisioning.ts` is
 * the only module that writes.
 */
export async function POST(request: Request) {
  const guardResponse = verifyProvisioningSecret(request);
  if (guardResponse) return guardResponse;

  const body = await readJsonBody(request, { maxBytes: PROVISIONING_MAX_BODY_BYTES });
  if (!body.ok) return provisioningResponse({ error: "INVALID_BODY", issues: body.issues }, 400);

  const parsed = provisionCredentialSchema.safeParse(body.json);
  if (!parsed.success) {
    return provisioningResponse(
      { error: "INVALID_BODY", issues: serializableIssues(parsed.error) },
      400,
    );
  }

  const result = await provisionCredential(parsed.data);
  const externalId = parsed.data.externalId;

  // No `default`: adding a new `ProvisionResult` status has to break this
  // compile step, not fall through to a silent 500 — the same discipline
  // `withInternalAuth` uses over `CallerResolution`
  // (src/app/api/internal/_lib/guard.ts).
  switch (result.status) {
    case "minted":
      return provisioningResponse(
        { externalId, created: result.created, minted: true, token: result.token },
        201,
      );
    case "already_minted":
      return provisioningResponse({ externalId, created: false, minted: false, token: null }, 200);
    case "inactive":
      return provisioningResponse({ error: "BUSINESS_INACTIVE" }, 403);
    case "collision":
      return provisioningResponse({ error: "TOKEN_COLLISION" }, 503);
  }
}
