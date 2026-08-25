import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE } from "@/lib/auth/adminSession";

/**
 * Proxy (formerly `middleware`) runs on a deliberately narrow set of paths.
 *
 * The public storefront (`/[slug]/**`) is NOT matched, and that is the single
 * most important line in this file. Middleware executes on every request,
 * including ones the CDN would otherwise serve from cache — matching the
 * storefront would quietly undo the entire ISR strategy.
 *
 * Session validity is not checked here (that needs the jose verification, which
 * belongs in the route). This only redirects when there is plainly no cookie,
 * so that an anonymous visitor never reaches an admin page shell.
 */
export default function proxy(request: NextRequest) {
  const hasSession = request.cookies.has(ADMIN_COOKIE);
  if (hasSession) return NextResponse.next();

  const url = new URL("/", request.url);
  url.searchParams.set("admin", "sesion-requerida");
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    /*
     * Admin pages only, and never /admin/sso — that route is precisely how a
     * session is obtained, so guarding it would make login impossible.
     */
    "/admin/:path((?!sso).*)",
    "/admin",
  ],
};
