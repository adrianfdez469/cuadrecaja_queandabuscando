import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/**
 * F-041 — architecture.md § Escalabilidad, punto 6: the zone catalog index
 * is ~7 KB gzip that `check:bundle` would NOT catch if it leaked into a
 * client chunk (the budget is 193 KB, the worst page measured is 182.1 KB —
 * the etapa would keep PASSING). `eslint.config.mjs`'s `no-restricted-imports`
 * is the first guarantee, but it only fires on `src/components/**` and
 * `.tsx` files under `src/app` — it does not reach a `components` directory
 * nested inside a feature, where the checkout lives
 * (`src/features/cart/components/CheckoutForm.tsx`).
 *
 * This file is the SECOND guarantee: a fixed ALLOW-LIST of every file in
 * `src/` that may import `@/features/zones/catalog` or
 * `@/features/zones/zone-index.json`, resolved by actually following each
 * import specifier (relative AND the `@/` alias) rather than a substring
 * grep — a specifier is only counted when it resolves to one of the two
 * real files, so a coincidental `"../catalog"` importing an unrelated
 * module elsewhere in the tree can never produce a false positive. Growing
 * the allow-list is a conscious edit to THIS file; anyone else showing up
 * fails loudly, which is the whole point.
 */

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, "src");
const CATALOG_TS = join(SRC_DIR, "features/zones/catalog.ts");
const ZONE_INDEX_JSON = join(SRC_DIR, "features/zones/zone-index.json");

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    // Generated code is never hand-written and never imports this module.
    if (entry === "generated") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every `from "..."` / `require("...")` / dynamic `import("...")` /
 *  `vi.mock("...")` string literal in a file — a superset of what any
 *  single one of those forms would catch alone. */
function importSpecifiersOf(content: string): string[] {
  const specifiers: string[] = [];
  const re = /(?:from\s+|require\(\s*|import\(\s*|vi\.mock\(\s*)["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) specifiers.push(match[1]);
  return specifiers;
}

/** `null` unless `specifier`, resolved from `fromFile`, points at exactly
 *  `catalog.ts` or `zone-index.json` — the `@/` alias maps to `src/`
 *  (tsconfig paths), a relative specifier resolves against its own file's
 *  directory, and both try every extension the two targets could be
 *  written without. */
function resolveIfCatalogModule(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = join(SRC_DIR, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    return null; // a bare package import — never this module
  }
  for (const ext of ["", ".ts", ".tsx", ".json"]) {
    const candidate = `${base}${ext}`;
    if (candidate === CATALOG_TS || candidate === ZONE_INDEX_JSON) return candidate;
  }
  return null;
}

function importsCatalogModule(file: string): boolean {
  const content = readFileSync(file, "utf8");
  return importSpecifiersOf(content).some(
    (specifier) => resolveIfCatalogModule(specifier, file) !== null,
  );
}

/** Resolved ONCE so both `it`s below read the exact same list. */
const IMPORTERS = listSourceFiles(SRC_DIR)
  .filter(importsCatalogModule)
  .map((file) => relative(ROOT, file).split(sep).join("/"))
  .sort();

/**
 * The current, deliberate readers: the sobre's schema and the two handlers
 * that validate a `zoneCode` (§ Contratos 2, § Flujo B), the minimal reader
 * (§ Flujo C), `catalog.ts` itself (importing its own artefact), and the
 * test files that exercise them directly. Nothing under
 * `src/components/`, `src/app/`, or any nested `components` directory —
 * checked separately below, so THIS list stays about "who", not "where".
 */
const ALLOWED = [
  "src/features/sync/schemas.ts",
  "src/features/sync/server/handlers/store.ts",
  "src/features/sync/server/handlers/zoneTariff.ts",
  "src/features/zones/catalog.test.ts",
  "src/features/zones/catalog.ts",
  // F-042 (sdd-tester) — caso límite 16: comprueba que el manifiesto de
  // geometría tiene EXACTAMENTE los 168 municipios de `listMunicipalities()`.
  // Test, nunca un árbol de cliente.
  "src/features/zones/geometry.test.ts",
  "src/features/zones/server/catalogSeed.db.test.ts",
  // F-042 (architecture.md § AD3): la mitad de datos de la cobertura de una
  // sucursal — lee `listMunicipalities()` para resolver los 168 municipios
  // contra el tarifario en UNA consulta. Servidor, nunca un árbol de
  // cliente.
  "src/features/zones/server/coverage.ts",
  "src/features/zones/server/tariffs.db.test.ts",
  "src/features/zones/server/tariffs.ts",
].sort();

describe("zone catalog index — import boundaries (architecture.md § Escalabilidad, punto 6)", () => {
  it("only the allow-listed files import @/features/zones/catalog or the zone-index.json artefact", () => {
    expect(IMPORTERS).toEqual(ALLOWED);
  });

  it("none of the allow-listed importers lives in a client tree: src/components, a *.tsx under src/app, or any */components/** (the checkout's own home)", () => {
    for (const file of IMPORTERS) {
      const parts = file.split("/");
      expect(file.startsWith("src/components/")).toBe(false);
      expect(file.startsWith("src/app/") && file.endsWith(".tsx")).toBe(false);
      expect(parts.includes("components")).toBe(false);
    }
  });
});
