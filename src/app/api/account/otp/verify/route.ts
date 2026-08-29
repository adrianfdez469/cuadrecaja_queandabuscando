import { NextResponse } from "next/server";
import { verifyEmailOtp } from "@/lib/auth/customerSession";
import { ensureCustomerForUser } from "@/features/account/server/customers";
import { verifyOtpRequestSchema } from "@/features/account/schemas";
import { authUnavailable, NO_STORE, readAccountJsonBody, zodInvalidBody } from "../../_lib/respond";

export const dynamic = "force-dynamic";

/**
 * E1, step 2. On success, writes the session + hint cookies (inside
 * `verifyEmailOtp`) and creates the `Customer` on the first login (E5) before
 * responding — `/cuenta`, navigated to right after, needs the row to exist.
 */
export async function POST(request: Request) {
  const body = await readAccountJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = verifyOtpRequestSchema.safeParse(body.json);
  if (!parsed.success) return zodInvalidBody(parsed.error);

  const result = await verifyEmailOtp(parsed.data.email, parsed.data.token);
  if (!result.ok) {
    if (result.reason === "not_configured" || result.reason === "unavailable") {
      return authUnavailable();
    }
    return NextResponse.json(
      { error: "OTP_REJECTED", reason: result.reason },
      { status: 401, headers: NO_STORE },
    );
  }

  const profile = await ensureCustomerForUser(result.user);
  return NextResponse.json({ signedIn: true, profile }, { status: 200, headers: NO_STORE });
}
