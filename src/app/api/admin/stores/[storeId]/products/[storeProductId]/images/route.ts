import { NextResponse } from "next/server";
import { guardAdminStore } from "../../../../../_lib/guard";
import { invalidFile, NO_STORE, writeResultToResponse } from "../../../../../_lib/respond";
import { getProductForEdit } from "@/features/admin/server/products";
import { appendProductImage } from "@/features/admin/server/mutations";
import { storageAvailability } from "@/lib/supabase/storage";
import { detectImageMime, isAllowedImageMime } from "@/lib/imageType";
import { encodeImageVariants } from "@/lib/imageEncoder";
import { IMAGE_MAX_BYTES, PRODUCT_MAX_IMAGES } from "@/constants/media";

export const dynamic = "force-dynamic";
// F-023 SP1/architecture.md § El codificador: `sharp` needs Node, never edge
// — this documents that this endpoint cannot migrate, it does not opt into
// anything new (`"nodejs"` is already the route handler default).
export const runtime = "nodejs";
// Encoding one image is 1.5-2.5s of CPU in the worst case the spec accepts
// (4 MB / 8000×8000) plus five sequential-enough Storage round trips; 30s
// leaves ample margin without inviting a runaway request to hang forever.
// AGENTS.md § Cosas que muerden: a literal, never an imported constant —
// Next analyzes segment config exports statically.
export const maxDuration = 30;

/**
 * `multipart/form-data` — the only panel route that isn't JSON, because a
 * file cannot be. Order matters (architecture.md § Subida de imagen): the
 * ownership check (E24) and the two 409s happen BEFORE `request.formData()`
 * even runs, so a 403 never costs reading the uploaded bytes.
 *
 * F-023 (SP1): a new stage — encoding — sits between the mime sniff and the
 * write. It runs BEFORE anything touches Storage, which is what makes R6
 * (all-or-nothing) cheap: a corrupt file or a decoder timeout never leaves a
 * single object behind.
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

  const encoded = await encodeImageVariants(bytes, mime);
  if (!encoded.ok) {
    // "archivo corrupto" caso límite: a mime-sniffed-valid file the decoder
    // still can't handle, or one that lies about its real dimensions past
    // `IMAGE_MAX_PIXELS` — both are the caller's fault, a 400, and neither
    // uploads a single object.
    if (encoded.reason === "decode_failed" || encoded.reason === "too_many_pixels") {
      return invalidFile("decode");
    }
    // `encode_failed`: ours, not the caller's — the same 503 shape a Storage
    // outage produces (architecture.md § Endpoint de subida).
    return NextResponse.json(
      { error: "STORAGE_UNAVAILABLE", reason: "encode_failed" },
      { status: 503, headers: NO_STORE },
    );
  }

  try {
    const result = await appendProductImage(guard.storeId, storeProductId, lookup.storeSlug, {
      bytes,
      mime,
      encoded,
    });
    return writeResultToResponse(result);
  } catch (error) {
    console.error("[admin] image upload failed:", error);
    return writeResultToResponse({ kind: "failed" });
  }
}
