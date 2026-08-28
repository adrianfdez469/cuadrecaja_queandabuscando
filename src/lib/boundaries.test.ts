import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * F-023 architecture.md § Componentes → "Guarda de fronteras de imagen".
 * Three boundaries the compiler and ESLint cannot see on their own:
 *
 * (a) Nobody under `src/` imports `next/image` — the guard that backs
 *     `next.config.ts`'s `images.unoptimized: true` (R1): reintroducing the
 *     component by accident produces a broken/raw `<img>`, never a re-lit
 *     optimizer, but this test fails BEFORE that ships.
 * (b) Only `src/lib/imageEncoder.ts` imports `sharp` — the one module
 *     authorized to (architecture.md § El codificador).
 * (c) Only `src/lib/supabase/storage.ts` calls `.remove(`/`.list(` — Storage
 *     API calls funnel through one module (R14, F-011 R17), and a `route.ts`
 *     sits outside the ESLint rule that only covers `*.tsx`.
 */

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, "src");
const ENCODER_FILE = join(ROOT, "src/lib/imageEncoder.ts");
const STORAGE_FILE = join(ROOT, "src/lib/supabase/storage.ts");
const GENERATED_DIR = join(ROOT, "src/generated");

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
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

const files = listFiles(SRC_DIR);

describe("image boundaries (F-023)", () => {
  it("no module under src/ imports next/image", () => {
    const offenders = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      return /from\s+["']next\/image["']/.test(source);
    });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("only src/lib/imageEncoder.ts imports sharp", () => {
    const offenders = files.filter((file) => {
      if (file === ENCODER_FILE) return false;
      const source = readFileSync(file, "utf8");
      return /from\s+["']sharp["']/.test(source);
    });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("only src/lib/supabase/storage.ts talks to the Supabase Storage API (.storage.from(…).remove(/.list()", () => {
    // Scoped to the actual Supabase Storage SDK shape (`.storage.from(...)`),
    // not a bare `.remove(`/`.list(` — those also match unrelated calls like
    // the cart store's own `cart.remove(id)`, which have nothing to do with
    // Storage.
    const offenders = files.filter((file) => {
      if (file === STORAGE_FILE) return false;
      const source = readFileSync(file, "utf8");
      return /\.storage\.from\(/.test(source);
    });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });
});
