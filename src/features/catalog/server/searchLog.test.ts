import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `recordStoreSearchQuery` as a unit (F-021, R13, E16): the SQL-level effect
 * — a real row landing in `StoreSearchQuery` — is only verifiable against
 * Postgres (`src/features/catalog/server/search.db.test.ts`, criterio 7).
 * What IS a unit fact, and what this file holds the line on: a failure to
 * write NEVER surfaces as a thrown error, because the caller schedules this
 * with `after()`, after the response has already left (R13).
 */

const create = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    storeSearchQuery: {
      create: (...a: unknown[]) => create(...a),
    },
  },
}));

const { recordStoreSearchQuery } = await import("./searchLog");

beforeEach(() => {
  create.mockReset();
});

describe("recordStoreSearchQuery()", () => {
  it("writes storeId, term and resultCount", async () => {
    create.mockResolvedValue({ id: "row-1" });

    await recordStoreSearchQuery({ storeId: "store-1", term: "arroz", resultCount: 3 });

    expect(create).toHaveBeenCalledExactlyOnceWith({
      data: { storeId: "store-1", term: "arroz", resultCount: 3 },
    });
  });

  it("never throws when the write fails (R13, E16)", async () => {
    create.mockRejectedValue(new Error("connection reset"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      recordStoreSearchQuery({ storeId: "store-1", term: "arroz", resultCount: 0 }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
