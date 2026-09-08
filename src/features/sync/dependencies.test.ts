import { describe, expect, it } from "vitest";
import { createBatchDependencies, dependencyRoleOf } from "./dependencies";
import type { SyncEventInput } from "./schemas";

/**
 * F-037: the algebra of dependency keys, with nothing mocked — the module is
 * pure. This file covers the module itself; `processBatch.test.ts` (plan.md
 * step 7, sdd-tester) is where the LOOP that uses it — R8, E6-E10, E13-E15,
 * E17-E18 — gets covered, not yet extended as of this commit.
 */

function categoryEvent(
  categoryId: string,
  eventId = "evt-category",
  operation: "CREATE" | "UPDATE" | "DELETE" = "UPDATE",
): SyncEventInput {
  return {
    eventId,
    entity: "CATEGORY",
    operation,
    occurredAt: "2026-08-27T00:00:00.000Z",
    payload: {
      categoryId,
      businessId: "business-1",
      name: "Bebidas",
      updatedAt: "2026-08-27T00:00:00.000Z",
    },
  };
}

function currencyEvent(
  code: string,
  eventId = "evt-currency",
  operation: "CREATE" | "UPDATE" | "DELETE" = "UPDATE",
): SyncEventInput {
  return {
    eventId,
    entity: "CURRENCY",
    operation,
    occurredAt: "2026-08-27T00:00:00.000Z",
    payload: {
      code,
      name: code,
      symbol: code,
      active: true,
      updatedAt: "2026-08-27T00:00:00.000Z",
    },
  };
}

function productEvent(
  localCategoryId: string | null | undefined,
  eventId = "evt-product",
): SyncEventInput {
  return {
    eventId,
    entity: "PRODUCT",
    operation: "UPDATE",
    occurredAt: "2026-08-27T00:00:00.000Z",
    payload: {
      storeProductId: `sp-${eventId}`,
      productId: `p-${eventId}`,
      businessId: "business-1",
      storeId: "store-1",
      localName: "Ron",
      barcodes: [],
      localCategoryId,
      price: 10,
      currency: "CUP",
      publishToStore: true,
      updatedAt: "2026-08-27T00:00:00.000Z",
    },
  };
}

function exchangeRateEvent(currency: string, eventId = "evt-rate"): SyncEventInput {
  return {
    eventId,
    entity: "EXCHANGE_RATE",
    operation: "UPDATE",
    occurredAt: "2026-08-27T00:00:00.000Z",
    payload: {
      businessId: "business-1",
      currency,
      rate: 400,
      updatedAt: "2026-08-27T00:00:00.000Z",
    },
  };
}

function storeEvent(eventId = "evt-store"): SyncEventInput {
  return {
    eventId,
    entity: "STORE",
    operation: "UPDATE",
    occurredAt: "2026-08-27T00:00:00.000Z",
    payload: {
      storeId: "ext-store-1",
      businessId: "business-1",
      businessName: "La Rampa",
      name: "Bodega Uno",
      publishToStore: true,
      baseCurrency: "CUP",
      updatedAt: "2026-08-27T00:00:00.000Z",
    },
  };
}

function businessEvent(eventId = "evt-business"): SyncEventInput {
  return {
    eventId,
    entity: "BUSINESS",
    operation: "UPDATE",
    occurredAt: "2026-08-27T00:00:00.000Z",
    payload: {
      businessId: "business-1",
      displayCurrencies: ["CUP", "USD"],
      updatedAt: "2026-08-27T00:00:00.000Z",
    },
  };
}

describe("dependencyRoleOf()", () => {
  it("a CATEGORY provides its externalId and requires nothing", () => {
    expect(dependencyRoleOf(categoryEvent("cat-1"))).toEqual({
      provides: "CATEGORY:cat-1",
      requires: null,
    });
  });

  it("a CURRENCY provides its code and requires nothing", () => {
    expect(dependencyRoleOf(currencyEvent("USD"))).toEqual({
      provides: "CURRENCY:USD",
      requires: null,
    });
  });

  it("a PRODUCT requires its localCategoryId and provides nothing", () => {
    expect(dependencyRoleOf(productEvent("cat-1"))).toEqual({
      provides: null,
      requires: "CATEGORY:cat-1",
    });
  });

  it("an EXCHANGE_RATE requires its currency and provides nothing", () => {
    expect(dependencyRoleOf(exchangeRateEvent("USD"))).toEqual({
      provides: null,
      requires: "CURRENCY:USD",
    });
  });

  it("a STORE neither provides nor requires anything", () => {
    expect(dependencyRoleOf(storeEvent())).toEqual({ provides: null, requires: null });
  });

  // F-038 R12/E14: BUSINESS adds no order dependency of any kind, so the
  // list of dependencies from the contract's v11 ③ still has exactly two.
  it("a BUSINESS neither provides nor requires anything", () => {
    expect(dependencyRoleOf(businessEvent())).toEqual({ provides: null, requires: null });
  });

  // R11: no row has both columns filled — a dependent is never itself an
  // origin, so there is no chain (E13).
  it("no entity plays both roles at once", () => {
    for (const event of [
      categoryEvent("cat-1"),
      currencyEvent("USD"),
      productEvent("cat-1"),
      exchangeRateEvent("USD"),
      storeEvent(),
      businessEvent(),
    ]) {
      const role = dependencyRoleOf(event);
      expect(role.provides === null || role.requires === null).toBe(true);
    }
  });

  // E12/R5: null, absent and "" all mean "no category" and none of them
  // produce a `requires` — a PRODUCT without a category never participates.
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
  ])("a PRODUCT with %s localCategoryId requires nothing", (_label, localCategoryId) => {
    expect(dependencyRoleOf(productEvent(localCategoryId)).requires).toBeNull();
  });

  // E16: the entity pair is part of the key, so a category and a currency
  // that share the same raw value never collide.
  it("CATEGORY:USD and CURRENCY:USD are distinct keys", () => {
    expect(dependencyRoleOf(categoryEvent("USD")).provides).toBe("CATEGORY:USD");
    expect(dependencyRoleOf(currencyEvent("USD")).provides).toBe("CURRENCY:USD");
  });

  // R4/E11: the comparison is exact, byte for byte — no trim, no case fold.
  it("case and surrounding spaces are part of the key, not noise", () => {
    expect(dependencyRoleOf(currencyEvent("usd")).provides).toBe("CURRENCY:usd");
    expect(dependencyRoleOf(currencyEvent("USD")).provides).toBe("CURRENCY:USD");
    expect(dependencyRoleOf(categoryEvent(" cat-1")).provides).toBe("CATEGORY: cat-1");
    expect(dependencyRoleOf(categoryEvent("cat-1")).provides).toBe("CATEGORY:cat-1");
  });
});

describe("createBatchDependencies()", () => {
  it("blocks a PRODUCT whose category already failed in this batch", () => {
    const dependencies = createBatchDependencies();
    dependencies.note(categoryEvent("cat-1"), "failed");

    expect(dependencies.blockedBy(productEvent("cat-1"))).toBe("CATEGORY:cat-1");
  });

  it("does not block a PRODUCT of a category that never failed", () => {
    const dependencies = createBatchDependencies();

    expect(dependencies.blockedBy(productEvent("cat-1"))).toBeNull();
  });

  // E11/E16 from the tracker's own point of view: distinct keys never block
  // each other.
  it("a failed CATEGORY never blocks an EXCHANGE_RATE of the same raw value", () => {
    const dependencies = createBatchDependencies();
    dependencies.note(categoryEvent("USD"), "failed");

    expect(dependencies.blockedBy(exchangeRateEvent("USD"))).toBeNull();
  });

  it("a failed CURRENCY of 'usd' never blocks an EXCHANGE_RATE of 'USD'", () => {
    const dependencies = createBatchDependencies();
    dependencies.note(currencyEvent("usd"), "failed");

    expect(dependencies.blockedBy(exchangeRateEvent("USD"))).toBeNull();
  });

  // R13/E17: a key repaired later in the same batch stops dragging.
  it.each(["processed", "stale"] as const)(
    "a category that later ends '%s' clears the block for products behind it",
    (status) => {
      const dependencies = createBatchDependencies();
      dependencies.note(categoryEvent("cat-1", "evt-1"), "failed");
      expect(dependencies.blockedBy(productEvent("cat-1"))).toBe("CATEGORY:cat-1");

      dependencies.note(categoryEvent("cat-1", "evt-2"), status);

      expect(dependencies.blockedBy(productEvent("cat-1"))).toBeNull();
    },
  );

  // R13 exception (plan.md paso 4b, PP5): a CATEGORY DELETE never proves the
  // row exists — it either removed it or found nothing (`handleCategory`'s
  // `if (!existing) return PROCESSED;`) — so it must NOT clear the block.
  it("a CATEGORY DELETE of a key that failed before does NOT clear the block", () => {
    const dependencies = createBatchDependencies();
    dependencies.note(categoryEvent("cat-1", "evt-1"), "failed");
    expect(dependencies.blockedBy(productEvent("cat-1"))).toBe("CATEGORY:cat-1");

    dependencies.note(categoryEvent("cat-1", "evt-2", "DELETE"), "processed");

    expect(dependencies.blockedBy(productEvent("cat-1"))).toBe("CATEGORY:cat-1");
  });

  // R13 exception, the other half: `handleCurrency` ignores `operation`
  // entirely and always `upsert`s, so after ANY CURRENCY event — including a
  // DELETE — the row genuinely exists and clearing stays correct.
  it("a CURRENCY DELETE of a key that failed before DOES clear the block", () => {
    const dependencies = createBatchDependencies();
    dependencies.note(currencyEvent("USD", "evt-1"), "failed");
    expect(dependencies.blockedBy(exchangeRateEvent("USD"))).toBe("CURRENCY:USD");

    dependencies.note(currencyEvent("USD", "evt-2", "DELETE"), "processed");

    expect(dependencies.blockedBy(exchangeRateEvent("USD"))).toBeNull();
  });

  // R13: "skipped_not_published" and "duplicate" neither confirm the row
  // exists nor that it is missing — they must not clear a real block.
  it.each(["skipped_not_published", "duplicate"] as const)(
    "'%s' does not clear a block that already failed",
    (status) => {
      const dependencies = createBatchDependencies();
      dependencies.note(categoryEvent("cat-1", "evt-1"), "failed");

      dependencies.note(categoryEvent("cat-1", "evt-2"), status);

      expect(dependencies.blockedBy(productEvent("cat-1"))).toBe("CATEGORY:cat-1");
    },
  );

  // R2: only an event whose OWN outcome is "failed" adds a key — noting a
  // success for an entity that never failed leaves the tracker untouched.
  it("noting a successful CATEGORY that never failed blocks nothing", () => {
    const dependencies = createBatchDependencies();
    dependencies.note(categoryEvent("cat-1"), "processed");

    expect(dependencies.blockedBy(productEvent("cat-1"))).toBeNull();
  });

  // R11: a PRODUCT or EXCHANGE_RATE never provides a key, so noting their
  // outcome — whatever it is — never starts blocking anything (no chain).
  it("noting a failed PRODUCT or EXCHANGE_RATE starts no new block", () => {
    const dependencies = createBatchDependencies();
    dependencies.note(productEvent("cat-1"), "failed");
    dependencies.note(exchangeRateEvent("USD"), "failed");

    expect(dependencies.blockedBy(productEvent("cat-1"))).toBeNull();
    expect(dependencies.blockedBy(exchangeRateEvent("USD"))).toBeNull();
  });
});
