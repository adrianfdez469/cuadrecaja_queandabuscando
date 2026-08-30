import { NextResponse } from "next/server";
import { startOAuth } from "@/lib/auth/customerSession";
import { safeNextPath } from "@/lib/safeNextPath";
import { startOAuthRequestSchema } from "@/features/account/schemas";
import { authUnavailable, NO_STORE, readAccountJsonBody, zodInvalidBody } from "../_lib/respond";

export const dynamic = "force-dynamic";

/**
 * E2, E23. Returns the provider's URL; the island navigates to it itself
 * (`window.location.assign`) — this route never redirects (architecture.md §
 * DA5): `signInWithOAuth` is called with `skipBrowserRedirect: true`.
 */
export async function POST(request: Request) {
  const body = await readAccountJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = startOAuthRequestSchema.safeParse(body.json);
  if (!parsed.success) return zodInvalidBody(parsed.error);

  const origin = new URL(request.url).origin;
  const next = safeNextPath(parsed.data.next);
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;

  const result = await startOAuth(parsed.data.provider, redirectTo);
  if (!result.ok) {
    if (result.reason === "provider_disabled") {
      return NextResponse.json({ error: "PROVIDER_DISABLED" }, { status: 409, headers: NO_STORE });
    }
    return authUnavailable();
  }

  return NextResponse.json({ url: result.url }, { status: 200, headers: NO_STORE });
}
