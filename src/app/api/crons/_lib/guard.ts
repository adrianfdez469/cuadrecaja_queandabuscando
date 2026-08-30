import { NextResponse } from "next/server";

/**
 * Shared guard for every `/api/crons/*` route (F-019, extracted from
 * `purge-sso-tokens/route.ts`, the pattern this repeats verbatim): a bearer
 * token compared against `CRON_SECRET`, `401` if it is missing or wrong.
 * Deliberately independent of `withInternalAuth` — Vercel's cron caller has
 * no `Business`, and a cron route is not machine-to-machine sync traffic.
 */
export function verifyCronSecret(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  return null;
}
