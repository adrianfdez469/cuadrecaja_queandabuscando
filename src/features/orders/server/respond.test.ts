import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();
const orderFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    order: { findFirst: (...args: unknown[]) => orderFindFirst(...args) },
  },
}));

const { respondToProposal } = await import("./respond");

/**
 * F-019 architecture.md DA3/DA4. `$queryRaw` mocked to the shape the two
 * CTE sentences RETURN — the SQL itself (the CTE ordering, `rateSnapshot`
 * left untouched, the second call affecting 0 rows) is what
 * architecture.md's own preamble says was hand-verified against Postgres
 * with ROLLBACK, and the smoke script (etapa 8) exercises it end to end.
 * These tests own the 200/409 classification rule (DA4).
 */

beforeEach(() => {
  queryRaw.mockReset();
  orderFindFirst.mockReset();
});

describe("respondToProposal() — applied (E5, E6)", () => {
  it("approving with 1 row affected returns CONFIRMED", async () => {
    queryRaw.mockResolvedValue([{ code: "A7K3M9PQR2" }]);
    const result = await respondToProposal({
      storeId: "store-1",
      code: "A7K3M9PQR2",
      decision: "aprobar",
    });
    expect(result).toEqual({ kind: "applied", status: "CONFIRMED" });
  });

  it("rejecting with 1 row affected returns CANCELLED", async () => {
    queryRaw.mockResolvedValue([{ code: "A7K3M9PQR2" }]);
    const result = await respondToProposal({
      storeId: "store-1",
      code: "A7K3M9PQR2",
      decision: "rechazar",
    });
    expect(result).toEqual({ kind: "applied", status: "CANCELLED" });
  });
});

describe("respondToProposal() — 0 rows affected: the DA4 rule", () => {
  it("unknown_order when no row matches (storeId, code) at all (R22)", async () => {
    queryRaw.mockResolvedValue([]);
    orderFindFirst.mockResolvedValue(null);

    const result = await respondToProposal({
      storeId: "store-1",
      code: "NOPE",
      decision: "aprobar",
    });
    expect(result).toEqual({ kind: "unknown_order" });
  });

  it("idempotent 200 when the SAME decision already won (E7)", async () => {
    queryRaw.mockResolvedValue([]);
    orderFindFirst.mockResolvedValue({ status: "CONFIRMED", proposalOutcome: "APPROVED" });

    const result = await respondToProposal({
      storeId: "store-1",
      code: "A7K3M9PQR2",
      decision: "aprobar",
    });
    expect(result).toEqual({ kind: "idempotent", status: "CONFIRMED" });
  });

  it("idempotent 200 for a repeated rejection too", async () => {
    queryRaw.mockResolvedValue([]);
    orderFindFirst.mockResolvedValue({ status: "CANCELLED", proposalOutcome: "REJECTED" });

    const result = await respondToProposal({
      storeId: "store-1",
      code: "A7K3M9PQR2",
      decision: "rechazar",
    });
    expect(result).toEqual({ kind: "idempotent", status: "CANCELLED" });
  });

  it("expired (409) when still AWAITING_CUSTOMER — only the deadline could have blocked it (E11/E12)", async () => {
    queryRaw.mockResolvedValue([]);
    orderFindFirst.mockResolvedValue({ status: "AWAITING_CUSTOMER", proposalOutcome: null });

    const result = await respondToProposal({
      storeId: "store-1",
      code: "A7K3M9PQR2",
      decision: "aprobar",
    });
    expect(result).toEqual({ kind: "expired", status: "AWAITING_CUSTOMER" });
  });

  it("already_decided (409) when the OPPOSITE decision is what won (E7)", async () => {
    queryRaw.mockResolvedValue([]);
    orderFindFirst.mockResolvedValue({ status: "CANCELLED", proposalOutcome: "REJECTED" });

    const result = await respondToProposal({
      storeId: "store-1",
      code: "A7K3M9PQR2",
      decision: "aprobar",
    });
    expect(result).toEqual({ kind: "already_decided", status: "CANCELLED" });
  });

  it("no_live_proposal (409) when the store already closed it (E8)", async () => {
    queryRaw.mockResolvedValue([]);
    orderFindFirst.mockResolvedValue({ status: "REJECTED_BY_STORE", proposalOutcome: null });

    const result = await respondToProposal({
      storeId: "store-1",
      code: "A7K3M9PQR2",
      decision: "aprobar",
    });
    expect(result).toEqual({ kind: "no_live_proposal", status: "REJECTED_BY_STORE" });
  });
});
