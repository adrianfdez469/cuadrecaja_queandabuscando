import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  effectiveDeliveryConfig,
  NEW_STORE_DELIVERY_BASELINE,
  storeConfigWrite,
  type StoreConfigWrite,
} from "./storeConfig";
import type { StorePayload } from "../schemas";
import type { DeliveryConfig } from "@/features/orders/deliveryOffer";

/** The minimum a `storePayloadSchema.parse(...)` output has — only the keys
 *  `storeConfigWrite` reads matter for these tests, the rest is filler so
 *  the type checks. */
function payload(overrides: Partial<StorePayload> = {}): StorePayload {
  return {
    storeId: "s1",
    businessId: "b1",
    businessName: "Negocio",
    name: "Tienda",
    baseCurrency: "CUP",
    publishToStore: true,
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  } as StorePayload;
}

describe("storeConfigWrite() — R1/R3, 'omitir no es apagar'", () => {
  it("drops every one of the five keys the payload did not send", () => {
    expect(storeConfigWrite(payload())).toEqual({});
  });

  it("keeps a key that was sent, whatever its value", () => {
    expect(storeConfigWrite(payload({ checkoutMode: "ONSITE" }))).toEqual({
      checkoutMode: "ONSITE",
    });
  });

  it("keeps deliveryFee: null — the one explicit null that means something (R3, E4)", () => {
    expect(storeConfigWrite(payload({ deliveryFee: null }))).toEqual({ deliveryFee: null });
  });

  it("keeps only the subset actually present, never inventing the other four (E3)", () => {
    expect(storeConfigWrite(payload({ deliveryFee: 300 }))).toEqual({ deliveryFee: 300 });
  });

  it("keeps all five when all five are present (E2)", () => {
    expect(
      storeConfigWrite(
        payload({
          checkoutMode: "ONSITE",
          deliveryEnabled: true,
          deliveryFee: 750.5,
          deliveryFeeMode: "QUOTED_PER_ORDER",
          orderExpiryHours: 6,
        }),
      ),
    ).toEqual({
      checkoutMode: "ONSITE",
      deliveryEnabled: true,
      deliveryFee: 750.5,
      deliveryFeeMode: "QUOTED_PER_ORDER",
      orderExpiryHours: 6,
    });
  });
});

describe("effectiveDeliveryConfig() — R7, the value the R8 guard actually checks", () => {
  const rowConfig: DeliveryConfig = {
    deliveryEnabled: true,
    deliveryFeeMode: "FLAT_RATE",
    deliveryFee: "500.00",
  };

  it("uses the row's value for every key the payload did not touch", () => {
    const config: StoreConfigWrite = {};
    expect(effectiveDeliveryConfig(config, rowConfig)).toEqual(rowConfig);
  });

  it("overrides only the keys the payload sent, mixed with the row (R9's premise)", () => {
    const config: StoreConfigWrite = { deliveryEnabled: false };
    expect(effectiveDeliveryConfig(config, rowConfig)).toEqual({
      ...rowConfig,
      deliveryEnabled: false,
    });
  });

  it("without a row, mixes against NEW_STORE_DELIVERY_BASELINE (E13)", () => {
    const config: StoreConfigWrite = { deliveryEnabled: true };
    expect(effectiveDeliveryConfig(config, NEW_STORE_DELIVERY_BASELINE)).toEqual({
      deliveryEnabled: true,
      deliveryFeeMode: "FLAT_RATE",
      deliveryFee: null,
    });
  });

  it("deliveryFee: null in the payload overrides a stored fee with NULL (E4)", () => {
    const config: StoreConfigWrite = { deliveryFee: null, deliveryFeeMode: "QUOTED_PER_ORDER" };
    expect(effectiveDeliveryConfig(config, rowConfig)).toEqual({
      deliveryEnabled: true,
      deliveryFeeMode: "QUOTED_PER_ORDER",
      deliveryFee: null,
    });
  });

  it("a numeric deliveryFee from the payload becomes a string, only to answer 'is there a fee'", () => {
    const config: StoreConfigWrite = { deliveryFee: 12.345 };
    expect(effectiveDeliveryConfig(config, rowConfig).deliveryFee).toBe("12.345");
  });
});

describe("NEW_STORE_DELIVERY_BASELINE — must not drift from prisma/schema.prisma's @default(...)s", () => {
  it("matches the Store block's deliveryEnabled and deliveryFeeMode defaults on disk", () => {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const storeBlock = /model Store \{[\s\S]*?\n\}/.exec(schema)?.[0];
    expect(storeBlock, "model Store { ... } not found in prisma/schema.prisma").toBeTruthy();

    expect(storeBlock).toMatch(/deliveryEnabled\s+Boolean\s+@default\(false\)/);
    expect(storeBlock).toMatch(/deliveryFeeMode\s+DeliveryFeeMode\s+@default\(FLAT_RATE\)/);
    // deliveryFee has no @default: absent row and absent amount are the same NULL.
    expect(storeBlock).toMatch(/deliveryFee\s+Decimal\?\s+@db\.Decimal\(14, 2\)/);

    expect(NEW_STORE_DELIVERY_BASELINE).toEqual({
      deliveryEnabled: false,
      deliveryFeeMode: "FLAT_RATE",
      deliveryFee: null,
    });
  });
});
