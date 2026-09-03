import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Backstop for I10/I2 (spec.md, architecture.md § Pruebas → server): this
 * area lives OUTSIDE `/api/internal/*` on purpose (§ La objeción que todo
 * lector va a tener) and so inherits NONE of
 * `src/app/api/internal/boundaries.test.ts`'s guarantees — this is that
 * test's gemelo for `/api/provisioning/*`, same disk-reading technique, no
 * mocks, no base.
 *
 *   1. No route under `/api/provisioning` imports Prisma directly (R13).
 *   2. Every route calls `verifyProvisioningSecret(...)` — the area's own
 *      guard, never `withInternalAuth` (that guard resolves a `Business`
 *      from the token; this secret does not identify one — R5).
 *   3. The guard still compares in constant time (criterio 12 backstop —
 *      the literal `grep` the criterion itself runs is what actually
 *      decides it; this is the same assertion, automated).
 *   4. I2: `mintSyncToken(` keeps an explicit, small whitelist of callers.
 *      A NEW file calling it is the fifth writer of `syncTokenHash` — this
 *      turns that into a compile-time-adjacent decision (a red test) instead
 *      of a silent one, mirroring G7's technique in
 *      `src/app/api/internal/boundaries.test.ts` for `CanonicalBarcode`.
 */

const ROOT = process.cwd();
const PROVISIONING_ROUTES_DIR = join(ROOT, "src/app/api/provisioning");
const GUARD_FILE = join(PROVISIONING_ROUTES_DIR, "_lib/guard.ts");
const SRC_DIR = join(ROOT, "src");
const SCRIPTS_DIR = join(ROOT, "scripts");
const PRISMA_DIR = join(ROOT, "prisma");
/** Generated Prisma client code: not our code, not linted (AGENTS.md). */
const GENERATED_DIR = join(SRC_DIR, "generated");

/**
 * I2 (architecture.md § Los cuatro escritores de syncTokenHash): the ONLY
 * files allowed to call `mintSyncToken(` outside a test. `dbFixtures.ts` and
 * `provisioning.ts` are the two servers of a REAL `Business`; the script and
 * the seed are the two terminal-only paths R18 keeps alive.
 */
const ALLOWED_TOKEN_MINTER_CALLERS = [
  join(SRC_DIR, "lib/syncAuth.ts"), // the definition itself
  join(SRC_DIR, "features/sync/server/provisioning.ts"),
  join(SCRIPTS_DIR, "mint-sync-token.ts"),
  join(PRISMA_DIR, "seed.ts"),
  join(SRC_DIR, "features/marketplace/server/dbFixtures.ts"),
];

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function routeFiles(): string[] {
  return listFiles(PROVISIONING_ROUTES_DIR).filter(
    (file) => file.endsWith("route.ts") && !file.endsWith(".test.ts"),
  );
}

describe("/api/provisioning/* boundaries (F-034, I10)", () => {
  const routes = routeFiles();

  it("no route imports Prisma directly — the only writer is features/sync/server/provisioning.ts", () => {
    // Not vacuous: there really is a route to scan.
    expect(routes.length).toBeGreaterThanOrEqual(1);

    const offenders = routes.filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        source.includes('"@/lib/prisma"') ||
        source.includes("'@/lib/prisma'") ||
        source.includes("@/generated/prisma/client")
      );
    });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("every route calls verifyProvisioningSecret(...) — never withInternalAuth(...)", () => {
    const offenders = routes.filter((file) => {
      const source = readFileSync(file, "utf8");
      return !source.includes("verifyProvisioningSecret(") || source.includes("withInternalAuth(");
    });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("the guard still compares in constant time (criterio 12 backstop)", () => {
    expect(readFileSync(GUARD_FILE, "utf8")).toMatch(/timingSafeEqual/);
  });

  it("I2: mintSyncToken() keeps an explicit, small whitelist of callers", () => {
    const files = [
      ...listFiles(SRC_DIR),
      ...listFiles(SCRIPTS_DIR),
      ...listFiles(PRISMA_DIR).filter((f) => f.endsWith(".ts")),
    ].filter((file) => !file.startsWith(GENERATED_DIR));
    // Not vacuous: there is a real, non-empty set of files to scan.
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((file) => {
      if (file.endsWith(".test.ts")) return false; // tests mint their own fixtures freely
      if (ALLOWED_TOKEN_MINTER_CALLERS.includes(file)) return false;
      return readFileSync(file, "utf8").includes("mintSyncToken(");
    });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });
});
