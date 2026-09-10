#!/usr/bin/env node
/**
 * F-042 (spec.md criterio 6, architecture.md § Componentes "Medidor de la
 * geometría") — calcado de `scripts/check-image-budget.mjs`: mide bytes
 * contra la app levantada y se llama desde `.agent/specs/F-042/smoke.sh`,
 * nunca desde `.agent/verify.sh` directamente (no hay servidor arriba en
 * una corrida `--full`).
 *
 * Pide `GET /api/zones/geometry/{slug}` y afirma que la respuesta trae
 * EXACTAMENTE `--expect` zonas — ni la provincia entera cuando la tienda
 * declaró cuatro municipios, ni el país cuando declaró una provincia (E8,
 * E9, R13) — y anota el peso en bytes.
 *
 * Uso:
 *   node scripts/check-geometry-budget.mjs --slug=tienda-demo --expect=4 [--base=http://localhost:3100]
 *
 * Exit codes:
 *   0  la respuesta trae EXACTAMENTE `--expect` features, sin `missing`
 *   1  count distinto, `missing` no vacío, o la petición no respondió 200
 */

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
const SLUG = args.get("slug");
const EXPECT = args.has("expect") ? Number(args.get("expect")) : null;

if (!SLUG || EXPECT === null || Number.isNaN(EXPECT)) {
  console.error("Uso: node scripts/check-geometry-budget.mjs --slug=<slug> --expect=<n>");
  process.exit(1);
}

async function main() {
  const url = `${BASE}/api/zones/geometry/${SLUG}`;
  const response = await fetch(url).catch((error) => {
    console.error(`✗ No se pudo pedir ${url}: ${error.message}`);
    process.exit(1);
  });
  if (!response.ok) {
    console.error(`✗ ${url} respondió ${response.status}`);
    process.exit(1);
  }
  const text = await response.text();
  const bytes = Buffer.byteLength(text);
  const json = JSON.parse(text);
  const count = Array.isArray(json.features) ? json.features.length : -1;
  const missing = Array.isArray(json.missing) ? json.missing : [];

  console.log(`  ${SLUG}: ${count} zonas, ${(bytes / 1024).toFixed(1)} KB (esperadas ${EXPECT})`);
  if (missing.length > 0) {
    console.error(`  ✗ ${missing.length} zonas ofrecibles sin geometría: ${missing.join(", ")}`);
  }

  const ok = count === EXPECT && missing.length === 0;
  console.log(`${ok ? "✓" : "✗"} ${SLUG}: ${count}/${EXPECT} zonas, ${bytes} bytes`);
  process.exit(ok ? 0 : 1);
}

main();
