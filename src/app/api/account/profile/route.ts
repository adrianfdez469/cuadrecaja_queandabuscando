import { NextResponse } from "next/server";
import { getCustomerUser } from "@/lib/auth/customerSession";
import { getProfileByUserId, updateProfileByUserId } from "@/features/account/server/customers";
import { accountProfileSchema } from "@/features/account/schemas";
import { NO_STORE, readAccountJsonBody, zodInvalidBody } from "../_lib/respond";

export const dynamic = "force-dynamic";

/**
 * `GET`: the checkout's autocompletion (DA1, NC2) and `/cuenta`'s own read.
 * ALWAYS 200 — there is no error state, only "signed in" or not (design.md:
 * a failed fetch here must stay invisible to the shopper).
 */
export async function GET() {
  const user = await getCustomerUser();
  if (!user) {
    return NextResponse.json(
      { signedIn: false, profile: null },
      { status: 200, headers: NO_STORE },
    );
  }

  const profile = await getProfileByUserId(user.id);
  return NextResponse.json(
    { signedIn: true, profile: profile ?? null },
    { status: 200, headers: NO_STORE },
  );
}

/**
 * `PUT`: saves the profile from `/cuenta` (E9, E10, E11). The row touched is
 * derived ONLY from the session (R20) — nothing in the body, query or a
 * header can point this at another `Customer`.
 */
export async function PUT(request: Request) {
  const user = await getCustomerUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE });
  }

  const body = await readAccountJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = accountProfileSchema.safeParse(body.json);
  if (!parsed.success) return zodInvalidBody(parsed.error);

  const profile = await updateProfileByUserId(user.id, parsed.data);
  return NextResponse.json({ signedIn: true, profile }, { status: 200, headers: NO_STORE });
}
