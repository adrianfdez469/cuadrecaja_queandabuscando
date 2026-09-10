import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findZone,
  isKnownZoneCode,
  isRetiredZone,
  ZONE_INDEX_COUNTS,
  ZONE_INDEX_VERSION,
} from "./catalog";

/**
 * F-041 — criterio 16 / E22 (paso 16, architecture.md § Componentes, fila
 * `catalog.test.ts`): the committed artefact's own integrity, checked by
 * EXECUTING against the real bytes on disk, never by re-typing the numbers
 * R7 already promises. The sha256 is cross-checked against the one
 * published in `docs/sync-contract.md` § "La versión del catálogo
 * geográfico" — read from the document, same technique
 * `fieldOwnership.test.ts` already uses, so a hand-edited number in either
 * file is what this test is FOR.
 */

const ROOT = process.cwd();
const ARTIFACT_PATH = join(ROOT, "src/features/zones/zone-index.json");
const CONTRACT_PATH = join(ROOT, "docs/sync-contract.md");
const CONTRACT_HEADING = "### La versión del catálogo geográfico";

type ZoneEntry = {
  code: string;
  name: string;
  level: "FIRST_LEVEL" | "MUNICIPALITY";
  provinceCode: string | null;
  osmRelationId: string;
  osmName: string;
  retiredAt: string | null;
};

type Artifact = { version: string; generatedAt: string; zones: ZoneEntry[] };

const raw = readFileSync(ARTIFACT_PATH);
const artifact = JSON.parse(raw.toString("utf8")) as Artifact;

/** The sha256 row of § "La versión del catálogo geográfico", read from the
 *  document itself — never transcribed. */
function publishedSha256(): string {
  const contract = readFileSync(CONTRACT_PATH, "utf8");
  const headingIndex = contract.indexOf(CONTRACT_HEADING);
  if (headingIndex === -1) {
    throw new Error(
      `catalog.test.ts: heading "${CONTRACT_HEADING}" not found in docs/sync-contract.md`,
    );
  }
  const rest = contract.slice(headingIndex);
  const nextHeading = /\n#{2,4} /.exec(rest.slice(1));
  const section = nextHeading ? rest.slice(0, nextHeading.index + 1) : rest;
  const match = /`sha256`[^|]*\|\s*`([0-9a-f]{64})`/.exec(section);
  if (!match) {
    throw new Error(
      'catalog.test.ts: no `sha256` row found under § "La versión del catálogo geográfico"',
    );
  }
  return match[1];
}

describe("zone-index.json artefact integrity (C16, E22)", () => {
  it("184 rows total: 16 FIRST_LEVEL + 168 MUNICIPALITY (R7)", () => {
    expect(artifact.zones).toHaveLength(184);
    expect(artifact.zones.filter((z) => z.level === "FIRST_LEVEL")).toHaveLength(16);
    expect(artifact.zones.filter((z) => z.level === "MUNICIPALITY")).toHaveLength(168);
  });

  it("ZONE_INDEX_COUNTS (catalog.ts's own export) agrees with a fresh count of the artefact", () => {
    expect(ZONE_INDEX_COUNTS).toEqual({ total: 184, firstLevel: 16, municipality: 168 });
  });

  it("no duplicated code", () => {
    const codes = artifact.zones.map((z) => z.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("every MUNICIPALITY row's provinceCode exists as a FIRST_LEVEL row, and no FIRST_LEVEL row carries one (R2, R3)", () => {
    const firstLevelCodes = new Set(
      artifact.zones.filter((z) => z.level === "FIRST_LEVEL").map((z) => z.code),
    );
    for (const zone of artifact.zones) {
      if (zone.level === "MUNICIPALITY") {
        expect(zone.provinceCode).not.toBeNull();
        expect(firstLevelCodes.has(zone.provinceCode as string)).toBe(true);
      } else {
        expect(zone.provinceCode).toBeNull();
      }
    }
  });

  it("183 distinct osmRelationId — the ONLY repeat is the Isla de la Juventud (40 / 40.01, I9)", () => {
    const byRelation = new Map<string, string[]>();
    for (const zone of artifact.zones) {
      const codes = byRelation.get(zone.osmRelationId) ?? [];
      codes.push(zone.code);
      byRelation.set(zone.osmRelationId, codes);
    }
    expect(byRelation.size).toBe(183);

    const repeated = [...byRelation.entries()].filter(([, codes]) => codes.length > 1);
    expect(repeated).toHaveLength(1);
    const [relationId, codes] = repeated[0];
    expect(relationId).toBe("1854614");
    expect([...codes].sort()).toEqual(["40", "40.01"]);
  });

  it("no row is retired today — R4's 'read but not offered' has nothing to exercise here yet", () => {
    expect(artifact.zones.every((z) => z.retiredAt === null)).toBe(true);
  });

  it("the artefact's own sha256 matches the one published in docs/sync-contract.md § La versión del catálogo geográfico", () => {
    const actualSha256 = createHash("sha256").update(raw).digest("hex");
    expect(actualSha256).toBe(publishedSha256());
  });

  it("ZONE_INDEX_VERSION (what the seeder reads) matches the artefact's own `version` field", () => {
    expect(ZONE_INDEX_VERSION).toBe(artifact.version);
  });

  /**
   * F-043 (architecture.md § AD2, plan.md paso 6): the DPA shape gains its
   * FIRST assertion — until this feature, nothing checked that the 184
   * committed codes actually match it, only that the schema's own
   * `.regex(ZONE_CODE_PATTERN)` rejected a bad VALUE (removed in paso 3,
   * moved to the handler's `isKnownZoneCode`, which never re-checks the
   * shape). The pattern is a LOCAL constant of this test on purpose:
   * `ZONE_CODE_PATTERN` is no longer exported from `catalog.ts` (paso 5),
   * and re-exporting it to reuse it here would undo that decision — the
   * only production question left is "is it in the index?", never "does it
   * look right?" (architecture.md § AD2).
   */
  it("every one of the 184 committed codes matches the DPA's own shape (F-043, architecture.md § AD2) — checked here for the first time", () => {
    const ZONE_CODE_PATTERN = /^\d{2}(\.\d{2})?$/;
    for (const zone of artifact.zones) {
      expect(zone.code).toMatch(ZONE_CODE_PATTERN);
    }
  });
});

describe("catalog.ts reader — findZone / isKnownZoneCode / isRetiredZone (C6, C9)", () => {
  it("findZone resolves a known first-level code with its declared level and null provinceCode", () => {
    expect(findZone("21")).toMatchObject({
      code: "21",
      level: "FIRST_LEVEL",
      provinceCode: null,
    });
  });

  it("findZone resolves a known municipality with its declared provinceCode", () => {
    expect(findZone("21.01")).toMatchObject({
      code: "21.01",
      level: "MUNICIPALITY",
      provinceCode: "21",
    });
  });

  it("findZone returns null for a code the catalog does not know", () => {
    expect(findZone("99.99")).toBeNull();
  });

  it("isKnownZoneCode agrees with findZone for both a known and an unknown code", () => {
    expect(isKnownZoneCode("21")).toBe(true);
    expect(isKnownZoneCode("99.99")).toBe(false);
  });

  it("isRetiredZone is false for a known, non-retired code and for an unknown code alike (R19: 'retired' and 'unknown' are different questions)", () => {
    expect(isRetiredZone("21")).toBe(false);
    expect(isRetiredZone("99.99")).toBe(false);
  });

  it("the Isla de la Juventud pattern: 40 is FIRST_LEVEL, 40.01 is its own MUNICIPALITY row, and neither is deduced from the other's shape (R3)", () => {
    expect(findZone("40")).toMatchObject({ level: "FIRST_LEVEL", provinceCode: null });
    expect(findZone("40.01")).toMatchObject({ level: "MUNICIPALITY", provinceCode: "40" });
  });
});
