import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { MARKETPLACE_SEARCH_TS_CONFIG } from "@/constants/marketplace";

/**
 * The guard against C10's silent degradation (spec.md § La guarda de C10,
 * architecture.md § Componentes, step 6): reads the source from disk, no
 * base and no mocks, at the style of `src/features/admin/server/
 * boundaries.test.ts` and `src/features/storefront/server/
 * boundaries.test.ts`. Five asserts, G1-G5, each with its own
 * anti-vacuity — the same technique those two files use for `data: { … }`
 * write blocks and `prisma.<model>.<method>(...)` calls respectively.
 *
 * Scanned files exclude `*.test.ts`/`*.test.tsx` and `src/generated/**`
 * (AGENTS.md: generated, not linted, not our code) — otherwise this very
 * file, which has to spell out `to_tsvector(` and `searchDocument` as text
 * to look for them, would flag itself.
 */

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, "src");
const SEED_FILE = join(ROOT, "prisma/seed.ts");
const WRITER_FILE = join(ROOT, "src/features/marketplace/server/searchVector.ts");
const QUERY_FILE = join(ROOT, "src/features/marketplace/server/search.ts");
const VITEST_CONFIG = join(ROOT, "vitest.config.mts");
const EXCLUDED_DIRS = [join(ROOT, "src/generated")];

/** The literal `to_tsvector(` substring, built so THIS file — which has to
 *  name it to look for it — never itself matches G2/G4's own scan. */
const TO_TSVECTOR_CALL = ["to_ts", "vector("].join("");

function listAllFiles(dir: string): string[] {
  if (EXCLUDED_DIRS.includes(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listAllFiles(full));
    else out.push(full);
  }
  return out;
}

function isTestFile(file: string): boolean {
  return file.endsWith(".test.ts") || file.endsWith(".test.tsx");
}

/** Every production file this guard reads: all of `src/` plus
 *  `prisma/seed.ts` — the sixth site R1 talks about, outside `src/`. */
function productionFiles(): string[] {
  return [...listAllFiles(SRC_DIR).filter((f) => !isTestFile(f)), SEED_FILE];
}

/** Same technique `src/features/admin/server/boundaries.test.ts` uses for
 *  its own `data: { … }` write blocks: extract every `{ … }` that follows a
 *  literal `data: {`, respecting brace nesting, so a `select: { …
 *  searchDocument: true … }` read never taints this. */
function extractDataBlocks(source: string): string[] {
  const blocks: string[] = [];
  const marker = /data:\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(source))) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (depth > 0 && i < source.length) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
      i++;
    }
    blocks.push(source.slice(start, i - 1));
    marker.lastIndex = i;
  }
  return blocks;
}

describe("marketplace search boundaries (F-015, C10)", () => {
  const files = productionFiles();

  it("no data: { ... } write block sets searchDocument directly (G1, half a)", () => {
    let totalBlocks = 0;
    const offenders: string[] = [];
    for (const file of files) {
      const blocks = extractDataBlocks(readFileSync(file, "utf8"));
      totalBlocks += blocks.length;
      if (blocks.some((block) => /\bsearchDocument\s*:/.test(block))) {
        offenders.push(relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
    // Not vacuous: the scan really did find data: { ... } blocks to look
    // inside, across the panel, the sync handlers and the seed.
    expect(totalBlocks).toBeGreaterThan(0);
  });

  it('only the writer assigns the raw "searchDocument" column (G1, half b)', () => {
    const offenders = files.filter((file) => {
      if (file === WRITER_FILE) return false;
      return readFileSync(file, "utf8").includes('"searchDocument" =');
    });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
    // Not vacuous: the writer itself does contain it — proves the needle
    // is real, not a typo that would make the check pass on anything.
    expect(readFileSync(WRITER_FILE, "utf8")).toContain('"searchDocument" =');
  });

  it("exactly one file under src/ composes to_tsvector(...), and it is the writer (G2)", () => {
    const matches = files.filter(
      (file) => file.startsWith(SRC_DIR) && readFileSync(file, "utf8").includes(TO_TSVECTOR_CALL),
    );
    expect(matches).toEqual([WRITER_FILE]);
  });

  it("the hand-written backfill migration uses the dictionary constant's own value (G3)", () => {
    const migrationsDir = join(ROOT, "prisma/migrations");
    const migrationDirs = readdirSync(migrationsDir).filter((name) =>
      name.endsWith("_backfill_search_vector"),
    );
    // Not vacuous: the migration folder has to exist and be found.
    expect(migrationDirs.length).toBeGreaterThan(0);

    const needle = `to_tsvector('${MARKETPLACE_SEARCH_TS_CONFIG}', unaccent(`;
    for (const dir of migrationDirs) {
      const sql = readFileSync(join(migrationsDir, dir, "migration.sql"), "utf8");
      expect(sql).toContain(needle);
    }
  });

  it('the query module predicates against the "searchVector" column, not a recomputed expression (G4)', () => {
    const source = readFileSync(QUERY_FILE, "utf8");
    expect(/"searchVector"\s*@@/.test(source)).toBe(true);
    expect(source.includes(TO_TSVECTOR_CALL)).toBe(false);
  });

  /**
   * G5 protects against the stage-5 suite disappearing silently: the `db`
   * vitest project and its `*.db.test.ts` files never quietly vanish once
   * they exist. Unconditional as of stage 5 (`sdd-tester`) — the escape
   * hatch `sdd-implementer` left here on purpose (impl.md § Desviaciones)
   * is gone now that both halves are real.
   */
  it("keeps the db vitest project and its *.db.test.ts files in place (G5)", () => {
    const config = readFileSync(VITEST_CONFIG, "utf8");
    const dbTestFiles = listAllFiles(SRC_DIR).filter((f) => f.endsWith(".db.test.ts"));

    expect(/name:\s*"db"/.test(config)).toBe(true);
    expect(config).toContain('"src/**/*.db.test.ts"');
    expect(dbTestFiles.length).toBeGreaterThanOrEqual(2);
  });
});
