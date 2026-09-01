#!/usr/bin/env node
/**
 * Reusable Realtime Broadcast subscriber (F-020, architecture.md §
 * Componentes: "Suscriptor de prueba… reutilizable fuera del sensor") PLUS
 * the multi-mode runtime check that `.agent/specs/F-020/smoke.sh` invokes —
 * same double duty `scripts/renegotiate-order.mjs` and `scripts/place-order.mjs`
 * already do for their own features.
 *
 *   node scripts/realtime-bell.mjs --criterio1    # broadcast sin datos al crear
 *   node scripts/realtime-bell.mjs --criterio2    # aislamiento por negocio
 *   node scripts/realtime-bell.mjs --criterio3    # Realtime inalcanzable no rompe la escritura
 *   node scripts/realtime-bell.mjs --criterio4    # menos timbres que pedidos (la ráfaga)
 *   node scripts/realtime-bell.mjs --criterio8    # el timbre llega a tiempo
 *   node scripts/realtime-bell.mjs --criterio9    # ningún evento se queda sin timbre
 *   node scripts/realtime-bell.mjs --criterio10   # los dos disparadores, y solo esos
 *   node scripts/realtime-bell.mjs --criterio11   # emitir no retrasa
 *   node scripts/realtime-bell.mjs --criterio13   # la credencial es del negocio que la pide
 *   node scripts/realtime-bell.mjs                # todos, en orden
 *
 * Plain `fetch` and the native `WebSocket` global (Node 24 — architecture.md
 * § Riesgos, riesgo 5) against the running app and against Realtime's own
 * REST/websocket endpoints directly (never `@supabase/*`: this is a test
 * script under `scripts/`, outside `src/`, so R13's boundary does not apply
 * to it, but there is no reason to pull the library in either).
 *
 * Realtime's websocket lives at `/socket/websocket`, and a channel joined
 * over the wire is `realtime:<channel>` — a `realtime:` prefix client
 * libraries add for you, which this script adds by hand since it speaks the
 * Phoenix protocol directly. Found by running the emulator end to end
 * (docker/supabase-gateway.conf), not documented in Realtime's own docs at
 * the level this script needs.
 *
 * Criterio 3/11 ("Realtime inalcanzable") stop the `realtime` container
 * instead of pointing `NEXT_PUBLIC_SUPABASE_URL` at a TEST-NET-3 address
 * (spec.md's own wording): Next 16 allows only ONE `next dev` per
 * directory, and `.agent/verify.sh`'s smoke stage already owns the single
 * running one — there is no way to restart it with a different URL mid-run
 * without a second server, which Next itself refuses. Stopping the
 * container makes the SAME gateway URL (`NEXT_PUBLIC_SUPABASE_URL` never
 * changes) actually unreachable: `supabase-gateway`'s upstream connect
 * hangs for several seconds before nginx would even answer 502, so
 * `broadcastBell`'s own `AbortSignal.timeout(REALTIME_BELL_EMIT_TIMEOUT_MS)`
 * is what actually cuts it short — reproducing E6 (an address that
 * SWALLOWS the connection) for real, not a stand-in for it.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "pg";

const BASE = process.env.QAB_BASE_URL ?? "http://localhost:3000";
const args = new Set(process.argv.slice(2).map((arg) => arg.split("=")[0]));

// Mirrors src/constants/realtime.ts — a plain `node` script cannot import a
// TypeScript module without a build step (same reasoning
// scripts/renegotiate-order.mjs documents for the generated Prisma client).
const REALTIME_BELL_WINDOW_MS = 5000;
const REALTIME_BELL_EVENT = "pedidos";
const REALTIME_BELL_PAYLOAD = { t: "pedidos" };

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

const CRON_SECRET = process.env.CRON_SECRET;

// ------------------------------------------------------------- checkout ----
// Same shape as scripts/renegotiate-order.mjs / scripts/place-order.mjs.

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

async function quote(slug, items) {
  const response = await fetch(`${BASE}/api/orders/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ storeSlug: slug, items }),
  });
  return response.json();
}

let phoneSeq = 0;
function uniquePhone() {
  phoneSeq += 1;
  return `+53${String(Date.now()).slice(-7)}${String(phoneSeq).padStart(2, "0")}`;
}

async function orderRow(code) {
  const { rows } = await db.query(
    `SELECT id::text AS id, code, status, "businessId" FROM "Order" WHERE code = $1`,
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

/** Creates one order through the PUBLIC checkout. Returns timing too, for
 *  criterio 11's median. */
async function checkout(slug) {
  const product = await pickOrderableProduct(slug);
  const items = [{ storeProductId: product.id, qty: 1 }];
  const quoted = await quote(slug, items);

  const body = {
    storeSlug: slug,
    items,
    contact: { name: "Script F-020", phone: uniquePhone() },
    fulfillment: "PICKUP",
    expectedTotal: quoted.subtotal,
  };

  const startedAt = performance.now();
  const response = await fetch(`${BASE}/api/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const elapsedMs = performance.now() - startedAt;
  const json = await response.json().catch(() => null);
  if (response.status !== 201) {
    throw new Error(
      `No se pudo sembrar un pedido en ${slug}: ${response.status} ${JSON.stringify(json)}`,
    );
  }

  const row = await orderRow(json.code);
  return { id: BigInt(row.id), code: json.code, businessId: row.businessId, elapsedMs };
}

async function buildSimpleProposal(order) {
  const items = await orderItemRows(order.id.toString());
  const line = items[0];
  return {
    currencyCode: "CUP",
    subtotal: line.lineTotal.toString(),
    discountTotal: "0",
    deliveryFee: "0",
    total: line.lineTotal.toString(),
    message: "Ajuste de prueba F-020",
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

async function proposeChange(orderId, payload, token) {
  const response = await fetch(`${BASE}/api/internal/orders/proposal`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
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

async function pull(businessToken, since = "0", limit = 500) {
  const response = await fetch(`${BASE}/api/internal/orders?since=${since}&limit=${limit}`, {
    headers: { authorization: `Bearer ${businessToken}` },
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

// -------------------------------------------------------------- docker ----

function dockerCompose(...args) {
  execFileSync("docker", ["compose", ...args], { stdio: "pipe" });
}

async function waitForRealtimeHealthy(supabaseUrl, anonKey, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${supabaseUrl}/realtime/v1/api/tenants/realtime-dev/health`, {
        headers: { authorization: `Bearer ${anonKey}` },
      });
      if (response.ok) return true;
    } catch {
      // still coming up
    }
    await sleep(500);
  }
  return false;
}

// --------------------------------------------------------- credential ----

async function fetchCredential(businessToken) {
  const response = await fetch(`${BASE}/api/internal/realtime/credential`, {
    method: "POST",
    headers: { authorization: `Bearer ${businessToken}` },
  });
  if (response.status !== 200) {
    throw new Error(`credential fetch failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

// ------------------------------------------------------------ subscriber ----

/** Speaks the Phoenix channel protocol directly against Realtime's
 *  websocket. `messages` accumulates every `broadcast` event received,
 *  each stamped with `receivedAt` (ms since epoch) for latency assertions. */
class BellSubscriber {
  constructor(credential) {
    this.credential = credential;
    this.messages = [];
    const base = credential.url.replace(/^http/, "ws");
    this.ws = new WebSocket(
      `${base}/realtime/v1/websocket?apikey=${encodeURIComponent(credential.apikey)}&vsn=1.0.0`,
    );
    this.ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.event === "broadcast") {
        this.messages.push({ payload: msg.payload?.payload, raw: ev.data, receivedAt: Date.now() });
      }
    });
  }

  /** Resolves once the channel join is acknowledged — `ok` or `error`. */
  async open() {
    await new Promise((resolve) => this.ws.addEventListener("open", resolve));
    const topic = `realtime:${this.credential.channel}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("join timed out")), 10_000);
      const onMessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.topic === topic && msg.event === "phx_reply") {
          clearTimeout(timeout);
          this.ws.removeEventListener("message", onMessage);
          if (msg.payload?.status === "ok") resolve();
          else reject(new Error(`join rejected: ${JSON.stringify(msg.payload)}`));
        }
      };
      this.ws.addEventListener("message", onMessage);
      this.ws.send(
        JSON.stringify({
          topic,
          event: "phx_join",
          payload: {
            config: { broadcast: { self: false }, private: true },
            access_token: this.credential.token,
          },
          ref: "1",
        }),
      );
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }
}

/** Polls `subscriber.messages.length` until it reaches `count` or `timeoutMs`
 *  elapses. Returns the final length — the caller decides pass/fail. */
async function waitForMessageCount(subscriber, count, timeoutMs) {
  const startedAt = Date.now();
  while (subscriber.messages.length < count && Date.now() - startedAt < timeoutMs) {
    await sleep(50);
  }
  return subscriber.messages.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ------------------------------------------------------------ criterio 1 ----

async function verifyCriterio1() {
  console.log("\n== Criterio 1 · Broadcast sin datos al crear ==");
  const token = mintToken("seed-negocio-1");
  const credential = await fetchCredential(token);
  const subscriber = new BellSubscriber(credential);
  await subscriber.open();

  check("la credencial nombra el evento 'pedidos'", credential.event === REALTIME_BELL_EVENT);

  const order = await checkout("tienda-demo");
  const count = await waitForMessageCount(subscriber, 1, 10_000);
  check("recibe exactamente un mensaje en 10 s", count === 1, `recibidos=${count}`);

  const message = subscriber.messages[0];
  check(
    "el payload es exactamente { t: 'pedidos' }, campo por campo",
    (() => {
      if (!message) return false;
      const keys = Object.keys(message.payload ?? {});
      return keys.length === 1 && message.payload.t === REALTIME_BELL_PAYLOAD.t;
    })(),
  );

  const raw = message?.raw ?? "";
  check("el mensaje no contiene el code del pedido", !raw.includes(order.code));
  check("el mensaje no contiene 'total'", !raw.toLowerCase().includes("total"));
  check("el mensaje no contiene 'phone' ni el teléfono usado", !raw.includes("phone"));
  check("el mensaje no contiene 'name'/'contact'", !/name|contact/i.test(raw));

  subscriber.close();
}

// ------------------------------------------------------------ criterio 2 ----

async function verifyCriterio2() {
  console.log("\n== Criterio 2 · Aislamiento por negocio ==");
  const tokenA = mintToken("seed-negocio-1");
  const tokenB = mintToken("seed-negocio-2");
  const credentialA = await fetchCredential(tokenA);
  const credentialB = await fetchCredential(tokenB);

  const subscriberA = new BellSubscriber(credentialA);
  const subscriberB = new BellSubscriber(credentialB);
  await Promise.all([subscriberA.open(), subscriberB.open()]);

  await checkout("tienda-demo"); // negocio A only

  const countA = await waitForMessageCount(subscriberA, 1, 10_000);
  await sleep(1000); // let anything mistakenly bound for B arrive too
  check("A recibe 1", countA === 1, `recibidos=${countA}`);
  check(
    "B recibe 0",
    subscriberB.messages.length === 0,
    `recibidos=${subscriberB.messages.length}`,
  );

  subscriberA.close();
  subscriberB.close();
}

// ------------------------------------------------------------ criterio 3 ----

async function verifyCriterio3() {
  console.log("\n== Criterio 3 · Realtime inalcanzable no rompe la escritura ==");
  dockerCompose("stop", "realtime");
  try {
    const token = mintToken("seed-negocio-1");
    const order = await checkout("tienda-demo");
    check("POST /api/orders sigue respondiendo 201 con Realtime caído", true);

    const pulled = await pull(token, "0", 500);
    const found = (pulled.json?.orders ?? []).some((o) => o.code === order.code);
    check("el pedido aparece en el pull", found);
  } finally {
    dockerCompose("start", "realtime");
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const healthy = await waitForRealtimeHealthy(supabaseUrl, anonKey);
    check("Realtime vuelve a estar sano antes de continuar", healthy);
  }
}

// ------------------------------------------------------------ criterio 4 ----

async function verifyCriterio4() {
  console.log("\n== Criterio 4 (redacción del criterio 17) · la ráfaga es como mucho 2 timbres ==");
  const token = mintToken("seed-negocio-1");
  const credential = await fetchCredential(token);
  const subscriber = new BellSubscriber(credential);
  await subscriber.open();

  // A silence first, so the burst starts from a closed window (E7).
  await sleep(REALTIME_BELL_WINDOW_MS + 500);
  subscriber.messages.length = 0;

  const startedAt = Date.now();
  for (let i = 0; i < 10; i += 1) await checkout("tienda-demo");
  const burstMs = Date.now() - startedAt;
  check(
    "los 10 pedidos se crearon en menos de 5 s",
    burstMs < REALTIME_BELL_WINDOW_MS,
    `${burstMs}ms`,
  );

  const count = await waitForMessageCount(subscriber, 2, 60_000);
  // Give the close bell (up to REALTIME_BELL_WINDOW_MS after the last
  // event) a chance to still be in flight before reading the final count.
  await sleep(REALTIME_BELL_WINDOW_MS + 500);
  const finalCount = subscriber.messages.length;
  check(
    "recibidos entre 1 y 2 (nunca 10)",
    finalCount >= 1 && finalCount <= 2,
    `recibidos=${finalCount}, primeros=${count}`,
  );

  subscriber.close();
}

// ------------------------------------------------------------ criterio 8 ----

async function verifyCriterio8() {
  console.log("\n== Criterio 8 · El timbre llega a tiempo ==");
  const token = mintToken("seed-negocio-1");
  const credential = await fetchCredential(token);
  const subscriber = new BellSubscriber(credential);
  await subscriber.open();

  // A silence longer than the window, so the next event rings immediately (E7).
  await sleep(REALTIME_BELL_WINDOW_MS + 500);
  subscriber.messages.length = 0;

  const respondedAt = Date.now();
  await checkout("tienda-demo");
  const count = await waitForMessageCount(subscriber, 1, 5_000);
  const latencyMs = (subscriber.messages[0]?.receivedAt ?? Infinity) - respondedAt;

  check("recibe el timbre", count >= 1);
  check("dentro de los 2 s siguientes a la respuesta", latencyMs <= 2000, `${latencyMs}ms`);

  subscriber.close();
}

// ------------------------------------------------------------ criterio 9 ----

async function verifyCriterio9() {
  console.log("\n== Criterio 9 · Ningún evento se queda sin timbre (E9) ==");
  const token = mintToken("seed-negocio-1");
  const credential = await fetchCredential(token);
  const subscriber = new BellSubscriber(credential);
  await subscriber.open();

  await sleep(REALTIME_BELL_WINDOW_MS + 500);
  subscriber.messages.length = 0;

  const t0 = Date.now();
  await checkout("tienda-demo"); // opens the window — rings now (E7)
  await sleep(4900);
  await checkout("tienda-demo"); // at 4.9s — must NOT ring now, but be covered

  const count = await waitForMessageCount(subscriber, 2, 6_500);
  const elapsedFromT0 = Date.now() - t0;
  check(
    "un segundo mensaje llega antes del segundo 6,0 desde el primer evento",
    count >= 2 && elapsedFromT0 < 6_000 + 500, // margin for network/DB round-trips
    `recibidos=${count} en ${elapsedFromT0}ms`,
  );

  subscriber.close();
}

// ------------------------------------------------------------ criterio 10 ----

async function verifyCriterio10() {
  console.log("\n== Criterio 10 · Los dos disparadores, y solo esos ==");
  const token = mintToken("seed-negocio-1");
  const credential = await fetchCredential(token);
  const subscriber = new BellSubscriber(credential);
  await subscriber.open();

  await sleep(REALTIME_BELL_WINDOW_MS + 500);

  // Aprobar una propuesta timbra. `pull` first: PENDING is not proposable —
  // POST /api/internal/orders/proposal only accepts PULLED, CONFIRMED or
  // AWAITING_CUSTOMER (docs/sync-contract.md § ③④), and a pull is what
  // moves PENDING -> PULLED, same precondition scripts/renegotiate-order.mjs
  // already relies on.
  subscriber.messages.length = 0;
  const approved = await checkout("tienda-demo");
  await pull(token, (approved.id - 1n).toString(), 1);
  await proposeChange(approved.id, await buildSimpleProposal(approved), token);
  await respond("tienda-demo", approved.code, "aprobar");
  let count = await waitForMessageCount(subscriber, 1, 10_000);
  check("aprobar produce un timbre", count >= 1, `recibidos=${count}`);

  await sleep(REALTIME_BELL_WINDOW_MS + 500);

  // Rechazar otra propuesta timbra.
  subscriber.messages.length = 0;
  const rejected = await checkout("tienda-demo");
  await pull(token, (rejected.id - 1n).toString(), 1);
  await proposeChange(rejected.id, await buildSimpleProposal(rejected), token);
  await respond("tienda-demo", rejected.code, "rechazar");
  count = await waitForMessageCount(subscriber, 1, 10_000);
  check("rechazar produce un timbre", count >= 1, `recibidos=${count}`);

  await sleep(REALTIME_BELL_WINDOW_MS + 500);

  // Repetir la misma decisión ya resuelta: 0 timbres.
  subscriber.messages.length = 0;
  const repeated = await respond("tienda-demo", approved.code, "aprobar");
  check("repetir la decisión responde 200 idempotente", repeated.status === 200, repeated.status);
  await sleep(REALTIME_BELL_WINDOW_MS + 1000);
  check("repetir la decisión produce 0 timbres", subscriber.messages.length === 0);

  // Vencimiento forzado: 0 timbres — but NOT 0 messages overall. Creating
  // `expiring` below is itself the FIRST trigger and rings on its own; that
  // ring has to be drained before it is safe to assert "the cron rang
  // nothing", or this would confuse the creation's own bell for one the
  // cron caused.
  subscriber.messages.length = 0;
  const expiring = await checkout("tienda-demo");
  await waitForMessageCount(subscriber, 1, 10_000); // drains the creation's own ring
  subscriber.messages.length = 0;

  await pull(token, (expiring.id - 1n).toString(), 1);
  await proposeChange(expiring.id, await buildSimpleProposal(expiring), token);
  await db.query(`UPDATE "Order" SET "expiresAt" = now() - interval '1 hour' WHERE id = $1`, [
    expiring.id.toString(),
  ]);
  if (!CRON_SECRET) {
    check("CRON_SECRET configurado para forzar el vencimiento", false, "ver .env.example");
  } else {
    const cron = await fetch(`${BASE}/api/crons/expire-proposals`, {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    check("el cron de vencimiento responde 200", cron.status === 200, cron.status);
    await sleep(REALTIME_BELL_WINDOW_MS + 1000);
    check("el vencimiento forzado produce 0 timbres (R7/E15)", subscriber.messages.length === 0);
  }

  subscriber.close();
}

// ------------------------------------------------------------ criterio 11 ----

async function verifyCriterio11() {
  console.log("\n== Criterio 11 · Emitir no retrasa ==");
  const healthyTimings = [];
  for (let i = 0; i < 5; i += 1) healthyTimings.push((await checkout("tienda-demo")).elapsedMs);
  const healthyMedian = median(healthyTimings);

  dockerCompose("stop", "realtime");
  try {
    const brokenTimings = [];
    for (let i = 0; i < 5; i += 1) brokenTimings.push((await checkout("tienda-demo")).elapsedMs);
    const brokenMedian = median(brokenTimings);

    // R3: REALTIME_BELL_EMIT_TIMEOUT_MS (src/constants/realtime.ts) — the
    // margin the spec's own criterion allows. after() means the two medians
    // are expected to be near-identical; the margin exists for network jitter.
    const marginMs = 1000;
    check(
      "mediana con Realtime roto no supera la mediana sano + el tope de R3",
      brokenMedian <= healthyMedian + marginMs,
      `sano=${healthyMedian.toFixed(1)}ms roto=${brokenMedian.toFixed(1)}ms`,
    );
  } finally {
    dockerCompose("start", "realtime");
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const healthy = await waitForRealtimeHealthy(supabaseUrl, anonKey);
    check("Realtime vuelve a estar sano antes de continuar", healthy);
  }
}

// ------------------------------------------------------------ criterio 13 ----

async function verifyCriterio13() {
  console.log("\n== Criterio 13 · La credencial es del negocio que la pide ==");
  const tokenA = mintToken("seed-negocio-1");
  const tokenB = mintToken("seed-negocio-2");
  const credentialA = await fetchCredential(tokenA);
  const credentialB = await fetchCredential(tokenB);

  check(
    "las dos credenciales nombran canales DISTINTOS, cada una el suyo",
    credentialA.channel !== credentialB.channel,
    `A=${credentialA.channel} B=${credentialB.channel}`,
  );

  // Positive control first: A's OWN credential must still work, or a "B
  // never receives" result below would be meaningless (a dead subscriber
  // receives nothing from ANY channel).
  const subscriberA = new BellSubscriber(credentialA);
  const subscriberB = new BellSubscriber(credentialB);
  await Promise.all([subscriberA.open(), subscriberB.open()]);

  await checkout("tienda-demo"); // negocio A's own store
  const countA = await waitForMessageCount(subscriberA, 1, 10_000);
  await sleep(1000);
  check("A, con su PROPIA credencial, recibe su propio timbre", countA >= 1, `recibidos=${countA}`);
  check(
    "B, con la credencial que le dio ESTE endpoint, nunca recibe el timbre de A",
    subscriberB.messages.length === 0,
    `recibidos=${subscriberB.messages.length}`,
  );

  subscriberA.close();
  subscriberB.close();
}

// ---------------------------------------------------------------------------

const MODES = {
  "--criterio1": verifyCriterio1,
  "--criterio2": verifyCriterio2,
  "--criterio3": verifyCriterio3,
  "--criterio4": verifyCriterio4,
  "--criterio8": verifyCriterio8,
  "--criterio9": verifyCriterio9,
  "--criterio10": verifyCriterio10,
  "--criterio11": verifyCriterio11,
  "--criterio13": verifyCriterio13,
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
