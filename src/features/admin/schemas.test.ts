import { describe, expect, it } from "vitest";

// `publicUrlPrefix()` reads `serverEnv()`/`publicEnv`, both evaluated once
// per module instance — set the env BEFORE the dynamic import below, in the
// same isolated module graph Vitest gives each test file (see
// `mutations.test.ts` for the same pattern).
process.env.DATABASE_URL = "postgresql://localhost/test";
process.env.SSO_JWT_SECRET = "s".repeat(32);
process.env.ADMIN_SESSION_SECRET = "a".repeat(32);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_STORAGE_BUCKET = "store-media";

const { productWriteSchema, promotionBodySchema } = await import("./schemas");

const BUCKET_URL = "https://test.supabase.co/storage/v1/object/public/store-media/photo.jpg";

function body(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    description: null,
    imageUrls: [],
    priceOverride: null,
    visible: true,
    featured: false,
    ...overrides,
  };
}

describe("productWriteSchema", () => {
  it("accepts a well-formed body", () => {
    expect(productWriteSchema.safeParse(body()).success).toBe(true);
  });

  it("rejects a negative priceOverride", () => {
    expect(productWriteSchema.safeParse(body({ priceOverride: "-1.00" })).success).toBe(false);
  });

  it("rejects three decimals", () => {
    expect(productWriteSchema.safeParse(body({ priceOverride: "10.123" })).success).toBe(false);
  });

  it('accepts "0" — zero is a real price (ADR 0007)', () => {
    expect(productWriteSchema.safeParse(body({ priceOverride: "0" })).success).toBe(true);
  });

  it("accepts a URL under the store's own bucket", () => {
    expect(productWriteSchema.safeParse(body({ imageUrls: [BUCKET_URL] })).success).toBe(true);
  });

  it("rejects a URL outside the bucket (R21)", () => {
    const outside = "https://evil.example.com/photo.jpg";
    const result = productWriteSchema.safeParse(body({ imageUrls: [outside] }));
    expect(result.success).toBe(false);
  });

  it("rejects an unknown key (.strict())", () => {
    expect(productWriteSchema.safeParse(body({ extra: "nope" })).success).toBe(false);
  });

  it("treats an empty description as null (R13)", () => {
    const result = productWriteSchema.safeParse(body({ description: "   " }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.description).toBeNull();
  });
});

function promotionBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: null,
    type: "PERCENTAGE",
    scope: "PRODUCT",
    value: "20",
    startsAt: "2026-01-01T00:00:00Z",
    endsAt: null,
    active: true,
    conditions: { storeProductIds: ["6a0f1e9e-2c1a-4f0a-8d1a-0d9c1b2a3c4d"] },
    ...overrides,
  };
}

describe("promotionBodySchema", () => {
  it("accepts a well-formed PRODUCT promotion", () => {
    expect(promotionBodySchema.safeParse(promotionBody()).success).toBe(true);
  });

  it("P2: rejects a PERCENTAGE value of 0 (would discount nothing)", () => {
    expect(promotionBodySchema.safeParse(promotionBody({ value: "0" })).success).toBe(false);
  });

  it("P2: rejects a PERCENTAGE value over 100", () => {
    expect(promotionBodySchema.safeParse(promotionBody({ value: "101" })).success).toBe(false);
  });

  it("P2: rejects a FIXED value of 0 or less", () => {
    const result = promotionBodySchema.safeParse(
      promotionBody({ type: "FIXED", value: "0", conditions: { storeProductIds: [] } }),
    );
    expect(result.success).toBe(false);
  });

  it("P2: rejects endsAt <= startsAt", () => {
    const result = promotionBodySchema.safeParse(promotionBody({ endsAt: "2026-01-01T00:00:00Z" }));
    expect(result.success).toBe(false);
  });

  it("P3: a CATEGORY promotion needs localCategoryIds, not storeProductIds", () => {
    const result = promotionBodySchema.safeParse(promotionBody({ scope: "CATEGORY" }));
    expect(result.success).toBe(false);
  });

  it("P3: an ORDER promotion accepts an optional minSubtotal", () => {
    const result = promotionBodySchema.safeParse(
      promotionBody({ scope: "ORDER", conditions: { minSubtotal: "1000" } }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a PRODUCT promotion with an empty storeProductIds", () => {
    const result = promotionBodySchema.safeParse(
      promotionBody({ conditions: { storeProductIds: [] } }),
    );
    expect(result.success).toBe(false);
  });

  it("treats an empty name as null (R13)", () => {
    const result = promotionBodySchema.safeParse(promotionBody({ name: "  " }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBeNull();
  });
});
