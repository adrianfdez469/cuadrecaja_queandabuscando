import { describe, expect, it } from "vitest";
import {
  businessPayloadSchema,
  provisionCredentialSchema,
  storePayloadSchema,
  syncEventSchema,
  zoneTariffPayloadSchema,
} from "./schemas";
import { STORE_DELIVERY_CONFIG_INCONSISTENT } from "@/constants/sync";

/**
 * F-032: the only test of the `400` that does not need a server (§ DA7).
 * `basePayload()` is a valid v6 payload — no key of the five — so every
 * case below only has to describe what it CHANGES.
 */
function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    storeId: "s1",
    businessId: "b1",
    businessName: "Negocio",
    name: "Tienda",
    baseCurrency: "CUP",
    publishToStore: true,
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("storePayloadSchema — the v6 shape, unchanged (E14)", () => {
  it("accepts a payload with none of the five keys, exactly like the v6 contract", () => {
    const result = storePayloadSchema.safeParse(basePayload());
    expect(result.success).toBe(true);
  });

  it("accepts a full syncEventSchema STORE event with the v6 shape (no `issues`)", () => {
    const result = syncEventSchema.safeParse({
      eventId: "evt-1",
      entity: "STORE",
      operation: "UPDATE",
      occurredAt: "2026-09-01T00:00:00.000Z",
      payload: basePayload(),
    });
    expect(result.success).toBe(true);
  });
});

describe("storePayloadSchema — F-022 E11: timezone is the panel's, the POS cannot write it even by accident", () => {
  it("a payload carrying a timezone key parses successfully with the key silently stripped", () => {
    const result = storePayloadSchema.safeParse(basePayload({ timezone: "Europe/Madrid" }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("timezone");
    }
  });

  it("an INVALID timezone value does not fail the event either — the whole key is discarded, not validated", () => {
    const result = storePayloadSchema.safeParse(basePayload({ timezone: "not-a-real-zone" }));
    expect(result.success).toBe(true);
  });
});

describe("storePayloadSchema — F-022: openingHours stays z.unknown() at this layer (E10 lives in the handler, not here)", () => {
  it("accepts openingHours: null/absent, exactly like before this feature", () => {
    expect(storePayloadSchema.safeParse(basePayload()).success).toBe(true);
    expect(storePayloadSchema.safeParse(basePayload({ openingHours: null })).success).toBe(true);
  });

  it("does NOT reject a malformed openingHours at the schema layer — architecture.md § Contratos internos, punto 6: rejecting a 500-event batch's shape here would 400 the WHOLE batch and write no SyncEvent, which is not what E10 asks for", () => {
    const result = storePayloadSchema.safeParse(basePayload({ openingHours: { lunes: "9 a 6" } }));
    expect(result.success).toBe(true);
  });
});

describe("storePayloadSchema — the five are optional and applied when present (E1, E2, E3)", () => {
  it("all five present and distinct from the defaults (--store-config=all)", () => {
    const result = storePayloadSchema.safeParse(
      basePayload({
        checkoutMode: "ONSITE",
        deliveryEnabled: true,
        deliveryFee: 750.5,
        deliveryFeeMode: "QUOTED_PER_ORDER",
        orderExpiryHours: 6,
      }),
    );
    expect(result.success).toBe(true);
  });

  it("only deliveryFee present — the other four are untouched by the schema (--store-config=partial)", () => {
    const result = storePayloadSchema.safeParse(basePayload({ deliveryFee: 300 }));
    expect(result.success).toBe(true);
  });

  it("deliveryFee: 0 is valid — free shipping, not the missing amount", () => {
    const result = storePayloadSchema.safeParse(
      basePayload({ deliveryEnabled: true, deliveryFeeMode: "FLAT_RATE", deliveryFee: 0 }),
    );
    expect(result.success).toBe(true);
  });
});

describe("storePayloadSchema — deliveryFee: null clears the amount (E4, --store-config=null-fee)", () => {
  it("deliveryFee: null together with QUOTED_PER_ORDER is valid", () => {
    const result = storePayloadSchema.safeParse(
      basePayload({ deliveryFee: null, deliveryFeeMode: "QUOTED_PER_ORDER" }),
    );
    expect(result.success).toBe(true);
  });
});

describe("storePayloadSchema — null on the other four is a type error, not a silent no-op (E5, --store-config=null-mode)", () => {
  it.each([
    ["checkoutMode", { checkoutMode: null }],
    ["deliveryEnabled", { deliveryEnabled: null }],
    ["deliveryFeeMode", { deliveryFeeMode: null }],
    ["orderExpiryHours", { orderExpiryHours: null }],
  ])("%s: null fails safeParse", (_name, overrides) => {
    const result = storePayloadSchema.safeParse(basePayload(overrides));
    expect(result.success).toBe(false);
  });
});

describe("storePayloadSchema — out-of-range or wrong-vocabulary values are 400s (E6)", () => {
  it.each([
    ["decimals", { deliveryFee: 12.345 }],
    ["negative", { deliveryFee: -1 }],
    ["too-large", { deliveryFee: 1e13 }],
    ["hours-zero", { orderExpiryHours: 0 }],
    ["hours-negative", { orderExpiryHours: -3 }],
    ["hours-decimal", { orderExpiryHours: 2.5 }],
    ["hours-max", { orderExpiryHours: 9000 }],
    ["bad-mode", { deliveryFeeMode: "PER_KM" }],
    ["bad-checkout", { checkoutMode: "TELEGRAM" }],
  ])("%s is rejected", (_name, overrides) => {
    const result = storePayloadSchema.safeParse(basePayload(overrides));
    expect(result.success).toBe(false);
  });
});

describe("storePayloadSchema — the payload-only contradiction (E7, R10.1, --store-config=contradictory)", () => {
  it("deliveryEnabled: true + FLAT_RATE + deliveryFee: null fails with STORE_DELIVERY_CONFIG_INCONSISTENT", () => {
    const result = storePayloadSchema.safeParse(
      basePayload({ deliveryEnabled: true, deliveryFeeMode: "FLAT_RATE", deliveryFee: null }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.message === STORE_DELIVERY_CONFIG_INCONSISTENT),
      ).toBe(true);
    }
  });

  it("deliveryEnabled: true alone (no FLAT_RATE/null in the SAME payload) is NOT a payload-only contradiction (--store-config=enable-only, R10.2 territory)", () => {
    // R10.2: this combination only becomes contradictory once mixed with the
    // ROW — a `refine` cannot see that, so the schema must accept it.
    const result = storePayloadSchema.safeParse(basePayload({ deliveryEnabled: true }));
    expect(result.success).toBe(true);
  });

  it("deliveryEnabled: true + FLAT_RATE with a real fee is valid — the refine only fires on null", () => {
    const result = storePayloadSchema.safeParse(
      basePayload({ deliveryEnabled: true, deliveryFeeMode: "FLAT_RATE", deliveryFee: 500 }),
    );
    expect(result.success).toBe(true);
  });
});

describe("provisionCredentialSchema — F-034 spec.md § Datos y contrato", () => {
  it("accepts an externalId alone", () => {
    const result = provisionCredentialSchema.safeParse({ externalId: "neg-000123" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ externalId: "neg-000123" });
  });

  it("trims externalId and name, rather than rejecting the surrounding whitespace", () => {
    const result = provisionCredentialSchema.safeParse({
      externalId: "  neg-1  ",
      name: "  Bodega La Rampa  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ externalId: "neg-1", name: "Bodega La Rampa" });
    }
  });

  it("R17: trims but never case-folds — it has to compare byte for byte against the sync's businessId", () => {
    const result = provisionCredentialSchema.safeParse({ externalId: "  Neg-Uno  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.externalId).toBe("Neg-Uno");
  });

  it("rejects a missing externalId (400 INVALID_BODY)", () => {
    expect(provisionCredentialSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an externalId that is empty or only whitespace after trim", () => {
    expect(provisionCredentialSchema.safeParse({ externalId: "" }).success).toBe(false);
    expect(provisionCredentialSchema.safeParse({ externalId: "   " }).success).toBe(false);
  });

  it("rejects an externalId over 128 characters", () => {
    expect(provisionCredentialSchema.safeParse({ externalId: "x".repeat(129) }).success).toBe(
      false,
    );
    expect(provisionCredentialSchema.safeParse({ externalId: "x".repeat(128) }).success).toBe(true);
  });

  it("rejects a name over 200 characters, but leaves it out entirely as valid", () => {
    expect(
      provisionCredentialSchema.safeParse({ externalId: "neg-1", name: "x".repeat(201) }).success,
    ).toBe(false);
    expect(provisionCredentialSchema.safeParse({ externalId: "neg-1" }).success).toBe(true);
  });

  it("strips unknown keys instead of rejecting the request — `strip`, not `strict` (E8)", () => {
    const result = provisionCredentialSchema.safeParse({
      externalId: "neg-1",
      trackingLabel: "cuadrecaja's own tag",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("trackingLabel");
  });

  it("the typo `external_id` still 400s — the unknown key is dropped, but `externalId` is then missing", () => {
    const result = provisionCredentialSchema.safeParse({ external_id: "neg-1" });
    expect(result.success).toBe(false);
  });
});

/**
 * F-038 R1/R2: the sixth branch of the envelope. `businessPayloadSchema` is
 * laxo a propósito — the MEMBERS of `displayCurrencies` are checked in the
 * applier (`findInvalidDisplayCurrency`), never here.
 */
function businessBasePayload(overrides: Record<string, unknown> = {}) {
  return {
    businessId: "b1",
    displayCurrencies: ["CUP", "USD", "EUR"],
    updatedAt: "2026-09-06T14:03:00.000Z",
    ...overrides,
  };
}

describe("businessPayloadSchema / syncEventSchema — the sixth branch (R1, E1)", () => {
  it("accepts a full syncEventSchema BUSINESS event", () => {
    const result = syncEventSchema.safeParse({
      eventId: "evt-1",
      entity: "BUSINESS",
      operation: "UPDATE",
      occurredAt: "2026-09-06T14:03:00.000Z",
      payload: businessBasePayload(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects an entity the contract does not define (ORDER, I13 — ZONE_TARIFF was this example until F-041 defined it): accepting BUSINESS does not open the envelope to anything (E2)", () => {
    const result = syncEventSchema.safeParse({
      eventId: "evt-1",
      entity: "ORDER",
      operation: "UPDATE",
      occurredAt: "2026-09-06T14:03:00.000Z",
      payload: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing displayCurrencies", () => {
    const { displayCurrencies: _displayCurrencies, ...rest } = businessBasePayload();
    expect(businessPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a payload missing businessId", () => {
    const { businessId: _businessId, ...rest } = businessBasePayload();
    expect(businessPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects displayCurrencies that is not a list", () => {
    expect(
      businessPayloadSchema.safeParse(businessBasePayload({ displayCurrencies: "USD" })).success,
    ).toBe(false);
  });

  it("rejects an updatedAt that is not ISO 8601", () => {
    expect(
      businessPayloadSchema.safeParse(businessBasePayload({ updatedAt: "not-a-date" })).success,
    ).toBe(false);
  });

  it("PASSES malformed members at this layer (R2/I2) — a code is checked by the applier, not the envelope", () => {
    expect(
      businessPayloadSchema.safeParse(businessBasePayload({ displayCurrencies: ["usd"] })).success,
    ).toBe(true);
    expect(
      businessPayloadSchema.safeParse(businessBasePayload({ displayCurrencies: ["US1"] })).success,
    ).toBe(true);
  });

  it("accepts 40 codes with no length cap (R17)", () => {
    const codes = Array.from({ length: 40 }, (_, i) => {
      const a = String.fromCharCode(65 + Math.floor(i / 26));
      const b = String.fromCharCode(65 + (i % 26));
      return `A${a}${b}`;
    });
    expect(
      businessPayloadSchema.safeParse(businessBasePayload({ displayCurrencies: codes })).success,
    ).toBe(true);
  });

  it("accepts an empty displayCurrencies list (E10)", () => {
    expect(
      businessPayloadSchema.safeParse(businessBasePayload({ displayCurrencies: [] })).success,
    ).toBe(true);
  });
});

/**
 * F-041 — criterio 3 (paso 16, § "Los criterios con trampa"): NOT_SERVED/
 * INHERIT with an amount, and FEE with NO amount, both 400 — neither is
 * ever a silent discard (R15, precedent: `barcode`). Real codes of the
 * committed catalog (`21`, `21.01`) so a regeneration that ever retires one
 * fails loudly here rather than this file quietly testing against a code
 * that stopped existing.
 */
function zoneTariffBasePayload(overrides: Record<string, unknown> = {}) {
  return {
    storeId: "s1",
    zoneCode: "21.01",
    rule: "FEE",
    deliveryFee: 300,
    updatedAt: "2026-09-08T14:03:00.000Z",
    ...overrides,
  };
}

describe("zoneTariffPayloadSchema / syncEventSchema — the seventh branch (C3, E6-E9)", () => {
  it("accepts a valid FEE payload", () => {
    expect(zoneTariffPayloadSchema.safeParse(zoneTariffBasePayload()).success).toBe(true);
  });

  it("accepts a valid NOT_SERVED payload with no deliveryFee key at all", () => {
    const { deliveryFee: _fee, ...rest } = zoneTariffBasePayload({ rule: "NOT_SERVED" });
    expect(zoneTariffPayloadSchema.safeParse(rest).success).toBe(true);
  });

  it("accepts a valid INHERIT payload with no deliveryFee key at all", () => {
    const { deliveryFee: _fee, ...rest } = zoneTariffBasePayload({ rule: "INHERIT" });
    expect(zoneTariffPayloadSchema.safeParse(rest).success).toBe(true);
  });

  it("E6: FEE with NO deliveryFee is rejected (400) — not free shipping, malformed", () => {
    const { deliveryFee: _fee, ...rest } = zoneTariffBasePayload();
    expect(zoneTariffPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it.each(["NOT_SERVED", "INHERIT"] as const)(
    "E7: %s WITH a deliveryFee present is rejected (400) — presence is the error, never a silent discard",
    (rule) => {
      expect(
        zoneTariffPayloadSchema.safeParse(zoneTariffBasePayload({ rule, deliveryFee: 0 })).success,
      ).toBe(false);
    },
  );

  it.each(["NOT_SERVED", "INHERIT"] as const)(
    "E7: %s with deliveryFee EXPLICITLY null is ALSO rejected — null is not the same as absent",
    (rule) => {
      expect(
        zoneTariffPayloadSchema.safeParse(zoneTariffBasePayload({ rule, deliveryFee: null }))
          .success,
      ).toBe(false);
    },
  );

  it("E8: a negative deliveryFee on FEE is rejected (400), same nonnegative() guard as STORE's own deliveryFee", () => {
    expect(
      zoneTariffPayloadSchema.safeParse(zoneTariffBasePayload({ deliveryFee: -1 })).success,
    ).toBe(false);
  });

  it("a deliveryFee with more than two decimal places is rejected (multipleOf 0.01, same domain as STORE R16)", () => {
    expect(
      zoneTariffPayloadSchema.safeParse(zoneTariffBasePayload({ deliveryFee: 300.005 })).success,
    ).toBe(false);
  });

  it("a deliveryFee of exactly 0 on FEE is ACCEPTED at the schema layer — free shipping is a valid amount (R27(2), decided by the pure function, not here)", () => {
    expect(
      zoneTariffPayloadSchema.safeParse(zoneTariffBasePayload({ deliveryFee: 0 })).success,
    ).toBe(true);
  });

  it("F-043 (R1/R5): a zoneCode with the wrong shape (no dot pattern match) is ACCEPTED at the schema layer — the VALUE is the handler's call, never the sobre's (avoids the 400 that took 499 unrelated events down with it)", () => {
    expect(
      zoneTariffPayloadSchema.safeParse(zoneTariffBasePayload({ zoneCode: "not-a-code" })).success,
    ).toBe(true);
  });

  it("F-043 (R1/R5): a zoneCode not in the published catalog is ALSO accepted here — checked against the artefact in the handler's assertZoneKnown, not the sobre (I7)", () => {
    const result = zoneTariffPayloadSchema.safeParse(zoneTariffBasePayload({ zoneCode: "99.99" }));
    expect(result.success).toBe(true);
  });

  it("F-043 (R5, lectura (a) del humano): a NUMERIC zoneCode is still rejected — the TYPE stays the sobre's call, this is the only door left open to a 400 for this field", () => {
    const result = zoneTariffPayloadSchema.safeParse(zoneTariffBasePayload({ zoneCode: 2101 }));
    expect(result.success).toBe(false);
  });

  it("rejects a rule outside the vocabulary — Zod's OWN discriminator message comes through, not a message this repo wrote", () => {
    const result = zoneTariffPayloadSchema.safeParse(zoneTariffBasePayload({ rule: "SERVED" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      // C3's trap: this is `invalid_union_discriminator` from Zod itself,
      // not a custom message — still a schema-level rejection either way,
      // which is all C3 requires ("400 INVALID_BATCH").
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("wraps in a full syncEventSchema ZONE_TARIFF event and rejects a malformed rule as INVALID at the envelope level too", () => {
    const result = syncEventSchema.safeParse({
      eventId: "evt-1",
      entity: "ZONE_TARIFF",
      operation: "UPDATE",
      occurredAt: "2026-09-08T14:03:00.000Z",
      payload: zoneTariffBasePayload({ rule: "SERVED" }),
    });
    expect(result.success).toBe(false);
  });

  it("accepts a full syncEventSchema ZONE_TARIFF event when the payload is valid", () => {
    const result = syncEventSchema.safeParse({
      eventId: "evt-1",
      entity: "ZONE_TARIFF",
      operation: "UPDATE",
      occurredAt: "2026-09-08T14:03:00.000Z",
      payload: zoneTariffBasePayload(),
    });
    expect(result.success).toBe(true);
  });
});
