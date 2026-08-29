import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { readJsonBody, serializableIssues, type SerializableIssue } from "@/lib/httpJson";
import { ACCOUNT_MAX_BODY_BYTES } from "@/constants/account";

/**
 * The HTTP half shared by the four public `/api/account/*` routes (design.md
 * § Defensa de las cuatro rutas POST, docs/adr/0016 defensa 4): strict
 * `content-type`, a byte cap, and `no-store` on every response.
 */
export const NO_STORE = { "cache-control": "no-store" } as const;

export type AccountBodyResult = { ok: true; json: unknown } | { ok: false; response: NextResponse };

export async function readAccountJsonBody(request: Request): Promise<AccountBodyResult> {
  const result = await readJsonBody(request, { maxBytes: ACCOUNT_MAX_BODY_BYTES });
  if (result.ok) return result;
  return {
    ok: false,
    response: NextResponse.json(
      { error: "INVALID_BODY", issues: result.issues },
      { status: 400, headers: NO_STORE },
    ),
  };
}

export function invalidBody(issues: SerializableIssue[]): NextResponse {
  return NextResponse.json({ error: "INVALID_BODY", issues }, { status: 400, headers: NO_STORE });
}

export function zodInvalidBody(error: ZodError): NextResponse {
  return invalidBody(serializableIssues(error));
}

export function authUnavailable(): NextResponse {
  return NextResponse.json({ error: "AUTH_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
}
