import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ORDER_EXPIRED_PROPOSAL_REASON } from "@/constants/orders";
import {
  createFixtureSession,
  type FixtureSession,
} from "@/features/marketplace/server/dbFixtures";
import { expireProposalsQuery } from "./expiry";

/**
 * `expireProposalsQuery` against a real Postgres (architecture.md DA5, § "El
 * reloj"; criterio 4(b)). A mock cannot show any of the three things this
 * owns: that Postgres actually stops matching a row once its `status` moves
 * (R14's idempotency), that an unexpired proposal in the SAME business is
 * left alone, and that a `businessId` scope really keeps another tenant's
 * expired proposal untouched — a mocked `$executeRaw` would return whatever
 * the test told it to, `WHERE` clause or not.
 */
describe("expireProposalsQuery() — Postgres real (R14, criterio 4b)", () => {
  let session: FixtureSession;
  let otherSession: FixtureSession;

  beforeAll(async () => {
    session = await createFixtureSession();
    otherSession = await createFixtureSession();
  });

  afterAll(async () => {
    await session.cleanup();
    await otherSession.cleanup();
  });

  async function makeAwaitingCustomer(
    owner: FixtureSession,
    storeId: string,
    expiresAt: Date,
  ): Promise<bigint> {
    const order = await owner.createOrder(storeId);
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "AWAITING_CUSTOMER", expiresAt, proposedAt: new Date() },
    });
    return order.id;
  }

  it("no toca un pedido AWAITING_CUSTOMER que todavía no vence", async () => {
    const store = await session.createStore();
    const orderId = await makeAwaitingCustomer(session, store.id, new Date(Date.now() + 3_600_000));

    await expireProposalsQuery(session.businessId);

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true, cancelledBy: true },
    });
    expect(row.status).toBe("AWAITING_CUSTOMER");
    expect(row.cancelledBy).toBeNull();
  });

  it("cancela un pedido vencido con la atribución EXPIRY y el motivo literal de R6 (E10)", async () => {
    const store = await session.createStore();
    const orderId = await makeAwaitingCustomer(session, store.id, new Date(Date.now() - 3_600_000));

    const affected = await expireProposalsQuery(session.businessId);
    expect(Number(affected)).toBeGreaterThanOrEqual(1);

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true, cancelledBy: true, proposalOutcome: true, cancelReason: true },
    });
    expect(row.status).toBe("CANCELLED");
    expect(row.cancelledBy).toBe("EXPIRY");
    expect(row.proposalOutcome).toBe("EXPIRED");
    expect(row.cancelReason).toBe(ORDER_EXPIRED_PROPOSAL_REASON);
  });

  it("un segundo barrido sobre la misma fila afecta 0 filas (R14)", async () => {
    const store = await session.createStore();
    const orderId = await makeAwaitingCustomer(session, store.id, new Date(Date.now() - 3_600_000));

    await expireProposalsQuery(session.businessId);
    const second = await expireProposalsQuery(session.businessId);

    expect(Number(second)).toBe(0);
    const row = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    });
    expect(row.status).toBe("CANCELLED");
  });

  it("acotado a businessId: no toca la propuesta vencida de OTRO negocio", async () => {
    const storeA = await session.createStore();
    const storeB = await otherSession.createStore();

    const orderA = await makeAwaitingCustomer(session, storeA.id, new Date(Date.now() - 3_600_000));
    const orderB = await makeAwaitingCustomer(
      otherSession,
      storeB.id,
      new Date(Date.now() - 3_600_000),
    );

    await expireProposalsQuery(session.businessId);

    const rowA = await prisma.order.findUniqueOrThrow({
      where: { id: orderA },
      select: { status: true },
    });
    const rowB = await prisma.order.findUniqueOrThrow({
      where: { id: orderB },
      select: { status: true },
    });
    expect(rowA.status).toBe("CANCELLED");
    expect(rowB.status).toBe("AWAITING_CUSTOMER"); // untouched — belongs to otherSession
  });

  it("sin businessId (el cron), barre el pedido vencido de cualquier negocio", async () => {
    const storeB = await otherSession.createStore();
    const orderB = await makeAwaitingCustomer(
      otherSession,
      storeB.id,
      new Date(Date.now() - 3_600_000),
    );

    await expireProposalsQuery();

    const rowB = await prisma.order.findUniqueOrThrow({
      where: { id: orderB },
      select: { status: true, cancelledBy: true },
    });
    expect(rowB.status).toBe("CANCELLED");
    expect(rowB.cancelledBy).toBe("EXPIRY");
  });
});
