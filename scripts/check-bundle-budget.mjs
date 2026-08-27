#!/usr/bin/env node
/**
 * Fail the build if the client JavaScript on a storefront page grows past its
 * budget.
 *
 * What this measures: every <script src> a prerendered page actually references,
 * gzipped. That is what a visitor downloads — a fairer number than summing the
 * build manifest, which includes chunks no single page loads.
 *
 * On the connections this app targets, the number that decides whether the page
 * is usable is the HTML, not the JS: every storefront component is a server
 * component, so the catalogue is readable before a single byte of JavaScript
 * arrives. The JS budget exists to catch regressions — a heavy client library,
 * or a catalogue component that gained a "use client" — not to hit an absolute.
 *
 * Run after `next build`.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

// Raised from 190 to 193 by F-010 (SP4, consulted and authorized 2026-08-26):
// the cart's first "use client" island lands on this SSG page, measured at
// 182.1 KB gzip + the same ~10 KB margin the previous number already carried.
// Bajarlo es F-013 — su criterio 4 lo dice literalmente.
const BUDGET_KB = Number(process.env.BUNDLE_BUDGET_KB ?? 193);
const APP_DIR = ".next/server/app";

if (!existsSync(APP_DIR)) {
  console.error(`✗ ${APP_DIR} not found. Run \`npm run build\` first.`);
  process.exit(1);
}

function* htmlFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* htmlFiles(full);
    else if (entry.endsWith(".html")) yield full;
  }
}

const gzipCache = new Map();
function gzipOf(src) {
  if (gzipCache.has(src)) return gzipCache.get(src);
  // "/_next/static/chunks/x.js" -> ".next/static/chunks/x.js"
  const rel = src.replace(/^\/_next\//, "");
  const full = path.join(".next", rel);
  const size = existsSync(full) ? gzipSync(readFileSync(full)).length : 0;
  gzipCache.set(src, size);
  return size;
}

let worst = { page: null, js: 0, html: 0 };

for (const file of htmlFiles(APP_DIR)) {
  const html = readFileSync(file, "utf8");
  const srcs = [...new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]))];
  const js = srcs.reduce((total, src) => total + gzipOf(src), 0);
  if (js > worst.js) {
    worst = { page: path.relative(APP_DIR, file), js, html: gzipSync(Buffer.from(html)).length };
  }
}

if (!worst.page) {
  console.error("✗ No prerendered pages found to measure.");
  process.exit(1);
}

// HD12 (F-011): the migration that closes every store retroactively means a
// build with no PUBLISHED store prerenders NOTHING under `/[slug]` — this
// script would then measure `index.html` and pass in green, silently
// checking a different, much lighter page than the one this budget is
// actually about (architecture.md § Qué se rompe de lo ya verificado). A
// storefront page is a top-level `<slug>.html` that is none of the app's
// other top-level routes.
const NON_STORE_TOP_LEVEL_PAGES = new Set(["index.html", "_not-found.html", "_global-error.html"]);
const hasStorePage = [...htmlFiles(APP_DIR)].some((file) => {
  const rel = path.relative(APP_DIR, file);
  return !rel.includes(path.sep) && !NON_STORE_TOP_LEVEL_PAGES.has(rel);
});
if (!hasStorePage) {
  console.error(
    "✗ No store page was prerendered — nothing PUBLISHED to measure.\n" +
      "  check:bundle would otherwise pass measuring index.html, which is not\n" +
      "  what this budget is for. Publish at least one store before building\n" +
      "  (`npm run seed` keeps tienda-demo and tienda-dos open on purpose).",
  );
  process.exit(1);
}

const jsKb = worst.js / 1024;
const htmlKb = worst.html / 1024;
const ok = jsKb <= BUDGET_KB;

console.log(`${ok ? "✓" : "✗"} Heaviest page: ${worst.page}`);
console.log(`    client JS: ${jsKb.toFixed(1)} KB gzipped (budget ${BUDGET_KB} KB)`);
console.log(`    HTML:      ${htmlKb.toFixed(1)} KB gzipped — this is what decides first paint`);

if (!ok) {
  console.error(
    "\nThe client bundle grew past its budget. Before raising the number, check\n" +
      'whether a component gained an unnecessary "use client".',
  );
  process.exit(1);
}
