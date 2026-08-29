import { NextResponse } from "next/server";
import { sendEmailOtp } from "@/lib/auth/customerSession";
import { sendOtpRequestSchema } from "@/features/account/schemas";
import { authUnavailable, NO_STORE, readAccountJsonBody, zodInvalidBody } from "../_lib/respond";

export const dynamic = "force-dynamic";

/**
 * E1, step 1. Public and unauthenticated by design (R2, R3): anyone can
 * request a code for any email — that is exactly what `signInWithOtp`
 * already allows against Supabase directly with the public anon key
 * (architecture.md § Defensa de las cuatro rutas POST).
 */
export async function POST(request: Request) {
  const body = await readAccountJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = sendOtpRequestSchema.safeParse(body.json);
  if (!parsed.success) return zodInvalidBody(parsed.error);

  const result = await sendEmailOtp(parsed.data.email);
  if (!result.ok) {
    if (result.reason === "rate_limited") {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: NO_STORE });
    }
    return authUnavailable();
  }

  return NextResponse.json({ sent: true }, { status: 200, headers: NO_STORE });
}
