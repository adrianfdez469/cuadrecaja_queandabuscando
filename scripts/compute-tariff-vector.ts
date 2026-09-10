/**
 * Computes the ZONE_TARIFF hash vector by RUNNING `tariffReconciliation` —
 * never by hand-transcribing an "expected" object (F-044, plan.md paso 5,
 * architecture.md § Componentes, fila "Calculadora del vector", precedent:
 * `scripts/compute-zone-vector.ts`). Prints the JSON block that gets pasted,
 * verbatim, under "#### Vector del hash del tarifario (v13.4)" in
 * `docs/sync-contract.md` — the same block `reconciliationHash.test.ts`
 * re-parses from that document and re-executes against.
 *
 * PP1 (decisión del orquestador, plan.md): `03`/`03.05` no existen en el
 * catálogo publicado (`src/features/zones/zone-index.json`), así que este
 * vector usa `21` (Pinar del Río, FIRST_LEVEL) y `21.05` (La Palma,
 * MUNICIPALITY) en su lugar — el resto de la tabla de R12 queda intacta.
 *
 * Pure computation, no Prisma, no network:
 *
 *   npx tsx scripts/compute-tariff-vector.ts   # via `npm run vector:tariff`
 */
import { tariffReconciliation } from "../src/features/sync/reconciliationHash";
import type { TariffRow } from "../src/features/zones/precedence";

type Case = { id: string; rows: TariffRow[] };

// R12: the rows are declared in an order DIFFERENT from byte order, so an
// implementation that concatenates "as they arrive" fails the case instead
// of passing by accident.
const cases: Case[] = [
  {
    id: "T1",
    rows: [
      { zoneCode: "40.01", rule: "INHERIT", deliveryFee: null },
      { zoneCode: "23.05", rule: "FEE", deliveryFee: "300.00" },
      { zoneCode: "21", rule: "FEE", deliveryFee: "0.00" },
      { zoneCode: "23.01", rule: "FEE", deliveryFee: "250.50" },
      { zoneCode: "21.05", rule: "NOT_SERVED", deliveryFee: null },
    ],
  },
  {
    id: "T2",
    rows: [],
  },
];

const vector = {
  version: "1",
  cases: cases.map((c) => {
    const { tariffs, entries, tariffHash } = tariffReconciliation(c.rows);
    return { id: c.id, rows: c.rows, expected: { tariffs, entries: [...entries], tariffHash } };
  }),
};

console.log(JSON.stringify(vector, null, 2));
