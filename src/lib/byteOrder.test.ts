import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { compareUtf8Bytes } from "./byteOrder";

/**
 * F-014, C12. This is the ONLY oracle that discriminates a byte-order
 * comparator from JavaScript's default `.sort()`: `.sort()` compares UTF-16
 * code units, and on a surrogate pair (a character outside the BMP) that
 * gives the OPPOSITE order of the UTF-8 bytes.
 *
 * "�" (U+FFFD, one UTF-16 unit, encodes to the 3 bytes EF BF BD) and
 * "\u{10000}" (U+10000, a surrogate pair D800 DC00 in UTF-16, encodes to the
 * 4 bytes F0 90 80 80). Byte-wise, EF < F0, so U+FFFD sorts first. But
 * `.sort()` compares the first UTF-16 unit of each string, and D800 < FFFD,
 * so `.sort()` puts U+10000 first — backwards.
 */
const REPLACEMENT = "�"; // U+FFFD
const SUPPLEMENTARY = "\u{10000}"; // U+10000, a surrogate pair in UTF-16

function md5(value: string): string {
  return createHash("md5").update(value, "utf8").digest("hex");
}

/** The same canonical-entry shape R1 fixes, for a made-up single-field row. */
function canonicalString(orderedIds: readonly string[]): string {
  return orderedIds.map((id) => `${id}:1990:CUP:AVAILABLE|`).join("");
}

describe("compareUtf8Bytes", () => {
  it("orders plain ASCII the same way byte comparison and .sort() agree on", () => {
    expect(compareUtf8Bytes("a", "b")).toBeLessThan(0);
    expect(compareUtf8Bytes("b", "a")).toBeGreaterThan(0);
    expect(compareUtf8Bytes("a", "a")).toBe(0);
  });

  it("orders the astral pair as U+FFFD, U+10000 — the order of UTF-8 bytes", () => {
    const sorted = [SUPPLEMENTARY, REPLACEMENT].sort(compareUtf8Bytes);
    expect(sorted).toEqual([REPLACEMENT, SUPPLEMENTARY]);

    const hash = md5(canonicalString(sorted));
    expect(hash).toBe(md5(canonicalString([REPLACEMENT, SUPPLEMENTARY])));
  });

  it("C12: the naive .sort() gives the OPPOSITE order and therefore a different hash", () => {
    const byBytes = [SUPPLEMENTARY, REPLACEMENT].sort(compareUtf8Bytes);
    const byDefaultSort = [SUPPLEMENTARY, REPLACEMENT].sort();

    // The naive implementation this criterion exists to catch: no comparator
    // at all, which falls back to UTF-16 code unit order.
    expect(byDefaultSort).toEqual([SUPPLEMENTARY, REPLACEMENT]);
    expect(byDefaultSort).not.toEqual(byBytes);

    const hashByBytes = md5(canonicalString(byBytes));
    const hashByDefaultSort = md5(canonicalString(byDefaultSort));

    // If these two hashes ever coincided, this test would be vacuous — the
    // fixture would need fixing, not relaxing (spec.md C12).
    expect(hashByDefaultSort).not.toBe(hashByBytes);
  });
});
