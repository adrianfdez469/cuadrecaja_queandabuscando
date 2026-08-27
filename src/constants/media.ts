/**
 * Product image limits (R20).
 *
 * 4 MB, not the 5 MB the spec first wrote (R20) — PP1 in `plan.md` overrides
 * it: a Vercel serverless function body caps out around 4.5 MB, so a request
 * that stays under 4 MB never gets clipped by the platform before our own
 * check runs. The Storage emulator's own `FILE_SIZE_LIMIT` is set to 10 MB
 * (`docker-compose.yml`) precisely so that OUR limit is always the one that
 * bites first — a 413 from the emulator would look identical to a bug here.
 */
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/** Decided by content-sniffed mime (R20), never by the filename extension. */
export const IMAGE_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;

export type AllowedImageMime = (typeof IMAGE_ALLOWED_MIME)[number];

/** Canonical file extension per allowed mime, used to build the object path (R19). */
export const IMAGE_EXTENSION_FOR_MIME: Record<AllowedImageMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

/** Per product, per R20. */
export const PRODUCT_MAX_IMAGES = 8;
