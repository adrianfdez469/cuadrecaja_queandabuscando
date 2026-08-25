#!/usr/bin/env node
/**
 * Verify that the compiled CSS still lets a store rebrand itself.
 *
 * This exists because of a bug that shipped: the per-store <style> block was
 * emitted correctly and asserted in tests, but nothing consumed the tokens, so
 * both stores rendered identically. Two independent mistakes hid behind a
 * passing check —
 *
 *   1. `@theme inline` substitutes a token's VALUE into each utility, so
 *      `.bg-brand` compiled to a literal colour that no runtime override could
 *      reach. A plain `@theme` compiles it to `var(--color-brand)` instead.
 *   2. The Tailwind v3 arbitrary-value shorthand for a custom property is no
 *      longer read as var() in v4: it compiles to a bare `border-radius:
 *      --radius-lg`, an invalid declaration that browsers drop. Use the theme
 *      name (rounded-lg) instead.
 *
 * Asserting that a <style> tag exists proves nothing. Asserting that utilities
 * resolve through var() proves the override can actually land.
 *
 * Run after `next build`.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = ".next/static";

if (!existsSync(ROOT)) {
  console.error(`✗ ${ROOT} not found. Run \`npm run build\` first.`);
  process.exit(1);
}

function* cssFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* cssFiles(full);
    else if (entry.endsWith(".css")) yield full;
  }
}

const css = [...cssFiles(ROOT)].map((f) => readFileSync(f, "utf8")).join("\n");

if (!css) {
  console.error("✗ No compiled CSS found.");
  process.exit(1);
}

const problems = [];

// Every overridable token must reach its utility through var().
const OVERRIDABLE = [
  { utility: "bg-brand", declaration: "background-color: var(--color-brand)" },
  { utility: "text-brand", declaration: "color: var(--color-brand)" },
  { utility: "bg-accent", declaration: "background-color: var(--color-accent)" },
  { utility: "rounded-lg", declaration: "border-radius: var(--radius-lg)" },
  { utility: "rounded-md", declaration: "border-radius: var(--radius-md)" },
];

for (const { utility, declaration } of OVERRIDABLE) {
  // Tolerate whitespace differences between dev and production output.
  const relaxed = declaration.replace(/\s+/g, "\\s*").replace(/[()]/g, "\\$&");
  const pattern = new RegExp(`\\.${utility}\\s*\\{[^}]*${relaxed}`);
  if (!pattern.test(css)) {
    problems.push(`.${utility} does not resolve to "${declaration}"`);
  }
}

// Tailwind v3's `rounded-[--x]` syntax compiles to an invalid declaration in v4.
const invalidVar = css.match(/[a-z-]+:\s*--[a-z-]+\s*[;}]/g);
if (invalidVar) {
  const unique = [...new Set(invalidVar.map((m) => m.trim()))];
  problems.push(
    `invalid declarations — a bare custom property is not a value. Use the ` +
      `theme name (rounded-lg) or var(): ${unique.slice(0, 5).join(", ")}`,
  );
}

if (problems.length > 0) {
  console.error("✗ Per-store theming is broken:\n");
  for (const problem of problems) console.error(`    ${problem}`);
  console.error("\n  A store's <style> override cannot reach a utility that");
  console.error("  compiled its colour in literally.");
  process.exit(1);
}

console.log(`✓ Theme tokens resolve through var() — per-store overrides can land`);
console.log(`    checked ${OVERRIDABLE.length} overridable utilities`);
