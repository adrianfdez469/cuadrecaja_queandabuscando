import { describe, expect, it } from "vitest";
import { detectImageMime, extensionForMime, isAllowedImageMime } from "./imageType";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
]);
const AVIF = Buffer.from([
  0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0x00, 0x00, 0x00, 0x00,
]);
const TEXT_RENAMED_TO_JPG = Buffer.from("this is not an image, just text pretending to be one");

describe("detectImageMime()", () => {
  it("recognizes a real jpeg by its magic bytes", () => {
    expect(detectImageMime(JPEG)).toBe("image/jpeg");
  });

  it("recognizes a real png", () => {
    expect(detectImageMime(PNG)).toBe("image/png");
  });

  it("recognizes a real webp", () => {
    expect(detectImageMime(WEBP)).toBe("image/webp");
  });

  it("recognizes a real avif", () => {
    expect(detectImageMime(AVIF)).toBe("image/avif");
  });

  it("rejects a text file renamed to .jpg — content wins over extension", () => {
    expect(detectImageMime(TEXT_RENAMED_TO_JPG)).toBeNull();
  });

  it("rejects an empty buffer", () => {
    expect(detectImageMime(new Uint8Array())).toBeNull();
  });
});

describe("extensionForMime()", () => {
  it("maps every allowed mime to its canonical extension", () => {
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("image/png")).toBe("png");
    expect(extensionForMime("image/webp")).toBe("webp");
    expect(extensionForMime("image/avif")).toBe("avif");
  });
});

describe("isAllowedImageMime()", () => {
  it("accepts the four allowed mimes and rejects everything else", () => {
    expect(isAllowedImageMime("image/jpeg")).toBe(true);
    expect(isAllowedImageMime("text/plain")).toBe(false);
    expect(isAllowedImageMime(null)).toBe(false);
  });
});
