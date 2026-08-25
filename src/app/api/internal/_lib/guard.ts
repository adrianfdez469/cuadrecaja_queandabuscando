import { NextResponse } from "next/server";
import { verifySyncToken } from "@/lib/syncAuth";

/**
 * Shared guard for every /api/internal/* route.
 *
 * These routes are machine-to-machine only: excluded from robots.txt, outside
 * any public rate limiting, and never reachable with a browser session.
 */
export function guardInternalRequest(request: Request): NextResponse | null {
  const result = verifySyncToken(request.headers.get("authorization"), process.env.SYNC_TOKEN);

  if (result.ok) return null;

  if (result.reason === "unconfigured") {
    // Fail closed and say so distinctly: a missing SYNC_TOKEN is an operator
    // error, not a caller error, and silently 401-ing hides a broken deploy.
    console.error("[internal] SYNC_TOKEN is not configured");
    return NextResponse.json({ error: "SYNC_NOT_CONFIGURED" }, { status: 503 });
  }

  return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
}
