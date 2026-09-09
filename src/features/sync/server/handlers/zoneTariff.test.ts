import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-041 — the handler with Prisma mocked by method (architecture.md §
 * Componentes, fila `zoneTariff.test.ts`). Covers the ORDER of R20/R21/R24:
 * a `DELETE` never reaches `store.findUnique` (R20, precedent
 * `business.test.ts`'s `BUSINESS_DELETE_NOT_SUPPORTED`), a store that does
 * not exist or belongs to another business never reaches `zoneTariff.upsert`
 * (R24, precedent `handleProduct`), and the anti-stale guard rejects `>=`
 * (R21) — both halves, including the `==` one everyone forgets. Real
 * Postgres scenarios (C2, C4, C5, C6, C12) live in `zoneTariff.db.test.ts`.
 *
 * `@/features/zones/catalog` is NOT mocked here: it is a pure, side-effect-
 * free module (a static JSON import), so letting the real `isRetiredZone`
 * run costs nothing and keeps this file about the HANDLER's own order, not
 * about a second copy of the catalog's behaviour — `boundaries.test.ts`
 * does not need to know about this file for that reason (it never imports
 * `@/features/zones/catalog` itself).
 */

const storeFindUnique = vi.fn();
const zoneTariffUpsert = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findUnique: (...a: unknown[]) => storeFindUnique(...a) },
    zoneTariff: { upsert: (...a: unknown[]) => zoneTariffUpsert(...a) },
  },
}));

const { handleZoneTariff } = await import("./zoneTariff");
const { SyncEventFailure } = await import("./types");
const { ZONE_TARIFF_DELETE_NOT_SUPPORTED } = await import("@/constants/sync");

const BUSINESS_ID = "business-1";
// A real, non-retired code from the committed artefact (R21: Sandino,
// municipality of Pinar del Río) — using a real code here means this file
// never has to reimplement anything about the catalog itself.
const ZONE_CODE = "21.01";

function payload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    storeId: "ext-store-1",
    zoneCode: ZONE_CODE,
    rule: "FEE" as const,
    deliveryFee: 300,
    updatedAt: "2026-09-08T14:03:00.000Z",
    ...overrides,
  };
}

function storeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "store-1",
    businessId: BUSINESS_ID,
    slug: "tienda-1",
    storefront: {
      slug: "marca-1",
      // brandBranchCount = 1 -> canonicalSlug() returns the BRAND's slug
      // (`src/lib/publicSlug.ts`), not the branch's own — this fixture is
      // a single-branch brand on purpose, the common case.
      stores: [{ id: "store-1", slug: "tienda-1" }],
    },
    zoneTariffs: [] as { sourceUpdatedAt: Date }[],
    ...overrides,
  };
}

beforeEach(() => {
  storeFindUnique.mockReset();
  zoneTariffUpsert.mockReset();
});

describe("handleZoneTariff() — R20: DELETE rejected FIRST, before any query", () => {
  it("a DELETE fails with ZONE_TARIFF_DELETE_NOT_SUPPORTED without calling store.findUnique even once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(handleZoneTariff(payload(), "DELETE", BUSINESS_ID)).rejects.toThrow(
      new SyncEventFailure(ZONE_TARIFF_DELETE_NOT_SUPPORTED).message,
    );
    expect(storeFindUnique).not.toHaveBeenCalled();
    expect(zoneTariffUpsert).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    warn.mockRestore();
    error.mockRestore();
  });

  it("a DELETE with a RANCID updatedAt still fails as DELETE_NOT_SUPPORTED, never stale (E5 — a format error cannot depend on a timestamp)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      handleZoneTariff(payload({ updatedAt: "2000-01-01T00:00:00.000Z" }), "DELETE", BUSINESS_ID),
    ).rejects.toThrow(ZONE_TARIFF_DELETE_NOT_SUPPORTED);
    expect(storeFindUnique).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});

describe("handleZoneTariff() — the branch lookup (R24)", () => {
  it("looks the store up by its externalId (payload.storeId), scoped to nothing else", async () => {
    storeFindUnique.mockResolvedValueOnce(storeRow());
    zoneTariffUpsert.mockResolvedValueOnce({});

    await handleZoneTariff(payload({ storeId: "ext-store-9" }), "UPDATE", BUSINESS_ID);

    expect(storeFindUnique.mock.calls[0][0].where).toEqual({ externalId: "ext-store-9" });
  });

  it("returns SKIPPED (skipped_not_published) when the store does not exist, without ever upserting", async () => {
    storeFindUnique.mockResolvedValueOnce(null);

    const outcome = await handleZoneTariff(payload(), "UPDATE", BUSINESS_ID);

    expect(outcome).toEqual({ status: "skipped_not_published" });
    expect(zoneTariffUpsert).not.toHaveBeenCalled();
  });

  it("returns SKIPPED when the store belongs to a DIFFERENT business, without ever upserting", async () => {
    storeFindUnique.mockResolvedValueOnce(storeRow({ businessId: "someone-elses-business" }));

    const outcome = await handleZoneTariff(payload(), "UPDATE", BUSINESS_ID);

    expect(outcome).toEqual({ status: "skipped_not_published" });
    expect(zoneTariffUpsert).not.toHaveBeenCalled();
  });
});

describe("handleZoneTariff() — R21: the guard that REJECTS, by (storeId, zoneCode)", () => {
  it("STALE when the existing row's sourceUpdatedAt is STRICTLY GREATER — never writes", async () => {
    storeFindUnique.mockResolvedValueOnce(
      storeRow({ zoneTariffs: [{ sourceUpdatedAt: new Date("2026-09-08T15:00:00.000Z") }] }),
    );

    const outcome = await handleZoneTariff(
      payload({ updatedAt: "2026-09-08T14:00:00.000Z" }),
      "UPDATE",
      BUSINESS_ID,
    );

    expect(outcome).toEqual({ status: "stale" });
    expect(zoneTariffUpsert).not.toHaveBeenCalled();
  });

  it("STALE when the marks are EXACTLY EQUAL — the half of R21's '>=' everyone forgets", async () => {
    storeFindUnique.mockResolvedValueOnce(
      storeRow({ zoneTariffs: [{ sourceUpdatedAt: new Date("2026-09-08T14:03:00.000Z") }] }),
    );

    const outcome = await handleZoneTariff(
      payload({ updatedAt: "2026-09-08T14:03:00.000Z" }),
      "UPDATE",
      BUSINESS_ID,
    );

    expect(outcome).toEqual({ status: "stale" });
    expect(zoneTariffUpsert).not.toHaveBeenCalled();
  });

  it("processes and upserts when the existing mark is strictly OLDER", async () => {
    storeFindUnique.mockResolvedValueOnce(
      storeRow({ zoneTariffs: [{ sourceUpdatedAt: new Date("2000-01-01T00:00:00.000Z") }] }),
    );
    zoneTariffUpsert.mockResolvedValueOnce({});

    const outcome = await handleZoneTariff(payload(), "UPDATE", BUSINESS_ID);

    expect(outcome).toEqual({ status: "processed", touchedStoreSlug: "marca-1" });
    expect(zoneTariffUpsert).toHaveBeenCalledOnce();
  });

  it("a brand-new (storeId, zoneCode) pair with NO existing row always processes (there is nothing to be stale against)", async () => {
    storeFindUnique.mockResolvedValueOnce(storeRow({ zoneTariffs: [] }));
    zoneTariffUpsert.mockResolvedValueOnce({});

    const outcome = await handleZoneTariff(payload(), "UPDATE", BUSINESS_ID);

    expect(outcome).toEqual({ status: "processed", touchedStoreSlug: "marca-1" });
  });
});

describe("handleZoneTariff() — the write (R15/R20)", () => {
  it("CREATE and UPDATE behave identically", async () => {
    storeFindUnique.mockResolvedValue(storeRow());
    zoneTariffUpsert.mockResolvedValue({});

    const created = await handleZoneTariff(payload(), "CREATE", BUSINESS_ID);
    const updated = await handleZoneTariff(payload(), "UPDATE", BUSINESS_ID);

    expect(created).toEqual(updated);
  });

  it("writes the numeric deliveryFee as-is for FEE, at the (storeId, zoneCode) primary key", async () => {
    storeFindUnique.mockResolvedValueOnce(storeRow());
    zoneTariffUpsert.mockResolvedValueOnce({});

    await handleZoneTariff(payload({ deliveryFee: 300 }), "UPDATE", BUSINESS_ID);

    const call = zoneTariffUpsert.mock.calls[0][0];
    expect(call.where).toEqual({
      storeId_zoneCode: { storeId: "store-1", zoneCode: ZONE_CODE },
    });
    expect(call.create.deliveryFee).toBe(300);
    expect(call.update.deliveryFee).toBe(300);
    expect(call.create.rule).toBe("FEE");
  });

  it("writes NULL deliveryFee for INHERIT/NOT_SERVED — R20's only mechanism of retraction", async () => {
    storeFindUnique.mockResolvedValueOnce(storeRow());
    zoneTariffUpsert.mockResolvedValueOnce({});

    await handleZoneTariff(
      {
        storeId: "ext-store-1",
        zoneCode: ZONE_CODE,
        rule: "INHERIT",
        updatedAt: payload().updatedAt,
      },
      "UPDATE",
      BUSINESS_ID,
    );

    const call = zoneTariffUpsert.mock.calls[0][0];
    expect(call.create.deliveryFee).toBeNull();
    expect(call.update.deliveryFee).toBeNull();
    expect(call.create.rule).toBe("INHERIT");
  });

  it("writes sourceUpdatedAt as the payload's own updatedAt, as a Date", async () => {
    storeFindUnique.mockResolvedValueOnce(storeRow());
    zoneTariffUpsert.mockResolvedValueOnce({});

    await handleZoneTariff(payload(), "UPDATE", BUSINESS_ID);

    const call = zoneTariffUpsert.mock.calls[0][0];
    expect(call.create.sourceUpdatedAt).toEqual(new Date("2026-09-08T14:03:00.000Z"));
    expect(call.update.sourceUpdatedAt).toEqual(new Date("2026-09-08T14:03:00.000Z"));
  });
});
