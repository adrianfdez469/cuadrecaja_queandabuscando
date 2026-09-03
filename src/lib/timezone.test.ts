import { describe, expect, it } from "vitest";
import { DEFAULT_STORE_TIMEZONE } from "@/constants/storeHours";
import { canonicalTimeZoneSchema, isCanonicalTimeZone, SUPPORTED_TIME_ZONES } from "./timezone";

/**
 * F-022 R1/AC3. `spec.md` § R1 measured this runtime (Node 24.13.1, ICU
 * 78.2): `Intl.DateTimeFormat` ACCEPTS `+05:00`, `Cuba`, `EST5EDT`, `UTC`,
 * `GMT`, `Etc/GMT+5` and `america/havana` — so "does not throw" is NOT this
 * rule. Every one of those seven is in the rejected list below on purpose:
 * if any of them passed, the validation would be checking usability, not
 * canonical membership.
 */
const ACCEPTED = ["America/Havana", "America/New_York", "Europe/Madrid"];

const REJECTED = [
  "America/Habana", // the misspelling a human types
  "-04:00",
  "+0500",
  "Cuba",
  "EST5EDT",
  "UTC",
  "GMT",
  "Etc/GMT+5",
  "america/havana", // R1 corollary: case-sensitive, no toLowerCase()
  "America/Havana ", // trailing space — no trim()
  "",
  "  ",
];

describe("isCanonicalTimeZone()", () => {
  it.each(ACCEPTED)("accepts %s", (value) => {
    expect(isCanonicalTimeZone(value)).toBe(true);
  });

  it.each(REJECTED)("rejects %j", (value) => {
    expect(isCanonicalTimeZone(value)).toBe(false);
  });

  it("rejects non-string values without throwing", () => {
    expect(isCanonicalTimeZone(undefined)).toBe(false);
    expect(isCanonicalTimeZone(null)).toBe(false);
    expect(isCanonicalTimeZone(42)).toBe(false);
    expect(isCanonicalTimeZone({})).toBe(false);
  });
});

describe("canonicalTimeZoneSchema", () => {
  it.each(ACCEPTED)("safeParse succeeds for %s", (value) => {
    expect(canonicalTimeZoneSchema.safeParse(value).success).toBe(true);
  });

  it.each(REJECTED)("safeParse fails for %j, with a named error", (value) => {
    const result = canonicalTimeZoneSchema.safeParse(value);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("not a canonical IANA time zone");
    }
  });
});

describe("caso límite 1 — a trimmed-down runtime ICU must be a red CI, not a silent prod rejection", () => {
  it("the default zone is itself accepted by this runtime", () => {
    expect(SUPPORTED_TIME_ZONES.has(DEFAULT_STORE_TIMEZONE)).toBe(true);
    expect(isCanonicalTimeZone(DEFAULT_STORE_TIMEZONE)).toBe(true);
  });

  it("this runtime's ICU carries more than 300 zones (measured: 418)", () => {
    expect(SUPPORTED_TIME_ZONES.size).toBeGreaterThan(300);
  });
});
