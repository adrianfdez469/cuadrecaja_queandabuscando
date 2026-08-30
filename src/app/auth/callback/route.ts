import { NextResponse } from "next/server";
import { exchangeCustomerCode } from "@/lib/auth/customerSession";
import { ensureCustomerForUser } from "@/features/account/server/customers";
import { safeNextPath } from "@/lib/safeNextPath";

export const dynamic = "force-dynamic";

/**
 * E3, E19, E20, E27. No screen (design.md § 3, NC4): every path here ends in
 * a 307, either to the validated `next` or back to `/cuenta/entrar` with an
 * `aviso`. `next` is validated with `safeNextPath` BEFORE it is used for
 * anything (R7) — this route sits right behind a freshly-set session cookie,
 * so an open redirector here would be the worst possible place for one.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const next = safeNextPath(url.searchParams.get("next"));

  // E20: the provider itself reported an error, or the person cancelled.
  if (url.searchParams.get("error")) {
    return NextResponse.redirect(new URL("/cuenta/entrar?aviso=cancelado", origin), 307);
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/cuenta/entrar?aviso=caducado", origin), 307);
  }

  // E19: an invalid or already-consumed code. No session, no Customer.
  const result = await exchangeCustomerCode(code);
  if (!result.ok) {
    return NextResponse.redirect(new URL("/cuenta/entrar?aviso=caducado", origin), 307);
  }

  await ensureCustomerForUser(result.user);
  return NextResponse.redirect(new URL(next, origin), 307);
}
