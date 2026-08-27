import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Backstop for the resolver's exclusivity (architecture.md § El resolvedor
 * único, I6): nothing outside `resolve.ts`/`registry.ts` may resolve a
 * store by its own slug, or write to the `Slug` table. ESLint's Prisma
 * restriction only fires on `components/**` and `app/**\/*.tsx`
 * (AGENTS.md § Arquitectura) — this catches the `route.ts` files and plain
 * `.ts` server modules that rule never sees, the same gap
 * `features/admin/server/boundaries.test.ts` closes for the panel.
 *
 * A fifth resolver is the exact failure mode this test exists to prevent: a
 * module that starts resolving `Store` by `slug` on its own drifts from the
 * canonical-slug invariant the moment two live URLs exist for one branch.
 *
 * Scoped to the ARGUMENTS of an actual `prisma.<model>.<method>(...)` call
 * (extracted by balanced parens, the same technique
 * `admin/server/boundaries.test.ts` uses for `data: { ... }` blocks) —
 * never the whole file. A plain object literal like
 * `toQuoteResponse`'s `{ store: { slug: ... } }` wire response is not a
 * query and must not trip this.
 */

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, "src");
const ALLOWED_FILES = [
  join(ROOT, "src/features/storefront/server/resolve.ts"),
  join(ROOT, "src/features/storefront/server/registry.ts"),
];
// Generated code (AGENTS.md: "No editar, no lintar") ships its own JSDoc
// examples that literally say `prisma.slug.findMany()` — not a query this
// codebase wrote.
const EXCLUDED_DIRS = [join(ROOT, "src/generated")];

const FORBIDDEN_IN_QUERY = [
  /where:\s*\{\s*slug\b/,
  /store:\s*\{\s*slug:/,
  /storefront:\s*\{\s*slug:/,
];

function listFiles(dir: string): string[] {
  if (EXCLUDED_DIRS.includes(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listFiles(full));
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Strips comments so a pattern only matches code that actually runs — a
 *  doc comment saying "never a `where: { slug }` of its own" must not trip
 *  the very rule it is explaining. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Every `prisma.<model>.<method>(...)` call's argument text, extracted by
 *  counting parens — a `route.ts` is outside ESLint's reach, so this has
 *  to parse text, not rely on the type checker. */
function extractPrismaCallArgs(source: string): string[] {
  const calls: string[] = [];
  const marker = /prisma\.\w+\.\w+\(/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(source))) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (depth > 0 && i < source.length) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") depth--;
      i++;
    }
    calls.push(source.slice(start, i - 1));
  }
  return calls;
}

describe("storefront resolver boundaries (I6)", () => {
  it("only resolve.ts and registry.ts resolve by slug or touch the Slug table", () => {
    const files = listFiles(SRC_DIR).filter(
      (file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"),
    );

    const offenders = files.filter((file) => {
      if (ALLOWED_FILES.includes(file)) return false;
      const source = stripComments(readFileSync(file, "utf8"));
      if (/prisma\.slug\./.test(source)) return true;
      return extractPrismaCallArgs(source).some((call) =>
        FORBIDDEN_IN_QUERY.some((pattern) => pattern.test(call)),
      );
    });

    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });
});
