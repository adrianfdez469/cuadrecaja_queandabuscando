#!/usr/bin/env node
/**
 * F-030: proves the order-customer-link instrument
 * (`src/features/account/server/orderLinkObserver.ts`) fires against the
 * REAL Auth of F-028, not a mock. `bash .agent/verify.sh F-030 --probe`
 * (architecture.md § "El guion", spec.md § "Mitad de verdad, contra el Auth
 * real de F-028") runs this and reads its exit code and its `PROBE FAIL`
 * lines; the nine unit cases in `orderIdentity.test.ts` already cover the
 * deterministic half in CI.
 *
 * Node ESM only, no dependency the repo does not already have: `node:http`,
 * `node:child_process`, `node:timers/promises`, global `fetch`, `pg` and
 * `dotenv` — the same two `scripts/place-order.mjs` uses (architecture.md
 * § "El guion").
 *
 * Env this reads:
 *   PROBE_PORT        port already checked free by verify.sh (default 3102,
 *                      so running this file directly still does something).
 *   PROBE_SERVER_LOG   file the probe's OWN `next dev` appends its stdio to.
 *                      Defaults to a temp file when run standalone.
 *   SUPABASE_UPSTREAM  real Auth origin the slow proxy forwards to. Defaults
 *                      to NEXT_PUBLIC_SUPABASE_URL from `.env`, then to
 *                      http://localhost:54321 (architecture.md DA7).
 *
 * Exit codes — one cause each, always with a `PROBE FAIL` line in front
 * (architecture.md § "El guion", tabla de códigos de salida):
 *   0  the seven runs (A-G) passed
 *   1  missing configuration (.env, DATABASE_URL)
 *   2  the Auth emulator or Postgres do not respond (F-028 / npm run seed)
 *   3  the probe's own `next dev` never came up
 *   4  no orderable store/product at tienda-demo (npm run seed)
 *   5  could not get a session (scripts/auth-otp.mjs's own exit code)
 *   6  at least one assertion in runs A-G failed
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "pg";

const EXIT = {
  OK: 0,
  CONFIG: 1,
  UNREACHABLE: 2,
  SERVER_DID_NOT_START: 3,
  NO_PRODUCT: 4,
  NO_SESSION: 5,
  ASSERTION_FAILED: 6,
};

const STORE_SLUG = "tienda-demo";
const PROBE_PREFIX = "[orders] customer link";
const HEALTH_TIMEOUT_MS = 3000;
const NEXT_DEV_TIMEOUT_MS = 90_000;

const PROBE_PORT = Number(process.env.PROBE_PORT ?? 3102);
const PROBE_SERVER_LOG =
  process.env.PROBE_SERVER_LOG ?? path.join(os.tmpdir(), `order-link-probe-${Date.now()}.log`);
const APP_URL = `http://localhost:${PROBE_PORT}`;
const UPSTREAM_URL =
  process.env.SUPABASE_UPSTREAM ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:54324";
const REAL_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// State that survives across the whole run, for `finally`/SIGINT cleanup
// (architecture.md § "El guion", pieza 6).
const state = {
  proxy: null,
  proxyPort: null,
  nextDev: null,
  db: null,
  orderCodes: [],
  customerEmail: null,
  failures: 0,
};

function fail(code, ...lines) {
  console.log(`PROBE FAIL ${lines[0] ?? "fallo sin descripción"}`);
  for (const line of lines.slice(1)) console.log(`  ${line}`);
  process.exitCode = code;
  throw new StopProbe(code);
}

class StopProbe extends Error {
  constructor(code) {
    super(`stop probe with code ${code}`);
    this.code = code;
  }
}

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
    return true;
  }
  console.log(`PROBE FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  state.failures += 1;
  return false;
}

/** `fetch` that never throws — a network error becomes a fake failed response. */
async function tryFetch(url, init, timeoutMs) {
  const controller = timeoutMs ? new AbortController() : undefined;
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    return await fetch(url, { ...init, signal: controller?.signal });
  } catch (error) {
    return { ok: false, status: 0, networkError: error };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------- 1. slow proxy ---
// http.createServer on port 0 (ephemeral — architecture.md DA7): forwards to
// UPSTREAM_URL after waiting `state.delayMs`, an assignable field so ONE
// arrancada covers runs A-E. Copies status, headers and body back verbatim.

function startSlowProxy(upstream) {
  const upstreamUrl = new URL(upstream);
  const isHttps = upstreamUrl.protocol === "https:";
  const transport = isHttps ? undefined : http; // upstream is always local http in dev

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const delayMs = proxyState.delayMs;
      const forward = () => {
        const upstreamReq = transport.request(
          {
            hostname: upstreamUrl.hostname,
            port: upstreamUrl.port,
            path: req.url,
            method: req.method,
            headers: { ...req.headers, host: upstreamUrl.host },
          },
          (upstreamRes) => {
            res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
            upstreamRes.pipe(res);
          },
        );
        upstreamReq.on("error", (error) => {
          if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
          res.end(`order-link-probe proxy: ${error.message}`);
        });
        if (body.length > 0) upstreamReq.write(body);
        upstreamReq.end();
      };
      if (delayMs > 0) {
        setTimeout(forward, delayMs);
      } else {
        forward();
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const proxyState = { delayMs: 0 };

// ----------------------------------------------------- 2. the probe's own next dev ---

function openLogFd() {
  fs.mkdirSync(path.dirname(PROBE_SERVER_LOG), { recursive: true });
  return fs.openSync(PROBE_SERVER_LOG, "a");
}

function startNextDev(extraEnv) {
  const fd = openLogFd();
  const child = spawn("npx", ["next", "dev", "-p", String(PROBE_PORT)], {
    cwd: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
    env: { ...process.env, PORT: String(PROBE_PORT), ...extraEnv },
    stdio: ["ignore", fd, fd],
    detached: true,
  });
  fs.closeSync(fd);
  return child;
}

async function waitForNextDev(child) {
  const deadline = Date.now() + NEXT_DEV_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    const response = await tryFetch(`${APP_URL}/`, undefined, 2000);
    if (response.ok) return true;
    await sleep(1000);
  }
  return false;
}

function killGroup(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", resolve);
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      resolve();
      return;
    }
    setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }, 5000);
  });
}

/** Restarts the probe's `next dev` with a fresh environment (run F needs
 * this: the two NEXT_PUBLIC_SUPABASE_* have to be genuinely empty at compile
 * time, and Next inlines them once per process — architecture.md riesgo 2). */
async function restartNextDev(extraEnv) {
  await killGroup(state.nextDev);
  state.nextDev = startNextDev(extraEnv);
  const up = await waitForNextDev(state.nextDev);
  if (!up) {
    fail(
      EXIT.SERVER_DID_NOT_START,
      "el next dev del probe no llegó a levantar tras el rearranque",
      `revisa ${PROBE_SERVER_LOG}`,
    );
  }
}

// --------------------------------------------------------------- 3. sesión ---

function runAuthOtp(email, cookieJar) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        path.join(path.dirname(new URL(import.meta.url).pathname), "auth-otp.mjs"),
        "--mode",
        "app",
        "--app",
        APP_URL,
        "--email",
        email,
        "--cookie-jar",
        cookieJar,
        "--mailpit",
        MAILPIT_URL,
        "--json",
        "--quiet",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

// -------------------------------------------------------- 4. cotizar/pedir ---
// Both queries are DUPLICATED from scripts/place-order.mjs on purpose
// (architecture.md § "El guion", pieza 4): that script deliberately never
// sends a Cookie header (F-010 criterio 4), so it cannot be reused here
// without weakening what it proves.

const STORE_BY_SLUG_JOIN = `
       JOIN "Storefront" sf ON sf.id = s."storefrontId"
      WHERE (sf.slug = $1 OR s.slug = $1)`;

async function pickOrderableProduct(db, slug) {
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
  return rows[0] ?? null;
}

async function readOrder(db, code) {
  const { rows } = await db.query(`SELECT "customerId" FROM "Order" WHERE code = $1`, [code]);
  return rows[0] ?? null;
}

function makePhone(offset) {
  return `+53${(Date.now() + offset * 1000).toString().slice(-9)}`;
}

async function quote(productId) {
  return tryFetch(`${APP_URL}/api/orders/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ storeSlug: STORE_SLUG, items: [{ storeProductId: productId, qty: 1 }] }),
  });
}

async function placeOrder(productId, phone, cookieHeader) {
  const quoted = await quote(productId);
  if (!quoted.ok) return { ok: false, status: quoted.status, reason: "quote failed" };
  const quotedBody = await quoted.json();
  const headers = { "content-type": "application/json" };
  if (cookieHeader) headers.cookie = cookieHeader;
  const response = await fetch(`${APP_URL}/api/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      storeSlug: STORE_SLUG,
      items: [{ storeProductId: productId, qty: 1 }],
      contact: { name: "Guion de verificación F-030", phone },
      fulfillment: "PICKUP",
      expectedTotal: quotedBody.subtotal,
      idempotencyKey: randomUUID(),
    }),
  });
  const json = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, json };
}

// ---------------------------------------------------- 5. lector de líneas ---
// NEVER JSON.parse: console.warn prints with util.inspect — single quotes,
// and it wraps the object across several lines once it stops fitting
// (architecture.md § "El guion", pieza 5; riesgos, riesgo 5).

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function markOffset() {
  try {
    return fs.statSync(PROBE_SERVER_LOG).size;
  } catch {
    return 0;
  }
}

function readSince(offset) {
  let fd;
  try {
    fd = fs.openSync(PROBE_SERVER_LOG, "r");
  } catch {
    return "";
  }
  try {
    const size = fs.fstatSync(fd).size;
    const length = Math.max(0, size - offset);
    if (length === 0) return "";
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, offset);
    return stripAnsi(buffer.toString("utf8"));
  } finally {
    fs.closeSync(fd);
  }
}

function parseOrderLinkLines(text) {
  const results = [];
  let cursor = 0;
  while (true) {
    const found = text.indexOf(PROBE_PREFIX, cursor);
    if (found === -1) break;
    const next = text.indexOf(PROBE_PREFIX, found + PROBE_PREFIX.length);
    const windowEnd = Math.min(next === -1 ? text.length : next, found + 800);
    const chunk = text.slice(found, windowEnd);
    results.push({
      outcome: /outcome:\s*'([a-z_]+)'/.exec(chunk)?.[1] ?? null,
      elapsedMs: numberField(/elapsedMs:\s*(\d+)/.exec(chunk)),
      ceilingMs: numberField(/ceilingMs:\s*(\d+)/.exec(chunk)),
      lateMs: numberField(/lateMs:\s*(\d+)/.exec(chunk)),
      resolved: /resolved:\s*(true|false)/.exec(chunk)?.[1] === "true",
      raw: chunk,
    });
    cursor = found + PROBE_PREFIX.length;
  }
  return results;
}

function numberField(match) {
  return match ? Number(match[1]) : null;
}

/** Polls the log for the `late` line, since it only lands after the response
 * already left (architecture.md flujo de datos, paso 9). */
async function waitForLateLine(offset, marginMs) {
  const deadline = Date.now() + proxyState.delayMs + marginMs;
  while (Date.now() < deadline) {
    const lines = parseOrderLinkLines(readSince(offset));
    const late = lines.find((line) => line.outcome === "late");
    if (late) return lines;
    await sleep(200);
  }
  return parseOrderLinkLines(readSince(offset));
}

// Literal, not imported from `@/constants/account`: this is a plain-`node`
// script, same reason `qab-shopper-auth=probe-garbage-session` is spelled
// out for corridas E/F above (architecture.md § "El guion" — no dependency
// on the compiled app).
const CUSTOMER_COOKIE_NAME = "qab-shopper-auth";

/**
 * Corrida G (spec.md R3 / architecture.md § "El guion") needs the Supabase
 * `user.id` too, not just `Customer.id` — it is a DIFFERENT identifier
 * (`Customer.supabaseUserId` in `src/features/account/server/customers.ts`)
 * and nothing else in this script ever reads it, so it has to come out of
 * the session cookie itself. `@supabase/ssr` stores the session as
 * `base64-<base64 JSON>` (chunked across `NAME`, `NAME.0`, `NAME.1`, … once
 * it does not fit one cookie — `isSessionCookieName()` in
 * `src/lib/auth/customerSession.ts`); the JSON's `access_token` is the JWT,
 * and its payload's `sub` IS the Supabase `user.id` (the same claim
 * `toCustomerUser()` reads in `src/lib/auth/customerSession.ts`). Returns
 * `null` — never throws — on any shape it does not recognize; the caller
 * decides that null is fatal for corrida G (R3: a verifier that silently
 * skips what it cannot find is worse than one that does not exist).
 */
function extractSupabaseUserId(cookieHeaderValue) {
  const chunks = [];
  for (const part of cookieHeaderValue.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const name = trimmed.slice(0, eq);
    if (name === CUSTOMER_COOKIE_NAME || name.startsWith(`${CUSTOMER_COOKIE_NAME}.`)) {
      chunks.push([name, trimmed.slice(eq + 1)]);
    }
  }
  if (chunks.length === 0) return null;
  chunks.sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  let raw = chunks.map(([, value]) => value).join("");
  if (raw.startsWith("base64-")) raw = raw.slice("base64-".length);

  try {
    const session = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    const accessToken = session?.access_token;
    if (typeof accessToken !== "string") return null;
    const segments = accessToken.split(".");
    if (segments.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

// -------------------------------------------------------------- 6. limpieza ---

async function cleanup() {
  if (state.orderCodes.length > 0 && state.db) {
    try {
      await state.db.query(`DELETE FROM "Order" WHERE code = ANY($1::text[])`, [state.orderCodes]);
    } catch (error) {
      console.log(`  (no se pudieron borrar los Order de prueba: ${error.message})`);
    }
  }
  if (state.customerEmail && state.db) {
    try {
      await state.db.query(`DELETE FROM "Customer" WHERE email = $1`, [state.customerEmail]);
    } catch (error) {
      console.log(`  (no se pudo borrar el Customer de prueba: ${error.message})`);
    }
  }
  if (state.db) {
    await state.db.end().catch(() => {});
  }
  await killGroup(state.nextDev);
  if (state.proxy) {
    await new Promise((resolve) => state.proxy.close(resolve));
  }
}

let cleaningUp = false;
async function cleanupOnce() {
  if (cleaningUp) return;
  cleaningUp = true;
  await cleanup();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await cleanupOnce();
    process.exit(130);
  });
}

// ------------------------------------------------------------------- main ---

async function main() {
  // --- config (código 1) ----------------------------------------------
  const missing = [];
  const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) missing.push("DATABASE_URL/DIRECT_URL");
  if (!REAL_ANON_KEY) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (missing.length > 0) {
    fail(EXIT.CONFIG, `falta en .env: ${missing.join(", ")}`);
  }

  // --- reachability (código 2) — antes de tocar nada más ---------------
  const authHealth = await tryFetch(`${UPSTREAM_URL}/auth/v1/health`, undefined, HEALTH_TIMEOUT_MS);
  if (!authHealth.ok) {
    fail(
      EXIT.UNREACHABLE,
      `el emulador de Auth no responde en ${UPSTREAM_URL}/auth/v1/health`,
      "levántalo con: docker compose up -d",
    );
  }
  const mailpitHealth = await tryFetch(`${MAILPIT_URL}/readyz`, undefined, HEALTH_TIMEOUT_MS);
  if (!mailpitHealth.ok) {
    fail(
      EXIT.UNREACHABLE,
      `Mailpit no responde en ${MAILPIT_URL}/readyz`,
      "levántalo con: docker compose up -d",
    );
  }

  state.db = new Client({ connectionString: databaseUrl });
  try {
    await state.db.connect();
  } catch (error) {
    fail(EXIT.UNREACHABLE, `Postgres no responde en ${databaseUrl}`, error.message);
  }

  // --- store/product (código 4) — antes de gastar 90s levantando next dev ---
  const product = await pickOrderableProduct(state.db, STORE_SLUG);
  if (!product) {
    fail(EXIT.NO_PRODUCT, `no hay producto vendible en "${STORE_SLUG}"`, "ejecuta: npm run seed");
  }

  // --- 1. proxy lento ----------------------------------------------------
  state.proxy = await startSlowProxy(UPSTREAM_URL);
  state.proxyPort = state.proxy.address().port;
  console.log(
    `> proxy lento escuchando en 127.0.0.1:${state.proxyPort}, reenvía a ${UPSTREAM_URL}`,
  );

  // --- 2. servidor propio, apuntando al proxy -----------------------------
  console.log(`> arrancando next dev en el puerto ${PROBE_PORT} (salida: ${PROBE_SERVER_LOG})`);
  state.nextDev = startNextDev({
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${state.proxyPort}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: REAL_ANON_KEY,
  });
  const up = await waitForNextDev(state.nextDev);
  if (!up) {
    fail(
      EXIT.SERVER_DID_NOT_START,
      "el next dev del probe no llegó a levantar",
      `revisa ${PROBE_SERVER_LOG}`,
    );
  }

  // --- Corrida A: sesión real, ANTES de encender el retraso ---------------
  console.log("\n== Corrida A — sesión real (retraso 0 ms) ==");
  const email = `order-link-probe+${Date.now()}@local.test`;
  state.customerEmail = email;
  const cookieJar = path.join(os.tmpdir(), `order-link-probe-cookie-${Date.now()}.txt`);
  const authResult = await runAuthOtp(email, cookieJar);
  if (authResult.code !== 0) {
    fail(
      EXIT.NO_SESSION,
      `scripts/auth-otp.mjs --mode app salió ${authResult.code}`,
      authResult.stdout || authResult.stderr,
    );
  }
  const cookieHeader = fs.readFileSync(cookieJar, "utf8").trim();
  const { rows: customerRows } = await state.db.query(
    `SELECT id FROM "Customer" WHERE email = $1`,
    [email],
  );
  const customerId = customerRows[0]?.id ?? null;
  assert("corrida A — cookie de sesión obtenida", cookieHeader.length > 0);
  assert("corrida A — Customer creado en Postgres", Boolean(customerId));
  fs.rmSync(cookieJar, { force: true });

  // --- Corrida B: control, calentando la ruta -----------------------------
  console.log("\n== Corrida B — control, retraso 0 ms (calienta la ruta) ==");
  proxyState.delayMs = 0;
  let offset = markOffset();
  const controlStart = Date.now();
  const b = await placeOrder(product.id, makePhone(0), cookieHeader);
  const controlDurationMs = Date.now() - controlStart;
  if (b.json?.code) state.orderCodes.push(b.json.code);
  assert("corrida B — 201", b.status === 201, JSON.stringify(b.json));
  if (b.json?.code) {
    const order = await readOrder(state.db, b.json.code);
    assert("corrida B — Order.customerId == Customer.id de A", order?.customerId === customerId);
  }
  await sleep(300); // margen para que una línea tardía, si la hubiera, ya esté escrita
  assert(
    "corrida B — cero líneas [orders] customer link",
    parseOrderLinkLines(readSince(offset)).length === 0,
  );

  // --- Corrida C: ~400 ms, por encima del umbral de aviso -----------------
  console.log("\n== Corrida C — retraso ~400 ms (slow) ==");
  proxyState.delayMs = 400;
  offset = markOffset();
  const c = await placeOrder(product.id, makePhone(1), cookieHeader);
  if (c.json?.code) state.orderCodes.push(c.json.code);
  assert("corrida C — 201", c.status === 201, JSON.stringify(c.json));
  if (c.json?.code) {
    const order = await readOrder(state.db, c.json.code);
    assert("corrida C — enlazado a Customer.id de A", order?.customerId === customerId);
  }
  await sleep(300);
  const cLines = parseOrderLinkLines(readSince(offset));
  assert("corrida C — exactamente una línea", cLines.length === 1, JSON.stringify(cLines));
  assert("corrida C — outcome slow", cLines[0]?.outcome === "slow", JSON.stringify(cLines[0]));
  assert(
    "corrida C — elapsedMs >= 300",
    (cLines[0]?.elapsedMs ?? 0) >= 300,
    JSON.stringify(cLines[0]),
  );
  assert("corrida C — ceilingMs 600", cLines[0]?.ceilingMs === 600, JSON.stringify(cLines[0]));

  // --- Corrida D: ~1500 ms, agota el techo --------------------------------
  console.log("\n== Corrida D — retraso ~1500 ms (timeout + late) ==");
  proxyState.delayMs = 1500;
  offset = markOffset();
  const dStart = Date.now();
  const d = await placeOrder(product.id, makePhone(2), cookieHeader);
  const dDurationMs = Date.now() - dStart;
  if (d.json?.code) state.orderCodes.push(d.json.code);
  assert("corrida D — 201", d.status === 201, JSON.stringify(d.json));
  if (d.json?.code) {
    const order = await readOrder(state.db, d.json.code);
    assert("corrida D — Order.customerId NULL", order?.customerId === null, JSON.stringify(order));
  }
  assert(
    "corrida D — responde por debajo de (control + techo + 100 ms)",
    dDurationMs < controlDurationMs + 600 + 100,
    `control=${controlDurationMs}ms D=${dDurationMs}ms`,
  );
  const dLinesAfterResponse = parseOrderLinkLines(readSince(offset));
  const timeoutLine = dLinesAfterResponse.find((line) => line.outcome === "timeout");
  assert(
    "corrida D — línea timeout antes/al llegar la respuesta",
    Boolean(timeoutLine),
    JSON.stringify(dLinesAfterResponse),
  );
  assert(
    "corrida D — timeout con elapsedMs >= 600",
    (timeoutLine?.elapsedMs ?? 0) >= 600,
    JSON.stringify(timeoutLine),
  );
  const dLines = await waitForLateLine(offset, 5000);
  const lateLine = dLines.find((line) => line.outcome === "late");
  assert("corrida D — línea late llegó", Boolean(lateLine), JSON.stringify(dLines));
  assert("corrida D — lateMs > 0", (lateLine?.lateMs ?? 0) > 0, JSON.stringify(lateLine));
  assert("corrida D — resolved true", lateLine?.resolved === true, JSON.stringify(lateLine));

  // --- Corrida E: invitado y cookie basura, retraso 0 ---------------------
  console.log("\n== Corrida E — invitado y cookie basura (retraso 0 ms) ==");
  proxyState.delayMs = 0;
  offset = markOffset();
  const eGuest = await placeOrder(product.id, makePhone(3), null);
  if (eGuest.json?.code) state.orderCodes.push(eGuest.json.code);
  assert("corrida E — invitado responde 201", eGuest.status === 201, JSON.stringify(eGuest.json));
  await sleep(300);
  assert("corrida E — invitado, cero líneas", parseOrderLinkLines(readSince(offset)).length === 0);

  offset = markOffset();
  const eGarbage = await placeOrder(
    product.id,
    makePhone(4),
    "qab-shopper-auth=probe-garbage-session",
  );
  if (eGarbage.json?.code) state.orderCodes.push(eGarbage.json.code);
  assert(
    "corrida E — cookie basura responde 201",
    eGarbage.status === 201,
    JSON.stringify(eGarbage.json),
  );
  await sleep(300);
  const eLines = parseOrderLinkLines(readSince(offset));
  assert(
    "corrida E — exactamente una línea unverified",
    eLines.length === 1 && eLines[0]?.outcome === "unverified",
    JSON.stringify(eLines),
  );

  // --- Corrida F: Auth realmente apagado -----------------------------------
  console.log("\n== Corrida F — Auth apagado (rearranque con NEXT_PUBLIC_SUPABASE_* vacías) ==");
  await restartNextDev({ NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" });
  const entrarHtml = await (await tryFetch(`${APP_URL}/cuenta/entrar`)).text?.();
  assert(
    "corrida F — precondición: /cuenta/entrar trae signin-disabled-aviso",
    Boolean(entrarHtml?.includes("signin-disabled-aviso")),
    "las NEXT_PUBLIC_SUPABASE_* no quedaron vacías al compilar — borra .next y repite",
  );
  offset = markOffset();
  const f = await placeOrder(product.id, makePhone(5), "qab-shopper-auth=probe-garbage-session");
  if (f.json?.code) state.orderCodes.push(f.json.code);
  assert("corrida F — 201 con Auth apagado", f.status === 201, JSON.stringify(f.json));
  await sleep(300);
  assert(
    "corrida F — cero líneas con Auth apagado",
    parseOrderLinkLines(readSince(offset)).length === 0,
  );

  // --- Corrida G: cero PII en todo lo capturado ----------------------------
  console.log("\n== Corrida G — sin PII en las líneas [orders] customer link ==");
  const supabaseUserId = extractSupabaseUserId(cookieHeader);
  if (!supabaseUserId) {
    fail(
      EXIT.ASSERTION_FAILED,
      "corrida G — no se pudo extraer el user.id de Supabase (sub del JWT) de la cookie de la corrida A",
      "el chequeo de PII no puede correr con menos de los cuatro valores que promete spec.md R3 — revisa el formato de la cookie de @supabase/ssr o el access_token que lleva dentro",
    );
  }
  const wholeLog = stripAnsi(fs.readFileSync(PROBE_SERVER_LOG, "utf8"));
  const allLines = parseOrderLinkLines(wholeLog);
  const forbidden = [email, customerId, cookieHeader, supabaseUserId].filter(Boolean);
  const leaked = allLines.filter((line) => forbidden.some((needle) => line.raw.includes(needle)));
  assert(
    "corrida G — ninguna línea lleva correo, user.id, Customer.id o cookie",
    leaked.length === 0,
    JSON.stringify(leaked),
  );

  console.log(`\n${state.failures} aserciones fallidas de ${"A-G"}`);
  if (state.failures > 0) throw new StopProbe(EXIT.ASSERTION_FAILED);
}

main()
  .then(async () => {
    await cleanupOnce();
    process.exit(EXIT.OK);
  })
  .catch(async (error) => {
    if (!(error instanceof StopProbe)) {
      console.log(`PROBE FAIL error inesperado: ${error.stack ?? error.message ?? error}`);
    }
    await cleanupOnce();
    process.exit(error instanceof StopProbe ? error.code : EXIT.ASSERTION_FAILED);
  });
