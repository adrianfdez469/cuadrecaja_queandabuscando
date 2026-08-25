/**
 * Canonical product identity.
 *
 * Resolution has to happen at ingest, not later: a product that lands without
 * an identity would otherwise require reprocessing the whole catalogue to
 * acquire one. This module holds the decision, not the database work, so the
 * branch logic is testable on its own.
 *
 * The third branch is the one that matters — a product with neither a canonical
 * id nor a barcode still gets published, as an "orphan" canonical that is
 * visible in its own store and excluded from the marketplace. There is never a
 * product that cannot be published.
 */

export type CanonicalResolution =
  | { strategy: "explicit"; canonicalProductId: string }
  | { strategy: "by-ean"; ean: string }
  | { strategy: "orphan"; isExclusive: true };

export type CanonicalInput = {
  canonicalProductId?: string | null;
  barcode?: string | null;
};

export function resolveCanonicalIdentity(input: CanonicalInput): CanonicalResolution {
  const explicit = input.canonicalProductId?.trim();
  if (explicit) {
    return { strategy: "explicit", canonicalProductId: explicit };
  }

  const ean = normalizeBarcode(input.barcode);
  if (ean) {
    return { strategy: "by-ean", ean };
  }

  return { strategy: "orphan", isExclusive: true };
}

/**
 * Barcodes arrive from handheld scanners and manual entry alike, so they carry
 * whitespace and the occasional separator. An 8/12/13/14-digit run is a real
 * GTIN; anything else is treated as absent rather than trusted as an identity.
 */
export function normalizeBarcode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  return digits;
}

/**
 * The searchable text for a canonical product: its own name plus every name a
 * business uses for it. Recomputed whenever a new alias appears — skipping that
 * degrades search silently, which is why it belongs in the handler and not in
 * the caller's hands.
 */
export function buildSearchDocument(name: string, aliases: readonly string[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];

  for (const candidate of [name, ...aliases]) {
    const normalized = candidate.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    parts.push(candidate.trim());
  }

  return parts.join(" · ");
}
