import { beforeEach, describe, expect, it, vi } from "vitest";

const updateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { order: { updateMany: (...args: unknown[]) => updateMany(...args) } },
}));

const { setOrderStatus } = await import("./status");

/**
 * F-019 DA6: `cancelledBy` is computed from the reported status, not the
 * row's previous one, so this stays a single `updateMany` (no `CASE`, no
 * read-before-write).
 */
describe("setOrderStatus() — cancelledBy (DA6)", () => {
  beforeEach(() => {
    updateMany.mockReset().mockResolvedValue({ count: 1 });
  });

  it("writes cancelledBy: 'STORE' when the POS reports CANCELLED", async () => {
    await setOrderStatus({
      businessId: "biz-1",
      orderId: 1n,
      status: "CANCELLED",
      reason: "sin existencias",
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cancelledBy: "STORE" }) }),
    );
  });

  it("writes cancelledBy: 'STORE' when the POS reports REJECTED_BY_STORE", async () => {
    await setOrderStatus({
      businessId: "biz-1",
      orderId: 1n,
      status: "REJECTED_BY_STORE",
      reason: null,
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cancelledBy: "STORE" }) }),
    );
  });

  it("writes cancelledBy: null for every other status", async () => {
    for (const status of ["CONFIRMED", "READY", "IN_TRANSIT", "DELIVERED"] as const) {
      updateMany.mockClear();
      await setOrderStatus({ businessId: "biz-1", orderId: 1n, status, reason: null });
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ cancelledBy: null }) }),
      );
    }
  });

  it("returns ok: false when 0 rows matched (unknown order or another business's, E12)", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    const result = await setOrderStatus({
      businessId: "biz-1",
      orderId: 999n,
      status: "CONFIRMED",
      reason: null,
    });
    expect(result).toEqual({ ok: false });
  });
});
