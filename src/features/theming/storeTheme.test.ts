import { describe, expect, it } from "vitest";
import { renderStoreTheme, themeTokensSchema } from "./storeTheme";

describe("renderStoreTheme()", () => {
  it("scopes overrides to the store", () => {
    const css = renderStoreTheme("cafe-habana", { brand: "#ff0000" });
    expect(css).toBe('[data-store="cafe-habana"]{--color-brand:#ff0000}');
  });

  it("emits nothing when there is nothing to override", () => {
    // The caller skips the <style> tag entirely rather than shipping an empty one.
    expect(renderStoreTheme("x", {})).toBe("");
    expect(renderStoreTheme("x", null)).toBe("");
    expect(renderStoreTheme("x", undefined)).toBe("");
  });

  it("expands the radius scale", () => {
    const css = renderStoreTheme("x", { radius: "round" });
    expect(css).toContain("--radius-sm:0.75rem");
    expect(css).toContain("--radius-lg:2rem");
  });

  it("accepts modern colour syntaxes", () => {
    expect(renderStoreTheme("x", { brand: "oklch(0.7 0.2 30)" })).toContain("oklch(0.7 0.2 30)");
    expect(renderStoreTheme("x", { accent: "rgb(1 2 3)" })).toContain("rgb(1 2 3)");
    expect(renderStoreTheme("x", { brand: "rebeccapurple" })).toContain("rebeccapurple");
  });

  it("refuses a value that would break out of the declaration", () => {
    // This is the injection that matters: the output goes into a <style> tag.
    const css = renderStoreTheme("x", { brand: "red}</style><script>alert(1)</script>" });
    expect(css).toBe("");
  });

  it("refuses unknown token names instead of passing them through", () => {
    expect(renderStoreTheme("x", { evil: "red" })).toBe("");
  });

  it("strips the characters a slug would need to break out of the selector", () => {
    const css = renderStoreTheme('x"]{color:red}[data-store="y', { brand: "red" });
    // The slug that lands inside the attribute selector cannot close it.
    const slug = css.match(/^\[data-store="([^"]*)"\]/)?.[1];
    expect(slug).toBeDefined();
    expect(slug).not.toMatch(/["\]{}:]/);
    // And exactly one rule was emitted, not two.
    expect(css.match(/{/g)).toHaveLength(1);
    expect(css.endsWith("{--color-brand:red}")).toBe(true);
  });

  it("rejects an over-long value", () => {
    expect(themeTokensSchema.safeParse({ brand: "a".repeat(100) }).success).toBe(false);
  });
});
