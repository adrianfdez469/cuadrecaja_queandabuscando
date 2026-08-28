import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Backstop for two layering rules the compiler and ESLint cannot see:
 * ESLint's `no-restricted-imports` for Prisma only fires on
 * `src/app/**\/*.tsx` and `src/components/**` (AGENTS.md § Arquitectura), so
 * a `route.ts` or a plain `.ts` file under `features/admin/` never trips it.
 *
 * (c) is scoped to the `data: { … }` write blocks of `mutations.ts`, not the
 * whole file: R14 requires READING `syncedPriceCurrency` there to copy it
 * into `priceOverrideCurrency`, so a whole-file grep for `syncedPrice` would
 * flag a read the spec itself requires.
 *
 * The assertion on `status` is INVERTED from the first cycle (HD10 supersedes
 * the half of HD2 that forbade it): `status` may now appear, but ONLY inside
 * a block that `satisfies PanelStoreWrite` (i.e. `setStoreEnabled`'s own two
 * writes) — a product write with `status` in it is still exactly the bug R8
 * exists to catch. `publishedAt` stays forbidden everywhere, in every block:
 * the panel never sets it, not even the switch (architecture.md § El
 * endpoint del panel).
 */

const ROOT = process.cwd();
const ADMIN_FEATURE_DIR = join(ROOT, "src/features/admin");
// `src/app/admin/sso/` predates this feature (F-008's SSO exchange, reviewed
// separately) and legitimately touches Prisma to mint the session — it is
// not part of the panel's read/write boundary this test protects.
const ADMIN_APP_DIRS = [join(ROOT, "src/app/api/admin"), join(ROOT, "src/app/admin")];
const EXCLUDE_DIRS = [join(ROOT, "src/app/admin/sso")];
const MUTATIONS_FILE = join(ROOT, "src/features/admin/server/mutations.ts");

const PRISMA_IMPORTS = ["@/lib/prisma", "@prisma/client", "@/generated/prisma/client"];
const FORBIDDEN_WRITE_COLUMNS = [
  "status",
  "publishedAt",
  "syncedPrice",
  "localName",
  "availability",
  // F-011 tanda 3: the panel never writes the slug of a store OR a brand —
  // that identity is `features/storefront/server/registry.ts`'s alone.
  // `PanelStorefrontWrite` (the branding write's own whitelist) already
  // makes this a compile error; this is the same second, grep-based line
  // of defense `boundaries.test.ts` already keeps for every other column.
  "slug",
];

function listFiles(dir: string): string[] {
  if (EXCLUDE_DIRS.includes(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listFiles(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function isUnderServer(file: string): boolean {
  return relative(ADMIN_FEATURE_DIR, file).startsWith(`server${"/"}`);
}

describe("admin feature boundaries", () => {
  const files = [
    ...listFiles(ADMIN_FEATURE_DIR),
    ...ADMIN_APP_DIRS.flatMap((dir) => listFiles(dir)),
  ];

  it("only imports Prisma from files under features/admin/server/", () => {
    const offenders = files.filter((file) => {
      if (isUnderServer(file)) return false;
      const source = readFileSync(file, "utf8");
      return PRISMA_IMPORTS.some(
        (spec) => source.includes(`"${spec}"`) || source.includes(`'${spec}'`),
      );
    });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("only imports revalidateStores from server/mutations.ts", () => {
    const offenders = files.filter((file) => {
      if (file === MUTATIONS_FILE) return false;
      const source = readFileSync(file, "utf8");
      return /import\s*\{[^}]*\brevalidateStores\b[^}]*\}\s*from/.test(source);
    });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("never writes publishedAt or a sync-owned column from mutations.ts (HD2, R8)", () => {
    const source = readFileSync(MUTATIONS_FILE, "utf8");
    const dataBlocks = extractDataBlocks(source);
    for (const block of dataBlocks) {
      // `status` is legitimate ONLY inside setStoreEnabled's own writes
      // (HD10) — everywhere else it is exactly the bug R8 exists to catch.
      const allowedStatus = block.isStoreWrite;
      for (const column of FORBIDDEN_WRITE_COLUMNS) {
        if (column === "status" && allowedStatus) continue;
        expect(new RegExp(`\\b${column}\\s*:`).test(block.content)).toBe(false);
      }
    }
    // A test that never found a `data:` block would pass vacuously and
    // hide a rewrite that stopped using `data` at all — guard against that.
    expect(dataBlocks.length).toBeGreaterThan(0);
    // And a test that never found a store write would silently stop
    // checking HD10's half of this rule the moment setStoreEnabled changed
    // shape.
    expect(dataBlocks.some((b) => b.isStoreWrite)).toBe(true);
  });
});

type DataBlock = { content: string; isStoreWrite: boolean };

/**
 * Extracts the `{ ... }` that follows every literal `data: {` in the
 * source, respecting brace nesting, plus whether it is immediately followed
 * by `satisfies PanelStoreWrite` (setStoreEnabled's own marker).
 */
function extractDataBlocks(source: string): DataBlock[] {
  const blocks: DataBlock[] = [];
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
    const content = source.slice(start, i - 1);
    const tail = source.slice(i, i + 40);
    blocks.push({ content, isStoreWrite: /^\s*satisfies\s+PanelStoreWrite\b/.test(tail) });
  }
  return blocks;
}
