import type { ZodError } from "zod";

/**
 * A Zod issue reduced to what is safe to serialize and safe to show a caller.
 *
 * `path` and `message` are the only two fields anyone acts on; everything
 * else in a Zod issue can carry a `bigint` (see the story in
 * `api/internal/_lib/issues.ts`, which this module now backs), and
 * `NextResponse.json` throws on those. One shape, one implementation, used by
 * every route in the app that reports a 400.
 */
export type SerializableIssue = { path: (string | number)[]; message: string };

export function serializableIssues(error: ZodError): SerializableIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path as (string | number)[],
    message: issue.message,
  }));
}

export type ReadJsonBodyResult =
  | { ok: true; json: unknown }
  | {
      ok: false;
      reason: "invalid_content_type" | "too_large" | "invalid_json";
      issues: SerializableIssue[];
    };

/**
 * Read and parse a JSON body, without producing a `NextResponse`.
 *
 * Deliberately pure — the caller (`app/api/admin/_lib/respond.ts`) decides
 * how a failure becomes HTTP. `app/api/orders/_lib/body.ts` keeps its own
 * version that returns a `NextResponse` directly: that endpoint predates this
 * module and touching it is outside this feature's scope.
 */
export async function readJsonBody(
  request: Request,
  options: { maxBytes: number },
): Promise<ReadJsonBodyResult> {
  const contentType = (request.headers.get("content-type") ?? "").trim();
  if (!/^application\/json(\s*;.*)?$/i.test(contentType)) {
    return {
      ok: false,
      reason: "invalid_content_type",
      issues: [{ path: [], message: "Expected application/json" }],
    };
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > options.maxBytes) {
    return {
      ok: false,
      reason: "too_large",
      issues: [{ path: ["body"], message: "Body is too large" }],
    };
  }

  try {
    return { ok: true, json: JSON.parse(raw) };
  } catch {
    return {
      ok: false,
      reason: "invalid_json",
      issues: [{ path: [], message: "Body is not valid JSON" }],
    };
  }
}
