import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResponsiveImage } from "./ResponsiveImage";

const BASE = "https://cdn.example/storage/v1/object/public/store-media";
const UUID = "b6f1c2a4-7e3d-4a10-9c2e-1f0a5d6e7b8c";
const ORIGINAL_URL = `${BASE}/stores/store-1/products/product-1/${UUID}/original.jpg`;
const LEGACY_URL = `${BASE}/stores/store-1/products/product-1/${UUID}.jpg`;

describe("ResponsiveImage — variant=card (design.md D3)", () => {
  it("emits a <picture> with ONE avif and ONE webp candidate, no sizes, and a WebP fallback <img>", () => {
    const { container } = render(
      <ResponsiveImage src={ORIGINAL_URL} alt="Un producto" variant="card" />,
    );

    const picture = container.querySelector("picture");
    expect(picture).not.toBeNull();

    const avif = container.querySelector('source[type="image/avif"]');
    const webp = container.querySelector('source[type="image/webp"]');
    expect(avif?.getAttribute("srcset")).toBe(
      `${BASE}/stores/store-1/products/product-1/${UUID}/w400.avif`,
    );
    expect(webp?.getAttribute("srcset")).toBe(
      `${BASE}/stores/store-1/products/product-1/${UUID}/w400.webp`,
    );
    expect(avif?.getAttribute("sizes")).toBeNull();
    expect(webp?.getAttribute("sizes")).toBeNull();

    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(
      `${BASE}/stores/store-1/products/product-1/${UUID}/w400.webp`,
    );
    expect(img?.getAttribute("alt")).toBe("Un producto");
    expect(img?.getAttribute("width")).toBe("400");
    expect(img?.getAttribute("height")).toBe("400");
  });

  it("defaults to loading=lazy and decoding=async, with no fetchpriority", () => {
    const { container } = render(<ResponsiveImage src={ORIGINAL_URL} alt="x" variant="card" />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("decoding")).toBe("async");
    expect(img?.hasAttribute("fetchpriority")).toBe(false);
  });

  it("priority=true drops loading/decoding and sets fetchpriority=high (the LCP candidate)", () => {
    const { container } = render(
      <ResponsiveImage src={ORIGINAL_URL} alt="x" variant="card" priority />,
    );
    const img = container.querySelector("img");
    expect(img?.hasAttribute("loading")).toBe(false);
    expect(img?.hasAttribute("decoding")).toBe(false);
    expect(img?.getAttribute("fetchpriority")).toBe("high");
  });

  it("eager=true (without priority) drops loading/decoding but sets no fetchpriority", () => {
    const { container } = render(
      <ResponsiveImage src={ORIGINAL_URL} alt="x" variant="card" eager />,
    );
    const img = container.querySelector("img");
    expect(img?.hasAttribute("loading")).toBe(false);
    expect(img?.hasAttribute("decoding")).toBe(false);
    expect(img?.hasAttribute("fetchpriority")).toBe(false);
  });

  it("fetchPriority='low' stays lazy but tags the hint (admin listing thumbnail)", () => {
    const { container } = render(
      <ResponsiveImage src={ORIGINAL_URL} alt="" variant="card" fetchPriority="low" />,
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("fetchpriority")).toBe("low");
  });
});

describe("ResponsiveImage — variant=detail (design.md § 2)", () => {
  it("emits both widths per format, with descriptors, and passes sizes through", () => {
    const { container } = render(
      <ResponsiveImage
        src={ORIGINAL_URL}
        alt="Producto"
        variant="detail"
        sizes="(min-width: 1152px) 536px, 100vw"
        priority
      />,
    );

    const avif = container.querySelector('source[type="image/avif"]');
    const webp = container.querySelector('source[type="image/webp"]');
    const dir = `${BASE}/stores/store-1/products/product-1/${UUID}/`;
    expect(avif?.getAttribute("srcset")).toBe(`${dir}w400.avif 400w, ${dir}w800.avif 800w`);
    expect(webp?.getAttribute("srcset")).toBe(`${dir}w400.webp 400w, ${dir}w800.webp 800w`);
    expect(avif?.getAttribute("sizes")).toBe("(min-width: 1152px) 536px, 100vw");

    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(`${dir}w800.webp`);
    expect(img?.getAttribute("width")).toBe("800");
    expect(img?.getAttribute("height")).toBe("800");
    expect(img?.getAttribute("fetchpriority")).toBe("high");
  });
});

describe("ResponsiveImage — legacy/foreign URL (R11, E9)", () => {
  it("renders a plain <img> with no <picture>, no width/height", () => {
    const { container } = render(<ResponsiveImage src={LEGACY_URL} alt="Viejo" variant="card" />);

    expect(container.querySelector("picture")).toBeNull();
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(LEGACY_URL);
    expect(img?.getAttribute("alt")).toBe("Viejo");
    expect(img?.hasAttribute("width")).toBe(false);
    expect(img?.hasAttribute("height")).toBe(false);
  });
});
