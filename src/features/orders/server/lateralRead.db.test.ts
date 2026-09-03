import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma";
import { OrderStatus } from "@/generated/prisma/enums";
import {
  createFixtureSession,
  type FixtureSession,
} from "@/features/marketplace/server/dbFixtures";
import { pullOrders } from "./pull";
import { readOrdersByIds, readOrdersByStatus } from "./lateralRead";

/**
 * Las dos lecturas laterales contra Postgres real (F-033 plan.md paso 10,
 * architecture.md DA5/DA8). Criterios 1, 2, 4, 9 y el `EXPLAIN` del 11. Un
 * mock no puede demostrar ninguno de los cinco: que un `id` por debajo del
 * cursor de verdad sale de la base, que dos negocios reales están aislados,
 * ni que el planificador de Postgres usa el índice compuesto.
 *
 * Cada `it` del primer `describe` corre con su propia sesión (`beforeEach`,
 * no `beforeAll`): la paginación por estado del criterio 9 necesita contar
 * EXACTAMENTE los pedidos de un estado dado, y compartir negocio entre `it`s
 * arriesgaría que un pedido dejado por otro test se colara en la cuenta.
 */
describe("lecturas laterales — Postgres real (criterios 1, 2, 4, 9)", () => {
  let session: FixtureSession;
  let storeId: string;

  beforeEach(async () => {
    session = await createFixtureSession();
    const store = await session.createStore();
    storeId = store.id;
  });

  afterEach(async () => {
    await session.cleanup();
  });

  it("criterios 1 y 2: un AWAITING_CUSTOMER sale por debajo del cursor, y el pull no se mueve", async () => {
    // A: pulleado primero (PENDING -> PULLED, el cursor del POS avanza más
    // allá de su id), y SOLO DESPUÉS pasa a AWAITING_CUSTOMER — exactamente
    // el camino real: una propuesta ocurre siempre sobre un pedido ya
    // pulleado (spec.md § Problema).
    const orderA = await session.createOrder(storeId);
    await pullOrders(session.businessId, 0n, 100);

    await prisma.order.update({
      where: { id: orderA.id },
      data: {
        status: OrderStatus.AWAITING_CUSTOMER,
        expiresAt: new Date(Date.now() + 3_600_000),
        proposedAt: new Date(),
      },
    });

    // B se crea DESPUÉS: pullearlo es lo que deja al POS con un cursor
    // estrictamente mayor que el id de A.
    const orderB = await session.createOrder(storeId);
    const pullB = await pullOrders(session.businessId, orderA.id, 100);
    expect(pullB.orders.map((o) => o.id)).toEqual([orderB.id.toString()]);
    const cursor = orderB.id;

    const pullBefore = await pullOrders(session.businessId, cursor, 100);
    expect(pullBefore.orders).toEqual([]);

    const lateral = await readOrdersByStatus({
      businessId: session.businessId,
      status: OrderStatus.AWAITING_CUSTOMER,
      after: 0n,
      limit: 100,
    });
    const found = lateral.orders.find((o) => o.id === orderA.id.toString());
    expect(found).toBeDefined();
    // Criterio 1: el id que vuelve es MENOR que el último cursor entregado.
    expect(BigInt(found!.id)).toBeLessThan(cursor);

    // Criterio 2, el aserto fuerte que no depende del escenario: repetir el
    // pull con el `since` que el POS ya tenía devuelve el MISMO cuerpo que
    // antes de la lectura lateral — la lateral no consumió ni marcó nada.
    const pullAfter = await pullOrders(session.businessId, cursor, 100);
    expect(pullAfter).toEqual(pullBefore);
  });

  it("criterio 4: un id de otro negocio es indistinguible de uno inexistente", async () => {
    const otherSession = await createFixtureSession();
    try {
      const otherStore = await otherSession.createStore();
      const otherOrder = await otherSession.createOrder(otherStore.id);

      const bodyOfOtherBusiness = await readOrdersByIds({
        businessId: session.businessId,
        ids: [otherOrder.id],
      });
      const bodyOfNonexistent = await readOrdersByIds({
        businessId: session.businessId,
        ids: [999999999999n],
      });

      expect(bodyOfOtherBusiness).toEqual(bodyOfNonexistent);
      expect(bodyOfOtherBusiness).toEqual({ orders: [], nextAfter: null });
    } finally {
      await otherSession.cleanup();
    }
  });

  it("criterio 9: paginación por estado con limit=1, dos pedidos, sin mover el pull", async () => {
    const order1 = await session.createOrder(storeId, { status: OrderStatus.CONFIRMED });
    const order2 = await session.createOrder(storeId, { status: OrderStatus.CONFIRMED });

    // El cursor "que el POS ya tiene": al día respecto de los dos.
    const cursor = order2.id;
    const pullBefore = await pullOrders(session.businessId, cursor, 100);
    expect(pullBefore.orders).toEqual([]);

    const page1 = await readOrdersByStatus({
      businessId: session.businessId,
      status: OrderStatus.CONFIRMED,
      after: 0n,
      limit: 1,
    });
    expect(page1.orders.map((o) => o.id)).toEqual([order1.id.toString()]);
    expect(page1.nextAfter).toBe(order1.id.toString());

    const page2 = await readOrdersByStatus({
      businessId: session.businessId,
      status: OrderStatus.CONFIRMED,
      after: BigInt(page1.nextAfter!),
      limit: 1,
    });
    expect(page2.orders.map((o) => o.id)).toEqual([order2.id.toString()]);
    expect(page2.nextAfter).toBe(order2.id.toString());

    const page3 = await readOrdersByStatus({
      businessId: session.businessId,
      status: OrderStatus.CONFIRMED,
      after: BigInt(page2.nextAfter!),
      limit: 1,
    });
    expect(page3.orders).toEqual([]);
    expect(page3.nextAfter).toBeNull();

    // Las tres llamadas laterales no cambiaron lo que el pull incremental
    // responde con el mismo cursor.
    const pullAfter = await pullOrders(session.businessId, cursor, 100);
    expect(pullAfter).toEqual(pullBefore);
  });
});

/**
 * Criterio 11: el `EXPLAIN` de la consulta por estado usa
 * `Order_businessId_status_id_idx`, nunca un `Seq Scan`, y no hay migración
 * nueva. Misma receta que `pull.db.test.ts` § «el EXPLAIN usa el índice»
 * (~500 filas de relleno de OTRO tenant + `enable_seqscan = off`), con
 * `VACUUM ANALYZE` en vez de solo `ANALYZE` — ficha
 * `explain-seq-scan-flaky-bajo-analyze-sin-vacuum`, que documenta que
 * `ANALYZE` solo sobre una tabla con tuplas muertas de otros
 * `*.db.test.ts` de la misma sesión serial puede hacer que el plan salga
 * intermitente. El SQL de abajo copia EXACTO el `where`/`orderBy` de
 * `readOrdersByStatus` en `lateralRead.ts` (impl.md § «Qué necesita quien
 * pruebe»).
 */
describe("readOrdersByStatus() — el EXPLAIN usa el índice (criterio 11)", () => {
  let session: FixtureSession;
  let client: Client;

  beforeAll(async () => {
    session = await createFixtureSession();
    const storeA = await session.createStore();
    await session.createOrder(storeA.id, { status: OrderStatus.PULLED });
    await session.createOrder(storeA.id, { status: OrderStatus.PULLED });
    // ~500 filas de OTRO negocio, para que el planificador considere
    // selectivo el índice compuesto sobre este tenant.
    await session.createFillerOrders(500);

    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query('VACUUM ANALYZE "Order"');
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

  it("(b) el plan de la lectura por estado nombra ese índice, nunca un Seq Scan", async () => {
    await client.query("SET enable_seqscan = off");
    const { rows } = await client.query<{ "QUERY PLAN": string }>(
      `EXPLAIN SELECT "id" FROM "Order" WHERE "businessId" = $1 AND status = $2 AND "id" > $3 ORDER BY "id" ASC LIMIT 100`,
      [session.businessId, "PULLED", "0"],
    );
    const plan = rows.map((row) => row["QUERY PLAN"]).join("\n");

    expect(plan).not.toMatch(/Seq Scan/);
    expect(plan).toContain("Order_businessId_status_id_idx");
  });
});
