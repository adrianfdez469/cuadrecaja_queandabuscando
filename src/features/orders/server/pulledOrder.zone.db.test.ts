import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createFixtureSession,
  type FixtureSession,
  type FixtureStore,
} from "@/features/marketplace/server/dbFixtures";
import { PULLED_ORDER_SELECT, toPulledOrder } from "./pulledOrder";

/**
 * F-042 (architecture.md § Componentes, fila `pulledOrder.zone.db.test.ts`)
 * — C4, E22, E23: `contact.zoneCode`/`zoneName` SIEMPRE presentes en el pull,
 * `null` cuando el pedido no lleva zona, y leídas de las columnas de la
 * FILA — nunca del catálogo — contra Postgres real y el `select`/mapeo REAL
 * que el POS recibe (`PULLED_ORDER_SELECT`, `toPulledOrder`), no un objeto
 * simulado a mano.
 */

async function insertOrder(
  session: FixtureSession,
  store: FixtureStore,
  overrides: {
    deliveryZoneCode?: string | null;
    deliveryZoneName?: string | null;
    deliveryFee?: string | null;
    deliveryAddress?: string | null;
  } = {},
) {
  const order = await prisma.order.create({
    data: {
      code: `${session.token}-${randomUUID().slice(0, 8)}`,
      idempotencyKey: randomUUID(),
      storeId: store.id,
      businessId: session.businessId,
      contactName: "Cliente F-042",
      contactPhone: "+5350000000",
      status: "PENDING",
      currencyCode: "CUP",
      subtotal: "100.00",
      discountTotal: "0.00",
      deliveryAddress: overrides.deliveryAddress ?? null,
      deliveryFee: overrides.deliveryFee === undefined ? "300.00" : overrides.deliveryFee,
      total: "400.00",
      deliveryZoneCode: overrides.deliveryZoneCode ?? null,
      deliveryZoneName: overrides.deliveryZoneName ?? null,
      rateSnapshot: { base: "CUP", capturedAt: new Date().toISOString(), rates: {} },
    },
    select: { id: true },
  });
  return order;
}

async function pull(orderId: bigint) {
  const row = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: PULLED_ORDER_SELECT,
  });
  return toPulledOrder(row);
}

describe("toPulledOrder() — contact.zoneCode/zoneName against a REAL row and the REAL select (C4, E22, E23)", () => {
  let session: FixtureSession;
  let store: FixtureStore;

  beforeEach(async () => {
    session = await createFixtureSession();
    store = await session.createStore();
  });

  afterEach(async () => {
    await session.cleanup();
  });

  it("C4 — a DELIVERY order of a ZONE_BASED store pulls its zoneCode/zoneName AND a resolved, non-pending deliveryFee", async () => {
    const order = await insertOrder(session, store, {
      deliveryZoneCode: "23.01",
      deliveryZoneName: "Playa",
      deliveryFee: "300.00",
      deliveryAddress: "Calle 1 e/ 2 y 4",
    });

    const pulled = await pull(order.id);

    expect(pulled.contact.zoneCode).toBe("23.01");
    expect(pulled.contact.zoneName).toBe("Playa");
    expect(pulled.deliveryFee).toBe("300.00");
    expect(pulled.deliveryFeePending).toBe(false);
  });

  it("E22 — a PICKUP order (no zone at all) pulls the two keys PRESENT and null, same shape as email/address without one", async () => {
    const order = await insertOrder(session, store, {
      deliveryZoneCode: null,
      deliveryZoneName: null,
      deliveryFee: "0.00",
    });

    const pulled = await pull(order.id);

    expect(pulled.contact).toHaveProperty("zoneCode", null);
    expect(pulled.contact).toHaveProperty("zoneName", null);
  });

  it("a not-yet-quoted delivery fee (deliveryFee NULL, F-031 DA1) pulls deliveryFeePending: true independently of the zone keys — the two never get confused", async () => {
    const order = await insertOrder(session, store, {
      deliveryZoneCode: null,
      deliveryZoneName: null,
      deliveryFee: null,
    });

    const pulled = await pull(order.id);

    expect(pulled.deliveryFeePending).toBe(true);
    expect(pulled.deliveryFee).toBe("0.00"); // NULL never travels as null (F-031 DA1)
    expect(pulled.contact.zoneCode).toBeNull();
    expect(pulled.contact.zoneName).toBeNull();
  });

  it("E23 — the pull returns EXACTLY what the row stores, even a zoneCode absent from today's catalog: it never consults the catalog to answer", async () => {
    // "99.99" no existe en `src/features/zones/zone-index.json` — si
    // `toPulledOrder` lo validara o lo resolviera contra el catálogo,
    // fallaría o lo cambiaría. No lo hace: lee la columna y punto, que es
    // exactamente lo que protege a un pedido de una zona retirada o
    // renombrada después de crearse (caso límite 5, R19).
    const order = await insertOrder(session, store, {
      deliveryZoneCode: "99.99",
      deliveryZoneName: "Una Zona Que Ya No Está En El Catálogo",
    });

    const pulled = await pull(order.id);

    expect(pulled.contact.zoneCode).toBe("99.99");
    expect(pulled.contact.zoneName).toBe("Una Zona Que Ya No Está En El Catálogo");
  });

  it("dos pedidos de la MISMA zona, con nombres distintos guardados como instantánea, pullean cada uno el suyo — el pull nunca re-deriva el nombre del code", async () => {
    const older = await insertOrder(session, store, {
      deliveryZoneCode: "23.01",
      deliveryZoneName: "Playa",
    });
    const newer = await insertOrder(session, store, {
      deliveryZoneCode: "23.01",
      deliveryZoneName: "Playa (nombre hipotético renombrado)",
    });

    expect((await pull(older.id)).contact.zoneName).toBe("Playa");
    expect((await pull(newer.id)).contact.zoneName).toBe("Playa (nombre hipotético renombrado)");
  });
});
