import {
  IMAGE_ALLOWED_MIME,
  IMAGE_EXTENSION_FOR_MIME,
  type AllowedImageMime,
} from "@/constants/media";

/**
 * Content-sniffed mime detection (R20).
 *
 * The browser's own `Content-Type` for a multipart part is whatever the
 * filename extension suggests, which is precisely what a renamed
 * `notas.txt` → `notas.jpg` exploits. This reads the first bytes instead.
 * Pure: no Prisma, no `fetch`, trivially testable with a handful of buffers.
 */
export function detectImageMime(bytes: Uint8Array): AllowedImageMime | null {
  if (isJpeg(bytes)) return "image/jpeg";
  if (isPng(bytes)) return "image/png";
  if (isWebp(bytes)) return "image/webp";
  if (isAvif(bytes)) return "image/avif";
  return null;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length >= signature.length && signature.every((byte, i) => bytes[i] === byte);
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

/** ISO base media file format `ftyp` box, brand `avif` or `avis` (AVIF sequences). */
function isAvif(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const isFtyp = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
  if (!isFtyp) return false;
  const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  return brand === "avif" || brand === "avis";
}

/** Canonical extension for an already-validated mime (R19). */
export function extensionForMime(mime: AllowedImageMime): string {
  return IMAGE_EXTENSION_FOR_MIME[mime];
}

export function isAllowedImageMime(mime: string | null): mime is AllowedImageMime {
  return (IMAGE_ALLOWED_MIME as readonly string[]).includes(mime ?? "");
}
