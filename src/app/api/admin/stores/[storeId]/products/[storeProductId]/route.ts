import { guardAdminStore } from "../../../../_lib/guard";
import { readAdminJsonBody, writeResultToResponse, zodInvalidBody } from "../../../../_lib/respond";
import { productWriteSchema } from "@/features/admin/schemas";
import { saveProduct } from "@/features/admin/server/mutations";

export const dynamic = "force-dynamic";

/**
 * The full-replacement write of the six panel-owned fields (E15). `PATCH` is
 * an alias of `PUT`: `spec.md` verifies with `PATCH` and a 405 there would
 * be a false negative of the sensor, not a real failure (architecture.md §
 * Endpoints).
 */
async function handle(
  request: Request,
  { params }: RouteContext<"/api/admin/stores/[storeId]/products/[storeProductId]">,
) {
  const { storeId, storeProductId } = await params;

  const guard = await guardAdminStore(storeId);
  if (!guard.ok) return guard.response;

  const body = await readAdminJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = productWriteSchema.safeParse(body.json);
  if (!parsed.success) return zodInvalidBody(parsed.error);

  try {
    const result = await saveProduct(guard.storeId, storeProductId, parsed.data);
    return writeResultToResponse(result);
  } catch (error) {
    console.error("[admin] product write failed:", error);
    return writeResultToResponse({ kind: "failed" });
  }
}

export { handle as PUT, handle as PATCH };
