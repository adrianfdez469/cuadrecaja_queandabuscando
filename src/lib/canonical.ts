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
 *
 * F-024 (ADR 0020): the POS sends every barcode a product has, not one. The
 * fusion still resolves by a SINGLE code — the smallest in ascending string
 * order of the valid ones — but every valid code is returned alongside the
 * identity so the caller can persist all of them. `barcodes[0]` IS that
 * smallest code because the list arrives already normalized/deduplicated/
 * sorted, so R4 (identity by one code) and the reorder-invariance criterion
 * hold by construction, not by caller discipline.
 */

/** The three branches of ADR 0004. Was `CanonicalResolution["strategy"]`
 *  fields before F-024; renamed because `CanonicalResolution` now names the
 *  pair below. */
export type CanonicalIdentity =
  | { strategy: "explicit"; canonicalProductId: string }
  | { strategy: "by-ean"; ean: string }
  | { strategy: "orphan"; isExclusive: true };

/** The identity AND what to store. Returned together because they come out
 *  of the same computation: normalizing the list is what picks the fusion
 *  code (R4). Invariant: `identity.strategy === "orphan"` implies
 *  `barcodes.length === 0` (E7/E9 — nothing survives normalization). */
export type CanonicalResolution = {
  identity: CanonicalIdentity;
  /** Normalized, deduplicated, sorted ascending (R3). `[]` when nothing in
   *  the input was a usable GTIN. */
  barcodes: readonly string[];
};

export type CanonicalInput = {
  canonicalProductId?: string | null;
  /** F-024 v4: the full list. Elements `normalizeBarcode` rejects are
   *  dropped here, not by the caller. */
  barcodes?: readonly (string | null | undefined)[] | null;
};

export function resolveCanonicalIdentity(input: CanonicalInput): CanonicalResolution {
  const barcodes = normalizeBarcodes(input.barcodes);
  const explicit = input.canonicalProductId?.trim();
  if (explicit) {
    return { identity: { strategy: "explicit", canonicalProductId: explicit }, barcodes };
  }

  if (barcodes.length > 0) {
    return { identity: { strategy: "by-ean", ean: barcodes[0] }, barcodes };
  }

  return { identity: { strategy: "orphan", isExclusive: true }, barcodes };
}

/**
 * R3: `normalizeBarcode` element by element, drops the `null`s, deduplicates
 * and sorts with `Array.prototype.sort()` with NO comparator — codeunit
 * comparison, never numeric, never `localeCompare`. That is what makes
 * reordering the same list resolve to the same identity (E3).
 */
export function normalizeBarcodes(
  raw: readonly (string | null | undefined)[] | null | undefined,
): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const candidate of raw) {
    const normalized = normalizeBarcode(candidate);
    if (normalized) seen.add(normalized);
  }
  return [...seen].sort();
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
