import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The cheap guardian architecture.md DA3 asks for, same style as
 * `src/features/account/boundaries.test.ts`: a TEXT pattern, not semantic
 * analysis. Its job is to catch the regression nobody intends — someone
 * "optimizing" `claimBell`/`closeBellWindow` with an in-memory cache, which
 * would silently reintroduce I5 (coalescence measured per-process instead of
 * per-system). `bell.db.test.ts` is what actually PROVES the SQL is correct;
 * this only proves nobody added the shortcut that would undo it.
 *
 * `let` is checked only at the START of a line (column 0, no indentation):
 * a module-scope `let cache;` is written unindented, while every `let`
 * inside a function body — like `ringOrderBell`'s own `claim` — is indented
 * under it. Narrow on purpose, so a legitimate local variable never trips
 * this test by coincidence.
 */
const SOURCE = readFileSync(join(process.cwd(), "src/features/orders/server/bell.ts"), "utf8");

describe("bell.ts stays free of module-scope mutable state (architecture.md DA3, I5)", () => {
  it("never uses new Map( — a process-local cache would make I5 pass locally and fail in production", () => {
    expect(SOURCE).not.toContain("new Map(");
  });

  it("never uses new Set( — same reasoning as new Map(", () => {
    expect(SOURCE).not.toContain("new Set(");
  });

  it("never declares a module-scope `let` (only function-local ones, indented)", () => {
    expect(SOURCE).not.toMatch(/^let /m);
  });
});
