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
 *   5. F-024 G6 (C11): the v4 contract cut. `barcode` (singular) never comes
 *      back as a payload key outside a test that exists specifically to
 *      prove it gets rejected (`route.test.ts`'s E10 cases,
 *      `product.db.test.ts`'s C1 case) or the schema line that declares the
 *      prohibition itself (`schemas.ts`). TypeScript already catches a typed
 *      `.ts` fixture that regresses this (`barcode?: never` on
 *      `ProductPayload`, spec.md N3); this guard is for what the compiler
 *      cannot see — `scripts/*.mjs`, raw JSON, prose.
 *   6. F-024 G7: `CanonicalBarcode` has exactly one writer in the whole repo
 *      — `features/sync/server/canonicalBarcodes.ts` — same discipline as
 *      F-015's `searchVector.ts` for `searchDocument`/`searchVector`.
 */

const ROOT = process.cwd();
const INTERNAL_ROUTES_DIR = join(ROOT, "src/app/api/internal");
const HANDLERS_DIR = join(ROOT, "src/features/sync/server/handlers");
const SRC_DIR = join(ROOT, "src");
const SCRIPTS_DIR = join(ROOT, "scripts");
const PRISMA_DIR = join(ROOT, "prisma");
const ENV_EXAMPLE = join(ROOT, ".env.example");
/** Generated Prisma client code: not our code, not linted (AGENTS.md), and
 *  it spells every model's delegate name — including `canonicalBarcode` —
 *  as part of its own typed API. Excluded from G6/G7 below the same way
 *  `src/features/marketplace/server/boundaries.test.ts` excludes it. */
const GENERATED_DIR = join(SRC_DIR, "generated");

/** The identity field a handler must never read off the raw payload. */
const PAYLOAD_BUSINESS_ID = ["payload", ".businessId"].join("");
/** The removed global env var (C16) — halved so this file cannot itself
 *  trip the literal `grep` the criterion runs. */
const REMOVED_GLOBAL_TOKEN_VAR = ["SYNC", "_TOKEN"].join("");
/** F-024 (G6): the forbidden v4 payload key, as a regex so `barcodes:`
 *  (after `barcode` comes an `s`) never matches. The `\s*` between the two
 *  halves also means this file's OWN source — which spells the pattern out
 *  for documentation — never satisfies the literal `grep -rn "barcode:"`
 *  criterion C11 runs, the same trick `REMOVED_GLOBAL_TOKEN_VAR` uses above. */
const FORBIDDEN_BARCODE_KEY = /\bbarcode\s*:/;
/** F-024 (G6): files where the singular key legitimately appears — the
 *  schema line that declares the prohibition (R2) — never a "forgotten
 *  fixture". Test files are excluded from the scan entirely below: a typed
 *  `.test.ts` fixture that regresses is already a compile error (N3), and
 *  the handful that deliberately send the OLD shape to prove it 400s
 *  (`route.test.ts`, `product.db.test.ts`) are the point of those tests, not
 *  an oversight. */
const SYNC_SCHEMAS_FILE = join(SRC_DIR, "features/sync/schemas.ts");
/** F-024 (G6): the smoke script's `--singular-barcode` flag deliberately
 *  sends the removed v3 shape to demonstrate the whole-batch 400 (E10) —
 *  the same kind of legitimate exception as `SYNC_SCHEMAS_FILE` above, not a
 *  fixture that forgot to migrate. */
const SEND_CATALOG_BATCH_SCRIPT = join(SCRIPTS_DIR, "send-catalog-batch.mjs");
/** F-024 (G7): the one file allowed to name the `canonicalBarcode` Prisma
 *  delegate or the `"CanonicalBarcode"` table. */
const CANONICAL_BARCODE_WRITER_FILE = join(SRC_DIR, "features/sync/server/canonicalBarcodes.ts");
/** F-024 (G7): the delegate access (`db.canonicalBarcode.foo`) or the raw
 *  table name in quotes — never the module PATH, which every legitimate
 *  caller (`product.ts`, `dbFixtures.ts`, `prisma/seed.ts`) imports by. */
const CANONICAL_BARCODE_TABLE_TOUCH = /\.canonicalBarcode\b|"CanonicalBarcode"/;

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

  it("G6 (F-024, C11): the removed singular `barcode` payload key never reappears outside a test or the schema that forbids it", () => {
    const files = [
      ...listFiles(SRC_DIR),
      ...listFiles(SCRIPTS_DIR),
      ...listFiles(PRISMA_DIR).filter((f) => f.endsWith(".ts")),
    ].filter(
      (file) =>
        file !== THIS_FILE &&
        file !== SYNC_SCHEMAS_FILE &&
        file !== SEND_CATALOG_BATCH_SCRIPT &&
        !file.startsWith(GENERATED_DIR) &&
        !file.endsWith(".test.ts") &&
        !file.endsWith(".test.tsx"),
    );
    // Not vacuous: there is a real, non-empty set of files to scan.
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((file) =>
      FORBIDDEN_BARCODE_KEY.test(readFileSync(file, "utf8")),
    );
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("G7 (F-024): exactly one production file touches CanonicalBarcode — the dedicated writer/reader module", () => {
    const files = listFiles(SRC_DIR).filter(
      (file) =>
        !file.startsWith(GENERATED_DIR) &&
        !file.endsWith(".test.ts") &&
        !file.endsWith(".test.tsx"),
    );
    // Not vacuous: there is a real, non-empty set of files to scan.
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter(
      (file) =>
        file !== CANONICAL_BARCODE_WRITER_FILE &&
        CANONICAL_BARCODE_TABLE_TOUCH.test(readFileSync(file, "utf8")),
    );
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });
});
