import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);

/**
 * Backstop for two F-018 invariants the compiler cannot see on its own
 * (architecture.md § Pruebas: el corte entre mock y Postgres real — "C16 +
 * frontera de capa"). Reads the disk, no base, no mocks — same technique as
 * `src/features/storefront/server/boundaries.test.ts` and
 * `src/features/admin/server/boundaries.test.ts`.
 *
 *   1. No `/api/internal/*` route imports Prisma directly (R9,
 *      AGENTS.md § Arquitectura): the write that used to violate this —
 *      `orders/status/route.ts`'s `updateMany` — moved to
 *      `features/orders/server/status.ts`. A FUTURE route regressing this
 *      is what this test exists to catch, not only today's six.
 *   2. Every `/api/internal/*` route exports its handlers through
 *      `withInternalAuth(...)` — never a bare `async function` that could
 *      forget the guard entirely.
 *   3. C6: no handler under `features/sync/server/handlers/` reads the
 *      body's own tenant field as a source of identity in any `where`.
 *   4. C16: the corte limpio of the old global bearer env var never comes
 *      back. Built from two halves below (never spelled whole in this
 *      file's own source) so that a REAL literal `grep` for it — the exact
 *      command the criterion runs — never trips over this test file
 *      itself, the one place it is legitimately allowed to be absent.
 */

const ROOT = process.cwd();
const INTERNAL_ROUTES_DIR = join(ROOT, "src/app/api/internal");
const HANDLERS_DIR = join(ROOT, "src/features/sync/server/handlers");
const SRC_DIR = join(ROOT, "src");
const SCRIPTS_DIR = join(ROOT, "scripts");
const ENV_EXAMPLE = join(ROOT, ".env.example");

/** The identity field a handler must never read off the raw payload. */
const PAYLOAD_BUSINESS_ID = ["payload", ".businessId"].join("");
/** The removed global env var (C16) — halved so this file cannot itself
 *  trip the literal `grep` the criterion runs. */
const REMOVED_GLOBAL_TOKEN_VAR = ["SYNC", "_TOKEN"].join("");

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
  return listFiles(INTERNAL_ROUTES_DIR).filter(
    (file) => file.endsWith("route.ts") && !file.endsWith(".test.ts"),
  );
}

describe("/api/internal/* boundaries (F-018)", () => {
  const routes = routeFiles();

  it("no route imports Prisma directly — the only writes go through features/*/server/", () => {
    // Not vacuous: there really are six routes to scan.
    expect(routes.length).toBeGreaterThanOrEqual(6);

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

  it("every route exports its handlers through withInternalAuth(...)", () => {
    const offenders = routes.filter((file) => {
      const source = readFileSync(file, "utf8");
      return !/export const (GET|POST) = withInternalAuth\(/.test(source);
    });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("C6: no sync handler reads the payload's own businessId as an identity source", () => {
    const handlerFiles = listFiles(HANDLERS_DIR).filter((file) => !file.endsWith(".test.ts"));
    // Not vacuous: the handlers directory really has files to scan.
    expect(handlerFiles.length).toBeGreaterThan(0);

    const offenders = handlerFiles.filter((file) =>
      readFileSync(file, "utf8").includes(PAYLOAD_BUSINESS_ID),
    );
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("C16: the removed global bearer token env var never reappears in src/, scripts/, or .env.example", () => {
    const files = [
      ...listFiles(SRC_DIR).filter((f) => f !== THIS_FILE),
      ...listFiles(SCRIPTS_DIR),
      ENV_EXAMPLE,
    ];
    // Not vacuous: there is a real, non-empty set of files to scan.
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((file) =>
      readFileSync(file, "utf8").includes(REMOVED_GLOBAL_TOKEN_VAR),
    );
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });
});
