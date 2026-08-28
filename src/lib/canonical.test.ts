import { describe, expect, it } from "vitest";
import {
  buildSearchDocument,
  normalizeBarcode,
  normalizeBarcodes,
  resolveCanonicalIdentity,
} from "./canonical";

describe("resolveCanonicalIdentity()", () => {
  it("uses an explicit canonical id when the POS provides one", () => {
    expect(resolveCanonicalIdentity({ canonicalProductId: "abc" })).toEqual({
      identity: { strategy: "explicit", canonicalProductId: "abc" },
      barcodes: [],
    });
  });

  it("falls back to the smallest valid barcode (R4)", () => {
    expect(resolveCanonicalIdentity({ barcodes: ["7501031311309"] })).toEqual({
      identity: { strategy: "by-ean", ean: "7501031311309" },
      barcodes: ["7501031311309"],
    });
  });

  it("E13: an explicit canonical id still returns every valid barcode to store", () => {
    const result = resolveCanonicalIdentity({
      canonicalProductId: "abc",
      barcodes: ["7501031311316", "7501031311309"],
    });
    expect(result.identity).toEqual({ strategy: "explicit", canonicalProductId: "abc" });
    expect(result.barcodes).toEqual(["7501031311309", "7501031311316"]);
  });

  it("prefers the explicit id over the barcode", () => {
    const result = resolveCanonicalIdentity({
      canonicalProductId: "abc",
      barcodes: ["7501031311309"],
    });
    expect(result.identity.strategy).toBe("explicit");
  });

  it("creates an orphan rather than refusing to publish (E9: empty list)", () => {
    expect(resolveCanonicalIdentity({})).toEqual({
      identity: { strategy: "orphan", isExclusive: true },
      barcodes: [],
    });
    expect(resolveCanonicalIdentity({ canonicalProductId: "   ", barcodes: [""] })).toEqual({
      identity: { strategy: "orphan", isExclusive: true },
      barcodes: [],
    });
  });

  it("E7: every barcode unusable still produces an orphan, with nothing to store", () => {
    // A 5-digit internal code is not a GTIN; trusting it would merge unrelated
    // products from different businesses into one canonical.
    const result = resolveCanonicalIdentity({ barcodes: ["12345", "", "abc"] });
    expect(result.identity).toEqual({ strategy: "orphan", isExclusive: true });
    expect(result.barcodes).toEqual([]);
  });

  it("E8: a mix of valid and invalid codes resolves by the smallest valid one, invalid dropped", () => {
    const result = resolveCanonicalIdentity({
      barcodes: ["12345", "7501031311316", "7501031311309"],
    });
    expect(result.identity).toEqual({ strategy: "by-ean", ean: "7501031311309" });
    expect(result.barcodes).toEqual(["7501031311309", "7501031311316"]);
  });

  it("C5/E3: three permutations of the same list resolve to the same identity", () => {
    const permutations = [
      ["cod2", "cod3", "cod1"],
      ["cod3", "cod1", "cod2"],
      ["cod1", "cod2", "cod3"],
    ].map((list) =>
      list.map((label) =>
        label === "cod1" ? "7501031311309" : label === "cod2" ? "7501031311316" : "7501031311323",
      ),
    );

    const results = permutations.map((barcodes) => resolveCanonicalIdentity({ barcodes }));
    for (const result of results) {
      expect(result.identity).toEqual({ strategy: "by-ean", ean: "7501031311309" });
      expect(result.barcodes).toEqual(["7501031311309", "7501031311316", "7501031311323"]);
    }
  });
});

describe("normalizeBarcodes()", () => {
  it("E6: strips noise, deduplicates, and returns exactly one code", () => {
    expect(normalizeBarcodes(["  750-1031311309 ", "7501031311309", "7501031311309"])).toEqual([
      "7501031311309",
    ]);
  });

  it("sorts ascending by codeunit, never numerically or with localeCompare", () => {
    expect(normalizeBarcodes(["7501031311316", "7501031311309"])).toEqual([
      "7501031311309",
      "7501031311316",
    ]);
  });

  it("drops nulls/undefined and invalid entries, keeps the rest", () => {
    expect(normalizeBarcodes(["12345", null, undefined, "7501031311309", "abc"])).toEqual([
      "7501031311309",
    ]);
  });

  it("returns [] for null, undefined, or an all-invalid list", () => {
    expect(normalizeBarcodes(null)).toEqual([]);
    expect(normalizeBarcodes(undefined)).toEqual([]);
    expect(normalizeBarcodes([])).toEqual([]);
    expect(normalizeBarcodes(["12345", "", "abc"])).toEqual([]);
  });
});

describe("normalizeBarcode()", () => {
  it("accepts the four GTIN lengths", () => {
    expect(normalizeBarcode("12345678")).toBe("12345678");
    expect(normalizeBarcode("123456789012")).toBe("123456789012");
    expect(normalizeBarcode("1234567890123")).toBe("1234567890123");
    expect(normalizeBarcode("12345678901234")).toBe("12345678901234");
  });

  it("strips scanner noise", () => {
    expect(normalizeBarcode("  750-1031311309 ")).toBe("7501031311309");
  });

  it("rejects non-numeric and wrong-length input", () => {
    expect(normalizeBarcode("ABC123")).toBeNull();
    expect(normalizeBarcode("123")).toBeNull();
    expect(normalizeBarcode(null)).toBeNull();
    expect(normalizeBarcode(undefined)).toBeNull();
    expect(normalizeBarcode("")).toBeNull();
  });
});

describe("buildSearchDocument()", () => {
  it("joins the canonical name with its aliases", () => {
    expect(buildSearchDocument("Refresco de cola", ["Cola", "Refresco"])).toBe(
      "Refresco de cola · Cola · Refresco",
    );
  });

  it("drops case-insensitive duplicates but keeps the original casing", () => {
    expect(buildSearchDocument("Cola", ["cola", "COLA", "Cola Light"])).toBe("Cola · Cola Light");
  });

  it("ignores blank aliases", () => {
    expect(buildSearchDocument("Cola", ["", "   "])).toBe("Cola");
  });
});
