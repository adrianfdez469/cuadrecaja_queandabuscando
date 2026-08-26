import type { ZodError } from "zod";
import type { InvalidBodyIssue } from "@/features/orders/types";

/**
 * Zod issues, reduced to what is safe to serialize.
 *
 * A Zod issue carries the constraint that was violated, and for a `bigint`
 * schema that value is a **BigInt** — `too_small` on `since` arrives as
 * `minimum: 0n`. `NextResponse.json` runs `JSON.stringify`, which throws on a
 * BigInt, so handing `error.issues` straight to it turns the 400 branch itself
 * into an uncaught 500 with an empty body. Found by executing F-007, not by
 * reading: `GET /api/internal/orders?since=-1` did exactly that.
 *
 * Fixing the schema would not be enough. The problem is not that a BigInt
 * exists, it is that anything a future schema puts in an issue gets serialized
 * unchecked. `path` and `message` are the only two fields a caller can act on
 * anyway; the rest was never useful to them.
 *
 * The public order routes already do this — `zodIssuesToInvalidBody` in
 * `app/api/orders/_lib/body.ts`. This is the same convention for the internal
 * ones, which never adopted it. The shape is deliberately `InvalidBodyIssue`,
 * the one the public routes already return, so both halves of the API report a
 * validation error the same way.
 *
 * Not a contract change: `issues` does not appear in docs/sync-contract.md,
 * which pins the success shapes and the error codes, not this payload.
 */
export function serializableIssues(error: ZodError): InvalidBodyIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path as (string | number)[],
    message: issue.message,
  }));
}
