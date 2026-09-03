import { NextResponse } from "next/server";

/**
 * Every response `/api/provisioning/*` returns is `no-store` (R10, spec.md):
 * this area hands back a bearer credential, and a cached 201 with a token —
 * or even a cached 401 — is not something a proxy should ever be allowed to
 * replay. `guard.ts` and `route.ts` both go through this single function, so
 * R10 is structural: there is no OTHER place in this area that constructs a
 * JSON response and could forget the header (architecture.md § Componentes).
 */
export const NO_STORE = { "cache-control": "no-store" } as const;

export function provisioningResponse(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}
