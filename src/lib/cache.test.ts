import { describe, expect, it, vi, beforeEach } from "vitest";
import { asPublicSlug } from "./publicSlug";

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidateTag: (...args: unknown[]) => revalidateTag(...args),
  unstable_cache: (fn: unknown) => fn,
}));

const {
  productTag,
  revalidateProducts,
  revalidateSlugs,
  revalidateStorefronts,
  revalidateStores,
  slugTag,
  storeCatalogTag,
  storefrontTag,
  storeTag,
} = await import("./cache");

beforeEach(() => revalidateTag.mockClear());

describe("tag builders", () => {
  it("namespaces tags so they cannot collide", () => {
    expect(storeTag(asPublicSlug("cafe-habana"))).toBe("store:cafe-habana");
    expect(storeCatalogTag(asPublicSlug("cafe-habana"))).toBe("store:cafe-habana:catalog");
    expect(productTag("abc")).toBe("product:abc");
    expect(storefrontTag("la-rampa")).toBe("storefront:la-rampa");
    expect(slugTag("la-rampa")).toBe("slug:la-rampa");
  });
});

describe("revalidateStores()", () => {
  it("invalidates both tags per store, with no staleness tolerance", () => {
    revalidateStores([asPublicSlug("a")]);
    // The second argument is Next 16's cacheLife profile. A sync batch means
    // the cached value is already known to be wrong.
    expect(revalidateTag).toHaveBeenCalledWith("store:a", { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith("store:a:catalog", { expire: 0 });
  });

  it("de-duplicates so a batch does not fan out into hundreds of calls", () => {
    const touched = revalidateStores([
      asPublicSlug("a"),
      asPublicSlug("a"),
      asPublicSlug("b"),
      asPublicSlug("a"),
    ]);
    expect(touched).toEqual(["a", "b"]);
    expect(revalidateTag).toHaveBeenCalledTimes(4); // 2 stores x 2 tags
  });

  it("ignores empty slugs", () => {
    expect(revalidateStores([asPublicSlug(""), asPublicSlug("a")])).toEqual(["a"]);
  });

  it("does nothing for an empty batch", () => {
    expect(revalidateStores([])).toEqual([]);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe("revalidateStorefronts()", () => {
  it("invalidates the brand tag for each slug, de-duplicated", () => {
    const touched = revalidateStorefronts(["la-rampa", "la-rampa"]);
    expect(touched).toEqual(["la-rampa"]);
    expect(revalidateTag).toHaveBeenCalledWith("storefront:la-rampa", { expire: 0 });
  });
});

describe("revalidateSlugs()", () => {
  it("invalidates the resolution tag for each registry value", () => {
    revalidateSlugs(["la-rampa", "la-rampa-vedado"]);
    expect(revalidateTag).toHaveBeenCalledWith("slug:la-rampa", { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith("slug:la-rampa-vedado", { expire: 0 });
  });
});

describe("revalidateProducts()", () => {
  it("de-duplicates product ids", () => {
    expect(revalidateProducts(["p1", "p1", "p2"])).toEqual(["p1", "p2"]);
    expect(revalidateTag).toHaveBeenCalledTimes(2);
  });
});
