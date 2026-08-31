import { describe, expect, it } from "vitest";
import { jsonLdScriptContent } from "./jsonLd";

/**
 * F-025 plan.md paso 2: the one thing that can go wrong here — a merchant's
 * text closing the `<script>` block early — has to be proven impossible,
 * not just asserted.
 */
describe("jsonLdScriptContent()", () => {
  it("is valid JSON of the given value", () => {
    const value = { "@type": "Thing", name: "Jugo de mango 1 L" };
    expect(JSON.parse(jsonLdScriptContent(value))).toEqual(value);
  });

  it("neutralizes a </script> inside a name so it cannot close the block", () => {
    const value = { name: "</script><script>alert(1)</script>" };
    const serialized = jsonLdScriptContent(value);

    expect(serialized).not.toContain("</script>");
    expect(serialized).not.toContain("<script>");
    expect(JSON.parse(serialized)).toEqual(value);
  });

  it("neutralizes an HTML comment opener inside a name", () => {
    const value = { name: "<!--" };
    const serialized = jsonLdScriptContent(value);

    expect(serialized).not.toContain("<!--");
    expect(JSON.parse(serialized)).toEqual(value);
  });

  it("escapes every '<' to \\u003c, leaving the rest of the JSON untouched", () => {
    expect(jsonLdScriptContent({ a: "<b>" })).toBe('{"a":"\\u003cb>"}');
  });
});
