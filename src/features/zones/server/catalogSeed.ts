import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ZoneLevel } from "@/generated/prisma/enums";

/**
 * F-041 — the seeder of the zone catalog (architecture.md § La siembra, en
 * un statement). Reads `src/features/zones/zone-index.json` with `fs`
 * ITSELF — never through `catalog.ts`'s static import — and hashes/parses
 * the SAME bytes, so `ZoneCatalogVersion.sha256` is always the hash of the
 * content that was actually seeded, whatever a bundler did to the module
 * elsewhere.
 *
 * ONE `INSERT … ON CONFLICT ("code") DO UPDATE` for the whole artefact (184
 * rows × 7 columns = 1288 bound parameters, one round trip): Prisma has no
 * bulk upsert, and 184 individual `upsert` calls would be 184 round trips
 * per seeding. Precedent for raw SQL when the typed API cannot express the
 * operation: `docs/adr/0019-sql-crudo-para-tsvector-y-pruebas-contra-postgres-real.md`,
 * `src/features/marketplace/server/searchVector.ts`. No `$transaction`: the
 * Supavisor pooler runs in transaction mode and the global client cannot
 * enter one (AGENTS.md § Cosas que muerden).
 */

export type ZoneCatalogSeeder = Pick<PrismaClient, "$executeRaw" | "zone" | "zoneCatalogVersion">;
export type ZoneCatalogVersionReader = Pick<PrismaClient, "zoneCatalogVersion">;

type ZoneIndexRow = {
  code: string;
  name: string;
  level: ZoneLevel;
  provinceCode: string | null;
  osmRelationId: string;
  osmName: string;
  retiredAt: string | null;
};

type ZoneIndexArtifact = {
  version: string;
  generatedAt: string;
  zones: ZoneIndexRow[];
};

const ARTIFACT_PATH = join(__dirname, "..", "zone-index.json");

export type SeedZoneCatalogResult = {
  version: string;
  sha256: string;
  zoneCount: number;
};

/**
 * Idempotent and UPDATING at once (R9): a second run leaves the same 184
 * rows, and a new index version updates name/level/provinceCode/osmName/
 * retiredAt of rows that already exist — which
 * `createMany({ skipDuplicates: true })` does NOT do (it only covers the
 * first seeding). Never deletes (R4): a row in the base and not in the
 * artefact stays, and if the base ever has MORE rows than the artefact this
 * warns instead of staying silent.
 */
export async function seedZoneCatalog(db: ZoneCatalogSeeder): Promise<SeedZoneCatalogResult> {
  const raw = readFileSync(ARTIFACT_PATH);
  const sha256 = createHash("sha256").update(raw).digest("hex");
  const artifact = JSON.parse(raw.toString("utf8")) as ZoneIndexArtifact;

  // First-level rows before their municipalities: within ONE multi-row
  // INSERT, Postgres checks each row's FK as it is inserted (not deferred),
  // so a municipality referencing a `provinceCode` inserted later in the
  // SAME statement would fail. `34` sorts before `34.01` on its own, but the
  // explicit split makes the requirement legible instead of accidental.
  const ordered = [
    ...artifact.zones.filter((z) => z.level === "FIRST_LEVEL"),
    ...artifact.zones.filter((z) => z.level === "MUNICIPALITY"),
  ];

  const values = ordered.map(
    (z) =>
      Prisma.sql`(${z.code}, ${z.name}, ${z.level}::"ZoneLevel", ${z.provinceCode}, ${z.osmRelationId}, ${z.osmName}, ${z.retiredAt ? new Date(z.retiredAt) : null}::timestamp)`,
  );

  await db.$executeRaw(Prisma.sql`
    INSERT INTO "Zone" ("code", "name", "level", "provinceCode", "osmRelationId", "osmName", "retiredAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("code") DO UPDATE SET
      "name" = EXCLUDED."name",
      "level" = EXCLUDED."level",
      "provinceCode" = EXCLUDED."provinceCode",
      "osmRelationId" = EXCLUDED."osmRelationId",
      "osmName" = EXCLUDED."osmName",
      "retiredAt" = EXCLUDED."retiredAt"
  `);

  await db.zoneCatalogVersion.upsert({
    where: { version: artifact.version },
    create: {
      version: artifact.version,
      sha256,
      generatedAt: new Date(artifact.generatedAt),
      zoneCount: artifact.zones.length,
    },
    update: {
      sha256,
      generatedAt: new Date(artifact.generatedAt),
      zoneCount: artifact.zones.length,
    },
  });

  const baseCount = await db.zone.count();
  if (baseCount > artifact.zones.length) {
    console.warn("[zones] the base has more zone rows than the artefact declares", {
      baseCount,
      artifactCount: artifact.zones.length,
    });
  }

  return { version: artifact.version, sha256, zoneCount: artifact.zones.length };
}

/** Criterio 11: the currently applied version, its hash and its date, with
 *  ONE query — the highest `appliedAt`, which is always the last
 *  `seedZoneCatalog` call to touch this row (an upsert never inserts a
 *  second row for the same `version`, so this is also the only row for
 *  that version). */
export async function readAppliedZoneCatalogVersion(db: ZoneCatalogVersionReader) {
  return db.zoneCatalogVersion.findFirst({ orderBy: { appliedAt: "desc" } });
}
