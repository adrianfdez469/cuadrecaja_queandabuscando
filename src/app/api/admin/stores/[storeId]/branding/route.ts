import { NextResponse } from "next/server";
import { guardAdminStore } from "../../../_lib/guard";
import {
  forbidden,
  NO_STORE,
  readAdminJsonBody,
  writeResultToResponse,
  zodInvalidBody,
} from "../../../_lib/respond";
import { brandingBodySchema } from "@/features/admin/schemas";
import { authorizeBrandCoverage } from "@/features/admin/authorization";
import { loadBrandingTarget } from "@/features/admin/server/branding";
import { saveBrandTheme } from "@/features/admin/server/mutations";
import { expandBrandRevalidation } from "@/features/storefront/server/registry";

export const dynamic = "force-dynamic";

/**
 * F-011 tanda 3 (architecture.md § El endpoint). `PATCH` is an alias of
 * `PUT`, same reason as the product endpoint. Order, and it is NOT
 * cosmetic (§ Flujo de datos): guard (0 queries) → the one read that both
 * decides cobertura AND revalidación (R43) → the 403 of HD16 — BEFORE the
 * body is even parsed, so the sensor can send a VALID body and still get
 * 403 (criterio 22) → the body → the write.
 */
async function handle(
  request: Request,
  { params }: RouteContext<"/api/admin/stores/[storeId]/branding">,
) {
  const { storeId } = await params;

  const guard = await guardAdminStore(storeId);
  if (!guard.ok) return guard.response;

  const target = await loadBrandingTarget(guard.storeId);
  if (!target) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: NO_STORE });
  }

  const coverage = authorizeBrandCoverage(guard.session, {
    storefrontId: target.storefrontId,
    branches: target.branches,
  });
  // R44: the SAME forbidden() as tienda ajena — a distinct code or body here
  // would leak, to whoever lacks coverage, how many branches a brand they
  // do not fully administer actually has.
  if (!coverage.ok) return forbidden();

  const body = await readAdminJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = brandingBodySchema.safeParse(body.json);
  if (!parsed.success) return zodInvalidBody(parsed.error);

  try {
    const touch = expandBrandRevalidation(target.brandSlug, target.branches);
    const result = await saveBrandTheme(coverage.storefrontId, touch, parsed.data);
    return writeResultToResponse(result);
  } catch (error) {
    console.error("[admin] branding write failed:", error);
    return writeResultToResponse({ kind: "failed" });
  }
}

export { handle as PUT, handle as PATCH };
