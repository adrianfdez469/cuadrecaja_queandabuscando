import { describe, expect, it } from "vitest";
import { DEFAULT_NEXT, safeNextPath } from "./safeNextPath";

/**
 * R7/E27: every hostile `next` ends up at `/cuenta`, never anywhere the
 * caller pointed. `/auth/callback` sits behind a freshly-set session cookie,
 * so an open redirector here would be the worst possible place for one.
 */
describe("safeNextPath (R7, E27)", () => {
  it("accepts a plain relative path", () => {
    expect(safeNextPath("/tienda-demo/checkout")).toBe("/tienda-demo/checkout");
    expect(safeNextPath("/cuenta")).toBe("/cuenta");
  });

  const hostile = [
    "https://otro.com",
    "http://otro.com/x",
    "//otro.com",
    "/\\otro.com",
    "/../x",
    "/a/../../x",
    "javascript:alert(1)",
    "",
    null,
    undefined,
    "a/no-leading-slash",
    "/contains\\backslash",
    "/" + "a".repeat(600),
  ] as const;

  it.each(hostile)("rejects %p and falls back to /cuenta", (value) => {
    expect(safeNextPath(value)).toBe(DEFAULT_NEXT);
  });

  it("DEFAULT_NEXT is /cuenta", () => {
    expect(DEFAULT_NEXT).toBe("/cuenta");
  });
});
