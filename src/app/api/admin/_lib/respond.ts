import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { readJsonBody, serializableIssues, type SerializableIssue } from "@/lib/httpJson";
import { ADMIN_MAX_BODY_BYTES } from "@/constants/admin";
import { PRODUCT_MAX_IMAGES } from "@/constants/media";
import type { AdminWriteResult } from "@/features/admin/types";

/**
 * The HTTP half of every `/api/admin/*` route: strict JSON, a byte cap,
 * `no-store` on every response, and the single mapping from `AdminWriteResult`
 * to a status code. The decision itself never lives here (AGENTS.md § Arquitectura).
 */
export const NO_STORE = { "cache-control": "no-store" } as const;

export type AdminBodyResult = { ok: true; json: unknown } | { ok: false; response: NextResponse };

/** JSON body under the panel's byte cap, or a ready-to-return 400. */
export async function readAdminJsonBody(request: Request): Promise<AdminBodyResult> {
  const result = await readJsonBody(request, { maxBytes: ADMIN_MAX_BODY_BYTES });
  if (result.ok) return result;
  return { ok: false, response: invalidBody(result.issues) };
}

export function invalidBody(issues: SerializableIssue[]): NextResponse {
  return NextResponse.json({ error: "INVALID_BODY", issues }, { status: 400, headers: NO_STORE });
}

export function zodInvalidBody(error: ZodError): NextResponse {
  return invalidBody(serializableIssues(error));
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE });
}

export function forbidden(): NextResponse {
  return NextResponse.json({ error: "FORBIDDEN" }, { status: 403, headers: NO_STORE });
}

/** Every mime/size rejection of the image endpoint (E22). */
export function invalidFile(reason: "mime" | "too_large" | "empty"): NextResponse {
  return NextResponse.json({ error: "INVALID_FILE", reason }, { status: 400, headers: NO_STORE });
}

/**
 * Maps every `AdminWriteResult` kind to its HTTP shape (§ Tabla de errores).
 * `"saved"` (a `PUT`) is always 200; `"created"` (a `POST`) is always 201 —
 * neither branch needs the caller to choose.
 */
export function writeResultToResponse<T>(result: AdminWriteResult<T>): NextResponse {
  switch (result.kind) {
    case "saved":
      return NextResponse.json(result.value, { status: 200, headers: NO_STORE });
    case "created":
      return NextResponse.json(result.value, { status: 201, headers: NO_STORE });
    case "product_not_in_store":
    case "promotion_not_in_store":
      return forbidden();
    case "invalid_conditions":
      return invalidBody(result.issues);
    case "product_deleted":
      return NextResponse.json({ error: "PRODUCT_DELETED" }, { status: 409, headers: NO_STORE });
    case "too_many_images":
      return NextResponse.json(
        { error: "TOO_MANY_IMAGES", max: PRODUCT_MAX_IMAGES },
        { status: 409, headers: NO_STORE },
      );
    case "storage_unavailable":
      return NextResponse.json(
        { error: "STORAGE_UNAVAILABLE", reason: result.reason },
        { status: 503, headers: NO_STORE },
      );
    case "not_found":
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: NO_STORE });
    case "different_business":
      return NextResponse.json({ error: "DIFFERENT_BUSINESS" }, { status: 409, headers: NO_STORE });
    case "already_in_brand":
      return NextResponse.json({ error: "ALREADY_IN_BRAND" }, { status: 409, headers: NO_STORE });
    case "failed":
      return NextResponse.json({ error: "WRITE_FAILED" }, { status: 500, headers: NO_STORE });
  }
}
