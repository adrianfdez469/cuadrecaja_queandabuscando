#!/usr/bin/env node
/**
 * Exercises the renegotiation flow end to end — this is what verifies 7 of
 * the 10 acceptance criteria of F-019 with a command instead of "should
 * work" (spec.md § Criterios de aceptación propuestos).
 *
 *   node scripts/renegotiate-order.mjs --propose        # criterio 1
 *   node scripts/renegotiate-order.mjs --approve         # criterios 2, 6
 *   node scripts/renegotiate-order.mjs --reject          # criterio 3
 *   node scripts/renegotiate-order.mjs --expire          # criterio 4(a)
 *   node scripts/renegotiate-order.mjs --outcomes        # criterio 5
 *   node scripts/renegotiate-order.mjs --transit         # criterio 9
 *   node scripts/renegotiate-order.mjs --link-on-create  # criterio 7 (los dos huecos reales)
 *   node scripts/renegotiate-order.mjs                   # los siete, en orden
 *
 * Same shape as place-order.mjs/pull-orders.mjs: plain `fetch` against the
 * running app (no session cookie anywhere — the comprador's route never
 * needed one, ADR 0024), plain `pg` for the assertions Postgres alone can
 * answer (Prisma 7's TS client output needs a build step `node` does not
 * have here). Safe against a shared database: every assertion anchors to
 * the order(s) THIS run just created.
 *
 * The internal bearer token is minted FRESH for `seed-negocio-1` (the
 * business that owns both `tienda-demo` and `tienda-dos` in the seed) on
 * every run, unless `--token=` overrides it. Deliberately NOT falling back
 * to `QAB_BEARER_TOKEN` the way pull-orders.mjs does: a worktree's own
 * `.env` can carry a placeholder value for it (copied from `.env.example`'s
 * comment, never actually minted), and trusting that silently would 401
 * every request instead of failing loudly.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { Client } from "pg";

const BASE = process.env.QAB_BASE_URL ?? "http://localhost:3000";
const args = new Set(process.argv.slice(2).map((arg) => arg.split("=")[0]));

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

// --------------------------------------------------------------- auth ----

function mintToken(externalId) {
  const out = execFileSync("npx", ["tsx", "scripts/mint-sync-token.ts", externalId], {
    encoding: "utf8",
  });
  const lines = out.trim().split("\n");
  return lines.at(-1);
}

const AUTH_TOKEN =
  process.argv
    .slice(2)
    .find((arg) => arg.startsWith("--token="))
    ?.split("=")[1] ?? mintToken("seed-negocio-1");

const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) {
  console.error("FAIL  CRON_SECRET no está configurado — ver .env.example");
  process.exit(1);
}

// --------------------------------------------------------------- helpers ----

const STORE_BY_SLUG_JOIN = `
       JOIN "Storefront" sf ON sf.id = s."storefrontId"
      WHERE (sf.slug = $1 OR s.slug = $1)`;

async function pickOrderableProduct(slug) {
  const { rows } = await db.query(
    `SELECT sp.id
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

async function quote(slug, items) {
  const response = await fetch(`${BASE}/api/orders/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ storeSlug: slug, items }),
  });
  return response.json();
}

let phoneSeq = 0;
/** A fresh phone per order: creation is capped per store + phone (R30 of F-010). */
function uniquePhone() {
  phoneSeq += 1;
  return `+53${String(Date.now()).slice(-7)}${String(phoneSeq).padStart(2, "0")}`;
}

async function orderRow(code) {
  const { rows } = await db.query(
    `SELECT id::text AS id, code, status, "cancelledBy", "cancelReason", "expiresAt",
            "currencyCode", subtotal, "deliveryFee", total, "rateSnapshot"
       FROM "Order" WHERE code = $1`,
    [code],
  );
  return rows[0] ?? null;
}

async function orderItemRows(orderId) {
  const { rows } = await db.query(
    `SELECT "storeProductId", name, "unitPrice", "currencyCode", quantity, "lineTotal"
       FROM "OrderItem" WHERE "orderId" = $1`,
    [orderId],
  );
  return rows;
}

/** Seeds one order through the PUBLIC checkout — same path a shopper takes,
 *  no session cookie. Returns enough to build a proposal on it. */
async function checkout(slug, { fulfillment = "PICKUP", deliveryAddress } = {}) {
  const product = await pickOrderableProduct(slug);
  const items = [{ storeProductId: product.id, qty: 1 }];
  const quoted = await quote(slug, items);

  let total = quoted.subtotal;
  let deliveryFee = "0.00";
  if (fulfillment === "DELIVERY") {
    const info = await storeInfo(slug);
    deliveryFee = info.deliveryFee;
    total = (Number(quoted.subtotal) + Number(deliveryFee)).toFixed(2);
  }

  const body = {
    storeSlug: slug,
    items,
    contact: { name: "Script F-019", phone: uniquePhone() },
    fulfillment,
    ...(fulfillment === "DELIVERY"
      ? { deliveryAddress: deliveryAddress ?? "Calle de prueba 123" }
      : {}),
    expectedTotal: total,
  };

  const response = await fetch(`${BASE}/api/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  if (response.status !== 201) {
    throw new Error(
      `No se pudo sembrar un pedido en ${slug}: ${response.status} ${JSON.stringify(json)}`,
    );
  }

  const row = await orderRow(json.code);
  return {
    id: BigInt(row.id),
    code: json.code,
    currencyCode: quoted.store.currencyCode,
    whatsappUrl: json.whatsappUrl,
    subtotal: quoted.subtotal,
    deliveryFee,
    total,
  };
}

async function pull(since, limit = 100) {
  const response = await fetch(`${BASE}/api/internal/orders?since=${since}&limit=${limit}`, {
    headers: { authorization: `Bearer ${AUTH_TOKEN}` },
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

async function findPulled(code, since) {
  const { json } = await pull(since, 500);
  return (json?.orders ?? []).find((order) => order.code === code) ?? null;
}

async function reportStatus(orderId, status, reason = null) {
  const response = await fetch(`${BASE}/api/internal/orders/status`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${AUTH_TOKEN}` },
    body: JSON.stringify({ orderId: orderId.toString(), status, reason }),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

async function proposeChange(orderId, payload) {
  const response = await fetch(`${BASE}/api/internal/orders/proposal`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${AUTH_TOKEN}` },
    body: JSON.stringify({ orderId: orderId.toString(), ...payload }),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

async function respond(slug, code, decision) {
  const response = await fetch(`${BASE}/${slug}/pedido/${code}/respuesta`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `decision=${decision}`,
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

/** Builds a "costo de envío" style proposal: same lines, plus a delivery
 *  fee on top — the dominant trigger per spec § Problema. */
async function buildEnvioProposal(order) {
  const items = await orderItemRows(order.id.toString());
  const deliveryFee = "60.00";
  const total = (Number(order.subtotal) + Number(deliveryFee)).toFixed(2);
  return {
    currencyCode: order.currencyCode,
    subtotal: order.subtotal,
    discountTotal: "0",
    deliveryFee,
    total,
    message: "El envío a Playa cuesta 60.",
    items: items.map((item) => ({
      storeProductId: item.storeProductId,
      name: item.name,
      unitPrice: item.unitPrice.toString(),
      currencyCode: item.currencyCode,
      quantity: item.quantity.toString(),
      lineTotal: item.lineTotal.toString(),
    })),
  };
}

function formatMoneyLike(amount, currency = "CUP") {
  return new Intl.NumberFormat("es-CU", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(Number(amount));
}

function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// ------------------------------------------------------------ criterio 1 ----

async function verifyPropose() {
  console.log(
    "\n== Criterio 1 · proponer deja AWAITING_CUSTOMER y los dos totales en la página ==",
  );

  const order = await checkout("tienda-demo");
  const before = await orderRow(order.code);
  check("recién sembrado, sigue PENDING", before?.status === "PENDING", before?.status);

  const pulled = await pull((order.id - 1n).toString(), 1);
  check("el pull lo recoge (pasa a PULLED)", pulled.status === 200, `status=${pulled.status}`);

  const proposal = await buildEnvioProposal(order);
  const proposed = await proposeChange(order.id, proposal);
  check("proponer responde 200", proposed.status === 200, JSON.stringify(proposed.json));
  check(
    "el cuerpo trae status AWAITING_CUSTOMER y expiresAt",
    proposed.json?.status === "AWAITING_CUSTOMER" && !!proposed.json?.expiresAt,
    JSON.stringify(proposed.json),
  );

  const row = await orderRow(order.code);
  check("(a) la fila queda en AWAITING_CUSTOMER", row?.status === "AWAITING_CUSTOMER", row?.status);
  check("(a) expiresAt no es nulo", row?.expiresAt !== null);

  const html = await fetch(`${BASE}/tienda-demo/pedido/${order.code}`).then((r) => r.text());
  const previousText = formatMoneyLike(order.total, order.currencyCode);
  const proposedText = formatMoneyLike(proposal.total, proposal.currencyCode);
  check(
    "(b) el HTML trae el total anterior",
    html.includes(previousText),
    `esperaba ${previousText}`,
  );
  check(
    "(b) el HTML trae el total propuesto, distinto del anterior",
    html.includes(proposedText) && previousText !== proposedText,
    `esperaba ${proposedText}`,
  );
}

// ------------------------------------------------------------ criterios 2, 6 ----

async function verifyApprove() {
  console.log(
    "\n== Criterios 2 y 6 · aprobar pasa a CONFIRMED con los importes nuevos, rateSnapshot intacto ==",
  );

  const order = await checkout("tienda-demo");
  await pull((order.id - 1n).toString(), 1);

  const before = await orderRow(order.code);
  const rateSnapshotBefore = before.rateSnapshot;

  const proposal = await buildEnvioProposal(order);
  const proposed = await proposeChange(order.id, proposal);
  check("proponer responde 200", proposed.status === 200, JSON.stringify(proposed.json));

  const approved = await respond("tienda-demo", order.code, "aprobar");
  check(
    "aprobar responde 200 { status: CONFIRMED, applied: true }",
    approved.status === 200 &&
      approved.json?.status === "CONFIRMED" &&
      approved.json?.applied === true,
    JSON.stringify(approved.json),
  );

  const rowAfter = await orderRow(order.code);
  check("la fila queda CONFIRMED", rowAfter?.status === "CONFIRMED", rowAfter?.status);

  const pulledOrder = await findPulled(order.code, (order.id - 1n).toString());
  check("el pull lo trae", pulledOrder !== null);
  check(
    "el pull refleja status CONFIRMED",
    pulledOrder?.status === "CONFIRMED",
    pulledOrder?.status,
  );
  check(
    // Compared as numbers, not strings: Prisma's Decimal.toString() strips
    // trailing zeros ("1150" for what the column stores as 1150.00) — a
    // pre-existing property of every amount this pull already emitted in
    // F-010, not something this feature changes.
    "total/subtotal/deliveryFee del pull son los PROPUESTOS, no los originales",
    Number(pulledOrder?.total) === Number(proposal.total) &&
      Number(pulledOrder?.subtotal) === Number(proposal.subtotal) &&
      Number(pulledOrder?.deliveryFee) === Number(proposal.deliveryFee),
    JSON.stringify({ pulled: pulledOrder, proposed: proposal }),
  );
  check(
    "las líneas del pull son las propuestas",
    JSON.stringify(pulledOrder?.items?.map((i) => i.name).sort()) ===
      JSON.stringify(proposal.items.map((i) => i.name).sort()),
    JSON.stringify(pulledOrder?.items),
  );

  // Criterio 6.
  const rateSnapshotAfter = rowAfter.rateSnapshot;
  check(
    "criterio 6 — rateSnapshot idéntico byte a byte antes y después de aprobar",
    canonicalJSON(rateSnapshotBefore) === canonicalJSON(rateSnapshotAfter),
    `${JSON.stringify(rateSnapshotBefore)} vs ${JSON.stringify(rateSnapshotAfter)}`,
  );
}

// ------------------------------------------------------------ criterio 3 ----

async function verifyReject() {
  console.log(
    "\n== Criterio 3 · rechazar pasa a CANCELLED con el motivo atribuido al comprador ==",
  );

  const order = await checkout("tienda-demo");
  await pull((order.id - 1n).toString(), 1);
  const proposal = await buildEnvioProposal(order);
  await proposeChange(order.id, proposal);

  const rejected = await respond("tienda-demo", order.code, "rechazar");
  check(
    "rechazar responde 200 { status: CANCELLED, applied: true }",
    rejected.status === 200 &&
      rejected.json?.status === "CANCELLED" &&
      rejected.json?.applied === true,
    JSON.stringify(rejected.json),
  );

  const row = await orderRow(order.code);
  check("la fila queda CANCELLED", row?.status === "CANCELLED", row?.status);
  check("cancelledBy es CUSTOMER", row?.cancelledBy === "CUSTOMER", row?.cancelledBy);
  check("cancelReason no es nulo", row?.cancelReason !== null);

  const pulledOrder = await findPulled(order.code, (order.id - 1n).toString());
  check("el pull también lo distingue: status CANCELLED", pulledOrder?.status === "CANCELLED");
  check(
    "el pull también lo distingue: cancelledBy CUSTOMER",
    pulledOrder?.cancelledBy === "CUSTOMER",
    pulledOrder?.cancelledBy,
  );
}

// ------------------------------------------------------------ criterio 4(a) ----

async function verifyExpire() {
  console.log(
    "\n== Criterio 4(a) · un AWAITING_CUSTOMER vencido cambia solo, forzando la fecha ==",
  );

  const order = await checkout("tienda-demo");
  await pull((order.id - 1n).toString(), 1);
  const proposal = await buildEnvioProposal(order);
  await proposeChange(order.id, proposal);

  await db.query(`UPDATE "Order" SET "expiresAt" = now() - interval '1 hour' WHERE id = $1`, [
    order.id.toString(),
  ]);

  const cron = await fetch(`${BASE}/api/crons/expire-proposals`, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  check("el cron responde 200", cron.status === 200, `status=${cron.status}`);

  const row = await orderRow(order.code);
  check(
    "la fila queda CANCELLED sin intervención de nadie",
    row?.status === "CANCELLED",
    row?.status,
  );
  check("cancelledBy es EXPIRY", row?.cancelledBy === "EXPIRY", row?.cancelledBy);
  check(
    "el motivo es literalmente 'La propuesta venció sin respuesta'",
    row?.cancelReason === "La propuesta venció sin respuesta",
    row?.cancelReason,
  );
}

// ------------------------------------------------------------ criterio 5 ----

async function verifyOutcomes() {
  console.log("\n== Criterio 5 · REJECTED_BY_STORE y CANCELLED se distinguen en el pull ==");

  // Cancelado por el comprador.
  const byCustomer = await checkout("tienda-demo");
  await pull((byCustomer.id - 1n).toString(), 1);
  await proposeChange(byCustomer.id, await buildEnvioProposal(byCustomer));
  await respond("tienda-demo", byCustomer.code, "rechazar");

  // Vencido.
  const byExpiry = await checkout("tienda-demo");
  await pull((byExpiry.id - 1n).toString(), 1);
  await proposeChange(byExpiry.id, await buildEnvioProposal(byExpiry));
  await db.query(`UPDATE "Order" SET "expiresAt" = now() - interval '1 hour' WHERE id = $1`, [
    byExpiry.id.toString(),
  ]);
  await fetch(`${BASE}/api/crons/expire-proposals`, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });

  // Rechazado por la tienda — no necesita ninguna propuesta viva (R15).
  const byStore = await checkout("tienda-demo");
  await pull((byStore.id - 1n).toString(), 1);
  await reportStatus(byStore.id, "REJECTED_BY_STORE", "sin existencias");

  const since = (byCustomer.id - 1n).toString();
  const pulledCustomer = await findPulled(byCustomer.code, since);
  const pulledExpiry = await findPulled(byExpiry.code, since);
  const pulledStore = await findPulled(byStore.code, since);

  check(
    "REJECTED_BY_STORE ≠ CANCELLED por status",
    pulledStore?.status === "REJECTED_BY_STORE" &&
      pulledCustomer?.status === "CANCELLED" &&
      pulledExpiry?.status === "CANCELLED",
    JSON.stringify({
      store: pulledStore?.status,
      customer: pulledCustomer?.status,
      expiry: pulledExpiry?.status,
    }),
  );
  check(
    "los dos CANCELLED se distinguen entre sí por cancelledBy (R9)",
    pulledCustomer?.cancelledBy === "CUSTOMER" &&
      pulledExpiry?.cancelledBy === "EXPIRY" &&
      pulledCustomer?.cancelledBy !== pulledExpiry?.cancelledBy,
    JSON.stringify({ customer: pulledCustomer?.cancelledBy, expiry: pulledExpiry?.cancelledBy }),
  );
}

// ------------------------------------------------------------ criterio 9 ----

async function verifyOneTransit(label, slug, fulfillment) {
  const order = await checkout(slug, { fulfillment });
  await pull((order.id - 1n).toString(), 1);
  await reportStatus(order.id, "CONFIRMED");
  await reportStatus(order.id, "READY");

  const beforeHtml = await fetch(`${BASE}/${slug}/pedido/${order.code}`).then((r) => r.text());

  const reported = await reportStatus(order.id, "IN_TRANSIT");
  check(
    `${label}: reportar IN_TRANSIT responde 200`,
    reported.status === 200,
    JSON.stringify(reported.json),
  );

  const row = await orderRow(order.code);
  check(`${label}: (a) la fila queda IN_TRANSIT`, row?.status === "IN_TRANSIT", row?.status);

  const afterHtml = await fetch(`${BASE}/${slug}/pedido/${order.code}`).then((r) => r.text());
  const copy = fulfillment === "DELIVERY" ? "En camino" : "La tienda lo puso en camino";
  check(
    `${label}: (b) el HTML de después trae la copia de IN_TRANSIT ("${copy}")`,
    afterHtml.includes(copy),
  );
  check(`${label}: (c) esa copia NO estaba en el HTML de antes`, !beforeHtml.includes(copy));
}

async function verifyTransit() {
  console.log("\n== Criterio 9 · IN_TRANSIT sobre READY, copia propia y distinta de READY ==");
  await verifyOneTransit("envío (tienda-dos)", "tienda-dos", "DELIVERY");
  await verifyOneTransit("retiro (tienda-demo)", "tienda-demo", "PICKUP");
}

// ------------------------------------------------------------ criterio 7 ----

/** The order URL lives inside `?text=`, URL-encoded (slashes become `%2F`)
 *  — decode before looking for the path, or the substring never matches. */
function decodedMessage(waMeUrl) {
  return decodeURIComponent(waMeUrl.split("text=")[1] ?? "");
}

async function verifyLinkOnCreate() {
  console.log("\n== Criterio 7 · los dos huecos reales del enlace de WhatsApp ==");

  const whatsappOrder = await checkout("tienda-demo"); // checkoutMode = WHATSAPP
  check(
    "POST /api/orders (WHATSAPP) devuelve whatsappUrl con la URL del pedido (bug I2/SP6)",
    typeof whatsappOrder.whatsappUrl === "string" &&
      decodedMessage(whatsappOrder.whatsappUrl).includes(
        `/tienda-demo/pedido/${whatsappOrder.code}`,
      ),
    whatsappOrder.whatsappUrl,
  );

  const onsiteOrder = await checkout("tienda-dos"); // checkoutMode = ONSITE
  check(
    "POST /api/orders (ONSITE) no manda whatsappUrl por WhatsApp (I3, esperado null)",
    onsiteOrder.whatsappUrl === null,
    onsiteOrder.whatsappUrl,
  );

  const pulledOnsite = await findPulled(onsiteOrder.code, (onsiteOrder.id - 1n).toString());
  check(
    "el pull SÍ trae customerWhatsappUrl hacia el comprador, incluso para ONSITE (E24)",
    typeof pulledOnsite?.customerWhatsappUrl === "string" &&
      decodedMessage(pulledOnsite.customerWhatsappUrl).includes(
        `/tienda-dos/pedido/${onsiteOrder.code}`,
      ),
    pulledOnsite?.customerWhatsappUrl,
  );
}

// ---------------------------------------------------------------------------

const MODES = {
  "--propose": verifyPropose,
  "--approve": verifyApprove,
  "--reject": verifyReject,
  "--expire": verifyExpire,
  "--outcomes": verifyOutcomes,
  "--transit": verifyTransit,
  "--link-on-create": verifyLinkOnCreate,
};

try {
  const requested = Object.keys(MODES).filter((flag) => args.has(flag));
  const run = requested.length > 0 ? requested : Object.keys(MODES);

  for (const flag of run) {
    await MODES[flag]();
  }
} finally {
  await db.end();
}

console.log(`\n${failures} aserciones fallidas`);
process.exit(failures === 0 ? 0 : 1);
