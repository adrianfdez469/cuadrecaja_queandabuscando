import { guardAdminStore } from "../../../../../_lib/guard";
import { invalidFile, writeResultToResponse } from "../../../../../_lib/respond";
import { getProductForEdit } from "@/features/admin/server/products";
import { appendProductImage } from "@/features/admin/server/mutations";
import { storageAvailability } from "@/lib/supabase/storage";
import { detectImageMime, isAllowedImageMime } from "@/lib/imageType";
import { IMAGE_MAX_BYTES, PRODUCT_MAX_IMAGES } from "@/constants/media";

export const dynamic = "force-dynamic";

/**
 * `multipart/form-data` — the only panel route that isn't JSON, because a
 * file cannot be. Order matters (architecture.md § Subida de imagen): the
 * ownership check (E24) and the two 409s happen BEFORE `request.formData()`
 * even runs, so a 403 never costs reading the uploaded bytes.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/admin/stores/[storeId]/products/[storeProductId]/images">,
) {
  const { storeId, storeProductId } = await params;

  const guard = await guardAdminStore(storeId);
  if (!guard.ok) return guard.response;

  const lookup = await getProductForEdit(guard.storeId, storeProductId);
  if (!lookup.ok) return writeResultToResponse({ kind: "product_not_in_store" });
  if (lookup.row.deletedAt) return writeResultToResponse({ kind: "product_deleted" });
  // Check-then-act, deliberately unlocked (architecture.md § Subida de
  // imagen): two uploads racing when the product has 7 images can both read
  // "7 < 8" and both push, leaving 9. Accepted — the alternative is a row
  // lock the pooler's transaction mode does not want for an 8-image cap that
  // is a UX nudge, not a hard invariant anything downstream depends on.
  if (lookup.row.imageUrls.length >= PRODUCT_MAX_IMAGES)
    return writeResultToResponse({ kind: "too_many_images" });

  const availability = storageAvailability();
  if (!availability.ok)
    return writeResultToResponse({ kind: "storage_unavailable", reason: availability.reason });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return invalidFile("empty");
  if (file.size > IMAGE_MAX_BYTES) return invalidFile("too_large");

  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = detectImageMime(bytes);
  if (!mime || !isAllowedImageMime(mime)) return invalidFile("mime");

  try {
    const result = await appendProductImage(guard.storeId, storeProductId, lookup.storeSlug, {
      bytes,
      mime,
    });
    return writeResultToResponse(result);
  } catch (error) {
    console.error("[admin] image upload failed:", error);
    return writeResultToResponse({ kind: "failed" });
  }
}
