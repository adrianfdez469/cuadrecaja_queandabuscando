import { NextResponse } from "next/server";
import { withInternalAuth } from "../_lib/guard";
import { previewSlug } from "@/features/storefront/server/registry";
import { publicEnv } from "@/lib/env";

/**
 * HS7 — cuadrecaja can ask, BEFORE publishing, what slug a candidate would
 * actually resolve to. `architecture.md` § El servicio de disponibilidad de
 * slug: this is a forecast, never a reservation (`reserving` is always
 * `false`), and it calls the exact same function the creator uses
 * (`previewSlug`, sharing `uniqueSlug`/the `Slug` table lookup with
 * `createStorefrontWithStore`) — two implementations would let this endpoint
 * lie the day someone changed one without the other.
 *
 * Contract, aditivo, part of the still-unsent v3 announcement of
 * `docs/sync-contract.md` (§ Propuesta v3) — see the diff proposed in
 * `architecture.md` § El diff propuesto. F-018: `storeId` is checked against
 * the caller's own business (R10) — everything else stays unscoped, because
 * the slug namespace is global.
 */
export const dynamic = "force-dynamic";

export const GET = withInternalAuth(async (request, caller) => {
  const params = new URL(request.url).searchParams;
  const slug = params.get("slug");
  const name = params.get("name");
  const storeId = params.get("storeId");

  if (!slug && !name) {
    return NextResponse.json({ error: "MISSING_QUERY" }, { status: 400 });
  }

  const result = await previewSlug({
    slug,
    name,
    storeExternalId: storeId,
    businessId: caller.businessId,
  });

  return NextResponse.json(
    {
      candidate: result.candidate,
      available: result.available,
      reason: result.reason,
      resolvedSlug: result.resolvedSlug,
      url: new URL(`/${result.resolvedSlug}`, publicEnv.siteUrl).toString(),
      storeKnown: result.storeKnown,
      // Always false: this is a forecast, never a reservation (HS7) — a
      // slug apart for a store that never publishes is a slug nobody else
      // can ever use, with no expiry anyone asked for.
      reserving: false,
    },
    { headers: { "cache-control": "no-store" } },
  );
});
