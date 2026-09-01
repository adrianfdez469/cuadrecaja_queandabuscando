import { beforeEach, describe, expect, it, vi } from "vitest";

const updateMany = vi.fn();
const findUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: {
      updateMany: (...args: unknown[]) => updateMany(...args),
      findUnique: (...args: unknown[]) => findUnique(...args),
    },
  },
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
    findUnique.mockReset();
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

  it("returns unknown_order when 0 rows matched and the row does not exist (E12)", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue(null);
    const result = await setOrderStatus({
      businessId: "biz-1",
      orderId: 999n,
      status: "CONFIRMED",
      reason: null,
    });
    expect(result).toEqual({ kind: "unknown_order" });
  });
});

/**
 * F-031 DA5/E10/R17: the guard that requires the delivery fee already
 * quoted before `READY`/`IN_TRANSIT`/`DELIVERED`, and the order the two
 * checks run in on 0 rows — business isolation BEFORE the quote guard.
 */
describe("setOrderStatus() — guarda de envío cotizado (F-031 DA5)", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("no añade la guarda de deliveryFee para CONFIRMED/CANCELLED/REJECTED_BY_STORE", async () => {
    updateMany.mockReset().mockResolvedValue({ count: 1 });
    for (const status of ["CONFIRMED", "CANCELLED", "REJECTED_BY_STORE"] as const) {
      updateMany.mockClear();
      await setOrderStatus({ businessId: "biz-1", orderId: 1n, status, reason: null });
      const where = updateMany.mock.calls[0][0].where;
      expect(where).not.toHaveProperty("deliveryFee");
    }
  });

  it("añade `deliveryFee: { not: null }` al where para READY/IN_TRANSIT/DELIVERED", async () => {
    updateMany.mockReset().mockResolvedValue({ count: 1 });
    for (const status of ["READY", "IN_TRANSIT", "DELIVERED"] as const) {
      updateMany.mockClear();
      await setOrderStatus({ businessId: "biz-1", orderId: 1n, status, reason: null });
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deliveryFee: { not: null } }),
        }),
      );
    }
  });

  it("responde delivery_not_quoted cuando la fila es del negocio pero el envío sigue en NULL", async () => {
    updateMany.mockReset().mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue({ businessId: "biz-1", deliveryFee: null });

    const result = await setOrderStatus({
      businessId: "biz-1",
      orderId: 1n,
      status: "READY",
      reason: null,
    });

    expect(result).toEqual({ kind: "delivery_not_quoted" });
  });

  it("R17: responde unknown_order (NO delivery_not_quoted) cuando la fila es de OTRO negocio, aunque el envío esté sin cotizar", async () => {
    updateMany.mockReset().mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue({ businessId: "other-biz", deliveryFee: null });

    const result = await setOrderStatus({
      businessId: "biz-1",
      orderId: 1n,
      status: "READY",
      reason: null,
    });

    expect(result).toEqual({ kind: "unknown_order" });
  });

  it("unknown_order cuando la fila no existe", async () => {
    updateMany.mockReset().mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue(null);

    const result = await setOrderStatus({
      businessId: "biz-1",
      orderId: 999n,
      status: "READY",
      reason: null,
    });

    expect(result).toEqual({ kind: "unknown_order" });
  });

  it("ok cuando el pedido ya está cotizado (deliveryFee no nulo)", async () => {
    updateMany.mockReset().mockResolvedValue({ count: 1 });

    const result = await setOrderStatus({
      businessId: "biz-1",
      orderId: 1n,
      status: "READY",
      reason: null,
    });

    expect(result).toEqual({ kind: "ok" });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("carrera perdida: la fila existe, es del negocio y está cotizada, pero updateMany afectó 0 filas — cae al mismo unknown_order de siempre, avisando con console.warn (no error: es una carrera benigna, no un fallo)", async () => {
    updateMany.mockReset().mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue({ businessId: "biz-1", deliveryFee: "180.00" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await setOrderStatus({
      businessId: "biz-1",
      orderId: 1n,
      status: "READY",
      reason: null,
    });

    expect(result).toEqual({ kind: "unknown_order" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[orders]"), expect.anything());
    warnSpy.mockRestore();
  });
});
