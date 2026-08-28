import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma";
import { OrderStatus } from "@/generated/prisma/enums";
import {
  createFixtureSession,
  type FixtureSession,
} from "@/features/marketplace/server/dbFixtures";
import { pullOrders } from "./pull";

/**
 * `pullOrders` against a real Postgres (F-018, plan.md paso 5; spec.md C1,
 * E9-E11; architecture.md § Pruebas: el corte entre mock y Postgres real).
 * Two REAL tenants — the fixture session's own business, and a filler
 * business `createFillerOrders` creates — because "the pull of A never
 * returns an order of B" is exactly the property a mock cannot demonstrate:
 * a mocked `prisma.order.findMany` would return whatever the test tells it
 * to, `where` clause or not.
 */
describe("pullOrders() — dos negocios reales (C1, E9-E11)", () => {
  let session: FixtureSession;

  beforeAll(async () => {
    session = await createFixtureSession();
  });

  afterAll(async () => {
    await session.cleanup();
  });

  it("el pull de A no devuelve ningún pedido de B (E9)", async () => {
    const storeA = await session.createStore();
    await session.createOrder(storeA.id);
    await session.createOrder(storeA.id);

    // The other tenant's orders — created through the SAME fixture
    // mechanism `createFillerOrders` uses for the EXPLAIN test below, so
    // this is real cross-tenant data, not a hand-rolled second business.
    const filler = await session.createFillerOrders(3);

    const { orders } = await pullOrders(session.businessId, 0n, 100);

    expect(orders.length).toBeGreaterThanOrEqual(2);
    const fillerStore = await prisma.store.findUniqueOrThrow({
      where: { id: filler.storeId },
      select: { externalId: true },
    });
    const storeExternalIds = orders.map((o) => o.storeExternalId);
    expect(storeExternalIds).not.toContain(fillerStore.externalId);
    expect(storeExternalIds.every((id) => id === storeA.externalId)).toBe(true);
  });

  it("marca PULLED solo los PENDING de A; los de B (el filler) siguen PENDING (E10)", async () => {
    const storeA = await session.createStore();
    const orderA = await session.createOrder(storeA.id, { status: OrderStatus.PENDING });
    const filler = await session.createFillerOrders(2);

    await pullOrders(session.businessId, 0n, 500);

    const refreshedA = await prisma.order.findUniqueOrThrow({
      where: { id: orderA.id },
      select: { status: true, pulledAt: true },
    });
    expect(refreshedA.status).toBe("PULLED");
    expect(refreshedA.pulledAt).not.toBeNull();

    const fillerOrders = await prisma.order.findMany({
      where: { businessId: filler.businessId },
      select: { status: true, pulledAt: true },
    });
    for (const row of fillerOrders) {
      expect(row.status).toBe("PENDING");
      expect(row.pulledAt).toBeNull();
    }
  });

  it("cuando A está al día, un pull nuevo devuelve vacío aunque B tenga pedidos con ids posteriores (E11)", async () => {
    const storeA = await session.createStore();
    const orderA = await session.createOrder(storeA.id);
    // B's ids are created AFTER A's own, so they are numerically ahead.
    await session.createFillerOrders(5);

    const upToDate = await pullOrders(session.businessId, orderA.id, 100);
    expect(upToDate.orders).toEqual([]);
    expect(upToDate.nextCursor).toBeNull();
  });
});

/**
 * C7/E30/PP1: the pull's `EXPLAIN` names `Order_businessId_status_id_idx`,
 * never a `Seq Scan`. The receipt AP1 found (architecture.md § Lo que dice
 * el EXPLAIN de verdad): with too few rows the planner correctly prefers
 * `Order_pkey` even with `enable_seqscan = off`, because the rival plan is
 * an `Index Scan`, not a `Seq Scan`. PP1's fix: ~500 filler rows of ANOTHER
 * tenant + `ANALYZE "Order"`, with `enable_seqscan = off` kept as a belt
 * alongside that suspenders. The assertion is never removed.
 */
describe("pullOrders() — el EXPLAIN usa el índice (C7, E30, PP1)", () => {
  let session: FixtureSession;
  let client: Client;

  beforeAll(async () => {
    session = await createFixtureSession();
    const storeA = await session.createStore();
    await session.createOrder(storeA.id);
    await session.createOrder(storeA.id);
    // PP1: ~500 rows of a DIFFERENT business, so the planner has enough of
    // this tenant's data to consider the composite index selective.
    await session.createFillerOrders(500);

    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query('ANALYZE "Order"');
  });

  afterAll(async () => {
    await client.end();
    await session.cleanup();
  });

  it("(a) el índice (businessId, status, id) existe", async () => {
    const { rows } = await client.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'Order' AND indexname = 'Order_businessId_status_id_idx'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain('"businessId"');
    expect(rows[0]?.indexdef).toContain("status");
    expect(rows[0]?.indexdef).toContain("id");
  });

  it("(b) el plan de la consulta del pull nombra ese índice, nunca un Seq Scan", async () => {
    await client.query("SET enable_seqscan = off");
    const { rows } = await client.query<{ "QUERY PLAN": string }>(
      `EXPLAIN SELECT "id" FROM "Order" WHERE "businessId" = $1 AND "id" > $2 ORDER BY "id" ASC LIMIT 100`,
      [session.businessId, "0"],
    );
    const plan = rows.map((row) => row["QUERY PLAN"]).join("\n");

    expect(plan).not.toMatch(/Seq Scan/);
    expect(plan).toContain("Order_businessId_status_id_idx");
  });
});
