import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The boundaries guard (plan.md paso 3, written BEFORE paso 8 on purpose):
 * turns four things that were manual review into permanent tests.
 *
 * 1. F-010's own regression gate (`.agent/specs/F-010/tests.md`, fila 4):
 *    `cookies()` never appears in `src/features/orders/**` or
 *    `src/app/[slug]/**` (R18, I4). F-012 must not put it back.
 * 2. Only the three files that are ALLOWED to talk to Supabase import
 *    `@supabase/*`: the two clients and the session module (R19, I6).
 *    `src/lib/supabase/storage.ts` is a deliberate, pre-existing exception —
 *    it imports `@supabase/supabase-js` for image Storage, has nothing to do
 *    with Auth, and predates this feature entirely.
 * 3. No `"use client"` module imports `@supabase/*`, anywhere — the design's
 *    "error de una línea" (design.md § Coste de cliente): `@supabase/ssr` in
 *    the browser is 61.2 KB gzip, `AuthClient` alone is 23.9 KB, and either
 *    one landing in the header's tree sends every storefront `●` page ~45 KB
 *    over `scripts/check-bundle-budget.mjs`'s ceiling.
 * 4. `"slug"` never appears inside `src/proxy.ts`'s `matcher` (R22, I5):
 *    `/[slug]` must never enter the proxy, or ISR is gone.
 *
 * Ficha `boundaries-guard-cruzado-por-patron-de-texto`: these are text
 * patterns, not semantic analysis — written narrow on purpose so a file from
 * an unrelated feature does not trip them by coincidence.
 */

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, "src");
const GENERATED_DIR = join(ROOT, "src/generated");

const ORDERS_DIR = join(ROOT, "src/features/orders");
const SLUG_APP_DIR = join(ROOT, "src/app/[slug]");

const ALLOWED_SUPABASE_IMPORTERS = [
  join(ROOT, "src/lib/supabase/client.ts"),
  join(ROOT, "src/lib/supabase/server.ts"),
  join(ROOT, "src/lib/auth/customerSession.ts"),
  // Pre-existing, unrelated to Auth (F-011): image Storage only.
  join(ROOT, "src/lib/supabase/storage.ts"),
];

function listFiles(dir: string): string[] {
  if (dir === GENERATED_DIR) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (full === GENERATED_DIR) continue;
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listFiles(full));
    else if (
      /\.(ts|tsx)$/.test(entry) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx")
    )
      out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const allFiles = listFiles(SRC_DIR);

describe("account boundaries (plan.md paso 3)", () => {
  it("cookies() never appears under src/features/orders/** or src/app/[slug]/** (F-010 fila 4, R18)", () => {
    const scoped = [...listFiles(ORDERS_DIR), ...listFiles(SLUG_APP_DIR)];
    const offenders = scoped.filter((file) =>
      stripComments(readFileSync(file, "utf8")).includes("cookies()"),
    );
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("only the session module and the two Supabase clients import @supabase/* (R19, I6)", () => {
    const offenders = allFiles.filter((file) => {
      if (ALLOWED_SUPABASE_IMPORTERS.includes(file)) return false;
      const source = stripComments(readFileSync(file, "utf8"));
      return /from\s+["']@supabase\//.test(source);
    });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('no "use client" module imports @supabase/* — the one-line mistake design.md warns about', () => {
    const offenders = allFiles.filter((file) => {
      const source = readFileSync(file, "utf8");
      const hasUseClient = /^["']use client["'];?\s*$/m.test(
        source.split("\n").slice(0, 3).join("\n"),
      );
      if (!hasUseClient) return false;
      return /from\s+["']@supabase\//.test(stripComments(source));
    });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('"slug" never appears inside src/proxy.ts\'s matcher (R22, I5)', () => {
    const source = readFileSync(join(ROOT, "src/proxy.ts"), "utf8");
    const match = /matcher:\s*\[([\s\S]*?)\]/.exec(source);
    expect(match).not.toBeNull();
    const matcherBody = match?.[1] ?? "";
    expect(matcherBody.toLowerCase()).not.toContain("slug");
  });
});
