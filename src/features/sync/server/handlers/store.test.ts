import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * HD10-HD15: fixes the semantics AP5/AP6 chose, so nobody "fixes" the
 * handler back into the bug it was written to avoid — a routine STORE event
 * (a phone number edit, say) silently reopening a store the admin closed
 * from the panel.
 *
 * F-017: `existing` now carries its brand (`storefront: { slug, stores }`),
 * because `touchedStoreSlug`/`touchedBrandSlug` are computed from it, and a
 * brand-new store (`!existing`) is created through the registry
 * (`createStorefrontWithStore`), which is why `prisma.storefront.create` and
 * `prisma.slug.findUnique` are mocked here too — the SAME `@/lib/prisma`
 * module `registry.ts` imports.
 *
 * F-018 (R8, E16): the handler no longer `upsert`s a `Business` from the
 * payload — it only `update`s the one the caller already authenticated as
 * (`businessId`, third argument). `existing` also carries its own
 * `businessId`, so a store that belongs to someone else is skipped, never
 * touched (same rule product.ts already applies).
 */

const businessUpdate = vi.fn();
const storeFindUnique = vi.fn();
const storeUpdate = vi.fn();
const storefrontCreate = vi.fn();
const slugFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    business: {
      update: (...a: unknown[]) => businessUpdate(...a),
    },
    store: {
      findUnique: (...a: unknown[]) => storeFindUnique(...a),
      update: (...a: unknown[]) => storeUpdate(...a),
    },
    storefront: {
      create: (...a: unknown[]) => storefrontCreate(...a),
    },
    slug: {
      findUnique: (...a: unknown[]) => slugFindUnique(...a),
    },
  },
}));

const { handleStore } = await import("./store");
const { SyncEventFailure } = await import("./types");
const { STORE_DELIVERY_CONFIG_INCONSISTENT, STORE_OPENING_HOURS_INVALID, STORE_TIMEZONE_INVALID } =
  await import("@/constants/sync");

const BUSINESS_ID = "business-1";

/** An `existing` row the way the handler's own select shapes it — a single
 *  branch of a single-branch brand owned by `BUSINESS_ID`, unless the test
 *  says otherwise. */
function existingStore(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "store-1",
    slug: null,
    sourceUpdatedAt: null,
    sourceOptIn: true,
    businessId: BUSINESS_ID,
    // F-032: the row's own purchase config, read by the R8 guard's
    // "effective value" (R7) whenever the payload only touches PART of the
    // triad. Defaults mirror the column's own `@default(...)`s.
    deliveryEnabled: false,
    deliveryFeeMode: "FLAT_RATE",
    deliveryFee: null,
    storefront: { slug: "tienda-demo", stores: [{ id: "store-1" }] },
    ...overrides,
  };
}

function payload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    storeId: "seed-tienda-1",
    businessId: "seed-negocio-1",
    businessName: "La Rampa",
    name: "La Rampa · Vedado",
    slug: "tienda-demo",
    publishToStore: true,
    baseCurrency: "CUP",
    updatedAt: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

function callHandleStore(
  overrides: Partial<Record<string, unknown>> = {},
  operation: "CREATE" | "UPDATE" | "DELETE" = "UPDATE",
  businessId = BUSINESS_ID,
) {
  return handleStore(payload(overrides), operation, businessId);
}

beforeEach(() => {
  businessUpdate.mockReset().mockResolvedValue({ id: BUSINESS_ID });
  storeFindUnique.mockReset();
  storeUpdate.mockReset().mockResolvedValue({ slug: "tienda-demo" });
  storefrontCreate.mockReset();
  slugFindUnique.mockReset().mockResolvedValue(null);
});

describe("handleStore() — stale-write guard (AP6)", () => {
  it("discards an event older than what is already stored", async () => {
    storeFindUnique.mockResolvedValue(
      existingStore({ sourceUpdatedAt: new Date("2026-08-27T12:00:00.000Z") }),
    );

    const outcome = await callHandleStore({ updatedAt: "2026-08-27T00:00:00.000Z" }, "UPDATE");

    expect(outcome.status).toBe("stale");
    expect(storeUpdate).not.toHaveBeenCalled();
  });

  it("applies an event newer than what is stored", async () => {
    storeFindUnique.mockResolvedValue(
      existingStore({ sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z") }),
    );

    const outcome = await callHandleStore({ updatedAt: "2026-08-27T00:00:00.000Z" }, "UPDATE");

    expect(outcome.status).toBe("processed");
    expect(outcome.touchedStoreSlug).toBe("tienda-demo");
    expect(outcome.touchedBrandSlug).toBe("tienda-demo");
    expect(storeUpdate).toHaveBeenCalledOnce();
  });
});

describe("handleStore() — el negocio nunca se crea (R8, E16)", () => {
  it("solo actualiza el Business autenticado, nunca hace upsert", async () => {
    storeFindUnique.mockResolvedValue(existingStore());

    await callHandleStore({ updatedAt: "2026-08-27T00:00:00.000Z" }, "UPDATE");

    expect(businessUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: BUSINESS_ID } }),
    );
  });

  it("una tienda que pertenece a otro negocio se salta, no se toca (R1, R6)", async () => {
    storeFindUnique.mockResolvedValue(existingStore({ businessId: "otro-negocio" }));

    const outcome = await callHandleStore(
      { updatedAt: "2026-08-27T00:00:00.000Z" },
      "UPDATE",
      BUSINESS_ID,
    );

    expect(outcome.status).toBe("skipped_not_published");
    expect(storeUpdate).not.toHaveBeenCalled();
  });
});

describe("handleStore() — opt-in-only writes (AP5, option b)", () => {
  it("a real opt-in flip to unpublish suspends and records the reason", async () => {
    storeFindUnique.mockResolvedValue(existingStore({ sourceUpdatedAt: null, sourceOptIn: true }));

    await callHandleStore(
      { publishToStore: false, unpublishReason: "Cerrado por reformas" },
      "UPDATE",
    );

    const data = storeUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("SUSPENDED");
    expect(data.disabledReasonCode).toBeNull();
    expect(data.disabledMessage).toBe("Cerrado por reformas");
    expect(data.sourceOptIn).toBe(false);
  });

  it("a routine edit with the SAME publishToStore does not touch status or the disabled columns", async () => {
    // Exactly the scenario AP5 exists for: the admin closed this store from
    // the panel (VACATION), sourceOptIn never changed because the panel
    // does not own that column, and now the POS sends an unrelated edit.
    storeFindUnique.mockResolvedValue(
      existingStore({ sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z"), sourceOptIn: true }),
    );

    await callHandleStore({ publishToStore: true, phone: "+5350000099" }, "UPDATE");

    const data = storeUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("disabledReasonCode");
    expect(data).not.toHaveProperty("disabledMessage");
    expect(data).not.toHaveProperty("disabledAt");
    expect(data).not.toHaveProperty("publishedAt");
    // The sync-owned fields still update.
    expect(data.phone).toBe("+5350000099");
    expect(data.sourceOptIn).toBe(true);
  });

  it("a real opt-in flip to publish clears the disabled columns", async () => {
    // F-022 R12: the gate now reads `existing.timezone` on this path — a
    // canonical value here is what lets the flip through, exercising the
    // gate rather than bypassing it (impl.md § Qué necesita quien pruebe).
    storeFindUnique.mockResolvedValue(
      existingStore({
        sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z"),
        sourceOptIn: false,
        timezone: "America/Havana",
      }),
    );

    await callHandleStore({ publishToStore: true }, "UPDATE");

    const data = storeUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("PUBLISHED");
    expect(data.disabledReasonCode).toBeNull();
    expect(data.disabledMessage).toBeNull();
    expect(data.disabledAt).toBeNull();
    expect(data.sourceOptIn).toBe(true);
  });

  it("a repeated unpublish (opt-in already false) does not rewrite the reason", async () => {
    storeFindUnique.mockResolvedValue(
      existingStore({ sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z"), sourceOptIn: false }),
    );

    await callHandleStore({ publishToStore: false }, "UPDATE");

    const data = storeUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("disabledReasonCode");
  });

  it("R12: a real opt-in flip to publish with an unreadable existing.timezone fails, and never writes", async () => {
    storeFindUnique.mockResolvedValue(
      existingStore({
        sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z"),
        sourceOptIn: false,
        timezone: "Nowhere/Nothing",
      }),
    );

    await expect(callHandleStore({ publishToStore: true }, "UPDATE")).rejects.toThrow(
      SyncEventFailure,
    );
    await expect(callHandleStore({ publishToStore: true }, "UPDATE")).rejects.toThrow(
      STORE_TIMEZONE_INVALID,
    );
    expect(storeUpdate).not.toHaveBeenCalled();
  });

  it("R12: a ROUTINE event (opt-in unchanged) on a store with an unreadable timezone does NOT fail — the gate only guards an actual flip to PUBLISHED", async () => {
    storeFindUnique.mockResolvedValue(
      existingStore({
        sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z"),
        sourceOptIn: true,
        timezone: "Nowhere/Nothing",
      }),
    );

    await callHandleStore({ publishToStore: true, phone: "+5350000099" }, "UPDATE");

    const data = storeUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("status");
    expect(data.phone).toBe("+5350000099");
  });

  it("DELETE is treated as an unpublish regardless of publishToStore", async () => {
    storeFindUnique.mockResolvedValue(existingStore({ sourceUpdatedAt: null, sourceOptIn: true }));

    await callHandleStore({ publishToStore: true }, "DELETE");

    const data = storeUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("SUSPENDED");
    expect(data.sourceOptIn).toBe(false);
  });

  it("a brand-new store creates its brand in the SAME event (E9), PUBLISHED, sourceOptIn true", async () => {
    storeFindUnique.mockResolvedValue(null);
    storefrontCreate.mockResolvedValue({
      id: "storefront-1",
      slug: "tienda-demo",
      stores: [{ id: "store-1" }],
    });

    const outcome = await callHandleStore({}, "CREATE");

    expect(outcome.status).toBe("processed");
    expect(outcome.touchedStoreSlug).toBe("tienda-demo");
    expect(outcome.touchedBrandSlug).toBe("tienda-demo");
    const call = storefrontCreate.mock.calls[0][0];
    expect(call.data.slug).toBe("tienda-demo");
    expect(call.data.stores.create.status).toBe("PUBLISHED");
    expect(call.data.stores.create.sourceOptIn).toBe(true);
  });

  it("DELETE with no existing row is skipped, not an error", async () => {
    storeFindUnique.mockResolvedValue(null);

    const outcome = await callHandleStore({}, "DELETE");

    expect(outcome.status).toBe("skipped_not_published");
    expect(storeUpdate).not.toHaveBeenCalled();
  });
});

describe("handleStore() — F-022 E10/SP3: a malformed openingHours fails the WHOLE event, before any write", () => {
  it("rejects a calendar missing a day key and writes nothing — not even name/phone in the SAME event", async () => {
    storeFindUnique.mockResolvedValue(
      existingStore({ sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z") }),
    );
    const malformed = {
      version: 1,
      days: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] },
    };

    await expect(
      callHandleStore(
        { openingHours: malformed, phone: "+5350000099", updatedAt: "2026-08-27T00:00:00.000Z" },
        "UPDATE",
      ),
    ).rejects.toThrow(SyncEventFailure);
    await expect(
      callHandleStore(
        { openingHours: malformed, phone: "+5350000099", updatedAt: "2026-08-27T00:00:00.000Z" },
        "UPDATE",
      ),
    ).rejects.toThrow(STORE_OPENING_HOURS_INVALID);
    expect(storeUpdate).not.toHaveBeenCalled();
  });

  it("caso límite 9: an ABSENT openingHours is not an error — the column stays untouched", async () => {
    storeFindUnique.mockResolvedValue(
      existingStore({ sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z") }),
    );

    const outcome = await callHandleStore({ updatedAt: "2026-08-27T00:00:00.000Z" }, "UPDATE");

    expect(outcome.status).toBe("processed");
    const data = storeUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("openingHours");
  });

  it("a WELL-FORMED openingHours is applied as-is", async () => {
    storeFindUnique.mockResolvedValue(
      existingStore({ sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z") }),
    );
    const valid = {
      version: 1,
      days: {
        mon: [{ from: "09:00", to: "18:00" }],
        tue: [],
        wed: [],
        thu: [],
        fri: [],
        sat: [],
        sun: [],
      },
    };

    await callHandleStore({ openingHours: valid, updatedAt: "2026-08-27T00:00:00.000Z" }, "UPDATE");

    const data = storeUpdate.mock.calls[0][0].data;
    expect(data.openingHours).toEqual(valid);
  });

  it("E11: a timezone key riding in the payload never reaches the update's data — timezone is the panel's alone", async () => {
    storeFindUnique.mockResolvedValue(
      existingStore({ sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z") }),
    );

    await callHandleStore(
      { timezone: "Europe/Madrid", updatedAt: "2026-08-27T00:00:00.000Z" } as never,
      "UPDATE",
    );

    const data = storeUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("timezone");
  });
});

describe("handleStore() — F-017 ALTA #3 (tests.md § Fallos encontrados #3): a routine sync update in a multi-branch brand reports the brand + every sibling", () => {
  it("a routine name/city edit on one branch of a two-branch brand reports the brand's own slug AND the sibling's own slug", async () => {
    storeFindUnique.mockResolvedValue(
      existingStore({
        slug: "bodega-dos",
        sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z"),
        storefront: {
          slug: "bodega-uno",
          stores: [
            { id: "store-1", slug: "bodega-uno-2" },
            { id: "store-2", slug: "bodega-dos" },
          ],
        },
      }),
    );
    storeUpdate.mockResolvedValue({ slug: "bodega-dos" });

    const outcome = await callHandleStore(
      {
        updatedAt: "2026-08-27T00:00:00.000Z",
        name: "Bodega Dos RENOMBRADA",
        city: "Nueva ciudad",
      },
      "UPDATE",
    );

    expect(outcome.status).toBe("processed");
    expect(outcome.touchedStoreSlug).toBe("bodega-dos");
    // The MISSING piece before this fix: the brand's own slug (the
    // selector every visitor of `/bodega-uno` reads) and the sibling's own
    // slug (`/bodega-uno-2/sucursales`) — neither has a `Slug`/`Store` row
    // written FOR IT by this event, so nothing else would ever bust their
    // cached resolution.
    expect(outcome.touchedSlugValues).toEqual(["bodega-uno", "bodega-uno-2", "bodega-dos"]);
  });

  it("the same routine edit while UNPUBLISHING (opt-out branch) also reports the brand + sibling", async () => {
    storeFindUnique.mockResolvedValue(
      existingStore({
        slug: "bodega-dos",
        sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z"),
        storefront: {
          slug: "bodega-uno",
          stores: [
            { id: "store-1", slug: "bodega-uno-2" },
            { id: "store-2", slug: "bodega-dos" },
          ],
        },
      }),
    );

    const outcome = await callHandleStore({ publishToStore: false }, "UPDATE");

    expect(outcome.status).toBe("processed");
    expect(outcome.touchedSlugValues).toEqual(["bodega-uno", "bodega-uno-2", "bodega-dos"]);
  });

  it("does not report touchedSlugValues when the brand has a single branch — nothing about a selector exists to go stale", async () => {
    storeFindUnique.mockResolvedValue(
      existingStore({ sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z") }),
    );

    const outcome = await callHandleStore({ updatedAt: "2026-08-27T00:00:00.000Z" }, "UPDATE");

    expect(outcome.touchedSlugValues).toBeUndefined();
  });
});

describe("handleStore() — F-032: la configuración de compra viaja con la fila (criterio 15)", () => {
  it("E1: an event with none of the five keys does not include any of them in the update's data", async () => {
    storeFindUnique.mockResolvedValue(
      existingStore({
        sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z"),
        checkoutMode: "ONSITE",
        deliveryEnabled: true,
        deliveryFeeMode: "QUOTED_PER_ORDER",
        deliveryFee: "500.00",
      }),
    );

    const outcome = await callHandleStore({ updatedAt: "2026-08-27T00:00:00.000Z" }, "UPDATE");

    expect(outcome.status).toBe("processed");
    const data = storeUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("checkoutMode");
    expect(data).not.toHaveProperty("deliveryEnabled");
    expect(data).not.toHaveProperty("deliveryFee");
    expect(data).not.toHaveProperty("deliveryFeeMode");
    expect(data).not.toHaveProperty("orderExpiryHours");
  });

  it("E3: an event with only deliveryFee changes only that key", async () => {
    storeFindUnique.mockResolvedValue(
      existingStore({ sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z") }),
    );

    await callHandleStore({ updatedAt: "2026-08-27T00:00:00.000Z", deliveryFee: 300 }, "UPDATE");

    const data = storeUpdate.mock.calls[0][0].data;
    expect(data.deliveryFee).toBe(300);
    expect(data).not.toHaveProperty("checkoutMode");
    expect(data).not.toHaveProperty("deliveryEnabled");
    expect(data).not.toHaveProperty("deliveryFeeMode");
    expect(data).not.toHaveProperty("orderExpiryHours");
  });

  it("E8: a payload that is only contradictory once mixed with the row throws SyncEventFailure and writes nothing", async () => {
    // The row is already FLAT_RATE with no fee on file; the payload only
    // sends deliveryEnabled: true (`--store-config=enable-only`) — a `refine`
    // over the payload alone could never see this.
    storeFindUnique.mockResolvedValue(
      existingStore({
        sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z"),
        deliveryEnabled: false,
        deliveryFeeMode: "FLAT_RATE",
        deliveryFee: null,
      }),
    );

    await expect(
      callHandleStore({ updatedAt: "2026-08-27T00:00:00.000Z", deliveryEnabled: true }, "UPDATE"),
    ).rejects.toThrow(SyncEventFailure);
    await expect(
      callHandleStore({ updatedAt: "2026-08-27T00:00:00.000Z", deliveryEnabled: true }, "UPDATE"),
    ).rejects.toThrow(STORE_DELIVERY_CONFIG_INCONSISTENT);
    expect(storeUpdate).not.toHaveBeenCalled();
  });

  it("E9: a stale event stays stale even when contradictory — anti-rancio guard runs BEFORE the consistency guard", async () => {
    storeFindUnique.mockResolvedValue(
      existingStore({ sourceUpdatedAt: new Date("2026-08-27T12:00:00.000Z") }),
    );

    const outcome = await callHandleStore(
      { updatedAt: "2026-08-27T00:00:00.000Z", deliveryEnabled: true },
      "UPDATE",
    );

    expect(outcome.status).toBe("stale");
    expect(storeUpdate).not.toHaveBeenCalled();
  });

  it("E10: an event that unpublishes also configures — the five apply on the suspend path too", async () => {
    storeFindUnique.mockResolvedValue(existingStore({ sourceUpdatedAt: null, sourceOptIn: true }));

    await callHandleStore(
      { publishToStore: false, deliveryEnabled: true, deliveryFeeMode: "QUOTED_PER_ORDER" },
      "UPDATE",
    );

    const data = storeUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("SUSPENDED");
    expect(data.deliveryEnabled).toBe(true);
    expect(data.deliveryFeeMode).toBe("QUOTED_PER_ORDER");
  });

  it("E11: a DELETE never writes any of the five, even when the payload carries them", async () => {
    storeFindUnique.mockResolvedValue(existingStore({ sourceUpdatedAt: null, sourceOptIn: true }));

    await callHandleStore(
      { publishToStore: true, deliveryEnabled: true, deliveryFeeMode: "QUOTED_PER_ORDER" },
      "DELETE",
    );

    const data = storeUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("SUSPENDED");
    expect(data).not.toHaveProperty("deliveryEnabled");
    expect(data).not.toHaveProperty("deliveryFeeMode");
  });

  it("E13: a brand-new store is created with the payload's keys, checked against the column DEFAULTS", async () => {
    storeFindUnique.mockResolvedValue(null);
    storefrontCreate.mockResolvedValue({
      id: "storefront-1",
      slug: "tienda-demo",
      stores: [{ id: "store-1" }],
    });

    const outcome = await callHandleStore({ deliveryFeeMode: "QUOTED_PER_ORDER" }, "CREATE");

    expect(outcome.status).toBe("processed");
    const call = storefrontCreate.mock.calls[0][0];
    expect(call.data.stores.create.deliveryFeeMode).toBe("QUOTED_PER_ORDER");
  });

  it("E13: a brand-new store whose payload alone would violate R8 against the defaults throws", async () => {
    storeFindUnique.mockResolvedValue(null);

    await expect(callHandleStore({ deliveryEnabled: true }, "CREATE")).rejects.toThrow(
      SyncEventFailure,
    );
    expect(storefrontCreate).not.toHaveBeenCalled();
  });
});
