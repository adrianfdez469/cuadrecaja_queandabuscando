/**
 * Re-export of the shared implementation in `src/lib/httpJson.ts`.
 *
 * Kept as its own module so call sites in `api/internal/*` do not change:
 * this file used to hold the implementation itself. See `httpJson.ts` for
 * the story of why a Zod issue cannot be handed to `NextResponse.json`
 * unchecked (a `bigint` in the issue throws inside `JSON.stringify`).
 */
export { serializableIssues } from "@/lib/httpJson";
