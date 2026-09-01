#!/usr/bin/env node
/**
 * Verify the HTTP contract of GET /api/internal/reconciliation (F-014),
 * against a locally running server. HTTP puro: no `import` de Prisma en este
 * archivo, ni una escritura que no pase por el propio contrato (HD6,
 * architecture.md § «El script HTTP»). Lo que necesita escribir o leer la
 * base directamente vive en src/features/sync/server/reconciliation.db.test.ts.
 *
 *   node scripts/check-reconciliation.mjs --store=seed-tienda-1  # C1
 *   node scripts/check-reconciliation.mjs --price                # C2
 *   node scripts/check-reconciliation.mjs --availability          # C2
 *   node scripts/check-reconciliation.mjs --unknown-store         # C5
 *   node scripts/check-reconciliation.mjs --other-business        # C6
 *   node scripts/check-reconciliation.mjs --empty                 # C10
 *   node scripts/check-reconciliation.mjs --all                   # los seis, en orden
 *   node scripts/check-reconciliation.mjs --token=<token>         # seed-negocio-1's own token
 *
 * The token has to be seed-negocio-1's own (`npm run mint:token --
 * seed-negocio-1`), or the write modes (`--price`, `--availability`) answer
 * `403 BUSINESS_MISMATCH` instead of exercising what they mean to.
 *
 * Exits 0 only if every mode it ran passed. Any mismatch prints what was
 * expected against what came back and exits non-zero.
 */
import "dotenv/config";

const BASE = process.env.QAB_BASE_URL ?? "http://localhost:3000";
const argv = process.argv.slice(2);
const args = new Set(argv);

const explicitToken = argv.find((arg) => arg.startsWith("--token="))?.split("=")[1];
const token = explicitToken ?? process.env.QAB_BEARER_TOKEN;

const businessId = "seed-negocio-1";
const KNOWN_MODES = [
  "--store",
  "--price",
  "--availability",
  "--unknown-store",
  "--other-business",
  "--empty",
  "--all",
];

let failures = 0;

function ok(message) {
  console.log(`OK   ${message}`);
}

function fail(message) {
  console.error(`FAIL ${message}`);
  failures += 1;
}

async function getReconciliation(storeId) {
  const response = await fetch(
    `${BASE}/api/internal/reconciliation?storeId=${encodeURIComponent(storeId)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  return { status: response.status, body: await response.json() };
}

async function postCatalog(events) {
  const response = await fetch(`${BASE}/api/internal/sync/catalog`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ businessId, events }),
  });
  return { status: response.status, body: await response.json() };
}

async function postAvailability(items) {
  const response = await fetch(`${BASE}/api/internal/sync/availability`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ businessId, items }),
  });
  return { status: response.status, body: await response.json() };
}

/** C1 — the shape of a 200: exactly `products` and `hash`, `hash` 32 hex. */
async function checkStore(storeId) {
  const { status, body } = await getReconciliation(storeId);
  if (status !== 200) {
    fail(`--store=${storeId}: HTTP ${status}, esperaba 200. Cuerpo: ${JSON.stringify(body)}`);
    return;
  }
  const keys = Object.keys(body).sort().join(",");
  if (keys !== "hash,products") {
    fail(`--store=${storeId}: claves "${keys}", esperaba exactamente "hash,products"`);
    return;
  }
  if (!/^[0-9a-f]{32}$/.test(body.hash)) {
    fail(`--store=${storeId}: hash "${body.hash}" no son 32 hex minúsculas`);
    return;
  }
  ok(`--store=${storeId} -> 200 { products: ${body.products}, hash: ${body.hash} }`);
}

/**
 * C2 — el precio mueve el hash. El precio se deriva del reloj (con dos
 * decimales como máximo, R7) para no reenviar nunca el mismo valor: hacerlo
 * dejaría el hash sin cambiar y el modo fallaría en verde-falso.
 */
async function checkPrice() {
  const storeId = "seed-tienda-1";
  const before = await getReconciliation(storeId);
  if (before.status !== 200) {
    fail(`--price: la lectura previa de reconciliación dio ${before.status}, esperaba 200`);
    return;
  }

  const suffix = Date.now().toString(36);
  // Integer cents / 100: at most two decimal digits, never IEEE-754 noise.
  const price = (Date.now() % 100000) / 100;

  const { status, body } = await postCatalog([
    {
      eventId: `evt-reconciliation-price-${suffix}`,
      entity: "PRODUCT",
      operation: "UPDATE",
      occurredAt: new Date().toISOString(),
      payload: {
        storeProductId: "seed-tienda-1-p0",
        productId: "seed-producto-0",
        businessId,
        storeId,
        localName: "Refresco de cola 1.5 L",
        barcodes: ["7501031311309"],
        localCategoryId: "seed-cat-bebidas",
        price,
        currency: "CUP",
        canonicalProductId: null,
        imageUrl: null,
        publishToStore: true,
        updatedAt: new Date().toISOString(),
      },
    },
  ]);
  if (status !== 207) {
    fail(`--price: POST sync/catalog dio ${status}, esperaba 207. Cuerpo: ${JSON.stringify(body)}`);
    return;
  }

  const after = await getReconciliation(storeId);
  if (after.status !== 200) {
    fail(`--price: la lectura posterior de reconciliación dio ${after.status}, esperaba 200`);
    return;
  }

  if (after.body.hash === before.body.hash) {
    fail(`--price: el hash no cambió (${before.body.hash}) tras mandar price=${price}`);
    return;
  }
  if (after.body.products !== before.body.products) {
    fail(
      `--price: products cambió de ${before.body.products} a ${after.body.products}, no debía moverse`,
    );
    return;
  }
  ok(
    `--price: price=${price} -> hash ${before.body.hash} != ${after.body.hash}, products sin cambiar`,
  );
}

/**
 * C2 — la disponibilidad mueve el hash. Se fuerza primero AVAILABLE (para no
 * depender de en qué estado estaba la fixture) y luego OUT_OF_STOCK, y al
 * final se restaura AVAILABLE.
 */
async function checkAvailability() {
  const storeId = "seed-tienda-1";
  const items = (availability) => [
    { storeProductId: "seed-tienda-1-p0", storeId, availability },
    { storeProductId: "seed-tienda-1-p1", storeId, availability },
  ];

  const setAvailable1 = await postAvailability(items("AVAILABLE"));
  if (setAvailable1.status !== 200) {
    fail(`--availability: fijar AVAILABLE dio ${setAvailable1.status}, esperaba 200`);
    return;
  }
  const before = await getReconciliation(storeId);
  if (before.status !== 200) {
    fail(`--availability: la lectura previa dio ${before.status}, esperaba 200`);
    return;
  }

  const setOutOfStock = await postAvailability(items("OUT_OF_STOCK"));
  if (setOutOfStock.status !== 200) {
    fail(`--availability: fijar OUT_OF_STOCK dio ${setOutOfStock.status}, esperaba 200`);
    return;
  }
  const after = await getReconciliation(storeId);
  if (after.status !== 200) {
    fail(`--availability: la lectura posterior dio ${after.status}, esperaba 200`);
    return;
  }

  // Restore, regardless of the outcome above, so the fixture is not left
  // OUT_OF_STOCK for whoever runs the script next.
  await postAvailability(items("AVAILABLE"));

  if (after.body.hash === before.body.hash) {
    fail(`--availability: el hash no cambió (${before.body.hash}) al pasar a OUT_OF_STOCK`);
    return;
  }
  if (after.body.products !== before.body.products) {
    fail(
      `--availability: products cambió de ${before.body.products} a ${after.body.products}, no debía moverse`,
    );
    return;
  }
  ok(
    `--availability: AVAILABLE -> OUT_OF_STOCK, hash ${before.body.hash} != ${after.body.hash}, products sin cambiar, restaurado a AVAILABLE`,
  );
}

/** C5 — una tienda inexistente responde 404 UNKNOWN_STORE. */
async function checkUnknownStore() {
  const { status, body } = await getReconciliation(`no-such-store-${Date.now().toString(36)}`);
  if (status !== 404) {
    fail(`--unknown-store: HTTP ${status}, esperaba 404. Cuerpo: ${JSON.stringify(body)}`);
    return null;
  }
  if (JSON.stringify(body) !== JSON.stringify({ error: "UNKNOWN_STORE" })) {
    fail(`--unknown-store: cuerpo ${JSON.stringify(body)}, esperaba {"error":"UNKNOWN_STORE"}`);
    return null;
  }
  ok(`--unknown-store -> 404 ${JSON.stringify(body)}`);
  return { status, body };
}

/**
 * C6 — una tienda de otro negocio responde el MISMO 404, byte a byte. Corre
 * `--unknown-store` en la misma corrida para tener con qué comparar: no
 * basta con que los dos "parezcan" 404, tienen que ser indistinguibles.
 */
async function checkOtherBusiness() {
  const unknown = await checkUnknownStore();
  if (!unknown) {
    fail("--other-business: no se pudo comparar porque --unknown-store ya falló");
    return;
  }

  const other = await getReconciliation("seed-tienda-7");
  if (other.status !== unknown.status) {
    fail(
      `--other-business: HTTP ${other.status} frente a ${unknown.status} de --unknown-store, tienen que coincidir`,
    );
    return;
  }
  if (JSON.stringify(other.body) !== JSON.stringify(unknown.body)) {
    fail(
      `--other-business: cuerpo ${JSON.stringify(other.body)} difiere byte a byte de ${JSON.stringify(unknown.body)}`,
    );
    return;
  }
  ok(
    `--other-business (seed-tienda-7) -> ${other.status} ${JSON.stringify(other.body)}, igual que --unknown-store`,
  );
}

/** C10 — tienda publicada y vacía: 200, nunca 404, con el md5 de la cadena vacía. */
async function checkEmpty() {
  const storeId = "seed-tienda-8";
  const { status, body } = await getReconciliation(storeId);
  if (status === 404) {
    fail(`--empty: respondió 404 para ${storeId}, una tienda vacía tiene que dar 200 (E7)`);
    return;
  }
  if (status !== 200) {
    fail(`--empty: HTTP ${status}, esperaba 200. Cuerpo: ${JSON.stringify(body)}`);
    return;
  }
  const expected = { products: 0, hash: "d41d8cd98f00b204e9800998ecf8427e" };
  if (JSON.stringify(body) !== JSON.stringify(expected)) {
    fail(`--empty: cuerpo ${JSON.stringify(body)}, esperaba ${JSON.stringify(expected)}`);
    return;
  }
  ok(`--empty (${storeId}) -> 200 ${JSON.stringify(body)}`);
}

async function main() {
  if (!token) {
    console.error("Falta el token: exporta QAB_BEARER_TOKEN o pasa --token=<token>.");
    process.exit(1);
  }

  const requested = argv.filter((arg) => KNOWN_MODES.some((mode) => arg.startsWith(mode)));
  if (requested.length === 0) {
    console.error(`Uso: node scripts/check-reconciliation.mjs <${KNOWN_MODES.join("|")}>`);
    process.exit(1);
  }

  if (args.has("--all")) {
    await checkStore("seed-tienda-1");
    await checkPrice();
    await checkAvailability();
    await checkUnknownStore();
    await checkOtherBusiness();
    await checkEmpty();
  } else {
    const storeArg = argv.find((arg) => arg.startsWith("--store="));
    if (storeArg) await checkStore(storeArg.split("=")[1]);
    if (args.has("--price")) await checkPrice();
    if (args.has("--availability")) await checkAvailability();
    if (args.has("--unknown-store")) await checkUnknownStore();
    if (args.has("--other-business")) await checkOtherBusiness();
    if (args.has("--empty")) await checkEmpty();
  }

  if (failures > 0) {
    console.error(`\n${failures} comprobación(es) fallaron.`);
    process.exit(1);
  }
  console.log("\nTodas las comprobaciones pasaron.");
}

await main();
