import { IMAGE_VARIANT_WIDTH_CARD, IMAGE_VARIANT_WIDTH_DETAIL } from "@/constants/media";
import { deriveImageVariants, type ImageVariant } from "@/lib/imageVariants";

/**
 * F-023 architecture.md § Servido, design.md § Inventario de pantallas.
 *
 * The one place the app turns a `StoreProduct.imageUrls[n]` URL into markup —
 * a `<picture>` with AVIF + WebP sources and a WebP `<img>` fallback when the
 * URL has F-023 variants (R4), or a plain `<img>` when it does not (R11,
 * E9). Server component, zero `"use client"` (R16): `<picture>`/`<source>`
 * are HTML, and the format choice is the browser's, before any script runs.
 *
 * Lives in `src/components/ui/` — not `src/components/store/` — because the
 * panel's gallery and listing (`ImageUploader.tsx`, `ProductTable.tsx`) use
 * it too, and `AGENTS.md` reserves `components/store/` for the public
 * storefront.
 */

export type ResponsiveImageVariant = "card" | "detail";

export function ResponsiveImage({
  src,
  alt,
  variant,
  sizes,
  priority = false,
  eager = false,
  fetchPriority,
  className = "absolute inset-0 size-full object-cover",
}: {
  /** The URL of the ORIGINAL, exactly as stored in `imageUrls` — never a
   *  variant URL (R5: variants are derived, never persisted). */
  src: string;
  alt: string;
  variant: ResponsiveImageVariant;
  /** design.md D3: only meaningful for `"detail"` — the card always offers a
   *  single candidate and never needs `sizes`. Ignored for `"card"`. */
  sizes?: string;
  /** The page's LCP candidate: no `loading`, no `decoding`,
   *  `fetchPriority="high"` (design.md § 2, § 1 "índice 0"). */
  priority?: boolean;
  /** Above the fold but not the LCP candidate: no `loading`, no `decoding`,
   *  no `fetchPriority` (design.md § 1, `CATALOG_EAGER_IMAGE_COUNT`).
   *  Ignored when `priority` is set. */
  eager?: boolean;
  /** design.md § 4: the admin listing's own decorative thumbnail. */
  fetchPriority?: "low";
  className?: string;
}) {
  const variants = deriveImageVariants(src);
  const isEager = priority || eager;
  const loadingAttrs = isEager ? {} : ({ loading: "lazy", decoding: "async" } as const);
  const fetchPriorityAttr: "high" | "low" | undefined = priority ? "high" : fetchPriority;
  const fetchPriorityProps = fetchPriorityAttr ? { fetchPriority: fetchPriorityAttr } : {};

  // R11/E9: a legacy F-011 URL, or one foreign to our bucket layout — a
  // plain <img>. No intrinsic width/height: we never derived them from an
  // original we don't control the pipeline of.
  if (!variants) {
    return (
      <img src={src} alt={alt} className={className} {...loadingAttrs} {...fetchPriorityProps} />
    );
  }

  const width = variant === "card" ? IMAGE_VARIANT_WIDTH_CARD : IMAGE_VARIANT_WIDTH_DETAIL;
  const fallbackUrl = variant === "card" ? variants.fallbackUrl : variants.socialUrl;
  const avifSrcSet = toSrcSet(onlyRelevant(variants.avif, variant), variant);
  const webpSrcSet = toSrcSet(onlyRelevant(variants.webp, variant), variant);
  // design.md D3: the card offers ONE candidate and never a `sizes` — a
  // single-candidate `srcset` makes `sizes` meaningless, and every client
  // downloads the same ~20 KB object regardless of viewport.
  const sizesAttr = variant === "detail" ? sizes : undefined;

  return (
    <picture>
      <source type="image/avif" srcSet={avifSrcSet} {...(sizesAttr ? { sizes: sizesAttr } : {})} />
      <source type="image/webp" srcSet={webpSrcSet} {...(sizesAttr ? { sizes: sizesAttr } : {})} />
      <img
        src={fallbackUrl}
        alt={alt}
        width={width}
        height={width}
        className={className}
        {...loadingAttrs}
        {...fetchPriorityProps}
      />
    </picture>
  );
}

/** design.md D3: the card only ever offers the card width; the detail
 *  variant offers both, smallest first (already the derivation's order). */
function onlyRelevant(list: ImageVariant[], variant: ResponsiveImageVariant): ImageVariant[] {
  return variant === "card" ? list.filter((v) => v.width === IMAGE_VARIANT_WIDTH_CARD) : list;
}

function toSrcSet(list: ImageVariant[], variant: ResponsiveImageVariant): string {
  if (variant === "card") return list[0]?.url ?? "";
  return list.map((v) => `${v.url} ${v.width}w`).join(", ");
}
