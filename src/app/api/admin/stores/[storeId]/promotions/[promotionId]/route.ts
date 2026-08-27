import { NextResponse } from "next/server";
import { guardAdminStore } from "../../../../_lib/guard";
import {
  NO_STORE,
  readAdminJsonBody,
  writeResultToResponse,
  zodInvalidBody,
} from "../../../../_lib/respond";
import { promotionBodySchema } from "@/features/admin/schemas";
import { deletePromotion, updatePromotion } from "@/features/admin/server/mutations";

export const dynamic = "force-dynamic";

async function put(
  request: Request,
  { params }: RouteContext<"/api/admin/stores/[storeId]/promotions/[promotionId]">,
) {
  const { storeId, promotionId } = await params;

  const guard = await guardAdminStore(storeId);
  if (!guard.ok) return guard.response;

  const body = await readAdminJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = promotionBodySchema.safeParse(body.json);
  if (!parsed.success) return zodInvalidBody(parsed.error);

  try {
    const result = await updatePromotion(guard.storeId, promotionId, parsed.data);
    return writeResultToResponse(result);
  } catch (error) {
    console.error("[admin] promotion update failed:", error);
    return writeResultToResponse({ kind: "failed" });
  }
}

export async function DELETE(
  _request: Request,
  { params }: RouteContext<"/api/admin/stores/[storeId]/promotions/[promotionId]">,
) {
  const { storeId, promotionId } = await params;

  const guard = await guardAdminStore(storeId);
  if (!guard.ok) return guard.response;

  try {
    const result = await deletePromotion(guard.storeId, promotionId);
    if (result.kind === "saved") {
      return NextResponse.json({ id: result.value.id, deleted: true }, { headers: NO_STORE });
    }
    return writeResultToResponse(result);
  } catch (error) {
    console.error("[admin] promotion delete failed:", error);
    return writeResultToResponse({ kind: "failed" });
  }
}

export { put as PUT, put as PATCH };
