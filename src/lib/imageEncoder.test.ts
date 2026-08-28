import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { encodeImageVariants } from "./imageEncoder";
import { IMAGE_CARD_VARIANT_MAX_BYTES, IMAGE_MAX_PIXELS } from "@/constants/media";

/** Half red, half blue, physically pre-rotated 90° and tagged with an EXIF
 *  orientation that undoes that rotation — the same shape a phone photo
 *  taken in portrait produces. */
async function exifRotatedFixture(): Promise<Buffer> {
  const left = await sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  const right = await sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } },
  })
    .png()
    .toBuffer();
  const upright = await sharp({
    create: { width: 200, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([
      { input: left, left: 0, top: 0 },
      { input: right, left: 100, top: 0 },
    ])
    .png()
    .toBuffer();

  const rotated = await sharp(upright).rotate(90).toBuffer();
  return sharp(rotated).withMetadata({ orientation: 8 }).jpeg().toBuffer();
}

async function averageColor(bytes: Buffer, xStart: number, xEnd: number) {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = xStart; x < xEnd; x++) {
      const idx = (y * info.width + x) * info.channels;
      r += data[idx];
      g += data[idx + 1];
      b += data[idx + 2];
      count++;
    }
  }
  return { r: r / count, g: g / count, b: b / count };
}

/** A synthetic solid-color PNG well over `IMAGE_MAX_PIXELS`. Solid color
 *  compresses to a few KB and encodes in milliseconds, so this stays a fast
 *  unit test instead of an integration-scale one. */
async function oversizedFixture(): Promise<Buffer> {
  return sharp({
    create: { width: 10_000, height: 9_000, channels: 3, background: { r: 12, g: 34, b: 56 } },
  })
    .png({ compressionLevel: 1 })
    .toBuffer();
}

describe("encodeImageVariants()", () => {
  it("bakes EXIF rotation in before resizing — the photo comes out upright (architecture.md point 1)", async () => {
    const fixture = await exifRotatedFixture();
    const result = await encodeImageVariants(fixture, "image/jpeg");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const card = result.variants.find((v) => v.width === 400 && v.format === "webp");
    expect(card).toBeDefined();

    // Card variant is a 400×400 square crop of the (now correctly oriented)
    // 200×100 canvas — the left half stays red-dominant, the right half
    // blue-dominant, same as the un-rotated source. If `.rotate()` were
    // missing, this image would decode 100×200 (still portrait) and the
    // crop would mix red and blue roughly evenly on both sides instead.
    const left = await averageColor(card!.bytes, 0, 100);
    const right = await averageColor(card!.bytes, 300, 400);
    expect(left.r).toBeGreaterThan(left.b);
    expect(right.b).toBeGreaterThan(right.r);
  });

  it("produces all four variants under (or at) their quality ladder for a normal photo", async () => {
    const fixture = await exifRotatedFixture();
    const result = await encodeImageVariants(fixture, "image/jpeg");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.variants).toHaveLength(4);
    const widths = result.variants.map((v) => v.width).sort();
    expect(widths).toEqual([400, 400, 800, 800]);
    const formats = new Set(result.variants.map((v) => v.format));
    expect(formats).toEqual(new Set(["avif", "webp"]));

    // A flat two-color image compresses far below the card cap — the normal
    // case never carries the E3 warning.
    expect(result.heaviestCardBytes).toBeLessThan(IMAGE_CARD_VARIANT_MAX_BYTES);
    expect(result.warning).toBeUndefined();
  });

  it("rejects an input over the pixel limit without decoding it fully (architecture.md point 2)", async () => {
    const fixture = await oversizedFixture();
    const result = await encodeImageVariants(fixture, "image/png");

    expect(result).toEqual({ ok: false, reason: "too_many_pixels" });
  });

  it("never throws on a corrupt/undecodable buffer — returns decode_failed", async () => {
    const garbage = Buffer.from("this is not an image, just bytes pretending to be one");
    const result = await encodeImageVariants(garbage, "image/jpeg");

    expect(result).toEqual({ ok: false, reason: "decode_failed" });
  });
});

// Sanity check that the fixture builder itself and the constant are wired
// consistently — a change to `IMAGE_MAX_PIXELS` shouldn't silently make the
// oversized fixture fall under the limit.
describe("oversizedFixture()", () => {
  it("really is over IMAGE_MAX_PIXELS", () => {
    expect(10_000 * 9_000).toBeGreaterThan(IMAGE_MAX_PIXELS);
  });
});
