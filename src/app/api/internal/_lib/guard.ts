import { NextResponse } from "next/server";
import { hashSyncToken, readBearerToken } from "@/lib/syncAuth";
import { resolveCaller, syncConfigured, type InternalCaller } from "@/features/sync/server/caller";

/**
 * Shared envelope for every /api/internal/* route (F-018).
 *
 * These routes are machine-to-machine only: excluded from robots.txt, outside
 * any public rate limiting, and never reachable with a browser session.
 *
 * The identity is handed to the handler as a PARAMETER, not as a boolean the
 * route has to remember to check: a route that does not go through
 * `withInternalAuth` does not compile, because there is no other way to
 * obtain an `InternalCaller`. See architecture.md § Decisión for the
 * alternatives this rejected (a checked `GuardResult`, a cache, resolving in
 * `src/proxy.ts`).
 */
export type InternalRouteHandler = (request: Request, caller: InternalCaller) => Promise<Response>;

/**
 * Order of checks (spec.md § Comportamiento esperado): configuración ->
 * formato de cabecera -> resolución del negocio -> `active`. A request with
 * no header at all still runs the configuration probe (AP3 / PP3): R2 — "a
 * missing token never means let everyone through" — outranks E2/E3's "no
 * query at all", which the spec itself narrows to "no business-RESOLUTION
 * query" once the two collide.
 */
export function withInternalAuth(
  handler: InternalRouteHandler,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const bearer = readBearerToken(request.headers.get("authorization"));

    if (!bearer.ok) {
      if (!(await syncConfigured())) {
        console.error(
          "[internal] no Business has a syncTokenHash configured — run `npm run mint:token <externalId>`",
        );
        return NextResponse.json({ error: "SYNC_NOT_CONFIGURED" }, { status: 503 });
      }
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    const resolution = await resolveCaller(hashSyncToken(bearer.token));

    switch (resolution.status) {
      case "unconfigured":
        console.error(
          "[internal] no Business has a syncTokenHash configured — run `npm run mint:token <externalId>`",
        );
        return NextResponse.json({ error: "SYNC_NOT_CONFIGURED" }, { status: 503 });
      case "unknown":
        return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
      case "inactive":
        return NextResponse.json({ error: "BUSINESS_INACTIVE" }, { status: 403 });
      case "ok":
        return handler(request, resolution.caller);
    }
  };
}
