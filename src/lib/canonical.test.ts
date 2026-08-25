import { describe, expect, it } from "vitest";
import { buildSearchDocument, normalizeBarcode, resolveCanonicalIdentity } from "./canonical";

describe("resolveCanonicalIdentity()", () => {
  it("uses an explicit canonical id when the POS provides one", () => {
    expect(resolveCanonicalIdentity({ canonicalProductId: "abc" })).toEqual({
      strategy: "explicit",
      canonicalProductId: "abc",
    });
  });

  it("falls back to the barcode", () => {
    expect(resolveCanonicalIdentity({ barcode: "7501031311309" })).toEqual({
      strategy: "by-ean",
      ean: "7501031311309",
    });
  });

  it("prefers the explicit id over the barcode", () => {
    const result = resolveCanonicalIdentity({
      canonicalProductId: "abc",
      barcode: "7501031311309",
    });
    expect(result.strategy).toBe("explicit");
  });

  it("creates an orphan rather than refusing to publish", () => {
    expect(resolveCanonicalIdentity({})).toEqual({ strategy: "orphan", isExclusive: true });
    expect(resolveCanonicalIdentity({ canonicalProductId: "   ", barcode: "" })).toEqual({
      strategy: "orphan",
      isExclusive: true,
    });
  });

  it("treats an unusable barcode as absent instead of as an identity", () => {
    // A 5-digit internal code is not a GTIN; trusting it would merge unrelated
    // products from different businesses into one canonical.
    expect(resolveCanonicalIdentity({ barcode: "12345" }).strategy).toBe("orphan");
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
