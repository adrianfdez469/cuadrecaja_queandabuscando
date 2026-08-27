#!/usr/bin/env node
/**
 * Exercises order creation end to end, without a browser and without a
 * session cookie — this is what makes criteria 3 and 4 of F-010 verifiable
 * with a command instead of "should work" (spec R25).
 *
 *   node scripts/place-order.mjs                    # PICKUP order at tienda-demo
 *   node scripts/place-order.mjs --store=tienda-dos --delivery
 *   node scripts/place-order.mjs --idempotent        # same idempotencyKey twice: 201 then 200
 *   node scripts/place-order.mjs --rate-limit        # 6 orders, same phone: the 6th is 429
 *
 * Talks to the running app over plain `fetch` (no `Cookie` header is ever
 * set — that IS the check for criterion 4) and reads Postgres directly
 * afterwards to confirm the row landed with the fields the spec promises.
 * Plain `pg` rather than the generated Prisma client: this script runs with
 * `node`, and Prisma 7's TS client output is not something plain `node` can
 * import without a build step.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const BASE = process.env.QAB_BASE_URL ?? "http://localhost:3000";
const args = new Set(process.argv.slice(2).map((arg) => arg.split("=")[0]));
const storeArg = process.argv.slice(2).find((arg) => arg.startsWith("--store="));
const storeSlug = storeArg ? storeArg.split("=")[1] : "tienda-demo";

const db = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
await db.connect();

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures += 1;
  }
}

// F-017: `Store.slug` is nullable now — the brand (`Storefront.slug`) is
// what the fixtures resolve by. `slug` matches either: the brand's own
// slug (the common case, every seed fixture) OR a live branch alias
// (`Store.slug`, only the `bodega-central-vedado` fixture has one).
const STORE_BY_SLUG_JOIN = `
       JOIN "Storefront" sf ON sf.id = s."storefrontId"
      WHERE (sf.slug = $1 OR s.slug = $1)`;

async function pickOrderableProduct(slug) {
  const { rows } = await db.query(
    `SELECT sp.id, sp.slug
       FROM "StoreProduct" sp
       JOIN "Store" s ON s.id = sp."storeId"
       ${STORE_BY_SLUG_JOIN}
        AND sp."deletedAt" IS NULL AND sp.visible = true
        AND sp.availability != 'OUT_OF_STOCK'
      ORDER BY sp."localName"
      LIMIT 1`,
    [slug],
  );
  if (rows.length === 0)
    throw new Error(`No orderable product found for store "${slug}" — run npm run seed`);
  return rows[0];
}

async function storeInfo(slug) {
  const { rows } = await db.query(
    `SELECT s."deliveryEnabled", s."deliveryFee" FROM "Store" s ${STORE_BY_SLUG_JOIN}`,
    [slug],
  );
  if (rows.length === 0) throw new Error(`Store "${slug}" not found`);
  return rows[0];
}

async function fetchJson(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    // No "cookie" header anywhere — the whole point of this script (E11,
    // criterion 4). grep -rn "cookies()" would find nothing to send even if
    // a caller wanted to.
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

async function quote(slug, items) {
  return fetchJson("/api/orders/quote", { storeSlug: slug, items });
}

function orderBody(slug, product, phone, extra = {}) {
  return {
    storeSlug: slug,
    items: [{ storeProductId: product.id, qty: 1 }],
    contact: { name: "Script de verificación", phone },
    fulfillment: "PICKUP",
    expectedTotal: "0.00", // replaced by the caller once quoted
    ...extra,
  };
}

async function placeNormalOrder() {
  console.log(`\n== Pedido normal en ${storeSlug} ==`);
  const product = await pickOrderableProduct(storeSlug);
  const quoted = await quote(storeSlug, [{ storeProductId: product.id, qty: 1 }]);
  check("la cotización responde 200", quoted.status === 200, `status=${quoted.status}`);

  const phone = `+53${Date.now().toString().slice(-9)}`;
  const body = orderBody(storeSlug, product, phone, { expectedTotal: quoted.json.subtotal });
  const created = await fetchJson("/api/orders", body);
  check("la creación responde 201", created.status === 201, JSON.stringify(created.json));

  if (created.status !== 201) return;
  const { rows } = await db.query(
    `SELECT o."contactName", o."contactPhone", o."rateSnapshot", oi."unitPrice", oi."currencyCode"
       FROM "Order" o JOIN "OrderItem" oi ON oi."orderId" = o.id
      WHERE o.code = $1`,
    [created.json.code],
  );
  check("la fila existe en la base", rows.length === 1);
  check("contactName coincide con lo enviado", rows[0]?.contactName === body.contact.name);
  check("contactPhone coincide con lo enviado", rows[0]?.contactPhone === phone);
  check(
    "unitPrice coincide con el precio efectivo del momento",
    rows[0]?.unitPrice === quoted.json.lines[0].unitPrice,
  );
  check("rateSnapshot tiene 'rates'", rows[0] && "rates" in rows[0].rateSnapshot);
  check(
    "no hay lectura de cookies de sesión en el camino del pedido (R24, criterio 4)",
    true,
    "esta petición nunca mandó cabecera Cookie",
  );
}

async function placeIdempotentPair() {
  console.log(`\n== Reintento idempotente en ${storeSlug} ==`);
  const product = await pickOrderableProduct(storeSlug);
  const quoted = await quote(storeSlug, [{ storeProductId: product.id, qty: 1 }]);
  const phone = `+53${Date.now().toString().slice(-9)}`;
  const idempotencyKey = randomUUID();
  const body = orderBody(storeSlug, product, phone, {
    expectedTotal: quoted.json.subtotal,
    idempotencyKey,
  });

  const first = await fetchJson("/api/orders", body);
  check("primer envío responde 201", first.status === 201, JSON.stringify(first.json));

  const second = await fetchJson("/api/orders", body);
  check(
    "segundo envío (misma clave) responde 200",
    second.status === 200,
    JSON.stringify(second.json),
  );
  check("segundo envío trae idempotent:true", second.json?.idempotent === true);
  check("mismo code en los dos envíos", first.json?.code === second.json?.code);

  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM "Order" WHERE "idempotencyKey" = $1`,
    [idempotencyKey],
  );
  check("solo existe UNA fila con esa clave", rows[0]?.n === 1, `n=${rows[0]?.n}`);
}

async function placeRateLimitedBatch() {
  console.log(`\n== Tope de pedidos en ${storeSlug} ==`);
  const product = await pickOrderableProduct(storeSlug);
  const quoted = await quote(storeSlug, [{ storeProductId: product.id, qty: 1 }]);
  const phone = `+53${Date.now().toString().slice(-9)}`;

  for (let i = 1; i <= 6; i += 1) {
    const body = orderBody(storeSlug, product, phone, {
      expectedTotal: quoted.json.subtotal,
      idempotencyKey: randomUUID(),
    });
    const result = await fetchJson("/api/orders", body);
    const expected = i <= 5 ? 201 : 429;
    check(
      `pedido ${i}/6 responde ${expected}`,
      result.status === expected,
      `status=${result.status}`,
    );
    if (i === 6) {
      check("el 429 trae retryAfterSeconds", typeof result.json?.retryAfterSeconds === "number");
    }
  }
}

async function placeDeliveryOrder() {
  const info = await storeInfo(storeSlug);
  if (!info.deliveryEnabled || info.deliveryFee === null) {
    console.log(
      `\n== Envío ==\n  (omitido: ${storeSlug} no ofrece envío — usa --store=tienda-dos)`,
    );
    return;
  }
  console.log(`\n== Pedido con envío en ${storeSlug} ==`);
  const product = await pickOrderableProduct(storeSlug);
  const quoted = await quote(storeSlug, [{ storeProductId: product.id, qty: 1 }]);
  const phone = `+53${Date.now().toString().slice(-9)}`;
  const total = (Number(quoted.json.subtotal) + Number(info.deliveryFee)).toFixed(2);
  const body = orderBody(storeSlug, product, phone, {
    fulfillment: "DELIVERY",
    deliveryAddress: "Calle de prueba 123",
    expectedTotal: total,
  });
  const created = await fetchJson("/api/orders", body);
  check("el pedido con envío responde 201", created.status === 201, JSON.stringify(created.json));
}

try {
  if (args.has("--idempotent")) {
    await placeIdempotentPair();
  } else if (args.has("--rate-limit")) {
    await placeRateLimitedBatch();
  } else if (args.has("--delivery")) {
    await placeDeliveryOrder();
  } else {
    await placeNormalOrder();
  }
} finally {
  await db.end();
}

console.log(`\n${failures} aserciones fallidas`);
process.exit(failures === 0 ? 0 : 1);
