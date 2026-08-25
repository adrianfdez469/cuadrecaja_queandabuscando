import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const createMany = vi.fn();
const updateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    syncEvent: {
      findMany: (...args: unknown[]) => findMany(...args),
      createMany: (...args: unknown[]) => createMany(...args),
      updateMany: (...args: unknown[]) => updateMany(...args),
    },
  },
}));

const { recordBatch } = await import("./inbox");

function event(eventId: string, occurredAt = "2026-08-25T10:00:00.000Z") {
  return {
    eventId,
    entity: "CURRENCY" as const,
    operation: "UPDATE" as const,
    occurredAt,
    payload: {
      code: "USD",
      name: "Dólar",
      symbol: "US$",
      active: true,
      updatedAt: occurredAt,
    },
  };
}

beforeEach(() => {
  findMany.mockReset();
  createMany.mockReset().mockResolvedValue({ count: 0 });
  updateMany.mockReset();
});

describe("recordBatch()", () => {
  it("treats an unseen event as fresh and records it", async () => {
    findMany.mockResolvedValue([]);
    const result = await recordBatch("b1", [event("e1")]);

    expect(result.fresh.map((e) => e.eventId)).toEqual(["e1"]);
    expect(result.duplicateIds).toEqual([]);
    expect(createMany).toHaveBeenCalledOnce();
  });

  it("treats a PROCESSED event as a duplicate", async () => {
    findMany.mockResolvedValue([{ eventId: "e1", status: "PROCESSED" }]);
    const result = await recordBatch("b1", [event("e1")]);

    expect(result.fresh).toEqual([]);
    expect(result.duplicateIds).toEqual(["e1"]);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("treats a SKIPPED event as a duplicate", async () => {
    findMany.mockResolvedValue([{ eventId: "e1", status: "SKIPPED" }]);
    const result = await recordBatch("b1", [event("e1")]);
    expect(result.duplicateIds).toEqual(["e1"]);
  });

  it("REPROCESSES a previously FAILED event instead of calling it a duplicate", async () => {
    // The bug this guards against: reporting a failed event back in `ok` makes
    // the POS mark its outbox row done, and the update is lost permanently with
    // nothing anywhere reporting an error.
    findMany.mockResolvedValue([{ eventId: "e1", status: "FAILED" }]);
    const result = await recordBatch("b1", [event("e1")]);

    expect(result.fresh.map((e) => e.eventId)).toEqual(["e1"]);
    expect(result.duplicateIds).toEqual([]);
  });

  it("REPROCESSES a PENDING event — the process died mid-batch", async () => {
    findMany.mockResolvedValue([{ eventId: "e1", status: "PENDING" }]);
    const result = await recordBatch("b1", [event("e1")]);
    expect(result.fresh.map((e) => e.eventId)).toEqual(["e1"]);
  });

  it("does not re-insert a row that is already recorded", async () => {
    findMany.mockResolvedValue([{ eventId: "e1", status: "FAILED" }]);
    await recordBatch("b1", [event("e1")]);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("inserts only the events it has never seen", async () => {
    findMany.mockResolvedValue([
      { eventId: "e1", status: "PROCESSED" },
      { eventId: "e2", status: "FAILED" },
    ]);
    await recordBatch("b1", [event("e1"), event("e2"), event("e3")]);

    const inserted = createMany.mock.calls[0][0].data.map(
      (row: { eventId: string }) => row.eventId,
    );
    expect(inserted).toEqual(["e3"]);
  });

  it("applies events in causal order", async () => {
    findMany.mockResolvedValue([]);
    const result = await recordBatch("b1", [
      event("late", "2026-08-25T12:00:00.000Z"),
      event("early", "2026-08-25T09:00:00.000Z"),
    ]);
    expect(result.fresh.map((e) => e.eventId)).toEqual(["early", "late"]);
  });
});
