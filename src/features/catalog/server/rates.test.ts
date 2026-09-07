import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => queryRaw(...args) },
}));

const { buildCurrentRatesSql, loadCurrentRates } = await import("./rates");

beforeEach(() => {
  queryRaw.mockReset();
});

/** Stands in for `Prisma.Decimal` — `loadCurrentRates` only ever calls
 *  `.toString()` on `rate`, exactly what `findMany`'s own Decimal gave it. */
function decimal(value: string) {
  return { toString: () => value };
}

describe("buildCurrentRatesSql() — the ONE ORDER BY, verbatim (R4, R5, R6..R8)", () => {
  it("orders by currencyCode ASC, then sourceUpdatedAt DESC NULLS LAST, then createdAt DESC, then id DESC — nothing more, nothing less", () => {
    const sql = buildCurrentRatesSql("business-1");

    // The full ORDER BY clause, character by character: this is the ONE
    // sensor that a future edit cannot silently drop NULLS LAST or reorder
    // the keys — a nullable column without it would let a row with no mark
    // win forever (the exact bug this feature exists to close).
    expect(sql.text).toContain(
      'ORDER BY "currencyCode" ASC,\n              "sourceUpdatedAt" DESC NULLS LAST,\n              "createdAt" DESC,\n              "id" DESC',
    );
  });

  it("DISTINCT ON (currencyCode) matches the ORDER BY's required prefix", () => {
    const sql = buildCurrentRatesSql("business-1");
    expect(sql.text).toContain('SELECT DISTINCT ON ("currencyCode")');
  });

  it("filters by businessId, bound as a parameter — never interpolated as text", () => {
    const sql = buildCurrentRatesSql("business-1");
    expect(sql.text).toContain('WHERE "businessId" = $1');
    expect(sql.values).toEqual(["business-1"]);
  });
});

describe("loadCurrentRates() — maps the DISTINCT ON's rows to Record<string, string>", () => {
  it("one entry per currency, rate as a string (same shape the two former readers gave callers)", async () => {
    queryRaw.mockResolvedValue([
      { currencyCode: "USD", rate: decimal("440") },
      { currencyCode: "MLC", rate: decimal("210.5") },
    ]);

    const rates = await loadCurrentRates("business-1");

    expect(rates).toEqual({ USD: "440", MLC: "210.5" });
  });

  it("a business with zero rows returns {} — ordering zero rows gives zero rows (E11)", async () => {
    queryRaw.mockResolvedValue([]);

    const rates = await loadCurrentRates("business-1");

    expect(rates).toEqual({});
  });

  it("runs the SAME statement buildCurrentRatesSql returns, not a copy", async () => {
    queryRaw.mockResolvedValue([]);

    await loadCurrentRates("business-1");

    expect(queryRaw).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ values: ["business-1"] }),
    );
    const passed = queryRaw.mock.calls[0]?.[0];
    expect(passed.text).toEqual(buildCurrentRatesSql("business-1").text);
  });
});
