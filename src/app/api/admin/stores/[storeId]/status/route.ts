import { guardAdminStore } from "../../../_lib/guard";
import { readAdminJsonBody, writeResultToResponse, zodInvalidBody } from "../../../_lib/respond";
import { storeStatusBodySchema } from "@/features/admin/schemas";
import { setStoreEnabled } from "@/features/admin/server/mutations";

export const dynamic = "force-dynamic";

/**
 * HD10-HD15: the público switch. `PATCH` is an alias of `PUT`, same reason
 * as the product endpoint (architecture.md § Endpoints).
 */
async function handle(
  request: Request,
  { params }: RouteContext<"/api/admin/stores/[storeId]/status">,
) {
  const { storeId } = await params;

  const guard = await guardAdminStore(storeId);
  if (!guard.ok) return guard.response;

  const body = await readAdminJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = storeStatusBodySchema.safeParse(body.json);
  if (!parsed.success) return zodInvalidBody(parsed.error);

  try {
    const result = await setStoreEnabled(guard.storeId, parsed.data);
    return writeResultToResponse(result);
  } catch (error) {
    console.error("[admin] store status write failed:", error);
    return writeResultToResponse({ kind: "failed" });
  }
}

export { handle as PUT, handle as PATCH };
