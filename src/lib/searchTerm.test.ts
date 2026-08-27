import { describe, expect, it } from "vitest";
import { clampSearchLimit, clampSearchOffset, normalizeSearchTerm } from "./searchTerm";
import {
  MARKETPLACE_SEARCH_LIMIT_DEFAULT,
  MARKETPLACE_SEARCH_LIMIT_MAX,
  MARKETPLACE_SEARCH_LIMIT_MIN,
  MARKETPLACE_SEARCH_TERM_MAX_LENGTH,
} from "@/constants/marketplace";

/**
 * Unit coverage for stage 1 of F-015 (plan.md): no database, no Prisma. E15
 * (empty/blank/punctuation), E16 (one letter), E17 (tsquery metacharacters)
 * and R7 (a 10 000-character term) all have to hold on `normalizeSearchTerm`
 * alone — the SQL side that consumes its output is exercised against real
 * Postgres in the stage-5 suite this file does not write.
 */

describe("normalizeSearchTerm()", () => {
  it("returns null for an empty term (E15)", () => {
    expect(normalizeSearchTerm("")).toBeNull();
  });

  it("returns null for a blank term (E15)", () => {
    expect(normalizeSearchTerm("   ")).toBeNull();
  });

  it("returns null for a term that is only punctuation (E15)", () => {
    expect(normalizeSearchTerm("¡¿?!...")).toBeNull();
  });

  it("keeps a one-letter term as-is (E16)", () => {
    expect(normalizeSearchTerm("c")).toBe("c");
  });

  it("passes through tsquery metacharacters unchanged (E17)", () => {
    const raw = "café & | ! ( ) : *";
    expect(normalizeSearchTerm(raw)).toBe(raw);
  });

  it("returns null for a lone quote — punctuation only (E15)", () => {
    expect(normalizeSearchTerm("'")).toBeNull();
  });

  it("passes through a hostile term unchanged — it has letters (E17, E18)", () => {
    const hostile = '\'; DROP TABLE "CanonicalProduct"; --';
    expect(normalizeSearchTerm(hostile)).toBe(hostile);
  });

  it("truncates a 10 000-character term to the configured maximum (R7)", () => {
    const raw = "a".repeat(10_000);
    const result = normalizeSearchTerm(raw);
    expect(result).not.toBeNull();
    expect(result?.length).toBe(MARKETPLACE_SEARCH_TERM_MAX_LENGTH);
  });

  it("trims the ends and collapses internal whitespace runs to one space", () => {
    expect(normalizeSearchTerm("  café   molido  ")).toBe("café molido");
  });

  it("returns null when truncation leaves nothing but punctuation", () => {
    // 120 dots followed by a letter: the letter falls outside the truncated
    // window, so what survives has no letter or digit.
    const raw = ".".repeat(MARKETPLACE_SEARCH_TERM_MAX_LENGTH) + "a";
    expect(normalizeSearchTerm(raw)).toBeNull();
  });
});

describe("clampSearchLimit()", () => {
  it("defaults when absent", () => {
    expect(clampSearchLimit(undefined)).toBe(MARKETPLACE_SEARCH_LIMIT_DEFAULT);
  });

  it("clamps below the minimum", () => {
    expect(clampSearchLimit(0)).toBe(MARKETPLACE_SEARCH_LIMIT_MIN);
    expect(clampSearchLimit(-5)).toBe(MARKETPLACE_SEARCH_LIMIT_MIN);
  });

  it("clamps above the maximum", () => {
    expect(clampSearchLimit(1000)).toBe(MARKETPLACE_SEARCH_LIMIT_MAX);
  });

  it("truncates a fractional value", () => {
    expect(clampSearchLimit(10.9)).toBe(10);
  });

  it("defaults on a non-finite value", () => {
    expect(clampSearchLimit(Number.NaN)).toBe(MARKETPLACE_SEARCH_LIMIT_DEFAULT);
  });
});

describe("clampSearchOffset()", () => {
  it("defaults to 0 when absent", () => {
    expect(clampSearchOffset(undefined)).toBe(0);
  });

  it("clamps a negative offset to 0", () => {
    expect(clampSearchOffset(-10)).toBe(0);
  });

  it("truncates a fractional value", () => {
    expect(clampSearchOffset(4.7)).toBe(4);
  });

  it("passes through a large offset unchanged", () => {
    expect(clampSearchOffset(10_000)).toBe(10_000);
  });
});
