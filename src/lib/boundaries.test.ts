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

/**
 * F-022 architecture.md § Contratos internos, puntos 3 y 5.
 *
 * (a) The PUBLISHED gate (R12): every file with a line that WRITES
 *     `status: "PUBLISHED"` must also mention `isCanonicalTimeZone` — the
 *     one predicate `src/lib/timezone.ts` exports for it, so a fourth writer
 *     can never forget the gate silently. The pattern is blind to intent, on
 *     purpose (same technique as the two guards above): a line with a `|` in
 *     it is a TYPE UNION (`"PUBLISHED" | "SUSPENDED"`), never a write, and is
 *     excluded — measured today: `resolve.ts`, `branding.ts` and
 *     `StoreBrandCard.tsx` (twice) all declare it that way. What is left
 *     after that filter is the two writers
 *     (`sync/server/handlers/store.ts`, `admin/server/mutations.ts`) and two
 *     files that only MENTION the literal in a comment
 *     (`catalog/server/queries.ts`'s own `where: { status: "PUBLISHED" }`
 *     read filter, and `constants/sync.ts`'s doc comment on
 *     `STORE_TIMEZONE_INVALID`) — all four already name
 *     `isCanonicalTimeZone` in their own text, so none needs a hand-written
 *     exception list. A fifth file that starts writing `PUBLISHED` without
 *     the gate fails here, before `bundle`, with a message naming it.
 * (b) A5: `evaluateStoreHours` has NO production caller this cycle (§
 *     Alcance, punto 4) — the instant must never re-enter a cached view
 *     through the back door of "let's just highlight today". Nothing under
 *     `src/app/` or `src/components/` may mention the identifier.
 */
const PUBLISHED_WRITE_LINE = /status:\s*"PUBLISHED"/;
const APP_DIR = join(ROOT, "src/app");
const COMPONENTS_DIR = join(ROOT, "src/components");

describe("PUBLISHED gate and evaluator boundaries (F-022)", () => {
  it('every file that writes status: "PUBLISHED" also mentions isCanonicalTimeZone', () => {
    const offenders = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      const writesPublished = source
        .split("\n")
        .some((line) => PUBLISHED_WRITE_LINE.test(line) && !line.includes("|"));
      if (!writesPublished) return false;
      return !source.includes("isCanonicalTimeZone");
    });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("no file under src/app/ or src/components/ mentions evaluateStoreHours (A5): the instant never re-enters a cached view", () => {
    const offenders = files.filter((file) => {
      if (!file.startsWith(APP_DIR) && !file.startsWith(COMPONENTS_DIR)) return false;
      const source = readFileSync(file, "utf8");
      return /\bevaluateStoreHours\b/.test(source);
    });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });
});
