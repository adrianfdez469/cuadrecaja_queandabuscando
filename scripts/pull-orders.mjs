#!/usr/bin/env node
/**
 * Exercises the two endpoints cuadrecaja uses to collect orders — this is what
 * makes the four acceptance criteria of F-007 verifiable with a command instead
 * of "the endpoints exist and typecheck", which is where the feature had been
 * stuck since it was written: until F-010 shipped a checkout there was no way to
 * create an order, so the pull could only be tried on hand-inserted rows.
 *
 *   node scripts/pull-orders.mjs                 # the four modes below, in order
 *   node scripts/pull-orders.mjs --paginate      # criterion 1: shape + cursor
 *   node scripts/pull-orders.mjs --transition    # criterion 2: PENDING → PULLED
 *   node scripts/pull-orders.mjs --status        # criterion 3: status + 404
 *   node scripts/pull-orders.mjs --no-outbound   # criterion 4: no calls out
 *
 * This script IS the POS for the duration of the run: it seeds orders through
 * the public checkout (the same path a shopper takes, no session cookie) and
 * then reads them back the way cuadrecaja would, with the bearer token.
 *
 * Plain `pg` rather than the generated Prisma client, for the same reason
 * place-order.mjs gives: this runs under bare `node`, and Prisma 7's TS client
 * output needs a build step first.
 *
 * Safe to run against a shared database. Every mode anchors its assertions to
 * order ids it created itself, so orders another session left lying around
 * neither break it nor get asserted on. It creates rows and moves their status;
 * it never deletes anything.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const BASE = process.env.QAB_BASE_URL ?? "http://localhost:3000";
const SYNC_TOKEN = process.env.SYNC_TOKEN;
const STORE_SLUG =
  process.argv
    .slice(2)
    .find((arg) => arg.startsWith("--store="))
    ?.split("=")[1] ?? "tienda-demo";

/** Bigger than any autoincrement id this database will plausibly reach (E7). */
const ABSENT_ORDER_ID = "999999999999";

const args = new Set(process.argv.slice(2).map((arg) => arg.split("=")[0]));

if (!SYNC_TOKEN) {
  console.error(
    "FAIL  SYNC_TOKEN no está en el entorno — sin él no se puede llamar a /api/internal/*",
  );
  process.exit(1);
}

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

// --------------------------------------------------------------- helpers ----

let phoneSeq = 0;
/** A fresh phone per order: creation is capped per store + phone (R30 of F-010),
 *  and reusing one would make the sixth order of a long run fail with 429. */
function uniquePhone() {
  phoneSeq += 1;
  return `+53${String(Date.now()).slice(-7)}${String(phoneSeq).padStart(2, "0")}`;
}

async function maxOrderId() {
  const { rows } = await db.query(`SELECT COALESCE(MAX(id), 0)::text AS max FROM "Order"`);
  return BigInt(rows[0].max);
}

async function orderRow(code) {
  const { rows } = await db.query(
    `SELECT id::text AS id, status, "pulledAt" FROM "Order" WHERE code = $1`,
    [code],
  );
  return rows[0] ?? null;
}

async function pickOrderableProduct(slug) {
  const { rows } = await db.query(
    `SELECT sp.id
       FROM "StoreProduct" sp
       JOIN "Store" s ON s.id = sp."storeId"
      WHERE s.slug = $1 AND sp."deletedAt" IS NULL AND sp.visible = true
        AND sp.availability != 'OUT_OF_STOCK'
      ORDER BY sp."localName"
      LIMIT 1`,
    [slug],
  );
  if (rows.length === 0)
    throw new Error(`No orderable product found for store "${slug}" — run npm run seed`);
  return rows[0];
}

/** Seeds one order the way a shopper does: quote, then create. No cookie. */
async function seedOrder() {
  const product = await pickOrderableProduct(STORE_SLUG);
  const items = [{ storeProductId: product.id, qty: 1 }];

  const quoted = await fetch(`${BASE}/api/orders/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ storeSlug: STORE_SLUG, items }),
  }).then((response) => response.json());

  const created = await fetch(`${BASE}/api/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      storeSlug: STORE_SLUG,
      items,
      contact: { name: "Script de verificación F-007", phone: uniquePhone() },
      fulfillment: "PICKUP",
      expectedTotal: quoted.subtotal,
    }),
  });

  const json = await created.json().catch(() => null);
  if (created.status !== 201) {
    throw new Error(`No se pudo sembrar un pedido: ${created.status} ${JSON.stringify(json)}`);
  }

  const row = await orderRow(json.code);
  // El `code` es la única credencial de /[slug]/pedido/[code], una página con
  // datos personales: se usa para consultar, no se imprime entero.
  return { id: BigInt(row.id), code: json.code };
}

async function pull(since, limit) {
  const response = await fetch(`${BASE}/api/internal/orders?since=${since}&limit=${limit}`, {
    headers: { authorization: `Bearer ${SYNC_TOKEN}` },
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

async function reportStatus(body, { token = SYNC_TOKEN, raw = false } = {}) {
  const headers = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;

  const response = await fetch(`${BASE}/api/internal/orders/status`, {
    method: "POST",
    headers,
    body: raw ? body : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

// ------------------------------------------------------------ criterion 1 ----

async function verifyPagination() {
  console.log(
    "\n== Criterio 1 · GET /api/internal/orders responde { orders, nextCursor } y respeta el cursor ==",
  );

  // Ancla: todo lo que sigue se afirma sobre ids > base, que son los nuestros.
  const base = await maxOrderId();
  const mine = [];
  for (let i = 0; i < 3; i += 1) mine.push((await seedOrder()).id.toString());
  console.log(`  (sembrados los pedidos ${mine.join(", ")} sobre since=${base})`);

  // --- E1: la forma de la respuesta ---
  const page = await pull(base, 3);
  check("responde 200", page.status === 200, `status=${page.status}`);
  check("el cuerpo trae `orders` como array", Array.isArray(page.json?.orders));
  check("el cuerpo trae la clave `nextCursor`", page.json !== null && "nextCursor" in page.json);
  check(
    "todos los pedidos devueltos tienen id > since",
    page.json?.orders?.every((order) => BigInt(order.id) > base),
    JSON.stringify(page.json?.orders?.map((order) => order.id)),
  );
  check(
    "el id y el cursor viajan como string, no como número (BIGINT no cabe en un Number)",
    page.json?.orders?.every((order) => typeof order.id === "string") &&
      (page.json?.nextCursor === null || typeof page.json?.nextCursor === "string"),
  );
  check(
    "la página llena devuelve el id del último como nextCursor (R2)",
    page.json?.orders?.length === 3 ? page.json.nextCursor === mine[2] : true,
    `orders=${page.json?.orders?.length} nextCursor=${page.json?.nextCursor}`,
  );

  // --- E2: paginar de uno en uno siguiendo el cursor ---
  const seen = [];
  let cursor = base.toString();
  let pages = 0;
  // El tope corta un pull infinito: si el cursor dejara de avanzar el fallo es
  // una aserción, no un script colgado.
  while (pages < 20) {
    pages += 1;
    const { json } = await pull(cursor, 1);
    seen.push(...(json?.orders ?? []).map((order) => order.id));
    if (json?.nextCursor === null || json?.nextCursor === undefined) break;
    cursor = json.nextCursor;
  }

  check(
    "paginando con limit=1 aparecen los tres pedidos, una vez cada uno y en orden",
    JSON.stringify(seen.filter((id) => mine.includes(id))) === JSON.stringify(mine),
    `vistos=${JSON.stringify(seen)} esperados=${JSON.stringify(mine)}`,
  );
  check(
    "ningún pedido se devolvió dos veces en el recorrido",
    new Set(seen).size === seen.length,
    `${seen.length} devueltos, ${new Set(seen).size} distintos`,
  );
  check("el recorrido terminó solo, sin agotar el tope", pages < 20, `${pages} páginas`);

  // --- E3: al día ---
  const caughtUp = await pull(seen.at(-1) ?? mine[2], 100);
  check(
    "al día: `orders` vacío",
    caughtUp.json?.orders?.length === 0,
    JSON.stringify(caughtUp.json?.orders),
  );
  check(
    "al día: `nextCursor` es null",
    caughtUp.json?.nextCursor === null,
    `${caughtUp.json?.nextCursor}`,
  );

  // --- Casos límite de la query ---
  check("since no numérico responde 400", (await pull("abc", 10)).status === 400);
  check("since negativo responde 400", (await pull("-1", 10)).status === 400);
  check("limit=0 responde 400", (await pull(base, 0)).status === 400);
  check("limit>500 responde 400", (await pull(base, 501)).status === 400);

  const noParams = await fetch(`${BASE}/api/internal/orders`, {
    headers: { authorization: `Bearer ${SYNC_TOKEN}` },
  });
  check("sin since ni limit responde 200 (defaults 0 y 100)", noParams.status === 200);

  const noToken = await fetch(`${BASE}/api/internal/orders?since=0&limit=1`);
  check("sin token responde 401 (E8)", noToken.status === 401, `status=${noToken.status}`);
}

// ------------------------------------------------------------ criterion 2 ----

async function verifyTransition() {
  console.log("\n== Criterio 2 · un pedido devuelto pasa de PENDING a PULLED ==");

  const order = await seedOrder();
  const before = await orderRow(order.code);
  check("recién creado, el pedido está en PENDING", before?.status === "PENDING", before?.status);
  check("recién creado, pulledAt está vacío", before?.pulledAt === null, `${before?.pulledAt}`);

  // since = id-1 y limit=1 devuelve exactamente este pedido: no hay ningún otro
  // id posible en el intervalo (id-1, id].
  const { json } = await pull((order.id - 1n).toString(), 1);
  check(
    "el pull lo devuelve",
    json?.orders?.[0]?.id === order.id.toString(),
    JSON.stringify(json?.orders?.map((o) => o.id)),
  );
  check(
    "el payload lo describe como PENDING: es el estado que tenía cuando el POS lo vio (R8)",
    json?.orders?.[0]?.status === "PENDING",
    json?.orders?.[0]?.status,
  );

  const after = await orderRow(order.code);
  check("la fila quedó en PULLED", after?.status === "PULLED", after?.status);
  check("pulledAt quedó con la hora", after?.pulledAt !== null);
  check("el pedido NO se borró: la fila sigue ahí (R4)", after !== null);

  const page = await fetch(`${BASE}/${STORE_SLUG}/pedido/${order.code}`);
  check(
    "y su página pública sigue respondiendo 200 tras el pull (R4)",
    page.status === 200,
    `status=${page.status}`,
  );

  // E5: lo que ya no está en PENDING no se vuelve a pisar.
  const secondPull = await pull((order.id - 1n).toString(), 1);
  check(
    "un segundo pull lo sigue devolviendo",
    secondPull.json?.orders?.[0]?.id === order.id.toString(),
  );
  const afterSecond = await orderRow(order.code);
  check(
    "sigue en PULLED tras el segundo pull",
    afterSecond?.status === "PULLED",
    afterSecond?.status,
  );
  check(
    "y pulledAt NO se reescribió: un estado que no es PENDING no se toca (R3, E5)",
    String(afterSecond?.pulledAt) === String(after?.pulledAt),
    `${after?.pulledAt} → ${afterSecond?.pulledAt}`,
  );
}

// ------------------------------------------------------------ criterion 3 ----

async function verifyStatusReport() {
  console.log(
    "\n== Criterio 3 · POST /api/internal/orders/status actualiza y responde 404 si no existe ==",
  );

  const order = await seedOrder();
  const orderId = order.id.toString();

  // E6
  const confirmed = await reportStatus({ orderId, status: "CONFIRMED" });
  check("CONFIRMED responde 200", confirmed.status === 200, `status=${confirmed.status}`);
  check("el cuerpo es { ok: true }", confirmed.json?.ok === true, JSON.stringify(confirmed.json));
  check("la fila quedó en CONFIRMED", (await orderRow(order.code))?.status === "CONFIRMED");

  const cancelled = await reportStatus({ orderId, status: "CANCELLED", reason: "sin existencias" });
  check("CANCELLED con motivo responde 200", cancelled.status === 200);
  const { rows } = await db.query(`SELECT status, "cancelReason" FROM "Order" WHERE code = $1`, [
    order.code,
  ]);
  check("la fila quedó en CANCELLED", rows[0]?.status === "CANCELLED", rows[0]?.status);
  check("y guardó el motivo", rows[0]?.cancelReason === "sin existencias", rows[0]?.cancelReason);

  // E7 — el que da nombre al criterio.
  const absent = await reportStatus({ orderId: ABSENT_ORDER_ID, status: "CONFIRMED" });
  check("un pedido inexistente responde 404", absent.status === 404, `status=${absent.status}`);
  check(
    "con error UNKNOWN_ORDER",
    absent.json?.error === "UNKNOWN_ORDER",
    JSON.stringify(absent.json),
  );

  // Cuerpos inválidos y credencial.
  check(
    "un status fuera del enum responde 400",
    (await reportStatus({ orderId, status: "ENTREGADO" })).status === 400,
  );
  check(
    "PENDING y PULLED los pone esta base, no el POS: responden 400",
    (await reportStatus({ orderId, status: "PENDING" })).status === 400 &&
      (await reportStatus({ orderId, status: "PULLED" })).status === 400,
  );
  check(
    "un orderId no convertible a BigInt responde 400",
    (await reportStatus({ orderId: "42.5", status: "CONFIRMED" })).status === 400,
  );
  const badJson = await reportStatus("no soy json", { raw: true });
  check(
    "un cuerpo que no es JSON responde 400 INVALID_JSON",
    badJson.json?.error === "INVALID_JSON",
    JSON.stringify(badJson.json),
  );
  check(
    "sin token responde 401 (E8)",
    (await reportStatus({ orderId, status: "CONFIRMED" }, { token: null })).status === 401,
  );
  check(
    "con un token equivocado responde 401",
    (await reportStatus({ orderId, status: "CONFIRMED" }, { token: "x".repeat(48) })).status ===
      401,
  );
}

// ------------------------------------------------------------ criterion 4 ----

function verifyNoOutboundCalls() {
  console.log("\n== Criterio 4 · ninguna llamada saliente hacia cuadrecaja ==");

  // El criterio nombra este grep literalmente. Sale 1 (sin coincidencias) es lo
  // que se espera; sale 0 significa que alguien añadió una llamada de salida y
  // rompió la ADR 0002, que es la decisión que sostiene todo el pull.
  const grep = spawnSync("grep", ["-rn", "CUADRECAJA_API_URL", "src/"], { encoding: "utf8" });
  check(
    "grep -rn CUADRECAJA_API_URL src/ no devuelve nada",
    grep.status !== 0 && grep.stdout.trim() === "",
    grep.stdout.trim(),
  );
}

// ---------------------------------------------------------------------------

try {
  const only = ["--paginate", "--transition", "--status", "--no-outbound"].filter((flag) =>
    args.has(flag),
  );
  const run = only.length > 0 ? only : ["--paginate", "--transition", "--status", "--no-outbound"];

  if (run.includes("--paginate")) await verifyPagination();
  if (run.includes("--transition")) await verifyTransition();
  if (run.includes("--status")) await verifyStatusReport();
  if (run.includes("--no-outbound")) verifyNoOutboundCalls();
} finally {
  await db.end();
}

console.log(`\n${failures} aserciones fallidas`);
process.exit(failures === 0 ? 0 : 1);
