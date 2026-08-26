import { describe, expect, it } from "vitest";
import { normalizeName, normalizePhone } from "./contact";

describe("normalizeName()", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normalizeName("  Ana   Pérez  ")).toBe("Ana Pérez");
  });

  it("leaves an already-clean name unchanged", () => {
    expect(normalizeName("Ana Pérez")).toBe("Ana Pérez");
  });
});

describe("normalizePhone()", () => {
  it("keeps a leading + and strips everything else but digits", () => {
    expect(normalizePhone("+53 5555-5555")).toBe("+5355555555");
    expect(normalizePhone("+53 5555 5555")).toBe("+5355555555");
  });

  it("strips punctuation with no leading +", () => {
    expect(normalizePhone("(53) 5555-5555")).toBe("5355555555");
  });

  it("two differently formatted inputs for the same number normalize equal", () => {
    expect(normalizePhone("+53 5555-5555")).toBe(normalizePhone("+535555 5555"));
  });
});
