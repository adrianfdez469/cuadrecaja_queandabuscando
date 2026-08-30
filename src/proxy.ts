import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE } from "@/lib/auth/adminSession";
import { refreshCustomerSession } from "@/lib/auth/customerSession";

/**
 * Proxy (formerly `middleware`) runs on a deliberately narrow set of paths.
 *
 * The public storefront (`/[slug]/**`) is NOT matched, and that is the single
 * most important line in this file. Middleware executes on every request,
 * including ones the CDN would otherwise serve from cache — matching the
 * storefront would quietly undo the entire ISR strategy.
 *
 * F-012 (architecture.md § DA4) added the shopper's own branch: `/cuenta*`
 * and `/auth*` need their session refreshed here — a Server Component
 * cannot persist a rotated refresh token, and this is the one place that
 * runs before the page and CAN write the response's cookies. Bifurcated by
 * PREFIX, first thing, before any admin logic runs (R22, I5): the admin
 * branch below is untouched, byte for byte, and it NEVER runs for a
 * shopper route — the old code redirected every unmatched path in the
 * `matcher` to `/?admin=sesion-requerida`, and without this split a
 * shopper with no `qab-admin-session` cookie visiting `/cuenta` would have
 * landed there instead of at `/cuenta/entrar`.
 */
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/cuenta") || pathname.startsWith("/auth")) {
    const response = NextResponse.next();
    await refreshCustomerSession(request, response);
    // Never redirects (E24): a shopper with no session still has to be
    // able to open `/cuenta/entrar`; `/cuenta` itself decides.
    return response;
  }

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
    "/cuenta/:path*",
    "/cuenta",
    "/auth/:path*",
  ],
};
