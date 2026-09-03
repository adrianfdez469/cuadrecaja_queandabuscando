#!/usr/bin/env node
/**
 * Exercises the two endpoints cuadrecaja uses to collect orders — this is what
 * makes the four acceptance criteria of F-007 verifiable with a command instead
 * of "the endpoints exist and typecheck", which is where the feature had been
 * stuck since it was written: until F-010 shipped a checkout there was no way to
 * create an order, so the pull could only be tried on hand-inserted rows.
 *
 *   node scripts/pull-orders.mjs                 # the six modes below, in order
 *   node scripts/pull-orders.mjs --paginate      # criterion 1: shape + cursor
 *   node scripts/pull-orders.mjs --transition    # criterion 2: PENDING → PULLED
 *   node scripts/pull-orders.mjs --status        # criterion 3: status + 404
 *   node scripts/pull-orders.mjs --no-outbound   # criterion 4: no calls out
 *   node scripts/pull-orders.mjs --lateral       # F-033 criterion 12: ?status=
 *                                                 # and ?ids= — no cursor move
 *   node scripts/pull-orders.mjs --resolution    # F-033 criterion 10: resolving
 *                                                 # a proposal removes it from
 *                                                 # ?status=AWAITING_CUSTOMER
 *   node scripts/pull-orders.mjs --token=<token> # F-018: a business's own
 *                                                 # token, instead of QAB_BEARER_TOKEN
 *
 * F-018: the token is now per business. `QAB_BEARER_TOKEN` in the environment
 * (a local-dev-only token for one business, minted with
 * `npm run mint:token`) or `--token=` on the command line — never the
 * global bearer this repo used to read. Without one, this fails with the
 * exact command to fix it, never a silent skip.
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
const AUTH_TOKEN =
  process.argv
    .slice(2)
    .find((arg) => arg.startsWith("--token="))
    ?.split("=")[1] ?? process.env.QAB_BEARER_TOKEN;
const STORE_SLUG =
  process.argv
    .slice(2)
    .find((arg) => arg.startsWith("--store="))
    ?.split("=")[1] ?? "tienda-demo";

/** Bigger than any autoincrement id this database will plausibly reach (E7). */
const ABSENT_ORDER_ID = "999999999999";

const args = new Set(process.argv.slice(2).map((arg) => arg.split("=")[0]));

if (!AUTH_TOKEN) {
  console.error(
    "FAIL  ningún token — pásalo con --token=<token> o exporta QAB_BEARER_TOKEN " +
      "(acúñalo con: npm run mint:token -- seed-negocio-1)",
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

// F-017: `Store.slug` is nullable now — the brand (`Storefront.slug`) is
// what the fixtures resolve by. `slug` matches either: the brand's own
// slug (the common case, every seed fixture) OR a live branch alias
// (`Store.slug`, only the `bodega-central-vedado` fixture has one).
// Same join the other four scripts already use; this file was the last one
// still reading `Store.slug` directly, which made every mode fail for any
// store without an alias while passing for the one fixture that has one.
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
    throw new Error(
      `No orderable product found for store "${slug}" — no brand or branch slug matches, ` +
        `or it has no visible in-stock product. Run npm run seed`,
    );
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
    headers: { authorization: `Bearer ${AUTH_TOKEN}` },
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

/** F-033: `?status=`, the lateral read that ignores the cursor entirely. */
async function readByStatus(status, extraQuery = "") {
  const response = await fetch(
    `${BASE}/api/internal/orders?status=${encodeURIComponent(status)}${extraQuery}`,
    { headers: { authorization: `Bearer ${AUTH_TOKEN}` } },
  );
  return { status: response.status, json: await response.json().catch(() => null) };
}

/** F-033: `?ids=`, the other lateral read. */
async function readByIds(ids) {
  const response = await fetch(`${BASE}/api/internal/orders?ids=${ids.join(",")}`, {
    headers: { authorization: `Bearer ${AUTH_TOKEN}` },
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

/**
 * The shopper resolving a proposal from their own order page. Same shape as
 * renegotiate-order.mjs::respond(): a form POST to the comprador's route, no
 * session cookie (ADR 0024), and no `Accept: text/html` so the route answers
 * JSON instead of a 303 to the page.
 *
 * This is the ONLY write in the criterion-10 check below. Nothing here touches
 * a column by hand — that is the whole point: the criterion says "sin tocar
 * ninguna columna a mano", so an UPDATE would not verify it.
 */
async function respond(slug, code, decision) {
  const response = await fetch(`${BASE}/${slug}/pedido/${code}/respuesta`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `decision=${decision}`,
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

async function orderInfo(code) {
  const { rows } = await db.query(
    `SELECT id::text AS id, code, "currencyCode", subtotal FROM "Order" WHERE code = $1`,
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

/** F-033 architecture.md DA8: a local `propose()`, copied from the shape of
 *  `scripts/renegotiate-order.mjs`'s own `proposeChange()`/`buildEnvioProposal()`
 *  — this is what turns a PULLED order into AWAITING_CUSTOMER, the state
 *  that a POS finds ONLY through the lateral read (its id is already below
 *  the cursor). */
async function propose(order) {
  const info = await orderInfo(order.code);
  const items = await orderItemRows(order.id.toString());
  const deliveryFee = "60.00";
  const total = (Number(info.subtotal) + Number(deliveryFee)).toFixed(2);

  const response = await fetch(`${BASE}/api/internal/orders/proposal`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${AUTH_TOKEN}` },
    body: JSON.stringify({
      orderId: order.id.toString(),
      currencyCode: info.currencyCode,
      subtotal: info.subtotal,
      discountTotal: "0",
      deliveryFee,
      total,
      message: "Verificación F-033 --lateral",
      items: items.map((item) => ({
        storeProductId: item.storeProductId,
        name: item.name,
        unitPrice: item.unitPrice.toString(),
        currencyCode: item.currencyCode,
        quantity: item.quantity.toString(),
        lineTotal: item.lineTotal.toString(),
      })),
    }),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

async function reportStatus(body, { token = AUTH_TOKEN, raw = false } = {}) {
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
    headers: { authorization: `Bearer ${AUTH_TOKEN}` },
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

// --------------------------------------------------------------- F-033 ----

/**
 * F-033 criterion 12: the two lateral reads against the running server,
 * with a header of their own so the output tells them apart from the pull
 * incremental's own sections (`== Criterio 12 · ... ==` vs `== Criterio 1 ·
 * ... ==`). Anchored entirely on ids this run seeds itself (ficha
 * `smoke-asume-since-0-devuelve-el-ultimo-pedido`): the shared database
 * always has orders from other sessions lying around.
 */
async function verifyLateralRead() {
  console.log("\n== Criterio 12 · lectura lateral (?status= y ?ids=) — no mueve el cursor ==");

  // A: el pedido cuya propuesta se resuelve. Se pullea (PENDING → PULLED) y
  // luego se le propone un cambio, que lo deja AWAITING_CUSTOMER — el caso
  // que motiva el feature (spec.md § Problema): la resolución de una
  // propuesta SIEMPRE ocurre sobre un pedido que el POS ya pulleó.
  const orderA = await seedOrder();
  const pullA = await pull((orderA.id - 1n).toString(), 100);
  check(
    "A sale en el pull incremental (queda PULLED)",
    pullA.json?.orders?.some((o) => o.id === orderA.id.toString()),
    JSON.stringify(pullA.json?.orders?.map((o) => o.id)),
  );

  const proposal = await propose(orderA);
  check(
    "la propuesta se acepta y deja el pedido AWAITING_CUSTOMER",
    proposal.status === 200 && proposal.json?.status === "AWAITING_CUSTOMER",
    JSON.stringify(proposal.json),
  );

  // B: un pull normal, posterior, que ADEMÁS de traer a B avanza el cursor
  // del POS más allá de A — es lo que deja a A estrictamente por debajo del
  // cursor (F-033 criterio 1).
  const orderB = await seedOrder();
  const pullB = await pull(orderA.id.toString(), 100);
  check(
    "B sale en el pull siguiente y el cursor del POS queda en B, más allá de A",
    pullB.json?.orders?.some((o) => o.id === orderB.id.toString()),
    JSON.stringify(pullB.json?.orders?.map((o) => o.id)),
  );
  const cursor = orderB.id.toString();

  // El pull con el `since` que el POS ya tiene NO ve la resolución de A: es
  // el agujero que este feature cierra, y el cuerpo "de antes" para el
  // aserto fuerte del F-033 criterio 2.
  const pullBeforeLateral = await pull(cursor, 100);
  check(
    "el pull incremental, al día, no ve el cambio de A",
    JSON.stringify(pullBeforeLateral.json?.orders) === "[]",
    JSON.stringify(pullBeforeLateral.json),
  );

  // --- F-033 criterio 1: la lectura lateral SÍ lo ve, por debajo del cursor ---
  const lateral = await readByStatus("AWAITING_CUSTOMER");
  check(
    "?status=AWAITING_CUSTOMER responde 200",
    lateral.status === 200,
    `status=${lateral.status}`,
  );
  const found = lateral.json?.orders?.find((o) => o.id === orderA.id.toString());
  check(
    "trae a A, con id MENOR que el cursor que el POS ya tiene (F-033 criterio 1)",
    found !== undefined && BigInt(found.id) < BigInt(cursor),
    `A=${found?.id} cursor=${cursor}`,
  );

  // --- F-033 criterio 2: nextCursor SIEMPRE null (R1, SP5), y el pull no se movió ---
  check(
    "la lectura lateral devuelve nextCursor: null (R1, SP5)",
    lateral.json?.nextCursor === null,
    `${lateral.json?.nextCursor}`,
  );
  const pullAfterLateral = await pull(cursor, 100);
  check(
    "repetir el pull con el mismo since da el MISMO cuerpo que antes de leer lateralmente (F-033 criterio 2)",
    JSON.stringify(pullAfterLateral.json) === JSON.stringify(pullBeforeLateral.json),
    `antes=${JSON.stringify(pullBeforeLateral.json)} despues=${JSON.stringify(pullAfterLateral.json)}`,
  );

  // --- F-033 criterio 3/E6-E9: ?ids= cruza el cursor sin mirarlo ---
  // C se siembra DESPUÉS de que el cursor quedara en B, así que nunca se
  // pulleó: queda por ENCIMA del cursor. D es el control: se pide A y C, y D
  // no debe aparecer.
  const orderC = await seedOrder();
  const orderD = await seedOrder();
  const idsRead = await readByIds([orderA.id.toString(), orderC.id.toString()]);
  check(
    "?ids=A,C trae exactamente esos dos, en orden ascendente, cruzando el cursor (F-033 criterio 3)",
    JSON.stringify(idsRead.json?.orders?.map((o) => o.id)) ===
      JSON.stringify([orderA.id.toString(), orderC.id.toString()]),
    JSON.stringify(idsRead.json?.orders?.map((o) => o.id)),
  );
  check(
    "D, el tercer pedido no pedido, no aparece",
    !idsRead.json?.orders?.some((o) => o.id === orderD.id.toString()),
  );
  check(
    "?ids= también trae nextCursor: null y nextAfter: null",
    idsRead.json?.nextCursor === null && idsRead.json?.nextAfter === null,
    JSON.stringify(idsRead.json),
  );

  const dupIds = await readByIds([orderA.id.toString(), orderA.id.toString()]);
  check(
    "un id repetido en ?ids= se sirve una sola vez (E9)",
    dupIds.json?.orders?.length === 1,
    JSON.stringify(dupIds.json?.orders),
  );

  const absent = await readByIds([ABSENT_ORDER_ID]);
  check(
    "un id inexistente responde 200 con orders vacío, igual que uno de otro negocio (E7/E8)",
    absent.status === 200 && absent.json?.orders?.length === 0,
    JSON.stringify(absent.json),
  );

  // --- E13/E14: las cinco combinaciones ambiguas responden 400 ---
  check(
    "since junto a status responde 400",
    (await readByStatus("PULLED", "&since=0")).status === 400,
  );
  check(
    "status junto a ids responde 400",
    (
      await fetch(`${BASE}/api/internal/orders?status=PULLED&ids=${orderA.id}`, {
        headers: { authorization: `Bearer ${AUTH_TOKEN}` },
      })
    ).status === 400,
  );
  check(
    "after sin status responde 400",
    (
      await fetch(`${BASE}/api/internal/orders?after=1`, {
        headers: { authorization: `Bearer ${AUTH_TOKEN}` },
      })
    ).status === 400,
  );
  check(
    "limit junto a ids responde 400",
    (
      await fetch(`${BASE}/api/internal/orders?ids=${orderA.id}&limit=1`, {
        headers: { authorization: `Bearer ${AUTH_TOKEN}` },
      })
    ).status === 400,
  );
  check(
    "más de 100 ids responde 400 (F-033 criterio 7), 100 exactos responde 200",
    (await readByIds(Array.from({ length: 101 }, (_, i) => String(i + 1)))).status === 400 &&
      (await readByIds(Array.from({ length: 100 }, (_, i) => String(i + 1)))).status === 200,
  );

  const noToken = await fetch(`${BASE}/api/internal/orders?status=PULLED`);
  check("sin token responde 401 (E8)", noToken.status === 401, `status=${noToken.status}`);
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

/**
 * F-033 criterio 10, la mitad que ningún test unitario puede demostrar: un
 * pedido que estaba en AWAITING_CUSTOMER y se resuelve DE VERDAD —aprobándolo
 * o rechazándolo desde la página del pedido— desaparece de la lectura
 * `?status=AWAITING_CUSTOMER` siguiente.
 *
 * Por qué vive aquí y no en un guion de una sola vez: durante la verificación
 * de F-033 esto se comprobó con un guion temporal que se borró al terminar, y
 * el trabajo se perdió. Es el único camino que ejercita la resolución de una
 * propuesta de punta a punta por HTTP, y cualquier ciclo que toque la
 * renegociación o la lectura lateral lo necesita otra vez.
 *
 * Las dos ramas, porque el criterio nombra las dos: aprobar deja CONFIRMED y
 * rechazar deja CANCELLED. Cada una sobre su propio pedido recién sembrado,
 * para que la corrida sea segura contra una base compartida.
 */
async function verifyProposalResolution() {
  console.log("\n== Criterio 10 · resolver una propuesta la saca de ?status=AWAITING_CUSTOMER ==");

  for (const [decision, esperado] of [
    ["aprobar", "CONFIRMED"],
    ["rechazar", "CANCELLED"],
  ]) {
    const order = await seedOrder();
    const id = order.id.toString();

    // Se pullea primero, para que el pedido quede por debajo del cursor: es la
    // situación que hace invisible la resolución en el pull incremental y la
    // razón de ser del feature.
    await pull((order.id - 1n).toString(), 100);

    const proposal = await propose(order);
    check(
      `(${decision}) la propuesta deja el pedido AWAITING_CUSTOMER`,
      proposal.status === 200 && proposal.json?.status === "AWAITING_CUSTOMER",
      JSON.stringify(proposal.json),
    );

    const antes = await readByStatus("AWAITING_CUSTOMER");
    check(
      `(${decision}) ANTES de responder está en ?status=AWAITING_CUSTOMER`,
      antes.json?.orders?.some((o) => o.id === id),
      JSON.stringify(antes.json?.orders?.map((o) => o.id)),
    );

    const respuesta = await respond(STORE_SLUG, order.code, decision);
    check(
      `(${decision}) el POST de la página del pedido responde 200`,
      respuesta.status === 200,
      `${respuesta.status} ${JSON.stringify(respuesta.json)}`,
    );

    const despues = await readByStatus("AWAITING_CUSTOMER");
    check(
      `(${decision}) DESPUÉS ya no está en ?status=AWAITING_CUSTOMER`,
      !despues.json?.orders?.some((o) => o.id === id),
      JSON.stringify(despues.json?.orders?.map((o) => o.id)),
    );

    // Y sigue siendo legible por la otra forma lateral, con el estado nuevo:
    // desaparecer de una lectura por estado no es desaparecer del sistema.
    const porId = await readByIds([id]);
    check(
      `(${decision}) ?ids= lo devuelve con status ${esperado}`,
      porId.json?.orders?.[0]?.id === id && porId.json?.orders?.[0]?.status === esperado,
      JSON.stringify(porId.json?.orders?.map((o) => ({ id: o.id, status: o.status }))),
    );
  }
}

try {
  const ALL_FLAGS = [
    "--paginate",
    "--transition",
    "--status",
    "--lateral",
    "--resolution",
    "--no-outbound",
  ];
  const only = ALL_FLAGS.filter((flag) => args.has(flag));
  const run = only.length > 0 ? only : ALL_FLAGS;

  if (run.includes("--paginate")) await verifyPagination();
  if (run.includes("--transition")) await verifyTransition();
  if (run.includes("--status")) await verifyStatusReport();
  if (run.includes("--lateral")) await verifyLateralRead();
  if (run.includes("--resolution")) await verifyProposalResolution();
  if (run.includes("--no-outbound")) verifyNoOutboundCalls();
} finally {
  await db.end();
}

console.log(`\n${failures} aserciones fallidas`);
process.exit(failures === 0 ? 0 : 1);
