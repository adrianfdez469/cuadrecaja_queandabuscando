import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  ORDER_EXPIRED_PROPOSAL_REASON,
  ORDER_UNQUOTED_DELIVERY_EXPIRED_REASON,
} from "@/constants/orders";
import {
  createFixtureSession,
  type FixtureSession,
} from "@/features/marketplace/server/dbFixtures";
import { expireProposalsQuery, expireUnquotedDeliveryOrdersQuery } from "./expiry";

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

/**
 * `expireUnquotedDeliveryOrdersQuery` contra Postgres real (F-031
 * architecture.md DA4; criterio 7(b)). El humano firmó que un pedido
 * `CONFIRMED` sin cotizar también vence (plan.md § Preguntas antes de
 * aprobar), y R15 exige que este barrido y el de arriba nunca se pisen —
 * solo Postgres puede demostrar que los dos `WHERE` son de verdad disjuntos.
 */
describe("expireUnquotedDeliveryOrdersQuery() — Postgres real (F-031 DA4, R15, R16, criterio 7b)", () => {
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

  /** El default de `Store.orderExpiryHours` es 24 (`prisma/schema.prisma`);
   *  ninguna de estas pruebas lo cambia, solo mueve `createdAt`. */
  async function makeUnquotedDelivery(
    owner: FixtureSession,
    storeId: string,
    createdAt: Date,
    status: "PENDING" | "PULLED" | "CONFIRMED" | "AWAITING_CUSTOMER" = "PENDING",
  ): Promise<bigint> {
    const order = await owner.createOrder(storeId, { status });
    await prisma.order.update({
      where: { id: order.id },
      data: { deliveryFee: null, createdAt },
    });
    return order.id;
  }

  it("no toca un pedido sin cotizar que todavía está DENTRO del plazo (contado desde createdAt)", async () => {
    const store = await session.createStore();
    const orderId = await makeUnquotedDelivery(session, store.id, new Date(Date.now() - 3_600_000));

    await expireUnquotedDeliveryOrdersQuery(session.businessId);

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true, cancelledBy: true, deliveryFee: true },
    });
    expect(row.status).toBe("PENDING");
    expect(row.cancelledBy).toBeNull();
    expect(row.deliveryFee).toBeNull();
  });

  it("cancela, con el motivo propio (E9), un pedido sin cotizar que superó orderExpiryHours desde su CREACIÓN — en los tres estados abiertos, incluido CONFIRMED (decisión del humano)", async () => {
    const store = await session.createStore();
    for (const status of ["PENDING", "PULLED", "CONFIRMED"] as const) {
      const orderId = await makeUnquotedDelivery(
        session,
        store.id,
        new Date(Date.now() - 30 * 3_600_000),
        status,
      );

      const affected = await expireUnquotedDeliveryOrdersQuery(session.businessId);
      expect(Number(affected)).toBeGreaterThanOrEqual(1);

      const row = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { status: true, cancelledBy: true, cancelReason: true },
      });
      expect(row.status).toBe("CANCELLED");
      expect(row.cancelledBy).toBe("EXPIRY");
      expect(row.cancelReason).toBe(ORDER_UNQUOTED_DELIVERY_EXPIRED_REASON);
    }
  });

  it("R15: NUNCA toca un pedido en AWAITING_CUSTOMER, aunque su createdAt sea antiguo — ese tiene el reloj de expireProposalsQuery", async () => {
    const store = await session.createStore();
    const orderId = await makeUnquotedDelivery(
      session,
      store.id,
      new Date(Date.now() - 30 * 3_600_000),
      "AWAITING_CUSTOMER",
    );

    await expireUnquotedDeliveryOrdersQuery(session.businessId);

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true, cancelledBy: true },
    });
    expect(row.status).toBe("AWAITING_CUSTOMER");
    expect(row.cancelledBy).toBeNull();
  });

  it("un segundo barrido sobre la misma fila afecta 0 filas (R16, idempotencia por construcción)", async () => {
    const store = await session.createStore();
    const orderId = await makeUnquotedDelivery(
      session,
      store.id,
      new Date(Date.now() - 30 * 3_600_000),
    );

    await expireUnquotedDeliveryOrdersQuery(session.businessId);
    const second = await expireUnquotedDeliveryOrdersQuery(session.businessId);

    expect(Number(second)).toBe(0);
    const row = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    });
    expect(row.status).toBe("CANCELLED");
  });

  it("no toca un pedido YA cotizado (deliveryFee no nulo), por viejo que sea", async () => {
    const store = await session.createStore();
    const order = await session.createOrder(store.id, { status: "PENDING" });
    await prisma.order.update({
      where: { id: order.id },
      data: { createdAt: new Date(Date.now() - 30 * 3_600_000) }, // deliveryFee sigue en "0" (cotizado)
    });

    await expireUnquotedDeliveryOrdersQuery(session.businessId);

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    });
    expect(row.status).toBe("PENDING");
  });

  it("acotado a businessId: no toca el pedido sin cotizar vencido de OTRO negocio", async () => {
    const storeA = await session.createStore();
    const storeB = await otherSession.createStore();

    const orderA = await makeUnquotedDelivery(
      session,
      storeA.id,
      new Date(Date.now() - 30 * 3_600_000),
    );
    const orderB = await makeUnquotedDelivery(
      otherSession,
      storeB.id,
      new Date(Date.now() - 30 * 3_600_000),
    );

    await expireUnquotedDeliveryOrdersQuery(session.businessId);

    const rowA = await prisma.order.findUniqueOrThrow({
      where: { id: orderA },
      select: { status: true },
    });
    const rowB = await prisma.order.findUniqueOrThrow({
      where: { id: orderB },
      select: { status: true },
    });
    expect(rowA.status).toBe("CANCELLED");
    expect(rowB.status).toBe("PENDING"); // untouched — belongs to otherSession
  });

  it("sin businessId (el cron), barre el pedido sin cotizar vencido de cualquier negocio", async () => {
    const storeB = await otherSession.createStore();
    const orderB = await makeUnquotedDelivery(
      otherSession,
      storeB.id,
      new Date(Date.now() - 30 * 3_600_000),
    );

    await expireUnquotedDeliveryOrdersQuery();

    const rowB = await prisma.order.findUniqueOrThrow({
      where: { id: orderB },
      select: { status: true, cancelledBy: true, cancelReason: true },
    });
    expect(rowB.status).toBe("CANCELLED");
    expect(rowB.cancelledBy).toBe("EXPIRY");
    expect(rowB.cancelReason).toBe(ORDER_UNQUOTED_DELIVERY_EXPIRED_REASON);
  });
});
