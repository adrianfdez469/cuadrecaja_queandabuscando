import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createFixtureSession,
  type FixtureSession,
} from "@/features/marketplace/server/dbFixtures";
import { findZone } from "../catalog";
import { resolveZoneTariff } from "../precedence";
import { resolveStoreZoneTariff } from "./tariffs";

/**
 * F-041 — criterio 7 (paso 16, architecture.md § Componentes, fila
 * `tariffs.db.test.ts`): REAL rows of `ZoneTariff`, written straight with
 * Prisma (never through the sync's `POST` — that path belongs to
 * `zoneTariff.db.test.ts`), entering `resolveStoreZoneTariff` — the ONE
 * round-trip, ≤2-row reader (architecture.md § Flujo C) — and matching what
 * the pure `resolveZoneTariff` computes over the exact same rows. All zone
 * codes below are REAL rows of the committed catalog (Pinar del Río `21`
 * and its municipalities, Artemisa `22`, the Isla de la Juventud `40`), the
 * same choice `zoneTariff.db.test.ts` makes and for the same reason: a
 * regeneration that retires or renames one of these fails loudly here.
 */

describe("resolveStoreZoneTariff() against real Postgres (C7)", () => {
  let session: FixtureSession;

  beforeEach(async () => {
    session = await createFixtureSession();
  });

  afterEach(async () => {
    await session.cleanup();
  });

  it("null when zoneCode is not in the published catalog — the caller decides what that means, this reader never queries for an unknown code's rows", async () => {
    const store = await session.createStore();
    const result = await resolveStoreZoneTariff(prisma, store.id, "99.99");
    expect(result).toBeNull();
  });

  it("a municipality with its OWN FEE row decides on its own — matches resolveZoneTariff() over the same row", async () => {
    const store = await session.createStore();
    await prisma.zoneTariff.create({
      data: {
        storeId: store.id,
        zoneCode: "21.01",
        rule: "FEE",
        deliveryFee: "300.00",
        sourceUpdatedAt: new Date("2026-09-08T10:00:00.000Z"),
      },
    });

    const result = await resolveStoreZoneTariff(prisma, store.id, "21.01");

    expect(result).toEqual(
      resolveZoneTariff(findZone("21.01")!, [
        { zoneCode: "21.01", rule: "FEE", deliveryFee: "300.00" },
      ]),
    );
    expect(result).toMatchObject({ served: true, deliveryFee: "300.00", decidedBy: "21.01" });
  });

  it("municipality absent, province FEE decides — the reader loads BOTH rows in one query and hands them to the pure function (R26)", async () => {
    const store = await session.createStore();
    await prisma.zoneTariff.create({
      data: {
        storeId: store.id,
        zoneCode: "21",
        rule: "FEE",
        deliveryFee: "400.00",
        sourceUpdatedAt: new Date("2026-09-08T10:00:00.000Z"),
      },
    });

    const result = await resolveStoreZoneTariff(prisma, store.id, "21.03");

    expect(result).toEqual(
      resolveZoneTariff(findZone("21.03")!, [
        { zoneCode: "21", rule: "FEE", deliveryFee: "400.00" },
      ]),
    );
    expect(result).toMatchObject({ served: true, deliveryFee: "400.00", decidedBy: "21" });
    expect(result?.path).toEqual([
      { code: "21.03", level: "MUNICIPALITY", verdict: "ABSENT", decides: false },
      { code: "21", level: "FIRST_LEVEL", verdict: "FEE", decides: true },
    ]);
  });

  it("criterio 7: a province-level INHERIT row is accepted, and a municipality with NO row of its own then resolves as NOT served", async () => {
    const store = await session.createStore();
    await prisma.zoneTariff.create({
      data: {
        storeId: store.id,
        zoneCode: "21",
        rule: "INHERIT",
        sourceUpdatedAt: new Date("2026-09-08T10:00:00.000Z"),
      },
    });

    const result = await resolveStoreZoneTariff(prisma, store.id, "21.05");

    expect(result).toEqual(
      resolveZoneTariff(findZone("21.05")!, [{ zoneCode: "21", rule: "INHERIT" }]),
    );
    expect(result).toMatchObject({ served: false, deliveryFee: null, decidedBy: null });
  });

  it("reads AT MOST the ≤2 relevant rows — a tariff of an unrelated province never leaks into this zone's resolution", async () => {
    const store = await session.createStore();
    await prisma.zoneTariff.create({
      data: {
        storeId: store.id,
        zoneCode: "22",
        rule: "FEE",
        deliveryFee: "999.00",
        sourceUpdatedAt: new Date("2026-09-08T10:00:00.000Z"),
      },
    });

    const result = await resolveStoreZoneTariff(prisma, store.id, "21.01");

    expect(result).toMatchObject({ served: false, deliveryFee: null, decidedBy: null });
  });

  it("a FIRST_LEVEL zone consulted directly has exactly ONE escalón and never looks at a province (R26, the Isla de la Juventud)", async () => {
    const store = await session.createStore();

    const result = await resolveStoreZoneTariff(prisma, store.id, "40");

    expect(result).toEqual(resolveZoneTariff(findZone("40")!, []));
    expect(result?.path).toEqual([
      { code: "40", level: "FIRST_LEVEL", verdict: "ABSENT", decides: false },
    ]);
  });

  it("two rows for the SAME (store, zone) pair never happen — the primary key is (storeId, zoneCode), so this reads a real row written by an upsert-shaped write", async () => {
    const store = await session.createStore();
    await prisma.zoneTariff.upsert({
      where: { storeId_zoneCode: { storeId: store.id, zoneCode: "21.01" } },
      create: {
        storeId: store.id,
        zoneCode: "21.01",
        rule: "FEE",
        deliveryFee: "100.00",
        sourceUpdatedAt: new Date("2026-09-08T10:00:00.000Z"),
      },
      update: {},
    });
    await prisma.zoneTariff.upsert({
      where: { storeId_zoneCode: { storeId: store.id, zoneCode: "21.01" } },
      create: {
        storeId: store.id,
        zoneCode: "21.01",
        rule: "FEE",
        deliveryFee: "999.00",
        sourceUpdatedAt: new Date("2026-09-08T11:00:00.000Z"),
      },
      update: { deliveryFee: "150.00", sourceUpdatedAt: new Date("2026-09-08T11:00:00.000Z") },
    });

    const result = await resolveStoreZoneTariff(prisma, store.id, "21.01");
    expect(result).toMatchObject({ served: true, deliveryFee: "150.00", decidedBy: "21.01" });
  });
});
