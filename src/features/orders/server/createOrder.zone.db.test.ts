import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { money } from "@/lib/money";
import {
  createFixtureSession,
  type FixtureSession,
} from "@/features/marketplace/server/dbFixtures";
import type { CreateOrderRequest } from "../schemas";

/**
 * `loadStoreForOrder` resuelve el slug con `resolvePublicSlug`
 * (`src/features/storefront/server/resolve.ts`), envuelto en
 * `unstable_cache` (`src/lib/cache.ts`). Ese envoltorio necesita el
 * "static generation store" que solo existe dentro de un `next dev`/`next
 * start` real; invocado directamente desde Vitest lanza `Invariant:
 * incrementalCache missing`, un artefacto del arnés y no del código bajo
 * prueba. Stubeado igual que `storePublishGate.db.test.ts` ya lo hace para
 * el mismo problema con `revalidateTag`: un passthrough para
 * `unstable_cache`, así esta prueba se queda en lo único que solo Postgres
 * puede demostrar — la resolución, la cotización y la fila real que
 * `createOrder()` deja escrita.
 */
vi.mock("next/cache", () => ({
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

const { createOrder } = await import("./createOrder");
const { PULLED_ORDER_SELECT, toPulledOrder } = await import("./pulledOrder");

/**
 * F-042 (architecture.md § Componentes, fila `createOrder.zone.db.test.ts`)
 * — C3, C10, C13, C14, contra Postgres real: llama a `createOrder()` de
 * verdad (nunca mockeado), con una tienda, un tarifario y un producto
 * REALES, y lee la fila del pedido que quedó escrita.
 *
 * `resolvePublicSlug` (que `loadStoreForOrder` usa por debajo) resuelve por
 * la tabla `Slug` — `session.createStore()` no la puebla (no lo necesitaba
 * hasta este fichero), así que cada fixture de aquí crea su propia fila con
 * el `slug` real de la tienda, el mismo mecanismo que
 * `src/features/storefront/server/registry.ts` usa al publicar.
 */

async function zoneBasedStore(session: FixtureSession) {
  const store = await session.createStore();
  const full = await prisma.store.update({
    where: { id: store.id },
    data: { deliveryEnabled: true, deliveryFeeMode: "ZONE_BASED" },
    select: { id: true, slug: true },
  });
  await prisma.slug.create({
    data: { value: full.slug!, kind: "STORE", storeId: store.id },
  });
  return { id: store.id, slug: full.slug! };
}

async function orderableOffer(session: FixtureSession, storeId: string, price: string) {
  const canonical = await session.createCanonical({ name: `Producto F-042 ${randomUUID()}` });
  return session.createOffer(storeId, canonical.id, {
    syncedPrice: price,
    syncedPriceCurrency: "CUP",
  });
}

function orderBody(
  overrides: Partial<CreateOrderRequest> & {
    storeSlug: string;
    items: CreateOrderRequest["items"];
    expectedTotal: string;
  },
): CreateOrderRequest {
  return {
    contact: { name: "Cliente F-042", phone: "+5350000000" },
    fulfillment: "DELIVERY",
    deliveryAddress: "Calle 1 e/ 2 y 4",
    ...overrides,
  };
}

async function countOrders(storeId: string) {
  return prisma.order.count({ where: { storeId } });
}

describe("createOrder() ZONE_BASED against real Postgres — C3, C10, C13, C14", () => {
  let session: FixtureSession;

  beforeEach(async () => {
    session = await createFixtureSession();
  });

  afterEach(async () => {
    await session.cleanup();
  });

  it("C10 — Order.deliveryFee IS NOT NULL, carrying the ZONE's amount — never Store.deliveryFee's residual column (R9)", async () => {
    const store = await zoneBasedStore(session);
    await prisma.zoneTariff.create({
      data: {
        storeId: store.id,
        zoneCode: "23.01",
        rule: "FEE",
        deliveryFee: "300.00",
        sourceUpdatedAt: new Date(),
      },
    });
    const offer = await orderableOffer(session, store.id, "100.00");

    const result = await createOrder(
      orderBody({
        storeSlug: store.slug,
        items: [{ storeProductId: offer.id, qty: 1 }],
        zoneCode: "23.01",
        expectedTotal: "400.00",
      }),
    );

    expect(result.kind).toBe("created");
    const { code } = result as { code: string };
    const row = await prisma.order.findUniqueOrThrow({
      where: { code },
      select: { deliveryFee: true, deliveryZoneCode: true, deliveryZoneName: true },
    });
    expect(row.deliveryFee).not.toBeNull();
    expect(money(row.deliveryFee!.toString(), "CUP").amount).toBe("300.00");
    expect(row.deliveryZoneCode).toBe("23.01");
    expect(row.deliveryZoneName).toBe("Playa");

    // El pull, con el mismo mecanismo del criterio 4: deliveryFeePending
    // en false porque el importe SIEMPRE se resolvió (R11).
    const pulledRow = await prisma.order.findUniqueOrThrow({
      where: { code },
      select: PULLED_ORDER_SELECT,
    });
    expect(toPulledOrder(pulledRow).deliveryFeePending).toBe(false);
  });

  it("C3 — el zoneName del pedido es una INSTANTÁNEA: renombrar 23.01 en la tabla Zone (el espejo, ADR 0032 (a)) DESPUÉS del pedido no cambia ni la fila ni su pull", async () => {
    const store = await zoneBasedStore(session);
    await prisma.zoneTariff.create({
      data: {
        storeId: store.id,
        zoneCode: "23.01",
        rule: "FEE",
        deliveryFee: "300.00",
        sourceUpdatedAt: new Date(),
      },
    });
    const offer = await orderableOffer(session, store.id, "100.00");

    const result = await createOrder(
      orderBody({
        storeSlug: store.slug,
        items: [{ storeProductId: offer.id, qty: 1 }],
        zoneCode: "23.01",
        expectedTotal: "400.00",
      }),
    );
    expect(result.kind).toBe("created");
    const { code } = result as { code: string };

    const originalName = await prisma.zone
      .findUniqueOrThrow({ where: { code: "23.01" } })
      .then((z) => z.name);
    expect(originalName).toBe("Playa");

    await prisma.zone.update({
      where: { code: "23.01" },
      data: { name: "Nombre Cambiado Después Del Pedido" },
    });

    try {
      const row = await prisma.order.findUniqueOrThrow({
        where: { code },
        select: { deliveryZoneCode: true, deliveryZoneName: true },
      });
      expect(row.deliveryZoneCode).toBe("23.01");
      expect(row.deliveryZoneName).toBe("Playa");

      const pulledRow = await prisma.order.findUniqueOrThrow({
        where: { code },
        select: PULLED_ORDER_SELECT,
      });
      expect(toPulledOrder(pulledRow).contact.zoneName).toBe("Playa");
    } finally {
      // Deja el espejo tal como lo encontró — es una fila compartida del
      // catálogo committeado, no un fixture propio.
      await prisma.zone.update({ where: { code: "23.01" }, data: { name: originalName } });
    }
  });

  it("C13 — el tarifario sube entre cargar el checkout y confirmar: 409 con el importe nuevo nombrado, CERO pedidos nuevos, y re-confirmar cobra el importe nuevo", async () => {
    const store = await zoneBasedStore(session);
    await prisma.zoneTariff.create({
      data: {
        storeId: store.id,
        zoneCode: "23.01",
        rule: "FEE",
        deliveryFee: "300.00",
        sourceUpdatedAt: new Date(),
      },
    });
    const offer = await orderableOffer(session, store.id, "100.00");
    const before = await countOrders(store.id);

    // El comprador vio 300.00 en pantalla; la tienda sube la tarifa a
    // 350.00 ANTES de que confirme.
    await prisma.zoneTariff.update({
      where: { storeId_zoneCode: { storeId: store.id, zoneCode: "23.01" } },
      data: { deliveryFee: "350.00", sourceUpdatedAt: new Date() },
    });

    const stale = await createOrder(
      orderBody({
        storeSlug: store.slug,
        items: [{ storeProductId: offer.id, qty: 1 }],
        zoneCode: "23.01",
        expectedDeliveryFee: "300.00",
        expectedTotal: "400.00", // subtotal 100 + el envío VIEJO (300)
      }),
    );

    expect(stale.kind).toBe("price_changed");
    const priceChanged = stale as {
      total: string;
      delivery?: { was: string | null; now: string };
    };
    expect(priceChanged.total).toBe("450.00"); // subtotal 100 + el envío NUEVO (350)
    expect(priceChanged.delivery).toEqual({ was: "300.00", now: "350.00" });
    expect(await countOrders(store.id)).toBe(before);

    const confirmed = await createOrder(
      orderBody({
        storeSlug: store.slug,
        items: [{ storeProductId: offer.id, qty: 1 }],
        zoneCode: "23.01",
        expectedDeliveryFee: "350.00",
        expectedTotal: "450.00",
      }),
    );
    expect(confirmed.kind).toBe("created");
    expect(await countOrders(store.id)).toBe(before + 1);

    const { code } = confirmed as { code: string };
    const row = await prisma.order.findUniqueOrThrow({
      where: { code },
      select: { deliveryFee: true },
    });
    expect(money(row.deliveryFee!.toString(), "CUP").amount).toBe("350.00");
  });

  it("C14 — la zona deja de servirse entre cargar y confirmar: error DISTINGUIBLE, CERO pedidos — nunca un pedido de recogida creado en silencio (E16)", async () => {
    const store = await zoneBasedStore(session);
    await prisma.zoneTariff.create({
      data: {
        storeId: store.id,
        zoneCode: "23.01",
        rule: "FEE",
        deliveryFee: "300.00",
        sourceUpdatedAt: new Date(),
      },
    });
    const offer = await orderableOffer(session, store.id, "100.00");
    const before = await countOrders(store.id);

    await prisma.zoneTariff.update({
      where: { storeId_zoneCode: { storeId: store.id, zoneCode: "23.01" } },
      data: { rule: "NOT_SERVED", deliveryFee: null, sourceUpdatedAt: new Date() },
    });

    const result = await createOrder(
      orderBody({
        storeSlug: store.slug,
        items: [{ storeProductId: offer.id, qty: 1 }],
        zoneCode: "23.01",
        expectedTotal: "400.00",
      }),
    );

    expect(result).toEqual({ kind: "delivery_zone_not_served", zoneCode: "23.01" });
    expect(await countOrders(store.id)).toBe(before);

    // Y nada de lo anterior dejó un pedido de MOSTRADOR en su lugar.
    const pickupOrders = await prisma.order.count({
      where: { storeId: store.id, deliveryAddress: null },
    });
    expect(pickupOrders).toBe(0);
  });

  it("E20/E17 — DELIVERY sin zoneCode en absoluto (una tienda ZONE_BASED sin ninguna zona resoluble) responde el error propio, no crea un pedido de recogida", async () => {
    const store = await zoneBasedStore(session); // tarifario VACÍO
    const offer = await orderableOffer(session, store.id, "100.00");
    const before = await countOrders(store.id);

    const result = await createOrder(
      orderBody({
        storeSlug: store.slug,
        items: [{ storeProductId: offer.id, qty: 1 }],
        expectedTotal: "100.00",
      }),
    );

    expect(result).toEqual({ kind: "delivery_zone_required" });
    expect(await countOrders(store.id)).toBe(before);
  });
});
