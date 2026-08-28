#!/usr/bin/env node
/**
 * F-023 R7/R8, architecture.md § El presupuesto de imágenes — decision (c).
 *
 * Fails if the total weight of the image an average mobile shopper would
 * download for a catalog page (DPR 1, AVIF-capable) goes over budget — a
 * NEW number, separate from `scripts/check-bundle-budget.mjs` (which only
 * measures client JavaScript).
 *
 * Requires a server AND the Storage emulator up, with the seed run
 * (`npm run seed`, which uploads `prisma/fixtures/producto-demo.jpg` to
 * every product of `tienda-demo` — see `prisma/seed.ts::seedProductImages`).
 * That is why this lives here, invoked from `.agent/specs/F-023/smoke.sh`,
 * and NOT as a new stage of `.agent/verify.sh`: a `--full` run has neither a
 * server nor an emulator, and `npm run check:harness`'s own comprobación 5
 * would force a matching edit to `.agent/init.sh` for an environment that
 * cannot deliver it (see architecture.md for the full argument).
 *
 * Usage:
 *   node scripts/check-image-budget.mjs [--base=http://localhost:3100] [--slug=tienda-demo]
 *
 * Exit codes:
 *   0  total <= budget, at least one image measured, every candidate resolved
 *   1  total > budget, OR the measured set is EMPTY (I5 — the same "no
 *      PUBLISHED store" trap `check-bundle-budget.mjs`'s HD12 guard fixed),
 *      OR any candidate did not resolve to a real byte count (a 404/400
 *      would otherwise measure 0 bytes and pass in green on broken URLs).
 */
import { setTimeout as delay } from "node:timers/promises";

// Raised only with a comment naming who, why, and the measurement — same
// convention `check-bundle-budget.mjs`'s own `BUDGET_KB` already follows.
// 300 KB ÷ 15 seed products of `tienda-demo` ≈ 20 KB per card variant (R8,
// `IMAGE_CARD_VARIANT_MAX_BYTES` in `src/constants/media.ts`). This number
// is duplicated on purpose, not derived from that constant: a `.mjs` cannot
// import a `.ts`, the exact reason `check-bundle-budget.mjs` already
// hardcodes its own `BUDGET_KB`.
const IMAGE_BUDGET_KB = Number(process.env.IMAGE_BUDGET_KB ?? 300);

const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--"))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split("=");
      return [key, rest.join("=")];
    }),
);

const BASE =
  args.get("base") ??
  process.env.SMOKE_BASE_URL ??
  `http://localhost:${process.env.SMOKE_PORT ?? 3100}`;
const SLUG = args.get("slug") ?? "tienda-demo";

/** Every `<source type="image/avif" srcset="…">` tag in the HTML, in
 *  document order — a plain regex over raw markup, same technique
 *  `check-bundle-budget.mjs` already uses for `<script src>`, deliberately
 *  not a full HTML parser this repo doesn't otherwise depend on. */
function extractAvifSourceTags(html) {
  const tags = html.match(/<source\b[^>]*>/gi) ?? [];
  return tags.filter((tag) => /type="image\/avif"/i.test(tag));
}

/** design.md D3: the card offers ONE candidate with no width descriptor;
 *  the detail variant offers two, `"…w400.avif 400w, …w800.avif 800w"`.
 *  Either way, this returns E7's "candidate a mobile client (DPR 1) would
 *  pick" — the smallest width, or the sole candidate when there is no
 *  descriptor at all. */
function smallestCandidateUrl(srcsetValue) {
  const candidates = srcsetValue.split(",").map((part) => part.trim());
  const parsed = candidates.map((candidate) => {
    const [url, descriptor] = candidate.split(/\s+/);
    const width = descriptor && descriptor.endsWith("w") ? Number(descriptor.slice(0, -1)) : 0;
    return { url, width };
  });
  parsed.sort((a, b) => a.width - b.width);
  return parsed[0]?.url;
}

function extractSrcset(sourceTag) {
  // React's static markup renders the attribute as `srcSet` (camelCase),
  // which HTML treats as identical to `srcset` — case-insensitive, on
  // purpose (found by running this, not by reading the JSX).
  const match = sourceTag.match(/srcset="([^"]*)"/i);
  return match ? match[1] : null;
}

/** HEAD first (cheap); if the response doesn't carry `content-length` (some
 *  proxies/emulators omit it), falls back to a GET and measures the real
 *  downloaded body — never silently counts a missing header as 0 bytes. */
async function measure(url) {
  const head = await fetch(url, { method: "HEAD" }).catch(() => null);
  if (!head || !head.ok) return { ok: false, status: head?.status ?? 0, bytes: 0 };

  const contentLength = head.headers.get("content-length");
  if (contentLength !== null) return { ok: true, bytes: Number(contentLength) };

  const got = await fetch(url).catch(() => null);
  if (!got || !got.ok) return { ok: false, status: got?.status ?? 0, bytes: 0 };
  const buffer = await got.arrayBuffer();
  return { ok: true, bytes: buffer.byteLength };
}

async function main() {
  const pageUrl = `${BASE}/${SLUG}`;
  const response = await fetch(pageUrl).catch((error) => {
    console.error(`✗ No se pudo pedir ${pageUrl}: ${error.message}`);
    process.exit(1);
  });
  if (!response.ok) {
    console.error(`✗ ${pageUrl} respondió ${response.status}`);
    process.exit(1);
  }
  const html = await response.text();

  const avifTags = extractAvifSourceTags(html);
  const candidateUrls = [
    ...new Set(avifTags.map(extractSrcset).filter(Boolean).map(smallestCandidateUrl)),
  ];

  if (candidateUrls.length === 0) {
    console.error(
      `✗ No se encontró ninguna imagen en ${pageUrl} — medición vacía. ` +
        "¿Corriste `npm run seed` con el emulador de Storage arriba?",
    );
    process.exit(1);
  }

  let total = 0;
  let anyFailed = false;
  for (const url of candidateUrls) {
    // A pequeña pausa entre peticiones evita saturar el emulador local con
    // decenas de HEAD simultáneos — no es una preocupación de producción.
    await delay(5);
    const result = await measure(url);
    if (!result.ok) {
      console.error(`  ✗ ${url} — respondió ${result.status}, no 200`);
      anyFailed = true;
      continue;
    }
    total += result.bytes;
    console.log(`  ${(result.bytes / 1024).toFixed(1).padStart(7)} KB  ${url}`);
  }

  const totalKb = total / 1024;
  const budgetOk = totalKb <= IMAGE_BUDGET_KB;

  console.log(`${budgetOk && !anyFailed ? "✓" : "✗"} ${candidateUrls.length} imágenes medidas`);
  console.log(`    total: ${totalKb.toFixed(1)} KB (presupuesto ${IMAGE_BUDGET_KB} KB)`);

  if (anyFailed) {
    console.error(
      "\nAl menos una variante no respondió 200 — una URL rota mide 0 bytes " +
        "y dejaría pasar el presupuesto en verde midiendo la página equivocada.",
    );
    process.exit(1);
  }
  if (!budgetOk) {
    console.error(
      "\nEl catálogo de referencia superó el presupuesto de imágenes. Antes de " +
        "subir IMAGE_BUDGET_KB, baja calidad o ancho en src/constants/media.ts (R8).",
    );
    process.exit(1);
  }
  process.exit(0);
}

main();
