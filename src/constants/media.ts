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

/**
 * F-023 R2: the fixed variant set — two widths × two formats, no magic
 * numbers scattered across the encoder, the derivation or the markup.
 *
 * design.md D1: 400 (card) covers every card box up to 264 CSS px at DPR 1
 * and up to 200 px at DPR 2; 800 (detail) covers the product page's box
 * (up to 536 CSS px) at DPR 1 and up to 400 px at DPR 2. Also the width that
 * makes R8's arithmetic true: 300 KB budget ÷ 15 seed products ≈ 20 KB per
 * card variant (`IMAGE_CARD_VARIANT_MAX_BYTES` below).
 */
export const IMAGE_VARIANT_WIDTH_CARD = 400;
export const IMAGE_VARIANT_WIDTH_DETAIL = 800;
export const IMAGE_VARIANT_WIDTHS = [IMAGE_VARIANT_WIDTH_CARD, IMAGE_VARIANT_WIDTH_DETAIL] as const;

export const IMAGE_VARIANT_FORMATS = ["avif", "webp"] as const;
export type ImageVariantFormat = (typeof IMAGE_VARIANT_FORMATS)[number];

export const IMAGE_VARIANT_CONTENT_TYPE: Record<ImageVariantFormat, string> = {
  avif: "image/avif",
  webp: "image/webp",
};

/** architecture.md § Rutas de objeto: literal filename of the untouched
 *  original inside an image's own directory (`<uuid>/original.<ext>`). */
export const IMAGE_ORIGINAL_BASENAME = "original";

/**
 * R8: the only HARD cap — the card's AVIF variant, because it is exactly the
 * object criterio 3 measures and the one downloaded 15 times per catalog
 * page. 300 KB budget ÷ 15 seed products ≈ 20 KB (20 480 B). Not adjusted
 * without going back to design.md — it is business rule, not a tuning knob.
 */
export const IMAGE_CARD_VARIANT_MAX_BYTES = 20 * 1024;

/**
 * design.md D4: quality ladders the encoder walks down while a variant is
 * over its (soft) target, plus the target itself. AVIF numbers are lower
 * than WebP's for equivalent perceived quality. Only the card/AVIF ladder is
 * enforced against a hard cap (`IMAGE_CARD_VARIANT_MAX_BYTES`); the rest are
 * "aim for, never fail on" — the encoder always returns a result, at worst
 * over its own target with a warning surfaced only for the card variant (E3).
 *
 * Adjustable by `sdd-implementer` "with the measurement in front of it"
 * (design.md D4) — everything here except `IMAGE_CARD_VARIANT_MAX_BYTES`.
 */
export const IMAGE_QUALITY_LADDER: Record<
  ImageVariantFormat,
  Record<typeof IMAGE_VARIANT_WIDTH_CARD | typeof IMAGE_VARIANT_WIDTH_DETAIL, readonly number[]>
> = {
  avif: {
    [IMAGE_VARIANT_WIDTH_CARD]: [52, 46, 40, 34],
    [IMAGE_VARIANT_WIDTH_DETAIL]: [54, 48, 42],
  },
  webp: {
    [IMAGE_VARIANT_WIDTH_CARD]: [74, 66, 58],
    [IMAGE_VARIANT_WIDTH_DETAIL]: [76, 68, 60],
  },
};

/** design.md D4: the byte target the encoder aims for before it ever checks
 *  the hard cap above — 10% under the cap, on purpose (R7 arithmetic). */
export const IMAGE_QUALITY_TARGET_BYTES: Record<
  ImageVariantFormat,
  Record<typeof IMAGE_VARIANT_WIDTH_CARD | typeof IMAGE_VARIANT_WIDTH_DETAIL, number>
> = {
  avif: {
    [IMAGE_VARIANT_WIDTH_CARD]: 18 * 1024,
    [IMAGE_VARIANT_WIDTH_DETAIL]: 72 * 1024,
  },
  webp: {
    [IMAGE_VARIANT_WIDTH_CARD]: 30 * 1024,
    [IMAGE_VARIANT_WIDTH_DETAIL]: 120 * 1024,
  },
};

/**
 * architecture.md § El codificador, punto 2: above the spec's accepted
 * 8000×8000 (64 MP) input, with margin, and below the absurd. AP3 (aprobada):
 * `sharp.concurrency(1)` bounds the memory a single instance spends on this.
 */
export const IMAGE_MAX_PIXELS = 80_000_000;

/**
 * design.md § 1: the first full row of desktop (4 columns from 1024px) plus
 * the first two rows of mobile (2 columns) — roughly what sits above the
 * fold. These cards render `eager` with `loading` omitted; the rest are
 * `loading="lazy"`.
 */
export const CATALOG_EAGER_IMAGE_COUNT = 4;
