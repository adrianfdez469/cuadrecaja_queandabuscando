import { guardAdminStore } from "../../../_lib/guard";
import { readAdminJsonBody, writeResultToResponse, zodInvalidBody } from "../../../_lib/respond";
import { promotionBodySchema } from "@/features/admin/schemas";
import { createPromotion } from "@/features/admin/server/mutations";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/admin/stores/[storeId]/promotions">,
) {
  const { storeId } = await params;

  const guard = await guardAdminStore(storeId);
  if (!guard.ok) return guard.response;

  const body = await readAdminJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = promotionBodySchema.safeParse(body.json);
  if (!parsed.success) return zodInvalidBody(parsed.error);

  try {
    const result = await createPromotion(guard.storeId, parsed.data);
    return writeResultToResponse(result);
  } catch (error) {
    console.error("[admin] promotion create failed:", error);
    return writeResultToResponse({ kind: "failed" });
  }
}
