import { describe, expect, it, vi } from "vitest";
import {
  formatCanonicalBarcodeStats,
  recordCanonicalBarcodes,
  type CanonicalBarcodeWriter,
} from "./canonicalBarcodes";

describe("recordCanonicalBarcodes()", () => {
  it("E7/E9: an empty list never touches the database — no round trip", async () => {
    const createMany = vi.fn();
    const db = { canonicalBarcode: { createMany } } as unknown as CanonicalBarcodeWriter;

    const inserted = await recordCanonicalBarcodes(db, "canon-1", []);

    expect(inserted).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("writes one statement with skipDuplicates and returns the inserted count", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const db = { canonicalBarcode: { createMany } } as unknown as CanonicalBarcodeWriter;

    const inserted = await recordCanonicalBarcodes(db, "canon-1", ["cod1", "cod2"]);

    expect(inserted).toBe(2);
    expect(createMany).toHaveBeenCalledOnce();
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { canonicalProductId: "canon-1", ean: "cod1" },
        { canonicalProductId: "canon-1", ean: "cod2" },
      ],
      skipDuplicates: true,
    });
  });
});

describe("formatCanonicalBarcodeStats()", () => {
  it("E18: prints the five figures and the histogram, one `clave: valor` line each", () => {
    const text = formatCanonicalBarcodeStats({
      canonicalTotal: 19,
      canonicalsWithBarcodes: 9,
      canonicalsWithMultipleBarcodes: 1,
      canonicalsWithBarcodesAcrossBusinesses: 0,
      canonicalsWithMultipleBarcodesAcrossBusinesses: 0,
      histogram: [
        { barcodes: 1, canonicals: 8 },
        { barcodes: 3, canonicals: 1 },
      ],
    });

    expect(text).toBe(
      [
        "canonicalTotal: 19",
        "canonicalsWithBarcodes: 9",
        "canonicalsWithMultipleBarcodes: 1",
        "canonicalsWithBarcodesAcrossBusinesses: 0",
        "canonicalsWithMultipleBarcodesAcrossBusinesses: 0",
        "histogram[1]: 8",
        "histogram[3]: 1",
      ].join("\n"),
    );
  });

  it("an empty histogram still prints the five figures", () => {
    const text = formatCanonicalBarcodeStats({
      canonicalTotal: 0,
      canonicalsWithBarcodes: 0,
      canonicalsWithMultipleBarcodes: 0,
      canonicalsWithBarcodesAcrossBusinesses: 0,
      canonicalsWithMultipleBarcodesAcrossBusinesses: 0,
      histogram: [],
    });

    expect(text.split("\n")).toHaveLength(5);
  });
});
