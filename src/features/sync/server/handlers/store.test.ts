import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * HD10-HD15: fixes the semantics AP5/AP6 chose, so nobody "fixes" the
 * handler back into the bug it was written to avoid — a routine STORE event
 * (a phone number edit, say) silently reopening a store the admin closed
 * from the panel.
 */

const businessUpsert = vi.fn();
const storeFindUnique = vi.fn();
const storeUpdate = vi.fn();
const storeCreate = vi.fn();
const businessCount = vi.fn();
const storeCount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    business: {
      upsert: (...a: unknown[]) => businessUpsert(...a),
      count: (...a: unknown[]) => businessCount(...a),
    },
    store: {
      findUnique: (...a: unknown[]) => storeFindUnique(...a),
      update: (...a: unknown[]) => storeUpdate(...a),
      create: (...a: unknown[]) => storeCreate(...a),
      count: (...a: unknown[]) => storeCount(...a),
    },
  },
}));

const { handleStore } = await import("./store");

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

beforeEach(() => {
  businessUpsert.mockReset().mockResolvedValue({ id: "business-1" });
  storeFindUnique.mockReset();
  storeUpdate.mockReset().mockResolvedValue({ slug: "tienda-demo" });
  storeCreate.mockReset().mockResolvedValue({ slug: "tienda-demo" });
  businessCount.mockReset().mockResolvedValue(0);
  storeCount.mockReset().mockResolvedValue(0);
});

describe("handleStore() — stale-write guard (AP6)", () => {
  it("discards an event older than what is already stored", async () => {
    storeFindUnique.mockResolvedValue({
      id: "store-1",
      slug: "tienda-demo",
      sourceUpdatedAt: new Date("2026-08-27T12:00:00.000Z"),
      sourceOptIn: true,
    });

    const outcome = await handleStore(payload({ updatedAt: "2026-08-27T00:00:00.000Z" }), "UPDATE");

    expect(outcome.status).toBe("stale");
    expect(storeUpdate).not.toHaveBeenCalled();
  });

  it("applies an event newer than what is stored", async () => {
    storeFindUnique.mockResolvedValue({
      id: "store-1",
      slug: "tienda-demo",
      sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z"),
      sourceOptIn: true,
    });

    const outcome = await handleStore(payload({ updatedAt: "2026-08-27T00:00:00.000Z" }), "UPDATE");

    expect(outcome.status).toBe("processed");
    expect(storeUpdate).toHaveBeenCalledOnce();
  });
});

describe("handleStore() — opt-in-only writes (AP5, option b)", () => {
  it("a real opt-in flip to unpublish suspends and records the reason", async () => {
    storeFindUnique.mockResolvedValue({
      id: "store-1",
      slug: "tienda-demo",
      sourceUpdatedAt: null,
      sourceOptIn: true,
    });

    await handleStore(
      payload({ publishToStore: false, unpublishReason: "Cerrado por reformas" }),
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
    storeFindUnique.mockResolvedValue({
      id: "store-1",
      slug: "tienda-demo",
      sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z"),
      sourceOptIn: true,
    });

    await handleStore(payload({ publishToStore: true, phone: "+5350000099" }), "UPDATE");

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
    storeFindUnique.mockResolvedValue({
      id: "store-1",
      slug: "tienda-demo",
      sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z"),
      sourceOptIn: false,
    });

    await handleStore(payload({ publishToStore: true }), "UPDATE");

    const data = storeUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("PUBLISHED");
    expect(data.disabledReasonCode).toBeNull();
    expect(data.disabledMessage).toBeNull();
    expect(data.disabledAt).toBeNull();
    expect(data.sourceOptIn).toBe(true);
  });

  it("a repeated unpublish (opt-in already false) does not rewrite the reason", async () => {
    storeFindUnique.mockResolvedValue({
      id: "store-1",
      slug: "tienda-demo",
      sourceUpdatedAt: new Date("2026-08-20T00:00:00.000Z"),
      sourceOptIn: false,
    });

    await handleStore(payload({ publishToStore: false }), "UPDATE");

    const data = storeUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("disabledReasonCode");
  });

  it("DELETE is treated as an unpublish regardless of publishToStore", async () => {
    storeFindUnique.mockResolvedValue({
      id: "store-1",
      slug: "tienda-demo",
      sourceUpdatedAt: null,
      sourceOptIn: true,
    });

    await handleStore(payload({ publishToStore: true }), "DELETE");

    const data = storeUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("SUSPENDED");
    expect(data.sourceOptIn).toBe(false);
  });

  it("a brand-new store is created PUBLISHED with sourceOptIn true", async () => {
    storeFindUnique.mockResolvedValue(null);

    const outcome = await handleStore(payload(), "CREATE");

    expect(outcome.status).toBe("processed");
    const data = storeCreate.mock.calls[0][0].data;
    expect(data.status).toBe("PUBLISHED");
    expect(data.sourceOptIn).toBe(true);
  });

  it("DELETE with no existing row is skipped, not an error", async () => {
    storeFindUnique.mockResolvedValue(null);

    const outcome = await handleStore(payload(), "DELETE");

    expect(outcome.status).toBe("skipped_not_published");
    expect(storeUpdate).not.toHaveBeenCalled();
  });
});
