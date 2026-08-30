import { describe, expect, it } from "vitest";
import {
  CONTACT_NAME_MAX_LENGTH,
  CONTACT_PHONE_MAX_DIGITS,
  CONTACT_PHONE_MIN_DIGITS,
} from "@/constants/orders";
import {
  accountProfileSchema,
  sendOtpRequestSchema,
  startOAuthRequestSchema,
  verifyOtpRequestSchema,
} from "./schemas";

/** R15: the profile shares its limits with the order's contact fields. */
describe("accountProfileSchema (R15, R20)", () => {
  it("accepts a fully filled profile and normalizes the phone", () => {
    const parsed = accountProfileSchema.safeParse({
      name: "Ana Pérez",
      phone: "+53 5555 5555",
      email: "ana@x.cu",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ name: "Ana Pérez", phone: "+5355555555", email: "ana@x.cu" });
    }
  });

  it("an empty string clears a field, not an error", () => {
    const parsed = accountProfileSchema.safeParse({ name: "", phone: "", email: "" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ name: "", phone: "", email: "" });
    }
  });

  it("rejects a phone with too few digits, using the SAME bound as orders.ts", () => {
    const shortDigits = "1".repeat(CONTACT_PHONE_MIN_DIGITS - 1);
    const parsed = accountProfileSchema.safeParse({ name: "", phone: shortDigits, email: "" });
    expect(parsed.success).toBe(false);
  });

  it("accepts a phone at exactly the max digit bound", () => {
    const maxDigits = "1".repeat(CONTACT_PHONE_MAX_DIGITS);
    const parsed = accountProfileSchema.safeParse({ name: "", phone: maxDigits, email: "" });
    expect(parsed.success).toBe(true);
  });

  it("rejects a name over the max length", () => {
    const tooLong = "a".repeat(CONTACT_NAME_MAX_LENGTH + 1);
    const parsed = accountProfileSchema.safeParse({ name: tooLong, phone: "", email: "" });
    expect(parsed.success).toBe(false);
  });

  it("ignores any extra key such as id or supabaseUserId (E11, R20)", () => {
    const parsed = accountProfileSchema.safeParse({
      name: "",
      phone: "",
      email: "",
      id: "some-other-customer-id",
      supabaseUserId: "not-mine",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("id");
      expect(parsed.data).not.toHaveProperty("supabaseUserId");
    }
  });
});

describe("sendOtpRequestSchema (E1)", () => {
  it("accepts a well-formed email", () => {
    expect(sendOtpRequestSchema.safeParse({ email: "ana@x.cu" }).success).toBe(true);
  });
  it("rejects a malformed email", () => {
    expect(sendOtpRequestSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
  });
});

describe("verifyOtpRequestSchema (E1, E21)", () => {
  it("accepts six digits", () => {
    expect(verifyOtpRequestSchema.safeParse({ email: "ana@x.cu", token: "123456" }).success).toBe(
      true,
    );
  });
  it("rejects a token with letters", () => {
    expect(verifyOtpRequestSchema.safeParse({ email: "ana@x.cu", token: "12a456" }).success).toBe(
      false,
    );
  });
  it("rejects a token with the wrong length", () => {
    expect(verifyOtpRequestSchema.safeParse({ email: "ana@x.cu", token: "12345" }).success).toBe(
      false,
    );
  });
});

describe("startOAuthRequestSchema (E2, E23)", () => {
  it.each(["google", "facebook", "apple"] as const)("accepts provider %s", (provider) => {
    expect(startOAuthRequestSchema.safeParse({ provider, next: "/cuenta" }).success).toBe(true);
  });
  it("rejects an unknown provider", () => {
    expect(startOAuthRequestSchema.safeParse({ provider: "twitter" }).success).toBe(false);
  });
});
