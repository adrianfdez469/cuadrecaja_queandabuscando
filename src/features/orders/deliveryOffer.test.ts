import { describe, expect, it } from "vitest";
import {
  deliveryFeeForNewOrder,
  isDeliveryConfigInconsistent,
  isDeliveryOffered,
  type DeliveryConfig,
} from "./deliveryOffer";

function config(overrides: Partial<DeliveryConfig> = {}): DeliveryConfig {
  return {
    deliveryEnabled: true,
    deliveryFeeMode: "FLAT_RATE",
    deliveryFee: "500.00",
    ...overrides,
  };
}

describe("isDeliveryOffered() — R20", () => {
  it("is false when deliveryEnabled is false, regardless of mode", () => {
    expect(isDeliveryOffered(config({ deliveryEnabled: false }))).toBe(false);
    expect(
      isDeliveryOffered(config({ deliveryEnabled: false, deliveryFeeMode: "QUOTED_PER_ORDER" })),
    ).toBe(false);
  });

  it("FLAT_RATE needs a stored fee to close the offer", () => {
    expect(isDeliveryOffered(config({ deliveryFee: null }))).toBe(false);
    expect(isDeliveryOffered(config({ deliveryFee: "500.00" }))).toBe(true);
  });

  it("QUOTED_PER_ORDER is offered even with no fee on file", () => {
    expect(
      isDeliveryOffered(config({ deliveryFeeMode: "QUOTED_PER_ORDER", deliveryFee: null })),
    ).toBe(true);
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
});

describe('deliveryFeeForNewOrder() — E8, § Casos límite "manda el modo"', () => {
  it("PICKUP always returns 0.00 — the delivery is uncertain, never the order", () => {
    expect(deliveryFeeForNewOrder(config(), "PICKUP")).toBe("0.00");
    expect(deliveryFeeForNewOrder(config({ deliveryFeeMode: "QUOTED_PER_ORDER" }), "PICKUP")).toBe(
      "0.00",
    );
  });

  it("FLAT_RATE + DELIVERY returns the stored fee", () => {
    expect(deliveryFeeForNewOrder(config({ deliveryFee: "500.00" }), "DELIVERY")).toBe("500.00");
  });

  it("FLAT_RATE + DELIVERY with no stored fee falls back to 0.00", () => {
    expect(deliveryFeeForNewOrder(config({ deliveryFee: null }), "DELIVERY")).toBe("0.00");
  });

  it("QUOTED_PER_ORDER + DELIVERY returns null — not quoted yet — IGNORING a residual fee", () => {
    expect(
      deliveryFeeForNewOrder(
        config({ deliveryFeeMode: "QUOTED_PER_ORDER", deliveryFee: "999.00" }),
        "DELIVERY",
      ),
    ).toBeNull();
  });
});
