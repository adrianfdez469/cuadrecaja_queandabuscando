import sharp from "sharp";
import {
  IMAGE_CARD_VARIANT_MAX_BYTES,
  IMAGE_MAX_PIXELS,
  IMAGE_QUALITY_LADDER,
  IMAGE_QUALITY_TARGET_BYTES,
  IMAGE_VARIANT_CONTENT_TYPE,
  IMAGE_VARIANT_FORMATS,
  IMAGE_VARIANT_WIDTH_CARD,
  IMAGE_VARIANT_WIDTHS,
  type AllowedImageMime,
  type ImageVariantFormat,
} from "@/constants/media";

/**
 * F-023 architecture.md § El codificador — decision (b). The ONLY module
 * allowed to import `sharp` (backed by `src/lib/boundaries.test.ts`).
 *
 * Same contract as `src/lib/supabase/storage.ts`: NEVER throws. Every
 * failure — a corrupt file, a decoder that chokes, an input bigger than
 * `IMAGE_MAX_PIXELS` — comes back as a discriminated result, because the
 * caller (the upload route) turns it into a `400`/`503`, never an uncaught
 * `500`.
 *
 * AP3 (aprobada): bounds a single process to one big decode at a time, so a
 * second large concurrent upload in the same serverless instance queues
 * rather than doubling the peak memory of the first.
 */
sharp.concurrency(1);

export type EncodedVariant = {
  width: number;
  format: ImageVariantFormat;
  contentType: string;
  bytes: Buffer;
};

export type EncodeResult =
  | { ok: true; variants: EncodedVariant[]; heaviestCardBytes: number; warning?: "heavy_image" }
  | { ok: false; reason: "decode_failed" | "too_many_pixels" | "encode_failed" };

const PIXEL_LIMIT_MESSAGE = /exceeds pixel limit/i;

/**
 * Encodes the fixed variant set (R2) from one already mime-sniffed buffer.
 *
 * Four things a change here must not drop (architecture.md § El
 * codificador):
 *   1. `.rotate()` with no args BEFORE resizing — sharp discards EXIF on
 *      encode, and with it the phone's own orientation, unless this bakes it
 *      in first.
 *   2. `limitInputPixels: IMAGE_MAX_PIXELS` — an input that lies about its
 *      real dimensions must not be allowed to blow up the function's memory.
 *   3. One decode, four encodings — `sharp(bytes, …).rotate()` built once,
 *      `.clone()`d per width, so a 4 MB original is only decoded once.
 *   4. `withoutEnlargement: false` — the card/detail widths are ALWAYS
 *      exactly 400/800 px, even for a smaller original, so the `srcset`
 *      descriptors the pure derivation writes are always true.
 */
export async function encodeImageVariants(
  bytes: Buffer,
  _mime: AllowedImageMime,
): Promise<EncodeResult> {
  try {
    const oriented = sharp(bytes, { limitInputPixels: IMAGE_MAX_PIXELS }).rotate();

    const variants: EncodedVariant[] = [];
    let heaviestCardBytes = 0;

    for (const width of IMAGE_VARIANT_WIDTHS) {
      const square = await oriented
        .clone()
        .resize(width, width, { fit: "cover", withoutEnlargement: false })
        .toBuffer();

      for (const format of IMAGE_VARIANT_FORMATS) {
        const encoded = await encodeWithLadder(square, format, width);
        variants.push({
          width,
          format,
          contentType: IMAGE_VARIANT_CONTENT_TYPE[format],
          bytes: encoded,
        });
        if (width === IMAGE_VARIANT_WIDTH_CARD && format === "avif") {
          heaviestCardBytes = encoded.length;
        }
      }
    }

    const warning = heaviestCardBytes > IMAGE_CARD_VARIANT_MAX_BYTES ? "heavy_image" : undefined;
    return { ok: true, variants, heaviestCardBytes, warning };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (PIXEL_LIMIT_MESSAGE.test(message)) return { ok: false, reason: "too_many_pixels" };
    console.error("[image] encode failed:", message);
    return { ok: false, reason: "decode_failed" };
  }
}

/**
 * design.md D4: walks the quality ladder from highest to lowest, stopping at
 * the first rung under the format/width's byte target. If every rung stays
 * over target, the last (lowest-quality, smallest) rung is what ships — the
 * encoder always returns a result, never fails on weight (E3 handles the
 * one case that needs a user-visible warning, in the caller).
 */
async function encodeWithLadder(
  square: Buffer,
  format: ImageVariantFormat,
  width: (typeof IMAGE_VARIANT_WIDTHS)[number],
): Promise<Buffer> {
  const ladder = IMAGE_QUALITY_LADDER[format][width];
  const target = IMAGE_QUALITY_TARGET_BYTES[format][width];

  let last: Buffer | undefined;
  for (const quality of ladder) {
    const out = await encodeAt(square, format, quality);
    last = out;
    if (out.length <= target) return out;
  }
  // `ladder` always has at least one rung (design.md D4) — `last` is set.
  return last as Buffer;
}

function encodeAt(square: Buffer, format: ImageVariantFormat, quality: number): Promise<Buffer> {
  const pipeline = sharp(square);
  return format === "avif"
    ? pipeline.avif({ quality, effort: 4 }).toBuffer()
    : pipeline.webp({ quality }).toBuffer();
}
