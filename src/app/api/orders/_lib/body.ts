import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { ORDER_MAX_BODY_BYTES } from "@/constants/orders";
import type { InvalidBodyIssue } from "@/features/orders/types";

/**
 * Shared by both public order endpoints. Nothing here is business logic
 * (AGENTS.md § Arquitectura: `src/app/` routes and composes) — it is what has
 * to happen before any of it runs: a strict `content-type` (forces CORS
 * preflight and keeps out a cross-origin POST), a hard size cap, and valid
 * JSON.
 */

export const NO_STORE = { "cache-control": "no-store" } as const;

function invalidBody(issues: InvalidBodyIssue[]): NextResponse {
  return NextResponse.json({ error: "INVALID_BODY", issues }, { status: 400, headers: NO_STORE });
}

export type BodyResult = { ok: true; json: unknown } | { ok: false; response: NextResponse };

export async function readJsonBody(request: Request): Promise<BodyResult> {
  const contentType = (request.headers.get("content-type") ?? "").trim();
  if (!/^application\/json(\s*;.*)?$/i.test(contentType)) {
    return {
      ok: false,
      response: invalidBody([{ path: [], message: "Expected application/json" }]),
    };
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > ORDER_MAX_BODY_BYTES) {
    return { ok: false, response: invalidBody([{ path: ["body"], message: "Body is too large" }]) };
  }

  try {
    return { ok: true, json: JSON.parse(raw) };
  } catch {
    return { ok: false, response: invalidBody([{ path: [], message: "Body is not valid JSON" }]) };
  }
}

export function zodIssuesToInvalidBody(error: ZodError): NextResponse {
  return invalidBody(
    error.issues.map((issue) => ({
      path: issue.path as (string | number)[],
      message: issue.message,
    })),
  );
}
