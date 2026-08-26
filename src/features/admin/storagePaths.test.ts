import { describe, expect, it } from "vitest";
import { objectPathFor } from "./storagePaths";

describe("objectPathFor()", () => {
  it("carries the storeId and the storeProductId in the path", () => {
    const path = objectPathFor({ storeId: "store-1", storeProductId: "product-1", ext: "jpg" });
    expect(path).toMatch(/^stores\/store-1\/products\/product-1\/[0-9a-f-]{36}\.jpg$/);
  });

  it("gives two calls different uuids, so a retry never collides", () => {
    const a = objectPathFor({ storeId: "s", storeProductId: "p", ext: "png" });
    const b = objectPathFor({ storeId: "s", storeProductId: "p", ext: "png" });
    expect(a).not.toBe(b);
  });
});
