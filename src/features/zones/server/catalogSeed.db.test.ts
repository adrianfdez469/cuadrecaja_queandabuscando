import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ZONE_INDEX_COUNTS, ZONE_INDEX_VERSION } from "../catalog";
import { readAppliedZoneCatalogVersion, seedZoneCatalog } from "./catalogSeed";

/**
 * F-041 — criterio 11 (paso 16, architecture.md § Componentes, fila
 * `catalogSeed.db.test.ts`): sembrar dos veces seguidas deja 184 filas y la
 * MISMA versión — the same guarantee the CI's own double `npm run seed`
 * (`.github/workflows/ci.yml`) already leans on. No fixture session here:
 * `Zone`/`ZoneCatalogVersion` are shared, catálogo-wide tables (never
 * scoped to one business), and every write here is idempotent by
 * construction (R9) — there is nothing to clean up afterwards that the
 * next run would not already overwrite identically.
 */

describe("seedZoneCatalog() against real Postgres (C11)", () => {
  it("seeding TWICE in a row leaves the same 184 rows and the same version — R9's own idempotence", async () => {
    const first = await seedZoneCatalog(prisma);
    const countAfterFirst = await prisma.zone.count();
    const firstLevelAfterFirst = await prisma.zone.count({ where: { level: "FIRST_LEVEL" } });
    const municipalityAfterFirst = await prisma.zone.count({ where: { level: "MUNICIPALITY" } });

    const second = await seedZoneCatalog(prisma);
    const countAfterSecond = await prisma.zone.count();
    const firstLevelAfterSecond = await prisma.zone.count({ where: { level: "FIRST_LEVEL" } });
    const municipalityAfterSecond = await prisma.zone.count({ where: { level: "MUNICIPALITY" } });

    expect(first.zoneCount).toBe(184);
    expect(second.zoneCount).toBe(184);
    expect(countAfterFirst).toBe(184);
    expect(countAfterSecond).toBe(184);
    expect(firstLevelAfterFirst).toBe(16);
    expect(firstLevelAfterSecond).toBe(16);
    expect(municipalityAfterFirst).toBe(168);
    expect(municipalityAfterSecond).toBe(168);
    expect(first.version).toBe(second.version);
    expect(first.sha256).toBe(second.sha256);
  });

  it("readAppliedZoneCatalogVersion (ONE query) reads the current version, matching catalog.ts's own ZONE_INDEX_VERSION and ZONE_INDEX_COUNTS", async () => {
    await seedZoneCatalog(prisma);

    const applied = await readAppliedZoneCatalogVersion(prisma);

    expect(applied?.version).toBe(ZONE_INDEX_VERSION);
    expect(applied?.zoneCount).toBe(ZONE_INDEX_COUNTS.total);
  });

  it("re-seeding never leaves TWO rows for the same version in ZoneCatalogVersion — an upsert by version, not an insert", async () => {
    await seedZoneCatalog(prisma);
    await seedZoneCatalog(prisma);

    const rowsForThisVersion = await prisma.zoneCatalogVersion.count({
      where: { version: ZONE_INDEX_VERSION },
    });

    expect(rowsForThisVersion).toBe(1);
  });

  it("re-seeding UPDATES an existing row rather than duplicating or dropping it — a known row survives byte-identical", async () => {
    await seedZoneCatalog(prisma);
    const before = await prisma.zone.findUniqueOrThrow({ where: { code: "21.01" } });

    await seedZoneCatalog(prisma); // second run over the SAME artefact

    const after = await prisma.zone.findUniqueOrThrow({ where: { code: "21.01" } });
    expect(after).toEqual(before);
  });

  it("never deletes (R4): a row present in the base and absent from a hypothetical smaller artefact would stay — checked here as 'the base never SHRINKS across two runs'", async () => {
    const before = await prisma.zone.count();
    await seedZoneCatalog(prisma);
    const after = await prisma.zone.count();
    expect(after).toBeGreaterThanOrEqual(before);
  });
});
