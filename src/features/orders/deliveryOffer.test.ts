import { describe, expect, it } from "vitest";
import {
  deliveryFeeForNewOrder,
  isDeliveryConfigInconsistent,
  isDeliveryOffered,
  type ChosenZone,
  type DeliveryConfig,
  type ZoneCoverageFact,
} from "./deliveryOffer";

function config(overrides: Partial<DeliveryConfig> = {}): DeliveryConfig {
  return {
    deliveryEnabled: true,
    deliveryFeeMode: "FLAT_RATE",
    deliveryFee: "500.00",
    ...overrides,
  };
}

// F-042 (AD2): irrelevant for FLAT_RATE/QUOTED_PER_ORDER, but the parameter
// is OBLIGATORY — a caller that forgets it does not compile.
const NO_COVERAGE: ZoneCoverageFact = { hasResolvableZone: false };
const HAS_COVERAGE: ZoneCoverageFact = { hasResolvableZone: true };

describe("isDeliveryOffered() — R20", () => {
  it("is false when deliveryEnabled is false, regardless of mode", () => {
    expect(isDeliveryOffered(config({ deliveryEnabled: false }), NO_COVERAGE)).toBe(false);
    expect(
      isDeliveryOffered(
        config({ deliveryEnabled: false, deliveryFeeMode: "QUOTED_PER_ORDER" }),
        NO_COVERAGE,
      ),
    ).toBe(false);
  });

  it("FLAT_RATE needs a stored fee to close the offer", () => {
    expect(isDeliveryOffered(config({ deliveryFee: null }), NO_COVERAGE)).toBe(false);
    expect(isDeliveryOffered(config({ deliveryFee: "500.00" }), NO_COVERAGE)).toBe(true);
  });

  it("QUOTED_PER_ORDER is offered even with no fee on file", () => {
    expect(
      isDeliveryOffered(
        config({ deliveryFeeMode: "QUOTED_PER_ORDER", deliveryFee: null }),
        NO_COVERAGE,
      ),
    ).toBe(true);
  });

  // F-042 (AD2, R1, I3/I4): la pregunta de verdad. ZONE_BASED ya NO
  // contesta `false` a secas — depende ÚNICAMENTE del hecho que le llega
  // resuelto, nunca de `config.deliveryFee` (que es residuo inerte, R9).
  it("ZONE_BASED depends ONLY on the resolved coverage fact, never on the residual store fee", () => {
    expect(
      isDeliveryOffered(config({ deliveryFeeMode: "ZONE_BASED", deliveryFee: null }), HAS_COVERAGE),
    ).toBe(true);
    expect(
      isDeliveryOffered(
        config({ deliveryFeeMode: "ZONE_BASED", deliveryFee: "999.00" }),
        NO_COVERAGE,
      ),
    ).toBe(false);
  });

  it("ZONE_BASED is false when deliveryEnabled is false, even with a resolvable zone", () => {
    expect(
      isDeliveryOffered(
        config({ deliveryEnabled: false, deliveryFeeMode: "ZONE_BASED" }),
        HAS_COVERAGE,
      ),
    ).toBe(false);
  });
});

describe("isDeliveryConfigInconsistent() — F-032 R8, the sync's write guard", () => {
  it("is true only for the one forbidden combination: enabled + FLAT_RATE + no fee", () => {
    expect(
      isDeliveryConfigInconsistent(
        config({ deliveryEnabled: true, deliveryFeeMode: "FLAT_RATE", deliveryFee: null }),
      ),
    ).toBe(true);
  });

  it("is false when disabled, whatever the mode or fee — nothing to protect if delivery is off", () => {
    expect(
      isDeliveryConfigInconsistent(
        config({ deliveryEnabled: false, deliveryFeeMode: "FLAT_RATE", deliveryFee: null }),
      ),
    ).toBe(false);
  });

  it("is false for FLAT_RATE with a fee on file, including deliveryFee: 0 (free shipping is valid)", () => {
    expect(
      isDeliveryConfigInconsistent(
        config({ deliveryEnabled: true, deliveryFeeMode: "FLAT_RATE", deliveryFee: "500.00" }),
      ),
    ).toBe(false);
    expect(
      isDeliveryConfigInconsistent(
        config({ deliveryEnabled: true, deliveryFeeMode: "FLAT_RATE", deliveryFee: "0.00" }),
      ),
    ).toBe(false);
  });

  it("is false for QUOTED_PER_ORDER even with no fee on file — it needs none to make the offer", () => {
    expect(
      isDeliveryConfigInconsistent(
        config({ deliveryEnabled: true, deliveryFeeMode: "QUOTED_PER_ORDER", deliveryFee: null }),
      ),
    ).toBe(false);
  });

  // F-042 (I4): the sync's question is UNCHANGED by this feature —
  // `hasSomethingToChargeDeliveryWith` (which this function is written in
  // terms of) already answered `true` for ZONE_BASED since F-041, with no
  // knowledge of the tarifario at all.
  it("is false for ZONE_BASED even with no fee on file — the tarifario decides, not this row", () => {
    expect(
      isDeliveryConfigInconsistent(
        config({ deliveryEnabled: true, deliveryFeeMode: "ZONE_BASED", deliveryFee: null }),
      ),
    ).toBe(false);
  });
});

describe('deliveryFeeForNewOrder() — E8, § Casos límite "manda el modo"', () => {
  it("PICKUP always returns { kind: charged, amount: 0.00 } — the delivery is uncertain, never the order", () => {
    expect(deliveryFeeForNewOrder(config(), "PICKUP", null)).toEqual({
      kind: "charged",
      amount: "0.00",
    });
    expect(
      deliveryFeeForNewOrder(config({ deliveryFeeMode: "QUOTED_PER_ORDER" }), "PICKUP", null),
    ).toEqual({ kind: "charged", amount: "0.00" });
  });

  it("FLAT_RATE + DELIVERY returns the stored fee", () => {
    expect(deliveryFeeForNewOrder(config({ deliveryFee: "500.00" }), "DELIVERY", null)).toEqual({
      kind: "charged",
      amount: "500.00",
    });
  });

  it("FLAT_RATE + DELIVERY with no stored fee falls back to 0.00", () => {
    expect(deliveryFeeForNewOrder(config({ deliveryFee: null }), "DELIVERY", null)).toEqual({
      kind: "charged",
      amount: "0.00",
    });
  });

  it("QUOTED_PER_ORDER + DELIVERY returns not_quoted — IGNORING a residual fee", () => {
    expect(
      deliveryFeeForNewOrder(
        config({ deliveryFeeMode: "QUOTED_PER_ORDER", deliveryFee: "999.00" }),
        "DELIVERY",
        null,
      ),
    ).toEqual({ kind: "not_quoted" });
  });

  // F-042 (AD4, C10): ZONE_BASED nunca puede dar `not_quoted` — es
  // EXACTAMENTE lo que R11 exige (ZONE_BASED y QUOTED_PER_ORDER son
  // excluyentes). Sin zona, `zone_required`; con zona, el importe de la
  // ZONA, NUNCA `config.deliveryFee` (R9) — ni siquiera con `"0.00"`,
  // que es envío gratis y no "sin importe" (R10).
  const zoneBasedConfig = config({ deliveryFeeMode: "ZONE_BASED", deliveryFee: "999.00" });

  it("ZONE_BASED + DELIVERY without a resolved zone returns zone_required, never not_quoted", () => {
    expect(deliveryFeeForNewOrder(zoneBasedConfig, "DELIVERY", null)).toEqual({
      kind: "zone_required",
    });
  });

  it("ZONE_BASED + DELIVERY with a resolved zone charges the ZONE's fee, never the residual store fee", () => {
    const zone: ChosenZone = { code: "23.01", deliveryFee: "300.00" };
    expect(deliveryFeeForNewOrder(zoneBasedConfig, "DELIVERY", zone)).toEqual({
      kind: "charged",
      amount: "300.00",
    });
  });

  it("ZONE_BASED free shipping (deliveryFee: 0.00) is charged, not zone_required — R10, never a falsy check", () => {
    const freeZone: ChosenZone = { code: "23.05", deliveryFee: "0.00" };
    expect(deliveryFeeForNewOrder(zoneBasedConfig, "DELIVERY", freeZone)).toEqual({
      kind: "charged",
      amount: "0.00",
    });
  });
});
