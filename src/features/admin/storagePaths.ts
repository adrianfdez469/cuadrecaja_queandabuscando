import { randomUUID } from "node:crypto";
import { IMAGE_ORIGINAL_BASENAME } from "@/constants/media";

/**
 * Object path for a product image's ORIGINAL (R19).
 *
 * F-023 architecture.md § Rutas de objeto — decision (a): an image stopped
 * being a single object and became a DIRECTORY of five — this function keeps
 * its name and signature (it is cited between backticks in
 * `.agent/specs/F-011/architecture.md`, and F-011 is `passes: true`, so it
 * cannot move file or disappear — see architecture.md § Qué se rompe, punto
 * 6) but now returns the path of `original.<ext>` INSIDE a fresh `<uuid>/`
 * directory, not a flat `<uuid>.<ext>` file.
 *
 * Carries `storeId` so a path for another store cannot be constructed by
 * hand, and a `uuid` so two uploads — or a retry after a failed write of
 * `imageUrls` — never collide on the same directory. `node:crypto` stays
 * here, not in `src/lib/imageVariants.ts`'s pure derivation, precisely so
 * that module can be imported from `ImageUploader.tsx` ("use client")
 * without dragging a Node-only module into the client bundle.
 */
export function objectPathFor(input: {
  storeId: string;
  storeProductId: string;
  ext: string;
}): string {
  const uuid = randomUUID();
  return `stores/${input.storeId}/products/${input.storeProductId}/${uuid}/${IMAGE_ORIGINAL_BASENAME}.${input.ext}`;
}
