import type { ZoneLevel } from "@/generated/prisma/enums";
import zoneIndexArtifact from "./zone-index.json";

/**
 * The reader of the committed zone index (F-041, architecture.md § Decisión
 * (2)). Sin `fs`, sin Prisma, sin React: `zone-index.json` is imported
 * STATICALLY, which is what makes the schema's `400 INVALID_BATCH` on an
 * unknown zone reachable without a database round-trip (I7) — and what a
 * lot of 500 `ZONE_TARIFF`s validates for FREE inside the `safeParse` that
 * already runs (§ Escalabilidad, punto 2).
 *
 * The artefact is the AUTHORITY (§ Decisión, la forma general): this module
 * only reads it. The `Zone`/`ZoneTariff`/`Store.zoneCode` tables in Postgres
 * are its MIRROR, sembrado by `src/features/zones/server/catalogSeed.ts`
 * (por crear) — never the other way around.
 *
 * `import type` of the generated enum only: cero bytes at runtime, and the
 * one vocabulary this feature commits to never writing a hand-rolled union
 * of literals for (I4's lesson applied up front).
 */

export type ZoneCatalogEntry = {
  code: string;
  name: string;
  level: ZoneLevel;
  /** Present on every municipality row, `null` on every first-level row (R2). */
  provinceCode: string | null;
  /** OSM relation id. NOT unique (I9): the Isla de la Juventud's first-level
   *  row and its only municipality share one. Never travels on the wire. */
  osmRelationId: string;
  /** The zone's OSM name at generation time, for diffing a regeneration. */
  osmName: string;
  /** ISO string, or `null` when the zone is not retired (R4). */
  retiredAt: string | null;
};

type ZoneIndexArtifact = {
  version: string;
  generatedAt: string;
  zones: ZoneCatalogEntry[];
};

const artifact = zoneIndexArtifact as ZoneIndexArtifact;

/** `1.0.0` today. Moves the MINOR on any row change, the MAJOR on a
 *  different DPA edition (architecture.md § La versión del índice). Read by
 *  the seeder to anotar `ZoneCatalogVersion.version`. */
export const ZONE_INDEX_VERSION: string = artifact.version;

const ZONE_INDEX: ReadonlyMap<string, ZoneCatalogEntry> = new Map(
  artifact.zones.map((zone) => [zone.code, zone]),
);

/** R7/C16: 184 total, 16 first-level, 168 municipality — computed from the
 *  artefact itself, never hand-counted, so a regeneration cannot drift from
 *  what this constant says without the integrity test catching it. */
export const ZONE_INDEX_COUNTS = {
  total: artifact.zones.length,
  firstLevel: artifact.zones.filter((z) => z.level === "FIRST_LEVEL").length,
  municipality: artifact.zones.filter((z) => z.level === "MUNICIPALITY").length,
} as const;

/** `null` when `code` is not in the published catalog — the caller decides
 *  what that means (a `400` in the sobre's schema, a `failed[]` in `STORE`). */
export function findZone(code: string): ZoneCatalogEntry | null {
  return ZONE_INDEX.get(code) ?? null;
}

export function isKnownZoneCode(code: string): boolean {
  return ZONE_INDEX.has(code);
}

/** R19: a retired zone is still known and still resolves — it is just not
 *  offered (F-042's concern). `false` for a code that is not in the catalog
 *  at all: "retired" and "unknown" are different questions. */
export function isRetiredZone(code: string): boolean {
  return ZONE_INDEX.get(code)?.retiredAt != null;
}

/** F-042 (AD3, R2) — the 168 municipality rows, for computing a store's
 *  coverage without a second copy of the index outside this module. Read
 *  ONCE per render by `src/features/zones/server/coverage.ts`, never
 *  queried: the definition of "offerable" (R1) only ever needs this array
 *  plus the tariff rows already loaded in the SAME round-trip. */
export function listMunicipalities(): readonly ZoneCatalogEntry[] {
  return artifact.zones.filter((zone) => zone.level === "MUNICIPALITY");
}
