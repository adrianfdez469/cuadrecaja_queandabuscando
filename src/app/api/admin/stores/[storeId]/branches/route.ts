import { guardAdminStore } from "../../../_lib/guard";
import {
  forbidden,
  readAdminJsonBody,
  writeResultToResponse,
  zodInvalidBody,
} from "../../../_lib/respond";
import { groupStoresBodySchema } from "@/features/admin/schemas";
import { authorizeStore } from "@/features/admin/authorization";
import { groupStoreIntoBrand } from "@/features/admin/server/mutations";

export const dynamic = "force-dynamic";

/**
 * HS8, etapa 2: agrupar la tienda del cuerpo bajo la marca de `storeId`.
 * Mismo embudo y mismo guard que el resto de `/api/admin/*`
 * (architecture.md § La forma: se agrupan DOS tiendas, luego se autorizan
 * las DOS por separado contra `session.storeIds`).
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/admin/stores/[storeId]/branches">,
) {
  const { storeId } = await params;

  const guard = await guardAdminStore(storeId);
  if (!guard.ok) return guard.response;

  const body = await readAdminJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = groupStoresBodySchema.safeParse(body.json);
  if (!parsed.success) return zodInvalidBody(parsed.error);

  const joining = authorizeStore(guard.session, parsed.data.joiningStoreId);
  if (!joining.ok) return forbidden();

  try {
    const result = await groupStoreIntoBrand(guard.storeId, joining.storeId);
    return writeResultToResponse(result);
  } catch (error) {
    console.error("[admin] group stores write failed:", error);
    return writeResultToResponse({ kind: "failed" });
  }
}
