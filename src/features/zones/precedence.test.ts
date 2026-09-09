import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveZoneTariff,
  type TariffRow,
  type ZoneRef,
  type ZoneTariffResolution,
} from "./precedence";

/**
 * F-041 — criterio 1 / E20 (paso 16, architecture.md § Componentes, fila
 * `precedence.test.ts`): this file reads the vector from
 * `docs/sync-contract.md` ITSELF — never a transcribed copy — and executes
 * `resolveZoneTariff` over every case it finds. If the contract's own block
 * changes (a new case, a fixed path), this test changes with it without a
 * single line here moving (R28's own instruction: "el test lo lee del
 * propio documento y no de una copia transcrita").
 *
 * The criterion's literal text says "los SIETE casos"; the humano's
 * decision (plan.md § Qué queda fuera, spec.md I2) is that ten precedence
 * cases plus three guards — thirteen — are what got implemented and what
 * the criterion counts as satisfied "de sobra". This file does not lower
 * that bar: it asserts the number of cases actually run is EXACTLY what the
 * document declares AND at least ten (I2) — a case quietly deleted from the
 * contract must turn this suite red, never shrink it in silence (caso
 * límite 16).
 *
 * F-041 paso 17 (S-007 punto 6): the contract also publishes a sha256 of
 * this EXACT block — cuadrecaja cannot read this file from their own repo
 * (`QAB_DOCS_PATH` is not set in their CI, and their own rule forbids a test
 * that guesses a path), so their test fixes a committed copy of the vector
 * against that published hash instead of against this document. The hash's
 * scope is written in the contract itself (§ «El hash del bloque JSON de
 * arriba»): the same bytes captured by `extractVector`'s regex below, no
 * normalization. This file recomputes it over the SAME captured bytes and
 * compares it against the contract's own published line — if the vector
 * changes here without the published hash moving with it, this fails FIRST,
 * before cuadrecaja's committed copy ever has a chance to drift silently.
 */

const CONTRACT_PATH = join(process.cwd(), "docs/sync-contract.md");
const HEADING = "#### Vector de precedencia de ZONE_TARIFF (v13)";

type VectorCase = {
  id: string;
  zone: ZoneRef;
  rows: TariffRow[];
  expected: ZoneTariffResolution;
};

type Vector = {
  version: string;
  fixture: { zones: ZoneRef[]; rows: TariffRow[] };
  cases: VectorCase[];
};

/** The section between the heading and the next level 2-4 heading (or the
 *  end of the document) — the same window `fieldOwnership.test.ts` already
 *  carves out for its own contract tables. */
function vectorSection(contract: string): string {
  const headingIndex = contract.indexOf(HEADING);
  if (headingIndex === -1) {
    throw new Error(
      `precedence.test.ts: heading "${HEADING}" not found in docs/sync-contract.md — did it move or get renamed?`,
    );
  }
  const rest = contract.slice(headingIndex + HEADING.length);
  const nextHeading = /\n#{2,4} /.exec(rest);
  return nextHeading ? rest.slice(0, nextHeading.index) : rest;
}

/**
 * Caso límite 16: zero, two-or-more, or invalid JSON are each their own
 * loud failure — never a `describe` that silently runs zero asserts.
 *
 * Returns the raw captured text alongside the parsed vector: F-041 paso 17
 * hashes exactly those bytes (nothing more, nothing less), so the hash test
 * below re-parses nothing and re-serializes nothing — it hashes the SAME
 * string this function already extracted to build `vector`.
 */
function extractVector(section: string): { vector: Vector; rawBlock: string } {
  const blocks = [...section.matchAll(/```json\n([\s\S]*?)\n```/g)];
  if (blocks.length === 0) {
    throw new Error(
      "precedence.test.ts: no ```json block found under the vector heading in docs/sync-contract.md",
    );
  }
  if (blocks.length > 1) {
    throw new Error(
      `precedence.test.ts: expected EXACTLY one \`\`\`json block under the vector heading, found ${blocks.length}`,
    );
  }
  const rawBlock = blocks[0][1];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBlock);
  } catch (cause) {
    throw new Error(
      `precedence.test.ts: the vector's json block in docs/sync-contract.md is not valid JSON: ${(cause as Error).message}`,
    );
  }
  return { vector: parsed as Vector, rawBlock };
}

/**
 * The contract's own published hash (§ «El hash del bloque JSON de arriba»),
 * read as text — never hand-copied into a second constant here, which is
 * exactly the kind of drift the hash exists to catch.
 */
function extractPublishedHash(contract: string): string {
  const match = /\*\*sha256 del bloque JSON del vector \(v13\):\*\*\s*\n`([0-9a-f]{64})`/.exec(
    contract,
  );
  if (!match) {
    throw new Error(
      "precedence.test.ts: the contract's published sha256 line (§ «El hash del bloque JSON de arriba») was not found or is not a 64-char hex string",
    );
  }
  return match[1];
}

const contract = readFileSync(CONTRACT_PATH, "utf8");
const { vector, rawBlock } = extractVector(vectorSection(contract));
const publishedHash = extractPublishedHash(contract);

let executed = 0;

describe("ZONE_TARIFF precedence vector, read from docs/sync-contract.md itself (C1, E20)", () => {
  it("declares at least 10 cases (I2 — the criterion's 'seven' is superseded by the humano's decision to implement all ten)", () => {
    expect(vector.cases.length).toBeGreaterThanOrEqual(10);
  });

  it.each(vector.cases.map((c) => [c.id, c] as const))(
    "%s: resolveZoneTariff() matches the contract's own expected amount, decidedBy AND full path",
    (_id, testCase) => {
      executed += 1;
      const actual = resolveZoneTariff(testCase.zone, testCase.rows);
      expect(actual).toEqual(testCase.expected);
    },
  );

  it("ran exactly as many cases as the document declares — a case deleted from the contract turns THIS red, never shrinks silently (R28)", () => {
    expect(executed).toBe(vector.cases.length);
  });

  it("paso 17 (S-007 punto 6): the contract's published sha256 matches this block's actual bytes — a vector edited without updating the hash fails HERE first", () => {
    const actualHash = createHash("sha256").update(rawBlock, "utf8").digest("hex");
    expect(actualHash).toBe(publishedHash);
  });
});
