import { describe, expect, it } from "vitest";
import { formatOrderCode, generateOrderCode, isOrderCode, normalizeOrderCode } from "./orderCode";

describe("generateOrderCode()", () => {
  it("produces 10 characters from the Crockford alphabet", () => {
    const code = generateOrderCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
  });

  it("accepts an injected random source, for deterministic tests", () => {
    const fixed = (buffer: Uint8Array) => {
      buffer.fill(0);
      return buffer;
    };
    expect(generateOrderCode(fixed)).toBe("0000000000");
  });

  it("does not repeat across many calls (extremely unlikely with real entropy)", () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateOrderCode()));
    expect(codes.size).toBe(1000);
  });
});

describe("normalizeOrderCode()", () => {
  it("upper-cases and strips spaces and hyphens", () => {
    expect(normalizeOrderCode("a7k3m-9pqr2")).toBe("A7K3M9PQR2");
    expect(normalizeOrderCode("A7K3M 9PQR2")).toBe("A7K3M9PQR2");
  });
});

describe("formatOrderCode()", () => {
  it("groups into XXXXX-XXXXX for display", () => {
    expect(formatOrderCode("A7K3M9PQR2")).toBe("A7K3M-9PQR2");
  });

  it("normalizes before grouping", () => {
    expect(formatOrderCode("a7k3m9pqr2")).toBe("A7K3M-9PQR2");
  });

  it("returns the normalized value unchanged if the length is wrong", () => {
    expect(formatOrderCode("abc")).toBe("ABC");
  });
});

describe("isOrderCode()", () => {
  it("accepts a valid code, normalizing case and separators first", () => {
    expect(isOrderCode("A7K3M9PQR2")).toBe(true);
    expect(isOrderCode("a7k3m-9pqr2")).toBe(true);
  });

  it("rejects the excluded letters I, L, O, U", () => {
    expect(isOrderCode("AIK3M9PQR2")).toBe(false);
    expect(isOrderCode("ALK3M9PQR2")).toBe(false);
    expect(isOrderCode("AOK3M9PQR2")).toBe(false);
    expect(isOrderCode("AUK3M9PQR2")).toBe(false);
  });

  it("rejects the wrong length", () => {
    expect(isOrderCode("A7K3M9PQR")).toBe(false);
    expect(isOrderCode("A7K3M9PQR22")).toBe(false);
  });
});
