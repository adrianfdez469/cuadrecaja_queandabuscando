import { randomUUID } from "node:crypto";

/**
 * Object path for a product image (R19).
 *
 * Carries `storeId` so a path for another store cannot be constructed by
 * hand, and a `uuid` so two uploads — or a retry after a failed write of
 * `imageUrls` — never collide on the same object.
 */
export function objectPathFor(input: {
  storeId: string;
  storeProductId: string;
  ext: string;
}): string {
  return `stores/${input.storeId}/products/${input.storeProductId}/${randomUUID()}.${input.ext}`;
}
