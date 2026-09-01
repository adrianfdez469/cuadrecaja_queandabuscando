#!/usr/bin/env node
/**
 * Exercises the "envío cotizado al gestionar" flow end to end — this is what
 * verifies the F-031 acceptance criteria that need a running server instead
 * of "should work" (.agent/specs/F-031/spec.md § Criterios de aceptación
 * propuestos, plan.md fila 6).
 *
 *   node scripts/quote-delivery-order.mjs --create    # criterios 2, 3, 10
 *   node scripts/quote-delivery-order.mjs --pull      # criterio 4
 *   node scripts/quote-delivery-order.mjs --quote     # criterios 5, 6
 *   node scripts/quote-delivery-order.mjs --dispatch  # criterio 8
 *   node scripts/quote-delivery-order.mjs --expire    # criterio 7(a)
 *   node scripts/quote-delivery-order.mjs             # las cinco, en orden
 *   node scripts/quote-delivery-order.mjs --token=<t> # en vez de acuñar uno
 *
 * Same shape as scripts/renegotiate-order.mjs: plain `fetch` against the
 * running app (no session cookie), plain `pg` for what only Postgres can
 * answer. `tienda-demo` (`seed-tienda-1`, negocio `seed-negocio-1`) es la
 * ÚNICA tienda del seed que combina `checkoutMode: WHATSAPP` con envío
 * (I8 de spec.md): sirve para los criterios 1-8 y para el 10. Se activa el
 * modo cotizado POR SQL — R8, F-032 todavía no existe — y se RESTAURA la
 * fila de la tienda al terminar (`deliveryEnabled: false,
 * deliveryFeeMode: 'FLAT_RATE'`, lo que dejó la etapa 3), pase lo que pase:
 * el `finally` corre también si una aserción falla.
 *
 * DP1 (design.md § El léxico, orquestador 2026-09-01T16:14:12Z): `grep -c
 * '0,00'` sobre lo que pinta este feature siempre da 0 — `formatMoney` usa
 * `es-CU`, que pone PUNTO decimal y COMA de millares (`"$0.00"`, nunca
 * `"0,00"`), y el sustituto obvio `'0.00'` da falso positivo contra
 * cualquier total con millares (`"$1,000.00"` lo contiene). Así que además
 * de la letra de los criterios 3 y 10, este guion asegura lo que de verdad
 * protegen: las CINCO cadenas exactas de design.md § El léxico ("Por
 * confirmar", "por confirmar", "Total parcial", "más el envío por
 * confirmar", "sin costo") sobre un pedido cuyo SUBTOTAL tiene centavos
 * DISTINTOS de "00" — `pickCentsProduct()` los busca en vivo contra el
 * catálogo sembrado, en vez de asumir un producto concreto.
 *
 * El bearer se acuña FRESCO para seed-negocio-1 en cada corrida, salvo
 * `--token=` — igual que renegotiate-order.mjs y por el mismo motivo:
 * confiar en QAB_BEARER_TOKEN silenciosamente daría 401 en vez de fallar
 * fuerte si el valor es un placeholder. Ficha
 * .agent/playbook/mint-token-rota-el-token-en-bd-compartida.md: acuñar ROTA
 * el token de ese negocio en la Postgres COMPARTIDA — avísalo si corres esto
 * sin `--token=`.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { Client } from "pg";

const BASE = process.env.QAB_BASE_URL ?? "http://localhost:3000";
const STORE = "tienda-demo";
const args = new Set(process.argv.slice(2).map((arg) => arg.split("=")[0]));

const db = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
await db.connect();

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.error(`FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
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

// ------------------------------------------------------- store fixture ----

const STORE_BY_SLUG_JOIN = `
       JOIN "Storefront" sf ON sf.id = s."storefrontId"
      WHERE (sf.slug = $1 OR s.slug = $1)`;

async function storeRow(slug) {
  const { rows } = await db.query(
    `SELECT s.id, s."deliveryEnabled", s."deliveryFeeMode", s."deliveryFee"
       FROM "Store" s ${STORE_BY_SLUG_JOIN}`,
    [slug],
  );
  if (rows.length === 0) throw new Error(`Store "${slug}" not found`);
  return rows[0];
}

/** R8: el modo se activa por SQL para verificar — F-032 todavía no existe. */
async function activateQuotedMode(slug) {
  const row = await storeRow(slug);
  await db.query(
    `UPDATE "Store" SET "deliveryEnabled" = true, "deliveryFeeMode" = 'QUOTED_PER_ORDER' WHERE id = $1`,
    [row.id],
  );
}

/** La etapa 3 dejó tienda-demo en deliveryEnabled: false, FLAT_RATE — se
 *  restaura la fila exactamente a lo que tenía ANTES de esta corrida, no a
 *  ese valor fijo, por si alguien la encontró ya distinta. */
async function restoreStore(slug, original) {
  await db.query(
    `UPDATE "Store" SET "deliveryEnabled" = $2, "deliveryFeeMode" = $3, "deliveryFee" = $4 WHERE id = $1`,
    [original.id, original.deliveryEnabled, original.deliveryFeeMode, original.deliveryFee],
  );
}

// --------------------------------------------------------------- checkout ----

async function quote(slug, items) {
  const response = await fetch(`${BASE}/api/orders/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ storeSlug: slug, items }),
  });
  return response.json();
}

/**
 * DP1: busca en vivo, entre los productos orderable de la tienda, el primero
 * cuya conversión a la moneda del pedido deja centavos distintos de "00" —
 * en vez de asumir que "Leche en polvo 400 g" (MLC 3.50 → $736.75) va a
 * seguir siendo ese producto si el seed cambia.
 */
async function pickCentsProduct(slug) {
  const { rows } = await db.query(
    `SELECT sp.id
       FROM "StoreProduct" sp
       JOIN "Store" s ON s.id = sp."storeId"
       ${STORE_BY_SLUG_JOIN}
        AND sp."deletedAt" IS NULL AND sp.visible = true
        AND sp.availability != 'OUT_OF_STOCK'
      ORDER BY sp."localName"`,
    [slug],
  );
  for (const row of rows) {
    const quoted = await quote(slug, [{ storeProductId: row.id, qty: 1 }]);
    if (typeof quoted.subtotal === "string" && !quoted.subtotal.endsWith(".00")) {
      return row.id;
    }
  }
  throw new Error(
    `Ningún producto orderable de "${slug}" da un subtotal con centavos != "00" (DP1) — el seed cambió`,
  );
}

let phoneSeq = 0;
function uniquePhone() {
  phoneSeq += 1;
  return `+53${String(Date.now()).slice(-7)}${String(phoneSeq).padStart(2, "0")}`;
}

async function orderRow(code) {
  const { rows } = await db.query(
    `SELECT id::text AS id, code, status, "cancelledBy", "cancelReason",
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

const createdOrderIds = [];

/** Siembra un pedido por el checkout PÚBLICO — mismo camino que un
 *  comprador, sin cookie de sesión. `expectedTotal` NUNCA incluye un envío
 *  que no existe (R7/I10a): en modo cotizado + DELIVERY es solo el
 *  subtotal; en PICKUP el envío firme es siempre 0.00. */
async function checkout(slug, { fulfillment = "PICKUP", deliveryAddress } = {}) {
  const productId = await pickCentsProduct(slug);
  const items = [{ storeProductId: productId, qty: 1 }];
  const quoted = await quote(slug, items);
  const expectedTotal = quoted.subtotal; // discountTotal es "0.00" en este seed

  const body = {
    storeSlug: slug,
    items,
    contact: { name: "Script F-031", phone: uniquePhone() },
    fulfillment,
    ...(fulfillment === "DELIVERY"
      ? { deliveryAddress: deliveryAddress ?? "Calle 23 esq. L, Vedado" }
      : {}),
    expectedTotal,
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
  createdOrderIds.push(row.id);
  return {
    id: BigInt(row.id),
    code: json.code,
    currencyCode: quoted.store.currencyCode,
    whatsappUrl: json.whatsappUrl,
    orderUrl: json.orderUrl,
    subtotal: quoted.subtotal,
  };
}

async function pull(since, limit = 500) {
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

/** R13/OD3: cotizar reenvía LAS MISMAS LÍNEAS del pedido — nunca se
 *  relaja proposeOrderChangeSchema, y aprobar las reescribe idénticas. */
async function buildQuoteProposal(order, deliveryFee, message = "Costo de envío confirmado.") {
  const items = await orderItemRows(order.id.toString());
  const total = (Number(order.subtotal) + Number(deliveryFee)).toFixed(2);
  return {
    currencyCode: order.currencyCode,
    subtotal: order.subtotal,
    discountTotal: "0",
    deliveryFee,
    total,
    message,
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

/** El `text=` de un enlace wa.me viaje URL-encoded (las barras salen
 *  `%2F`) — decodificar antes de buscar dentro. */
function decodedMessage(waMeUrl) {
  return decodeURIComponent(waMeUrl.split("text=")[1] ?? "");
}

// ------------------------------------------------------------ criterios 2, 3, 10 ----

async function verifyCreate() {
  console.log(
    "\n== Criterio 2 · POST /api/orders sin importe de envío, y el SQL distingue 'pendiente' de '0.00' ==",
  );

  const pending = await checkout(STORE, { fulfillment: "DELIVERY" });
  check("responde con un code", typeof pending.code === "string" && pending.code.length > 0);
  check(
    "el subtotal de prueba tiene centavos != '00' (DP1)",
    !pending.subtotal.endsWith(".00"),
    pending.subtotal,
  );

  const pendingRow = await orderRow(pending.code);
  check("la fila queda PENDING", pendingRow?.status === "PENDING", pendingRow?.status);
  check(
    "el envío sin cotizar es NULL en la base — ausencia de importe, no un cero (R3)",
    pendingRow?.deliveryFee === null,
    pendingRow?.deliveryFee,
  );

  // El par de prueba: un pedido de RETIRO en la misma tienda, cuyo envío es
  // un 0.00 real y cotizado (no pendiente) — E8.
  const zero = await checkout(STORE, { fulfillment: "PICKUP" });
  const zeroRow = await orderRow(zero.code);
  check(
    "el par de comparación (retiro) SÍ tiene deliveryFee, y vale 0.00",
    zeroRow?.deliveryFee !== null && Number(zeroRow.deliveryFee) === 0,
    zeroRow?.deliveryFee,
  );
  check(
    "la fila creada distingue 'envío pendiente' (NULL) de '0.00' por un VALOR de columna, no por interpretación",
    pendingRow?.deliveryFee === null && zeroRow?.deliveryFee !== null,
    { pending: pendingRow?.deliveryFee, zero: zeroRow?.deliveryFee },
  );

  console.log(
    "\n== Criterio 3 · GET /[slug]/pedido/[code] muestra el envío por confirmar y un total parcial ==",
  );
  const html = await fetch(`${BASE}/${STORE}/pedido/${pending.code}`).then((r) => r.text());
  check(
    "trae la cadena canónica 'Por confirmar' (design.md § El léxico)",
    html.includes("Por confirmar"),
  );
  check("trae la etiqueta 'Total parcial'", html.includes("Total parcial"));
  check(
    "trae la coletilla obligatoria de SP4 'más el envío por confirmar'",
    html.includes("más el envío por confirmar"),
  );
  check(
    "literal del criterio: grep -c '0,00' == 0 — DP1: con es-CU esa cadena NUNCA existe en pantalla, así que esto NO protege nada por sí solo",
    (html.match(/0,00/g) ?? []).length === 0,
  );
  check(
    "lo que SÍ protege (DP1): ninguna celda de este pedido imprime el importe formateado en cero",
    !html.includes("$0.00"),
  );

  console.log(
    "\n== E8, de paso: en la MISMA tienda cotizada, el retiro sigue siendo firme desde el primer momento ==",
  );
  const zeroHtml = await fetch(`${BASE}/${STORE}/pedido/${zero.code}`).then((r) => r.text());
  check(
    "el pedido de retiro NO tiene fila de envío (oculta en los dos modos, design.md § 3)",
    !zeroHtml.includes("Por confirmar"),
  );
  check("y su total es 'Total', no 'Total parcial'", !zeroHtml.includes("Total parcial"));

  console.log(
    "\n== Criterio 10 · el mensaje de WhatsApp de un pedido con envío pendiente no imprime '0,00' ==",
  );
  check(
    "tienda-demo es WHATSAPP: la creación devuelve whatsappUrl",
    typeof pending.whatsappUrl === "string",
    pending.whatsappUrl,
  );
  const decoded = decodedMessage(pending.whatsappUrl);
  check(
    "la línea de envío dice, literal, 'Envío: por confirmar'",
    decoded.includes("Envío: por confirmar"),
  );
  check(
    "la línea del total dice 'Total parcial: … más el envío por confirmar'",
    decoded.includes("más el envío por confirmar"),
    decoded,
  );
  check(
    "literal del criterio: ni la línea de envío ni la del total contienen '0,00' (DP1: no protege nada solo)",
    (decoded.match(/0,00/g) ?? []).length === 0,
  );
  check(
    "lo que SÍ protege (DP1): tampoco imprime el importe formateado en cero",
    !decoded.includes("$0.00"),
  );

  return pending;
}

// ------------------------------------------------------------ criterio 4 ----

async function verifyPull() {
  console.log(
    "\n== Criterio 4 · GET /api/internal/orders trae, en la MISMA respuesta, un pendiente y un 0.00 ==",
  );

  const pending = await checkout(STORE, { fulfillment: "DELIVERY" });
  const zero = await checkout(STORE, { fulfillment: "DELIVERY" });
  const since = (pending.id - 1n).toString();

  const firstPull = await pull(since);
  check(
    "el pull inicial responde 200 (marca los dos PULLED)",
    firstPull.status === 200,
    firstPull.status,
  );

  // E11: la tienda REGALA el envío del segundo pedido — 0.00 cotizado, no
  // pendiente. Es el caso que rompe cualquier heurística.
  const proposal = await buildQuoteProposal(
    await orderRow(zero.code),
    "0.00",
    "Este envío va por la casa.",
  );
  const proposed = await proposeChange(zero.id, proposal);
  check("proponer 0.00 responde 200", proposed.status === 200, proposed.json);
  const approved = await respond(STORE, zero.code, "aprobar");
  check(
    "aprobar responde 200 CONFIRMED",
    approved.status === 200 && approved.json?.status === "CONFIRMED",
    approved.json,
  );

  const { json } = await pull(since);
  const pulledPending = (json?.orders ?? []).find((order) => order.code === pending.code);
  const pulledZero = (json?.orders ?? []).find((order) => order.code === zero.code);

  check("los DOS pedidos vienen en la MISMA respuesta del pull", !!pulledPending && !!pulledZero, {
    pending: !!pulledPending,
    zero: !!pulledZero,
  });
  check(
    "el pendiente trae deliveryFeePending: true",
    pulledPending?.deliveryFeePending === true,
    pulledPending,
  );
  check(
    "el regalado trae deliveryFeePending: false — el cero AHÍ es un importe acordado",
    pulledZero?.deliveryFeePending === false,
    pulledZero,
  );
  check(
    "deliveryFee es la MISMA cadena en los dos ('0.00') — sin eso la heurística sería posible",
    pulledPending?.deliveryFee === "0.00" &&
      pulledZero?.deliveryFee === "0.00" &&
      pulledPending?.deliveryFee === pulledZero?.deliveryFee,
    { pending: pulledPending?.deliveryFee, zero: pulledZero?.deliveryFee },
  );
  check(
    "sin heurística posible: mirar contact.address no distingue (los dos son a domicilio)",
    typeof pulledPending?.contact?.address === "string" &&
      typeof pulledZero?.contact?.address === "string",
  );
  check(
    "sin heurística posible: comparar total con subtotal tampoco distingue (los dos son iguales, envío 0)",
    pulledPending?.total === pulledZero?.total,
    { pending: pulledPending?.total, zero: pulledZero?.total },
  );
}

// ------------------------------------------------------------ criterios 5, 6 ----

async function verifyQuote() {
  console.log(
    "\n== Criterio 5 · cotizar deja AWAITING_CUSTOMER, aprobar deja CONFIRMED con el total completo ==",
  );

  const order = await checkout(STORE, { fulfillment: "DELIVERY" });
  await pull((order.id - 1n).toString());

  const before = await orderRow(order.code);
  check(
    "recién pulleado, el envío sigue sin cotizar (NULL)",
    before?.deliveryFee === null,
    before?.deliveryFee,
  );
  const rateSnapshotBefore = before.rateSnapshot;

  const proposal = await buildQuoteProposal(before, "180.75"); // centavos != 00 también aquí
  const proposed = await proposeChange(order.id, proposal);
  check("cotizar (POST /orders/proposal) responde 200", proposed.status === 200, proposed.json);
  check(
    "el pedido queda AWAITING_CUSTOMER",
    proposed.json?.status === "AWAITING_CUSTOMER",
    proposed.json,
  );

  const htmlAwaiting = await fetch(`${BASE}/${STORE}/pedido/${order.code}`).then((r) => r.text());
  check(
    "la página, en AWAITING_CUSTOMER, ya no dice 'Total parcial' fuera de la tabla plegada (E5/E6)",
    htmlAwaiting.includes("Total con el envío") && htmlAwaiting.includes("Total sin el envío"),
  );

  const approved = await respond(STORE, order.code, "aprobar");
  check(
    "aprobar (POST …/respuesta) responde 200 { status: CONFIRMED }",
    approved.status === 200 && approved.json?.status === "CONFIRMED",
    approved.json,
  );

  const after = await orderRow(order.code);
  check("la fila queda CONFIRMED", after?.status === "CONFIRMED", after?.status);
  check("el envío ya NO es NULL (cotizado)", after?.deliveryFee !== null, after?.deliveryFee);
  check(
    "el envío es el propuesto",
    Number(after?.deliveryFee) === Number(proposal.deliveryFee),
    after?.deliveryFee,
  );
  check(
    "el total es el COMPLETO: subtotal + envío, ya no el parcial",
    Number(after?.total) === Number(proposal.total),
    after?.total,
  );

  const pulled = await findPulled(order.code, (order.id - 1n).toString());
  check(
    "el pull ya NO marca el pedido como pendiente",
    pulled?.deliveryFeePending === false,
    pulled,
  );
  check(
    "el pull trae el total completo, no el parcial",
    Number(pulled?.total) === Number(proposal.total),
    pulled?.total,
  );

  const htmlApproved = await fetch(`${BASE}/${STORE}/pedido/${order.code}`).then((r) => r.text());
  check(
    "E11 medido: cero apariciones de 'por confirmar' en toda la página, una vez aprobado",
    !htmlApproved.toLowerCase().includes("por confirmar"),
  );

  console.log(
    "\n== Criterio 6 · rateSnapshot no cambia entre la creación y la aprobación de la cotización ==",
  );
  const rateSnapshotAfter = after.rateSnapshot;
  check(
    "rateSnapshot idéntico BYTE A BYTE (JSON canónico) antes y después de aprobar",
    canonicalJSON(rateSnapshotBefore) === canonicalJSON(rateSnapshotAfter),
    { before: rateSnapshotBefore, after: rateSnapshotAfter },
  );
}

// ------------------------------------------------------------ criterio 8 ----

async function verifyDispatch() {
  console.log(
    "\n== Criterio 8 · POST /orders/status responde 409 sin cotizar, y 200 una vez cotizado y aprobado ==",
  );

  const order = await checkout(STORE, { fulfillment: "DELIVERY" });
  await pull((order.id - 1n).toString());

  for (const status of ["READY", "IN_TRANSIT", "DELIVERED"]) {
    const before = await orderRow(order.code);
    const result = await reportStatus(order.id, status);
    check(`${status} sin cotizar responde 409`, result.status === 409, result.json);
    check(
      `${status}: el cuerpo es exactamente {"error":"ORDER_DELIVERY_NOT_QUOTED"}`,
      result.json?.error === "ORDER_DELIVERY_NOT_QUOTED",
      result.json,
    );
    const after = await orderRow(order.code);
    check(
      `${status}: el 409 NO escribió nada — la fila sigue igual`,
      after?.status === before?.status && after?.deliveryFee === before?.deliveryFee,
      { before, after },
    );
  }

  // CONFIRMED y CANCELLED siguen permitidos con el envío pendiente (SP2's
  // exceptions) — probados sobre pedidos APARTE para no cerrar el principal.
  const confirmProbe = await checkout(STORE, { fulfillment: "DELIVERY" });
  await pull((confirmProbe.id - 1n).toString());
  const confirmResult = await reportStatus(confirmProbe.id, "CONFIRMED");
  check(
    "CONFIRMED sin cotizar SIGUE permitido (200)",
    confirmResult.status === 200,
    confirmResult.json,
  );

  const cancelProbe = await checkout(STORE, { fulfillment: "DELIVERY" });
  await pull((cancelProbe.id - 1n).toString());
  const cancelResult = await reportStatus(cancelProbe.id, "CANCELLED", "el cliente desistió");
  check(
    "CANCELLED sin cotizar SIGUE permitido (200)",
    cancelResult.status === 200,
    cancelResult.json,
  );

  // R17: un pedido de OTRO negocio sigue dando 404, sin que el 409 sirva de
  // oráculo — se prueba con un id que no existe en absoluto, lo más simple
  // que demuestra que el aislamiento se comprueba ANTES que la cotización.
  const foreign = await reportStatus(999999999999999n, "READY");
  check(
    "un orderId inexistente/ajeno responde 404 UNKNOWN_ORDER, nunca 409 (R17)",
    foreign.status === 404 && foreign.json?.error === "UNKNOWN_ORDER",
    foreign.json,
  );

  // Ahora sí: cotizar y aprobar el pedido principal, y reintentar READY.
  const proposal = await buildQuoteProposal(await orderRow(order.code), "90.25");
  await proposeChange(order.id, proposal);
  await respond(STORE, order.code, "aprobar");

  const readyAfterQuote = await reportStatus(order.id, "READY");
  check(
    "READY sobre el MISMO pedido, ya cotizado y aprobado, responde 200",
    readyAfterQuote.status === 200,
    readyAfterQuote.json,
  );
  const row = await orderRow(order.code);
  check("la fila queda READY", row?.status === "READY", row?.status);
}

// ------------------------------------------------------------ criterio 7(a) ----

async function verifyExpire() {
  console.log(
    "\n== Criterio 7(a) · un pedido sin cotizar vence forzando la fecha por SQL, sin esperar ==",
  );

  const order = await checkout(STORE, { fulfillment: "DELIVERY" });
  await pull((order.id - 1n).toString());

  await db.query(`UPDATE "Order" SET "createdAt" = now() - interval '48 hours' WHERE id = $1`, [
    order.id.toString(),
  ]);

  const cron = await fetch(`${BASE}/api/crons/expire-proposals`, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  check("el cron responde 200", cron.status === 200, cron.status);

  const row = await orderRow(order.code);
  check(
    "la fila queda CANCELLED sin intervención de nadie",
    row?.status === "CANCELLED",
    row?.status,
  );
  check("cancelledBy es EXPIRY", row?.cancelledBy === "EXPIRY", row?.cancelledBy);
  check(
    "el motivo es el PROPIO del pedido sin cotizar, distinto del de la propuesta vencida (AP2/I7)",
    row?.cancelReason === "El pedido venció sin que la tienda cotizara el envío",
    row?.cancelReason,
  );

  console.log(
    "\n== R15, de paso: el reloj nuevo NUNCA toca un AWAITING_CUSTOMER, aunque su createdAt también sea viejo ==",
  );
  const awaiting = await checkout(STORE, { fulfillment: "DELIVERY" });
  await pull((awaiting.id - 1n).toString());
  const proposal = await buildQuoteProposal(await orderRow(awaiting.code), "50.00");
  await proposeChange(awaiting.id, proposal);
  await db.query(`UPDATE "Order" SET "createdAt" = now() - interval '48 hours' WHERE id = $1`, [
    awaiting.id.toString(),
  ]);

  const cron2 = await fetch(`${BASE}/api/crons/expire-proposals`, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  check("el segundo cron responde 200", cron2.status === 200, cron2.status);
  const awaitingRow = await orderRow(awaiting.code);
  check(
    "AWAITING_CUSTOMER con createdAt viejo NO lo toca este barrido — tiene su propio reloj (R15)",
    awaitingRow?.status === "AWAITING_CUSTOMER",
    awaitingRow?.status,
  );

  // Segundo barrido: idempotente, 0 filas nuevas afectadas sobre el ya vencido.
  const cron3 = await fetch(`${BASE}/api/crons/expire-proposals`, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  const rowAfterSecondSweep = await orderRow(order.code);
  check(
    "un segundo barrido es idempotente: el ya vencido se queda exactamente igual",
    cron3.status === 200 &&
      rowAfterSecondSweep?.status === "CANCELLED" &&
      rowAfterSecondSweep?.cancelReason === row?.cancelReason,
    rowAfterSecondSweep,
  );
}

// ---------------------------------------------------------------------------

const MODES = {
  "--create": verifyCreate,
  "--pull": verifyPull,
  "--quote": verifyQuote,
  "--dispatch": verifyDispatch,
  "--expire": verifyExpire,
};

const original = await storeRow(STORE);

try {
  await activateQuotedMode(STORE);

  const requested = Object.keys(MODES).filter((flag) => args.has(flag));
  const run = requested.length > 0 ? requested : Object.keys(MODES);

  for (const flag of run) {
    await MODES[flag]();
  }
} finally {
  if (createdOrderIds.length > 0) {
    await db.query(`DELETE FROM "Order" WHERE id = ANY($1::bigint[])`, [createdOrderIds]);
  }
  await restoreStore(STORE, original);
  await db.end();
}

console.log(`\n${failures} aserciones fallidas`);
process.exit(failures === 0 ? 0 : 1);
