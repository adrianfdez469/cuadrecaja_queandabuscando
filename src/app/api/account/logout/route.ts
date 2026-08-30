import { NextResponse } from "next/server";
import { signOutCustomer } from "@/lib/auth/customerSession";

export const dynamic = "force-dynamic";

/**
 * E4, E18. `303` to `/`, so this also works from a plain
 * `<form method="post">` if JavaScript fails. Closing twice is the same as
 * once — there is no session to check first.
 */
export async function POST(request: Request) {
  await signOutCustomer();
  const response = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  response.headers.set("cache-control", "no-store");
  return response;
}
