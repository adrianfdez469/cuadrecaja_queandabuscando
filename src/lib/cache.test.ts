import { describe, expect, it, vi, beforeEach } from "vitest";

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidateTag: (...args: unknown[]) => revalidateTag(...args),
  unstable_cache: (fn: unknown) => fn,
}));

const { productTag, revalidateProducts, revalidateStores, storeCatalogTag, storeTag } =
  await import("./cache");

beforeEach(() => revalidateTag.mockClear());

describe("tag builders", () => {
  it("namespaces tags so they cannot collide", () => {
    expect(storeTag("cafe-habana")).toBe("store:cafe-habana");
    expect(storeCatalogTag("cafe-habana")).toBe("store:cafe-habana:catalog");
    expect(productTag("abc")).toBe("product:abc");
  });
});

describe("revalidateStores()", () => {
  it("invalidates both tags per store, with no staleness tolerance", () => {
    revalidateStores(["a"]);
    // The second argument is Next 16's cacheLife profile. A sync batch means
    // the cached value is already known to be wrong.
    expect(revalidateTag).toHaveBeenCalledWith("store:a", { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith("store:a:catalog", { expire: 0 });
  });

  it("de-duplicates so a batch does not fan out into hundreds of calls", () => {
    const touched = revalidateStores(["a", "a", "b", "a"]);
    expect(touched).toEqual(["a", "b"]);
    expect(revalidateTag).toHaveBeenCalledTimes(4); // 2 stores x 2 tags
  });

  it("ignores empty slugs", () => {
    expect(revalidateStores(["", "a"])).toEqual(["a"]);
  });

  it("does nothing for an empty batch", () => {
    expect(revalidateStores([])).toEqual([]);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe("revalidateProducts()", () => {
  it("de-duplicates product ids", () => {
    expect(revalidateProducts(["p1", "p1", "p2"])).toEqual(["p1", "p2"]);
    expect(revalidateTag).toHaveBeenCalledTimes(2);
  });
});
