import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createFixtureSession,
  type FixtureSession,
  type FixtureStore,
} from "@/features/marketplace/server/dbFixtures";
import { loadStoreZoneCoverage } from "./coverage";

/**
 * F-042 (architecture.md § Componentes, fila `coverage.db.test.ts`; § AD3) —
 * C1, C9: la ÚNICA consulta real que decide el conjunto ofrecible, contra
 * Postgres real y con filas de `ZoneTariff` reales. Todos los códigos de
 * zona son filas REALES del catálogo committeado (La Habana `23` y sus
 * municipios, Pinar del Río `21`) — los mismos que `tariffs.db.test.ts` de
 * F-041 usa, y por el mismo motivo: una regeneración que retire o renombre
 * uno de estos falla aquí a la vista.
 *
 * `session.createStore()` no acepta `deliveryEnabled`/`deliveryFeeMode`
 * (F-041/F-042 no lo necesitaron hasta ahora) — se escriben con
 * `prisma.store.update` directo, igual que `zoneTariff.db.test.ts` hace por
 * su propio camino (el sync) para el mismo par de columnas.
 */

async function zoneBasedStore(
  session: FixtureSession,
  overrides: { deliveryEnabled?: boolean } = {},
): Promise<FixtureStore> {
  const store = await session.createStore();
  await prisma.store.update({
    where: { id: store.id },
    data: {
      deliveryEnabled: overrides.deliveryEnabled ?? true,
      deliveryFeeMode: "ZONE_BASED",
    },
  });
  return store;
}

describe("loadStoreZoneCoverage() against real Postgres — C1, C9", () => {
  let session: FixtureSession;

  beforeEach(async () => {
    session = await createFixtureSession();
  });

  afterEach(async () => {
    await session.cleanup();
  });

  it("null when the store is not ZONE_BASED — the default FLAT_RATE never needs a coverage read", async () => {
    const store = await session.createStore();
    const result = await loadStoreZoneCoverage(prisma, store.id);
    expect(result).toBeNull();
  });

  it("null when deliveryEnabled is false, even ZONE_BASED with real tariff rows on file", async () => {
    const store = await zoneBasedStore(session, { deliveryEnabled: false });
    await prisma.zoneTariff.create({
      data: {
        storeId: store.id,
        zoneCode: "23",
        rule: "FEE",
        deliveryFee: "300.00",
        sourceUpdatedAt: new Date(),
      },
    });
    expect(await loadStoreZoneCoverage(prisma, store.id)).toBeNull();
  });

  it("C9 fixture 1/3 — an EMPTY tariff is a valid ZONE_BASED store: [] (not null), no domicilio to offer", async () => {
    const store = await zoneBasedStore(session);
    expect(await loadStoreZoneCoverage(prisma, store.id)).toEqual([]);
  });

  it("C9 fixture 2/3 — only INHERIT rows: still []. INHERIT never decides on its own (R27 of F-041)", async () => {
    const store = await zoneBasedStore(session);
    await prisma.zoneTariff.create({
      data: { storeId: store.id, zoneCode: "23", rule: "INHERIT", sourceUpdatedAt: new Date() },
    });
    expect(await loadStoreZoneCoverage(prisma, store.id)).toEqual([]);
  });

  it("C9 fixture 3/3 — only NOT_SERVED rows: still []", async () => {
    const store = await zoneBasedStore(session);
    await prisma.zoneTariff.create({
      data: {
        storeId: store.id,
        zoneCode: "23.01",
        rule: "NOT_SERVED",
        sourceUpdatedAt: new Date(),
      },
    });
    expect(await loadStoreZoneCoverage(prisma, store.id)).toEqual([]);
  });

  it("C1 — a NOT_SERVED municipality under a province with FEE does not appear, in NEITHER code nor name, while its siblings inherit the province fee", async () => {
    const store = await zoneBasedStore(session);
    await prisma.zoneTariff.create({
      data: {
        storeId: store.id,
        zoneCode: "23",
        rule: "FEE",
        deliveryFee: "300.00",
        sourceUpdatedAt: new Date(),
      },
    });
    await prisma.zoneTariff.create({
      data: {
        storeId: store.id,
        zoneCode: "23.05",
        rule: "NOT_SERVED",
        sourceUpdatedAt: new Date(),
      },
    });

    const result = await loadStoreZoneCoverage(prisma, store.id);
    expect(result).not.toBeNull();
    const codes = result!.map((zone) => zone.code);

    // La Habana (23) tiene 15 municipios; 23.05 (Regla) queda fuera —
    // exactamente 14, ni la provincia entera ni menos de lo que cubre.
    expect(codes).toHaveLength(14);
    expect(codes).not.toContain("23.05");
    expect(result!.some((zone) => zone.name === "Regla")).toBe(false);

    expect(codes).toContain("23.01");
    const playa = result!.find((zone) => zone.code === "23.01")!;
    expect(playa.name).toBe("Playa");
    expect(playa.deliveryFee).toBe("300.00");
    expect(playa.provinceName).toBe("La Habana");
  });

  it("free shipping (FEE 0) is offerable and its fee is the STRING '0.00', never dropped as falsy (R10)", async () => {
    const store = await zoneBasedStore(session);
    await prisma.zoneTariff.create({
      data: {
        storeId: store.id,
        zoneCode: "21.01",
        rule: "FEE",
        deliveryFee: "0",
        sourceUpdatedAt: new Date(),
      },
    });
    const result = await loadStoreZoneCoverage(prisma, store.id);
    const zone = result!.find((z) => z.code === "21.01");
    expect(zone).toBeDefined();
    expect(zone!.deliveryFee).toBe("0.00");
  });

  it("a FIRST_LEVEL code is never offerable, even with its own FEE row directly on it (R1(1), R3): only MUNICIPALITY zones ever enter the coverage", async () => {
    const store = await zoneBasedStore(session);
    await prisma.zoneTariff.create({
      data: {
        storeId: store.id,
        zoneCode: "23",
        rule: "FEE",
        deliveryFee: "300.00",
        sourceUpdatedAt: new Date(),
      },
    });
    const result = await loadStoreZoneCoverage(prisma, store.id);
    expect(result!.some((zone) => zone.code === "23")).toBe(false);
    // Its 15 municipalities DO inherit it, though — the province row decides
    // FOR them, never for itself (R1(1)/R3).
    expect(result).toHaveLength(15);
  });

  it("a municipality's OWN row wins over its province's — 21.01 with its own FEE ignores a province FEE of a different amount", async () => {
    const store = await zoneBasedStore(session);
    await prisma.zoneTariff.create({
      data: {
        storeId: store.id,
        zoneCode: "21",
        rule: "FEE",
        deliveryFee: "999.00",
        sourceUpdatedAt: new Date(),
      },
    });
    await prisma.zoneTariff.create({
      data: {
        storeId: store.id,
        zoneCode: "21.01",
        rule: "FEE",
        deliveryFee: "150.00",
        sourceUpdatedAt: new Date(),
      },
    });
    const result = await loadStoreZoneCoverage(prisma, store.id);
    const sandino = result!.find((zone) => zone.code === "21.01")!;
    expect(sandino.deliveryFee).toBe("150.00");
    // The rest of Pinar del Río's municipalities still inherit the 999.00.
    const mantua = result!.find((zone) => zone.code === "21.02")!;
    expect(mantua.deliveryFee).toBe("999.00");
  });
});
