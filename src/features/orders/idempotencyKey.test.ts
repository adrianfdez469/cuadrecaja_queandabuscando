import { describe, expect, it } from "vitest";
import { generateUuidV4 } from "./idempotencyKey";

describe("generateUuidV4()", () => {
  it("produces a well-formed v4 UUID", () => {
    const id = generateUuidV4();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("does not repeat across many calls", () => {
    const ids = new Set(Array.from({ length: 500 }, () => generateUuidV4()));
    expect(ids.size).toBe(500);
  });
});
