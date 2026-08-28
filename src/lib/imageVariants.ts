import {
  IMAGE_ORIGINAL_BASENAME,
  IMAGE_VARIANT_FORMATS,
  IMAGE_VARIANT_WIDTH_CARD,
  IMAGE_VARIANT_WIDTH_DETAIL,
  IMAGE_VARIANT_WIDTHS,
  type ImageVariantFormat,
} from "@/constants/media";

/**
 * F-023 architecture.md § Rutas de objeto — decision (a) — and § El contrato
 * de la derivación.
 *
 * Pure and environment-free on purpose: no `node:crypto`, no Prisma, no
 * `fetch`, no env var. That is what lets `ImageUploader.tsx` — a `"use
 * client"` island — import this module without dragging a Node-only module
 * into the client bundle it ships to the browser.
 *
 * A F-023 image is a DIRECTORY of five objects:
 *
 *   stores/<storeId>/products/<storeProductId>/<uuid>/original.<ext>
 *   stores/<storeId>/products/<storeProductId>/<uuid>/w400.avif
 *   stores/<storeId>/products/<storeProductId>/<uuid>/w400.webp
 *   stores/<storeId>/products/<storeProductId>/<uuid>/w800.avif
 *   stores/<storeId>/products/<storeProductId>/<uuid>/w800.webp
 *
 * `imageUrls` only ever stores the FIRST line — the URL of `original.<ext>` —
 * and everything else is a substitution of that URL's last path segment
 * (R5). A F-011 image (`.../<uuid>.<ext>`, no directory) is not ambiguous
 * with one of these: `randomUUID()` never produces the literal string
 * "original", so BOTH conditions below (right basename AND a UUID-shaped
 * penultimate segment) have to hold before a URL is treated as F-023's.
 */

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ImageVariant = { width: number; url: string };

export type ImageVariantSet = {
  /** Everything up to and including the image's own `<uuid>/` directory. */
  dir: string;
  /** Ordered smallest to largest width. */
  avif: ImageVariant[];
  webp: ImageVariant[];
  /** R4: the `<img>` fallback — the WebP of the card width. */
  fallbackUrl: string;
  /** R15: what the openGraph tag points to — the WebP of the detail width. */
  socialUrl: string;
};

function variantBasename(width: number, format: ImageVariantFormat): string {
  return `w${width}.${format}`;
}

/**
 * `null` = a legacy F-011 URL, or a URL outside our own bucket layout (R11,
 * E9) — the caller falls back to a plain `<img>`.
 */
export function deriveImageVariants(url: string): ImageVariantSet | null {
  const lastSlash = url.lastIndexOf("/");
  if (lastSlash < 0) return null;
  const basename = url.slice(lastSlash + 1);
  const dotIndex = basename.lastIndexOf(".");
  if (dotIndex <= 0) return null;
  const name = basename.slice(0, dotIndex);
  if (name !== IMAGE_ORIGINAL_BASENAME) return null;

  const dir = url.slice(0, lastSlash + 1); // includes trailing "/"
  const withoutTrailingSlash = url.slice(0, lastSlash);
  const uuidSlash = withoutTrailingSlash.lastIndexOf("/");
  const uuid = withoutTrailingSlash.slice(uuidSlash + 1);
  if (!UUID_V4_RE.test(uuid)) return null;

  const avif = IMAGE_VARIANT_WIDTHS.map((width) => ({
    width,
    url: `${dir}${variantBasename(width, "avif")}`,
  }));
  const webp = IMAGE_VARIANT_WIDTHS.map((width) => ({
    width,
    url: `${dir}${variantBasename(width, "webp")}`,
  }));

  return {
    dir,
    avif,
    webp,
    fallbackUrl: `${dir}${variantBasename(IMAGE_VARIANT_WIDTH_CARD, "webp")}`,
    socialUrl: `${dir}${variantBasename(IMAGE_VARIANT_WIDTH_DETAIL, "webp")}`,
  };
}

/**
 * Every object NAME (not full path) of one image, derived from the
 * original's own extension — used by the upload (to write) and by the
 * panel's removal (to build the keys to delete).
 */
export function imageObjectNamesFor(ext: string): string[] {
  const names = [`${IMAGE_ORIGINAL_BASENAME}.${ext}`];
  for (const width of IMAGE_VARIANT_WIDTHS) {
    for (const format of IMAGE_VARIANT_FORMATS) {
      names.push(variantBasename(width, format));
    }
  }
  return names;
}

/** `stores/<storeId>/products/<storeProductId>/` — the prefix E11 deletes
 *  in its entirety. */
export function productObjectPrefix(input: { storeId: string; storeProductId: string }): string {
  return `stores/${input.storeId}/products/${input.storeProductId}/`;
}

/** R15: a legacy URL (no variants) is passed through unchanged. */
export function socialImageUrl(url: string): string {
  return deriveImageVariants(url)?.socialUrl ?? url;
}
