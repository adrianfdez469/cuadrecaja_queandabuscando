import { describe, expect, it } from "vitest";
import { findAvailabilityMismatch, findCatalogMismatch } from "./identity";
import type { SyncEventInput } from "./schemas";

/**
 * R5/E14: pure coherence checks between the authenticated caller and the
 * `businessId` the payload still carries. No Prisma, no React.
 */

function storeEvent(businessId: string): SyncEventInput {
  return {
    eventId: "evt-1",
    entity: "STORE",
    operation: "UPDATE",
    occurredAt: "2026-08-27T00:00:00.000Z",
    payload: {
      storeId: "ext-store-1",
      businessId,
      businessName: "La Rampa",
      name: "Bodega Uno",
      publishToStore: true,
      baseCurrency: "CUP",
      updatedAt: "2026-08-27T00:00:00.000Z",
    },
  };
}

function currencyEvent(): SyncEventInput {
  return {
    eventId: "evt-2",
    entity: "CURRENCY",
    operation: "UPDATE",
    occurredAt: "2026-08-27T00:00:00.000Z",
    payload: {
      code: "USD",
      name: "Dólar",
      symbol: "$",
      active: true,
      updatedAt: "2026-08-27T00:00:00.000Z",
    },
  };
}

describe("findCatalogMismatch()", () => {
  it("returns null when the root businessId and every event payload match the caller", () => {
    const result = findCatalogMismatch("seed-negocio-1", {
      businessId: "seed-negocio-1",
      events: [storeEvent("seed-negocio-1")],
    });
    expect(result).toBeNull();
  });

  it("flags a root businessId that does not match the caller, before looking at events", () => {
    const result = findCatalogMismatch("seed-negocio-1", {
      businessId: "seed-negocio-2",
      events: [storeEvent("seed-negocio-1")],
    });
    expect(result).toBe("businessId");
  });

  it("flags an event payload whose businessId differs from the caller, by index", () => {
    const result = findCatalogMismatch("seed-negocio-1", {
      businessId: "seed-negocio-1",
      events: [storeEvent("seed-negocio-1"), storeEvent("seed-negocio-2")],
    });
    expect(result).toBe("events[1].payload.businessId");
  });

  it("CURRENCY never mismatches — it does not carry a businessId at all", () => {
    const result = findCatalogMismatch("seed-negocio-1", {
      businessId: "seed-negocio-1",
      events: [currencyEvent()],
    });
    expect(result).toBeNull();
  });
});

describe("findAvailabilityMismatch()", () => {
  it("returns null when the root businessId matches", () => {
    expect(findAvailabilityMismatch("seed-negocio-1", { businessId: "seed-negocio-1" })).toBeNull();
  });

  it("flags a root businessId that does not match the caller", () => {
    expect(findAvailabilityMismatch("seed-negocio-1", { businessId: "seed-negocio-2" })).toBe(
      "businessId",
    );
  });
});
