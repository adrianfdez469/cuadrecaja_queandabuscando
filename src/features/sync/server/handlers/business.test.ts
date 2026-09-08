import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-038 AD3/AD6: the handler with Prisma mocked by method. Covers the ORDER
 * of R5 (DELETE and a malformed member never call `updateMany`, both
 * `console.warn` and never `console.error`), that `count: 0` means `STALE`
 * and `count: 1` means `PROCESSED` pelado, that the `where` goes by
 * `businessId` (the caller's uuid, R11) and never by `payload.businessId`,
 * and that neither `Currency` nor `ExchangeRate` is ever touched (R9). No
 * Postgres here — the thirteen scenarios against a real row live in
 * `business.db.test.ts` (sdd-tester).
 */

const businessUpdateMany = vi.fn();
const currencyFindUnique = vi.fn();
const exchangeRateFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    business: {
      updateMany: (...a: unknown[]) => businessUpdateMany(...a),
    },
    currency: {
      findUnique: (...a: unknown[]) => currencyFindUnique(...a),
    },
    exchangeRate: {
      findMany: (...a: unknown[]) => exchangeRateFindMany(...a),
    },
  },
}));

const { handleBusiness } = await import("./business");
const { SyncEventFailure } = await import("./types");
const { BUSINESS_DELETE_NOT_SUPPORTED, BUSINESS_DISPLAY_CURRENCIES_INVALID } =
  await import("@/constants/sync");

const BUSINESS_ID = "business-1";

beforeEach(() => {
  businessUpdateMany.mockReset();
  currencyFindUnique.mockReset();
  exchangeRateFindMany.mockReset();
});

function payload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    businessId: "seed-negocio-1",
    displayCurrencies: ["CUP", "USD", "EUR"],
    updatedAt: "2026-09-06T14:03:00.000Z",
    ...overrides,
  };
}

describe("handleBusiness() — R5 order", () => {
  it("a DELETE fails with BUSINESS_DELETE_NOT_SUPPORTED WITHOUT calling updateMany even once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(handleBusiness(payload(), "DELETE", BUSINESS_ID)).rejects.toThrow(
      new SyncEventFailure(BUSINESS_DELETE_NOT_SUPPORTED).message,
    );
    expect(businessUpdateMany).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    warn.mockRestore();
    error.mockRestore();
  });

  it("a DELETE fails BEFORE the stale guard even runs (E6) — never STALE", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      handleBusiness(payload({ updatedAt: "2000-01-01T00:00:00.000Z" }), "DELETE", BUSINESS_ID),
    ).rejects.toThrow(BUSINESS_DELETE_NOT_SUPPORTED);
    expect(businessUpdateMany).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("a malformed member fails with BUSINESS_DISPLAY_CURRENCIES_INVALID WITHOUT calling updateMany even once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      handleBusiness(payload({ displayCurrencies: ["CUP", "usd"] }), "UPDATE", BUSINESS_ID),
    ).rejects.toThrow(new SyncEventFailure(BUSINESS_DISPLAY_CURRENCIES_INVALID).message);
    expect(businessUpdateMany).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    warn.mockRestore();
    error.mockRestore();
  });

  it("DELETE takes priority over a malformed member (R5 order: 1 before 2)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      handleBusiness(payload({ displayCurrencies: ["usd"] }), "DELETE", BUSINESS_ID),
    ).rejects.toThrow(BUSINESS_DELETE_NOT_SUPPORTED);
    vi.restoreAllMocks();
  });
});

describe("handleBusiness() — the write", () => {
  it("count: 0 means STALE and does not log anything", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    businessUpdateMany.mockResolvedValueOnce({ count: 0 });

    const outcome = await handleBusiness(payload(), "UPDATE", BUSINESS_ID);

    expect(outcome).toEqual({ status: "stale" });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("count: 1 means PROCESSED pelado — no touched* field of any kind (R13)", async () => {
    businessUpdateMany.mockResolvedValueOnce({ count: 1 });

    const outcome = await handleBusiness(payload(), "UPDATE", BUSINESS_ID);

    expect(outcome).toEqual({ status: "processed" });
  });

  it("the where goes by the caller's businessId (third argument), never payload.businessId (R11)", async () => {
    businessUpdateMany.mockResolvedValueOnce({ count: 1 });

    await handleBusiness(payload({ businessId: "some-other-external-id" }), "UPDATE", BUSINESS_ID);

    const call = businessUpdateMany.mock.calls[0][0];
    expect(call.where.id).toBe(BUSINESS_ID);
  });

  it("writes the deduplicated list and the payload's updatedAt as the mark", async () => {
    businessUpdateMany.mockResolvedValueOnce({ count: 1 });

    await handleBusiness(
      payload({ displayCurrencies: ["CUP", "USD", "CUP"] }),
      "UPDATE",
      BUSINESS_ID,
    );

    const call = businessUpdateMany.mock.calls[0][0];
    expect(call.data.displayCurrencies).toEqual({ set: ["CUP", "USD"] });
    expect(call.data.displayCurrenciesSourceUpdatedAt).toEqual(
      new Date("2026-09-06T14:03:00.000Z"),
    );
  });

  it("CREATE and UPDATE behave identically (E18)", async () => {
    businessUpdateMany.mockResolvedValueOnce({ count: 1 });
    const outcomeCreate = await handleBusiness(payload(), "CREATE", BUSINESS_ID);
    businessUpdateMany.mockResolvedValueOnce({ count: 1 });
    const outcomeUpdate = await handleBusiness(payload(), "UPDATE", BUSINESS_ID);

    expect(outcomeCreate).toEqual(outcomeUpdate);
  });

  it("never touches Currency or ExchangeRate (R9)", async () => {
    businessUpdateMany.mockResolvedValueOnce({ count: 1 });

    await handleBusiness(payload(), "UPDATE", BUSINESS_ID);

    expect(currencyFindUnique).not.toHaveBeenCalled();
    expect(exchangeRateFindMany).not.toHaveBeenCalled();
  });
});
