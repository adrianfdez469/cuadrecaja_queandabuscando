import { describe, expect, it } from "vitest";
import {
  deriveImageVariants,
  imageObjectNamesFor,
  productObjectPrefix,
  socialImageUrl,
} from "./imageVariants";

const BASE = "https://cdn.example/storage/v1/object/public/store-media";
const UUID = "b6f1c2a4-7e3d-4a10-9c2e-1f0a5d6e7b8c";

describe("deriveImageVariants()", () => {
  it("derives the four variants of a F-023 original URL", () => {
    const url = `${BASE}/stores/store-1/products/product-1/${UUID}/original.jpg`;
    const set = deriveImageVariants(url);

    expect(set).not.toBeNull();
    expect(set?.dir).toBe(`${BASE}/stores/store-1/products/product-1/${UUID}/`);
    expect(set?.avif.map((v) => v.url)).toEqual([`${set?.dir}w400.avif`, `${set?.dir}w800.avif`]);
    expect(set?.webp.map((v) => v.url)).toEqual([`${set?.dir}w400.webp`, `${set?.dir}w800.webp`]);
    expect(set?.fallbackUrl).toBe(`${set?.dir}w400.webp`);
    expect(set?.socialUrl).toBe(`${set?.dir}w800.webp`);
  });

  it("returns null for a legacy F-011 URL (a flat object, no directory)", () => {
    const url = `${BASE}/stores/store-1/products/product-1/${UUID}.jpg`;
    expect(deriveImageVariants(url)).toBeNull();
  });

  it("returns null when the basename isn't literally 'original.<ext>'", () => {
    const url = `${BASE}/stores/store-1/products/product-1/${UUID}/w400.avif`;
    expect(deriveImageVariants(url)).toBeNull();
  });

  it("returns null when the directory isn't UUID-shaped, even with the right basename", () => {
    const url = `${BASE}/stores/store-1/products/product-1/original.jpg`;
    expect(deriveImageVariants(url)).toBeNull();
  });

  it("returns null for a URL foreign to our bucket layout", () => {
    expect(deriveImageVariants("https://example.com/random/original.jpg")).toBeNull();
    expect(deriveImageVariants("not-a-url")).toBeNull();
  });
});

describe("imageObjectNamesFor()", () => {
  it("lists the original plus the four variant names", () => {
    expect(imageObjectNamesFor("jpg")).toEqual([
      "original.jpg",
      "w400.avif",
      "w400.webp",
      "w800.avif",
      "w800.webp",
    ]);
  });
});

describe("productObjectPrefix()", () => {
  it("builds the per-product prefix E11 deletes entirely", () => {
    expect(productObjectPrefix({ storeId: "store-1", storeProductId: "product-1" })).toBe(
      "stores/store-1/products/product-1/",
    );
  });
});

describe("socialImageUrl() (R15)", () => {
  it("returns the detail-width WebP for a URL with variants", () => {
    const url = `${BASE}/stores/store-1/products/product-1/${UUID}/original.jpg`;
    expect(socialImageUrl(url)).toBe(`${BASE}/stores/store-1/products/product-1/${UUID}/w800.webp`);
  });

  it("passes a legacy URL through unchanged", () => {
    const url = `${BASE}/stores/store-1/products/product-1/${UUID}.jpg`;
    expect(socialImageUrl(url)).toBe(url);
  });
});
