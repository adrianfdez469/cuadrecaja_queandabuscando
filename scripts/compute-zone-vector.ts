/**
 * Computes the ZONE_TARIFF precedence vector by RUNNING `resolveZoneTariff`
 * over a fixed fixture — never by hand-transcribing an "expected" object
 * (F-041, criterio 1/13, architecture.md § Componentes, fila "Calculadora
 * del vector"). Prints the JSON block that gets pasted, verbatim, under
 * "#### Vector de precedencia de ZONE_TARIFF (v13)" in
 * `docs/sync-contract.md` — the same block `precedence.test.ts` (por crear)
 * re-parses from that document and re-executes against.
 *
 * Ten precedence cases (V1-V10) plus the three guards of R27 (G1-G3),
 * reconstructed from spec.md § "El vector de precedencia" — not literally
 * the ten cross-checked with cuadrecaja on 2026-09-06, whose exact
 * composition is not written anywhere in this repository (I3). The plan is
 * to publish this UNION with theirs when the v13 draft goes out (SP1), never
 * the intersection.
 *
 * Pure computation, no Prisma, no network:
 *
 *   npx tsx scripts/compute-zone-vector.ts   # via `npm run vector:zones`
 */
import { resolveZoneTariff, type TariffRow, type ZoneRef } from "../src/features/zones/precedence";

type Case = { id: string; zone: ZoneRef; rows: TariffRow[] };

// The whole fixture is ONE store's tariff (spec.md § El vector de
// precedencia): synthetic codes chosen so that deducing level/province from
// the shape of the code — the antipattern R3 exists to forbid — fails
// visibly. `03.40` is declared FIRST_LEVEL despite looking like a
// municipality of `03` (V10, the Isla de la Juventud pattern in reverse).
const PROVINCE_03_FEE: TariffRow = { zoneCode: "03", rule: "FEE", deliveryFee: 300 };
const PROVINCE_04_NOT_SERVED: TariffRow = { zoneCode: "04", rule: "NOT_SERVED" };
const PROVINCE_05_INHERIT: TariffRow = { zoneCode: "05", rule: "INHERIT" };

const cases: Case[] = [
  {
    id: "V1",
    zone: { code: "03.05", level: "MUNICIPALITY", provinceCode: "03" },
    rows: [{ zoneCode: "03.05", rule: "NOT_SERVED" }],
  },
  {
    id: "V2",
    zone: { code: "03.03", level: "MUNICIPALITY", provinceCode: "03" },
    rows: [{ zoneCode: "03.03", rule: "INHERIT" }, PROVINCE_03_FEE],
  },
  {
    id: "V3",
    zone: { code: "03.04", level: "MUNICIPALITY", provinceCode: "03" },
    rows: [PROVINCE_03_FEE], // 03.04 itself has no row — absent.
  },
  {
    id: "V4",
    zone: { code: "03.07", level: "MUNICIPALITY", provinceCode: "03" },
    rows: [{ zoneCode: "03.07", rule: "FEE", deliveryFee: 150 }],
  },
  {
    id: "V5",
    zone: { code: "04.02", level: "MUNICIPALITY", provinceCode: "04" },
    rows: [{ zoneCode: "04.02", rule: "FEE", deliveryFee: 200 }],
  },
  {
    id: "V6",
    zone: { code: "04.05", level: "MUNICIPALITY", provinceCode: "04" },
    rows: [PROVINCE_04_NOT_SERVED], // 04.05 itself has no row — absent.
  },
  {
    id: "V7",
    zone: { code: "05.03", level: "MUNICIPALITY", provinceCode: "05" },
    // The pair with V2/V3: same amount, same deciding row, two different
    // paths — this is what justifies publishing the WHOLE path, not just
    // the decisive row (R28).
    rows: [{ zoneCode: "05.03", rule: "FEE", deliveryFee: 250 }, PROVINCE_05_INHERIT],
  },
  {
    id: "V8",
    zone: { code: "05.04", level: "MUNICIPALITY", provinceCode: "05" },
    rows: [PROVINCE_05_INHERIT], // 05.04 absent, province declines too.
  },
  {
    id: "V9",
    zone: { code: "06.01", level: "MUNICIPALITY", provinceCode: "06" },
    rows: [], // both 06.01 and 06 are absent from the tariff entirely.
  },
  {
    id: "V10",
    // R3, the Isla de la Juventud pattern in reverse: FIRST_LEVEL declared
    // with a `provinceCode` that LOOKS like it should matter and must not.
    zone: { code: "03.40", level: "FIRST_LEVEL", provinceCode: "03" },
    rows: [],
  },
  {
    id: "G1",
    zone: { code: "03.09", level: "MUNICIPALITY", provinceCode: "03" },
    // R27(1): FEE with no `deliveryFee` at all does not decide.
    rows: [{ zoneCode: "03.09", rule: "FEE" }, PROVINCE_03_FEE],
  },
  {
    id: "G2",
    zone: { code: "03.10", level: "MUNICIPALITY", provinceCode: "03" },
    // R27(2): FEE with `0` DOES decide — free shipping, not "not served".
    rows: [{ zoneCode: "03.10", rule: "FEE", deliveryFee: 0 }],
  },
  {
    id: "G3",
    zone: { code: "03.11", level: "MUNICIPALITY", provinceCode: "03" },
    // R27(3): a negative amount does not decide, on top of the schema
    // rejecting it outright — so a corrupt row resolves the same on both
    // sides even if it should never exist.
    rows: [{ zoneCode: "03.11", rule: "FEE", deliveryFee: -50 }, PROVINCE_03_FEE],
  },
];

const fixtureZones = cases.map((c) => c.zone);
const fixtureRowsByCode = new Map<string, TariffRow>();
for (const c of cases) {
  for (const row of c.rows) fixtureRowsByCode.set(row.zoneCode, row);
}

const vector = {
  version: "1",
  fixture: {
    zones: fixtureZones,
    rows: [...fixtureRowsByCode.values()],
  },
  cases: cases.map((c) => ({
    id: c.id,
    zone: c.zone,
    rows: c.rows,
    expected: resolveZoneTariff(c.zone, c.rows),
  })),
};

console.log(JSON.stringify(vector, null, 2));
