// Verificación visual de F-019. La ejecuta `bash .agent/verify.sh F-019
// --visual` con la app ya levantada; $VISUAL_BASE_URL apunta a ella y
// $VISUAL_SHOTS es la carpeta donde dejar las capturas.
//
// Traduce los pasos V7-V16 de `.agent/specs/F-019/design.md` § «Verificación
// visual» — los únicos que necesitan navegador (V1-V6 los cubre
// `scripts/renegotiate-order.mjs` sobre HTML plano, vía `--smoke`, y ya están
// en `tests.md`). sdd-designer dejó V7-V16 sin ejecutar porque las capturas
// no seguían al redimensionado; aquí cada viewport se abre en una `page`
// *nueva* (patrón de F-021/visual.mjs) en vez de reusar una con
// `setViewportSize`, que es justo lo que evita ese problema, y donde hace
// falta medir algo que no se ve en una imagen (contraste, foco, orden de
// lectura de un lector de pantalla) se lee del DOM/accessibility tree, no de
// la captura.
//
// Dos desviaciones deliberadas frente a la letra de design.md, ya
// documentadas en impl.md § Desviaciones y no algo que este guion deba
// re-litigar:
//   - El formulario de rechazar NO pide motivo (nada de las cuatro
//     `RadioCard` + `textarea` de DP3): un solo campo `decision`, por
//     architecture.md DA4 / ADR 0024 defensa 6. V8 se adapta a lo real.
//   - La redirección usa `?r=` (no `?respuesta=`) y seis valores, no ocho
//     (`aprobada · rechazada · conflicto · vencida · no-disponible ·
//     demasiados-intentos`) — `src/constants/orders.ts`
//     `ORDER_RESPONSE_OUTCOME`. V13/V15 miden los seis reales.
//
// Regla: cada aserción que no se cumpla imprime `VISUAL FAIL <qué>`. Eso es
// lo que el sensor busca para ponerle firma al error.

import "dotenv/config";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { Client } from "pg";

const BASE = process.env.VISUAL_BASE_URL ?? "http://localhost:3101";
const SHOTS = process.env.VISUAL_SHOTS ?? ".agent/runs/_libre/shots";

const MOVIL = { width: 360, height: 740 };
const TABLET = { width: 768, height: 900 };
const ESCRITORIO = { width: 1280, height: 800 };

let fails = 0;

function check(que, esperado, obtenido) {
  if (Object.is(esperado, obtenido)) {
    console.log(`  ok   ${que}`);
  } else {
    console.log(
      `VISUAL FAIL ${que} — esperaba ${JSON.stringify(esperado)}, obtuve ${JSON.stringify(obtenido)}`,
    );
    fails++;
  }
}

function checkTrue(que, obtenido) {
  check(que, true, Boolean(obtenido));
}

function fail(que) {
  console.log(`VISUAL FAIL ${que}`);
  fails++;
}

function note(que) {
  console.log(`  nota ${que}`);
}

const SIN_OVERLAY_DE_DEV = `
  nextjs-portal, [data-nextjs-dev-tools-button], [data-nextjs-toast] {
    display: none !important;
  }
`;

function vigilarConsola(page, donde) {
  page.on("console", (m) => {
    if (m.type() === "error") fail(`error de consola en ${donde}: ${m.text()}`);
  });
  page.on("pageerror", (e) => fail(`excepción en ${donde}: ${e.message}`));
}

async function prepararPagina(page, donde) {
  vigilarConsola(page, donde);
  await page.addStyleTag({ content: SIN_OVERLAY_DE_DEV });
}

async function shot(page, nombre) {
  await page.screenshot({ path: `${SHOTS}/${nombre}.png`, fullPage: true });
}

async function sinDesbordeHorizontal(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
}

/** Compone un color CSS (oklch/color-mix incluidos) contra el fondo real
 * pintando un canvas de 1x1 — ver F-010/visual.mjs V17, mismo motivo: Tailwind
 * v4 resuelve `bg-warning/15` con `color-mix()` y Chromium devuelve el color
 * computado en `oklab()`/`lab()`, nunca en `rgb()`. Se mide dentro del
 * navegador porque el canvas 2D normaliza cualquier sintaxis a RGBA. */
function medirContraste(selector) {
  function aRGBA(cssColor) {
    const lienzo = document.createElement("canvas");
    lienzo.width = 1;
    lienzo.height = 1;
    const ctx = lienzo.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = cssColor;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  }
  function componer(fg, bg) {
    return {
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
    };
  }
  function luminancia({ r, g, b }) {
    const canal = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
  }
  function razon(a, b) {
    const l1 = luminancia(a) + 0.05;
    const l2 = luminancia(b) + 0.05;
    return l1 > l2 ? l1 / l2 : l2 / l1;
  }
  const el = document.querySelector(selector);
  if (!el) return { encontrado: false };
  // Compone contra cada ancestro hasta <body>: un fondo translúcido
  // (bg-warning/15) necesita el color de detrás para dar un RGBA real.
  let bg = { r: 255, g: 255, b: 255, a: 0 };
  let nodo = el;
  const capas = [];
  while (nodo && nodo !== document.documentElement) {
    capas.unshift(getComputedStyle(nodo).backgroundColor);
    nodo = nodo.parentElement;
  }
  capas.unshift(getComputedStyle(document.body).backgroundColor);
  for (const capa of capas) {
    const c = aRGBA(capa);
    bg = c.a > 0 ? componer(c, bg) : bg;
  }
  const fg = aRGBA(getComputedStyle(el).color);
  return { encontrado: true, razon: razon(fg, bg) };
}

async function contraste(page, selector) {
  return page.evaluate(medirContraste, selector);
}

// ---------------------------------------------------------- fixtures ----

const db = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
await db.connect();

function mintToken(externalId) {
  const out = execFileSync("npx", ["tsx", "scripts/mint-sync-token.ts", externalId], {
    encoding: "utf8",
  });
  return out.trim().split("\n").at(-1);
}

const CRON_SECRET = process.env.CRON_SECRET;
const AUTH_TOKEN = mintToken("seed-negocio-1");

let phoneSeq = 0;
function uniquePhone() {
  phoneSeq += 1;
  return `+53${String(Date.now()).slice(-7)}${String(phoneSeq).padStart(2, "0")}`;
}

async function productsFor(slug, n) {
  // Filtrado a la moneda de la tienda: la base trae al menos un producto en
  // otra moneda (p.ej. "Cerveza Cristal" en USD sobre tienda-demo, que es
  // CUP), y proponer con líneas en monedas distintas es justo lo que R10
  // rechaza con 400 ("every line must be in the proposal's own currency") —
  // un fixture de prueba no puede mezclarlas.
  const { rows } = await db.query(
    `SELECT sp.id, sp."localName",
            COALESCE(sp."priceOverride", sp."syncedPrice") AS price,
            COALESCE(sp."priceOverrideCurrency", sp."syncedPriceCurrency") AS "currencyCode"
       FROM "StoreProduct" sp
       JOIN "Store" s ON s.id = sp."storeId"
       JOIN "Storefront" sf ON sf.id = s."storefrontId"
       JOIN "Business" b ON b.id = s."businessId"
      WHERE sf.slug = $1 AND sp."deletedAt" IS NULL AND sp.visible = true
        AND sp.availability != 'OUT_OF_STOCK'
        AND COALESCE(sp."priceOverrideCurrency", sp."syncedPriceCurrency") = b."baseCurrencyCode"
      ORDER BY sp."localName" LIMIT $2`,
    [slug, n],
  );
  if (rows.length < n)
    throw new Error(`${slug} no tiene ${n} productos disponibles en su propia moneda`);
  return rows;
}

async function orderRow(code) {
  const { rows } = await db.query(
    `SELECT id::text AS id, code, status, "currencyCode" FROM "Order" WHERE code = $1`,
    [code],
  );
  return rows[0] ?? null;
}

async function checkout(slug, { fulfillment = "PICKUP", deliveryAddress } = {}) {
  const [product] = await productsFor(slug, 1);
  const quoted = await (
    await fetch(`${BASE}/api/orders/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeSlug: slug, items: [{ storeProductId: product.id, qty: 1 }] }),
    })
  ).json();

  let total = quoted.subtotal;
  if (fulfillment === "DELIVERY") {
    const { rows } = await db.query(
      `SELECT s."deliveryFee" FROM "Store" s JOIN "Storefront" sf ON sf.id = s."storefrontId" WHERE sf.slug = $1`,
      [slug],
    );
    total = (Number(quoted.subtotal) + Number(rows[0].deliveryFee)).toFixed(2);
  }

  const body = {
    storeSlug: slug,
    items: [{ storeProductId: product.id, qty: 1 }],
    contact: { name: "Visual F-019", phone: uniquePhone() },
    fulfillment,
    ...(fulfillment === "DELIVERY"
      ? { deliveryAddress: deliveryAddress ?? "Calle de prueba 123" }
      : {}),
    expectedTotal: total,
  };
  const res = await fetch(`${BASE}/api/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (res.status !== 201)
    throw new Error(`checkout ${slug} falló: ${res.status} ${JSON.stringify(json)}`);
  const row = await orderRow(json.code);
  return { id: row.id, code: json.code, currencyCode: quoted.store.currencyCode };
}

async function pullOne(orderId) {
  await fetch(`${BASE}/api/internal/orders?since=${Number(orderId) - 1}&limit=1`, {
    headers: { authorization: `Bearer ${AUTH_TOKEN}` },
  });
}

async function proposeChange(orderId, payload) {
  const res = await fetch(`${BASE}/api/internal/orders/proposal`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${AUTH_TOKEN}` },
    body: JSON.stringify({ orderId: String(orderId), ...payload }),
  });
  const json = await res.json();
  if (res.status !== 200)
    throw new Error(`proponer sobre ${orderId} falló: ${JSON.stringify(json)}`);
  return json;
}

async function reportStatus(orderId, status) {
  const res = await fetch(`${BASE}/api/internal/orders/status`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${AUTH_TOKEN}` },
    body: JSON.stringify({ orderId: String(orderId), status }),
  });
  if (res.status !== 200)
    throw new Error(`reportar ${status} sobre ${orderId} falló: ${res.status}`);
}

async function setExpiresAt(code, deltaMs) {
  await db.query(
    `UPDATE "Order" SET "expiresAt" = now() + ($1 || ' milliseconds')::interval WHERE code = $2`,
    [String(deltaMs), code],
  );
}

/** Propone un cambio con `n` líneas sobre un pedido ya `checkout()`eado y
 * pulleado — el mismo "costo de envío" que dispara la mayoría de las
 * propuestas reales (spec.md § Problema), repartido en varias líneas para
 * V7/V9. */
async function proposeMultiLine(
  order,
  slug,
  n,
  { message = "El envío cuesta más de lo calculado." } = {},
) {
  const products = await productsFor(slug, n);
  const items = products.map((p, i) => ({
    storeProductId: p.id,
    name: p.localName,
    unitPrice: p.price.toString(),
    currencyCode: p.currencyCode,
    quantity: String(i + 1),
    lineTotal: (Number(p.price) * (i + 1)).toFixed(2),
  }));
  const subtotal = items.reduce((acc, it) => acc + Number(it.lineTotal), 0).toFixed(2);
  const total = (Number(subtotal) + 200).toFixed(2);
  await pullOne(order.id);
  return proposeChange(order.id, {
    currencyCode: order.currencyCode,
    subtotal,
    discountTotal: "0",
    deliveryFee: "200.00",
    total,
    message,
    items,
  });
}

note("sembrando pedidos de prueba…");

// F1 — seis líneas, plazo por defecto (~24h, tono normal) — V7, V9, V13(panel)
const f1 = await checkout("tienda-demo");
await proposeMultiLine(f1, "tienda-demo", 6);

// F2 — plazo a punto de vencer (< 15 min → text-danger) — V13
const f2 = await checkout("tienda-demo");
await proposeMultiLine(f2, "tienda-demo", 2, { message: null });
await setExpiresAt(f2.code, 10 * 60_000);

// F3 — plazo apretado (30-59 min → text-warning) — V13
const f3 = await checkout("tienda-demo");
await proposeMultiLine(f3, "tienda-demo", 2);
await setExpiresAt(f3.code, 45 * 60_000);

// F4 — se consume aprobando, sin JS — V10
const f4 = await checkout("tienda-demo");
await proposeMultiLine(f4, "tienda-demo", 1);

// F5 — se consume rechazando, sin JS — V10, V11, V12
const f5 = await checkout("tienda-demo");
await proposeMultiLine(f5, "tienda-demo", 1);

// F6 — branding verde de tienda-dos, propuesta viva — V14
const f6 = await checkout("tienda-dos", { fulfillment: "DELIVERY" });
await proposeMultiLine(f6, "tienda-dos", 2);

// F7 — envío, hasta IN_TRANSIT — criterio 9 en pantalla
const f7 = await checkout("tienda-dos", { fulfillment: "DELIVERY" });
await pullOne(f7.id);
await reportStatus(f7.id, "CONFIRMED");
await reportStatus(f7.id, "READY");

// F8 — retiro, hasta IN_TRANSIT — criterio 9 en pantalla
const f8 = await checkout("tienda-demo");
await pullOne(f8.id);
await reportStatus(f8.id, "CONFIRMED");
await reportStatus(f8.id, "READY");

note("pedidos listos — arrancando Chromium");

const browser = await chromium.launch();

try {
  // ============================================================ V7 =====
  // 360px, propuesta viva con seis líneas: sin scroll horizontal, el enlace
  // "Ver el cambio y responder" lleva al panel, los dos <summary> miden
  // ≥44px de alto.
  {
    const p = await browser.newPage({ viewport: MOVIL });
    await p.goto(`${BASE}/tienda-demo/pedido/${f1.code}`, { waitUntil: "networkidle" });
    await prepararPagina(p, `V7 pedido/${f1.code} @360`);
    checkTrue("V7 — sin scroll horizontal a 360px", !(await sinDesbordeHorizontal(p)));

    const enlace = p.locator('a[href="#propuesta"]', { hasText: "Ver el cambio y responder" });
    checkTrue("V7 — existe el enlace «Ver el cambio y responder»", (await enlace.count()) > 0);
    await enlace.click();
    await p.waitForTimeout(300); // el navegador desplaza el ancla, sin animación que esperar
    const panelTop = await p.locator("#propuesta").evaluate((el) => el.getBoundingClientRect().top);
    checkTrue(
      "V7 — al pulsar el enlace, el panel #propuesta queda visible (arriba del viewport)",
      panelTop < MOVIL.height && panelTop > -50,
    );

    const alturas = await p
      .locator("#propuesta details > summary")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    check("V7 — hay dos <summary> (aprobar/rechazar)", 2, alturas.length);
    checkTrue(
      "V7 — los dos <summary> miden ≥44px de alto",
      alturas.every((h) => h >= 44),
    );

    await shot(p, "V07-propuesta-360");
    await p.close();
  }

  // ============================================================ V8 =====
  // 360px: abrir "Rechazar el cambio" con teclado; el contenido queda
  // alcanzable sin que nada flote encima. Adaptado a lo real (impl.md): sin
  // motivos (DP3 no se construyó, single-field decision — architecture.md
  // DA4/ADR 0024 defensa 6), así que se comprueba el botón de confirmar, no
  // cuatro RadioCard.
  {
    const p = await browser.newPage({ viewport: MOVIL });
    await p.goto(`${BASE}/tienda-demo/pedido/${f1.code}`, { waitUntil: "networkidle" });
    await prepararPagina(p, `V8 pedido/${f1.code} @360`);

    const rechazarSummary = p.locator("summary", { hasText: "Rechazar el cambio" });
    await rechazarSummary.focus();
    checkTrue(
      "V8 — el <summary> «Rechazar el cambio» es alcanzable por teclado (foco)",
      await rechazarSummary.evaluate((el) => el === document.activeElement),
    );
    await p.keyboard.press("Enter"); // el navegador abre el <details>, sin JS
    const abierto = await p
      .locator("details", { has: p.locator("summary", { hasText: "Rechazar el cambio" }) })
      .evaluate((el) => el.open);
    checkTrue("V8 — Enter sobre el <summary> abre el <details> (nativo, sin JS)", abierto);

    const boton = p.getByRole("button", { name: /rechazar y cancelar el pedido/i });
    checkTrue("V8 — el botón de confirmar rechazo es visible tras abrir", await boton.isVisible());
    const cajaBoton = await boton.boundingBox();
    const cajaSummary = await rechazarSummary.boundingBox();
    checkTrue(
      "V8 — el botón queda DEBAJO del <summary> (crece hacia abajo, no flota encima)",
      cajaBoton && cajaSummary ? cajaBoton.y > cajaSummary.y : false,
    );
    await shot(p, "V08-rechazar-abierto-360");
    await p.close();
  }

  // ============================================================ V9 =====
  // 768px y 1280px: el <dl> de totales pasa a dos columnas, las dos
  // acciones siguen apiladas.
  for (const [nombre, viewport] of [
    ["768", TABLET],
    ["1280", ESCRITORIO],
  ]) {
    const p = await browser.newPage({ viewport });
    await p.goto(`${BASE}/tienda-demo/pedido/${f1.code}`, { waitUntil: "networkidle" });
    await prepararPagina(p, `V9 pedido/${f1.code} @${nombre}`);

    const columnas = await p
      .locator("#propuesta dl")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    checkTrue(
      `V9 @${nombre} — el <dl> de totales tiene 2 columnas (grid-template-columns con 2 tracks)`,
      columnas.split(" ").filter(Boolean).length >= 2,
    );

    const cajas = await p
      .locator("#propuesta details > summary")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
    checkTrue(
      `V9 @${nombre} — los dos <summary> siguen apilados (mismo x, distinto y)`,
      cajas.length === 2 && Math.abs(cajas[0].x - cajas[1].x) < 2 && cajas[1].y > cajas[0].y,
    );
    await shot(p, `V09-propuesta-${nombre}`);
    await p.close();
  }

  // =========================================================== V10 =====
  // SIN JavaScript: aprobar y rechazar funcionan de punta a punta,
  // incluida la vuelta con el banner. Es el paso que decide si esto cumple
  // R16 — y el único de los diez que un `curl` no puede poner a prueba de
  // verdad: `fetch`/`curl` no añaden cabecera `Origin` en un POST propio,
  // un navegador SÍ, siempre, la haya pedido quien la pida.
  const ctxSinJs = await browser.newContext({ viewport: MOVIL, javaScriptEnabled: false });

  async function responderSinJs(order, resumen, boton, etiqueta) {
    const p = await ctxSinJs.newPage();
    const respuestas = [];
    p.on("response", (r) => {
      if (r.request().method() === "POST") respuestas.push({ url: r.url(), status: r.status() });
    });
    await p.goto(`${BASE}/tienda-demo/pedido/${order.code}`, { waitUntil: "load" });
    await p.click(`summary >> text=${resumen}`);
    await p.click(`button:has-text("${boton}")`);
    await p.waitForTimeout(800);
    const post = respuestas.find((r) => r.url.endsWith("/respuesta"));
    if (post && post.status === 403) {
      const cuerpo = await p
        .locator("body")
        .innerText()
        .catch(() => "");
      fail(
        `V10 (${etiqueta}) — el POST sin JS a .../respuesta dio 403, NO el 303 que R16 promete ` +
          `(cuerpo: ${cuerpo.slice(0, 120)}) — ver "Hallazgo" en tests.md, isCrossOrigin() en ` +
          `src/app/[slug]/pedido/[code]/respuesta/route.ts`,
      );
      await p.close();
      return { ok: false, page: null };
    }
    const bannerVisible = await p
      .locator("#respuesta")
      .isVisible()
      .catch(() => false);
    checkTrue(
      `V10 (${etiqueta}) — tras responder sin JS, el banner del resultado aparece`,
      bannerVisible,
    );
    return { ok: bannerVisible, page: p };
  }

  const aprobado = await responderSinJs(f4, "Aprobar el cambio", "acepto pagar", "aprobar");
  if (aprobado.ok) {
    const estado = await orderRow(f4.code);
    check("V10 (aprobar) — la fila queda CONFIRMED", "CONFIRMED", estado?.status);
    await shot(aprobado.page, "V10-aprobado-sin-js");
    await aprobado.page.close();
  }

  const rechazado = await responderSinJs(
    f5,
    "Rechazar el cambio",
    "rechazar y cancelar",
    "rechazar",
  );
  if (rechazado.ok) {
    const estado = await orderRow(f5.code);
    check("V10 (rechazar) — la fila queda CANCELLED", "CANCELLED", estado?.status);
    await shot(rechazado.page, "V10-rechazado-sin-js");
  }

  // =========================================================== V11 =====
  // Recargar (F5) tras responder: no debe aparecer el diálogo nativo de
  // "¿reenviar formulario?" — depende de que V10 haya llegado al 303 (si no,
  // no hay nada que recargar de forma significativa, y se anota el motivo).
  if (rechazado.ok) {
    const p = rechazado.page;
    let dialogo = false;
    p.on("dialog", async (d) => {
      dialogo = true;
      await d.dismiss();
    });
    await p.reload({ waitUntil: "load" });
    checkTrue("V11 — recargar tras responder NO abre el diálogo de reenviar formulario", !dialogo);
    const sigueBanner = await p.locator("#respuesta").isVisible();
    checkTrue("V11 — el banner sigue presente tras recargar", sigueBanner);
    await p.close();
  } else {
    note(
      "V11 — omitido: depende de que V10 (rechazar) haya llegado al 303, y no llegó (ver V10 arriba)",
    );
  }

  // =========================================================== V12 =====
  // El foco tras responder está en el banner (ancla + tabindex=-1, sin una
  // línea de JS); pulsar Tab una vez lleva al primer enlace del CONTENIDO,
  // no a la cabecera (Carrito/Cuenta).
  {
    // Reproducido con JavaScript habilitado (el foco por fragmento de URL es
    // comportamiento nativo del navegador, no depende de JS) para poder usar
    // el mismo pedido F5 ya respondido sin depender de otra vez del 303.
    const p = await browser.newPage({ viewport: MOVIL });
    await p.goto(`${BASE}/tienda-demo/pedido/${f5.code}?r=rechazada#respuesta`, {
      waitUntil: "networkidle",
    });
    await prepararPagina(p, `V12 pedido/${f5.code}?r=rechazada`);
    const activoInicial = await p.evaluate(() => document.activeElement?.id ?? null);
    check(
      "V12 — al llegar por el ancla, el foco ya está en #respuesta",
      "respuesta",
      activoInicial,
    );

    await p.keyboard.press("Tab");
    const enCabecera = await p.evaluate(
      () =>
        !!document.activeElement &&
        !!document.querySelector("header")?.contains(document.activeElement),
    );
    checkTrue("V12 — tras un Tab, el foco NO volvió a la cabecera (Carrito/Cuenta)", !enCabecera);
    const esEnlaceDeContenido = await p.evaluate(() => document.activeElement?.tagName === "A");
    checkTrue("V12 — tras un Tab, el foco cayó en un <a> del contenido", esEnlaceDeContenido);
    await p.close();
  }
  await ctxSinJs.close();

  // =========================================================== V13 =====
  // Contraste ≥4.5:1 en claro y en oscuro: el cuerpo del panel, los seis
  // banners de resultado (adaptado: 6 valores reales, no los 8 de design.md
  // — ver cabecera) y el plazo en text-warning/text-danger.
  for (const modo of ["light", "dark"]) {
    const p = await browser.newPage({ viewport: MOVIL, colorScheme: modo });
    await p.goto(`${BASE}/tienda-demo/pedido/${f1.code}`, { waitUntil: "networkidle" });
    await prepararPagina(p, `V13 panel ${modo}`);
    const panel = await contraste(p, "#propuesta h2");
    checkTrue(
      `V13 (${modo}) — título del panel contrasta ≥4.5:1`,
      panel.encontrado && panel.razon >= 4.5,
    );
    const mensaje = await contraste(p, "#propuesta blockquote");
    checkTrue(
      `V13 (${modo}) — cita del mensaje de la tienda contrasta ≥4.5:1`,
      mensaje.encontrado && mensaje.razon >= 4.5,
    );
    await shot(p, `V13-panel-${modo}`);
    await p.close();

    for (const [valor, tono] of [
      ["aprobada", "positive"],
      ["rechazada", "muted"],
      ["conflicto", "warning"],
      ["vencida", "danger"],
      ["no-disponible", "danger"],
      ["demasiados-intentos", "warning"],
    ]) {
      const pb = await browser.newPage({ viewport: MOVIL, colorScheme: modo });
      await pb.goto(`${BASE}/tienda-demo/pedido/${f1.code}?r=${valor}`, {
        waitUntil: "networkidle",
      });
      await prepararPagina(pb, `V13 banner ${valor} ${modo}`);
      const c = await contraste(pb, "#respuesta [role]");
      checkTrue(
        `V13 (${modo}) — banner ?r=${valor} (tone=${tono}) contrasta ≥4.5:1`,
        c.encontrado && c.razon >= 4.5,
      );
      await pb.close();
    }

    // El plazo, en las dos franjas de tono (text-warning / text-danger).
    const pDanger = await browser.newPage({ viewport: MOVIL, colorScheme: modo });
    await pDanger.goto(`${BASE}/tienda-demo/pedido/${f2.code}`, { waitUntil: "networkidle" });
    await prepararPagina(pDanger, `V13 plazo-danger ${modo}`);
    const plazoTexto = await pDanger.locator("#propuesta time").innerText();
    checkTrue(
      `V13 (${modo}) — con <15min el plazo dice "pocos minutos" (tono danger)`,
      plazoTexto.includes("pocos minutos"),
    );
    const cDanger = await contraste(pDanger, "#propuesta time");
    checkTrue(
      `V13 (${modo}) — plazo en text-danger contrasta ≥4.5:1`,
      cDanger.encontrado && cDanger.razon >= 4.5,
    );
    await pDanger.close();

    const pWarn = await browser.newPage({ viewport: MOVIL, colorScheme: modo });
    await pWarn.goto(`${BASE}/tienda-demo/pedido/${f3.code}`, { waitUntil: "networkidle" });
    await prepararPagina(pWarn, `V13 plazo-warning ${modo}`);
    const cWarn = await contraste(pWarn, "#propuesta time");
    checkTrue(
      `V13 (${modo}) — plazo en text-warning contrasta ≥4.5:1`,
      cWarn.encontrado && cWarn.razon >= 4.5,
    );
    await pWarn.close();

    // La insignia de estado — "Esperando tu respuesta" es tone=warning y
    // nueva de este feature (design.md § Tokens y tema la incluye).
    const pBadge = await browser.newPage({ viewport: MOVIL, colorScheme: modo });
    await pBadge.goto(`${BASE}/tienda-demo/pedido/${f1.code}`, { waitUntil: "networkidle" });
    await prepararPagina(pBadge, `V13 insignia ${modo}`);
    const cBadge = await contraste(pBadge, "span.text-warning");
    if (cBadge.encontrado) {
      check(
        `V13 (${modo}) — insignia "Esperando tu respuesta" (tone=warning) contrasta ≥4.5:1 — riesgo PRE-EXISTENTE del Badge, no nuevo de F-019`,
        true,
        cBadge.razon >= 4.5,
      );
    } else {
      fail(`V13 (${modo}) — no se encontró la insignia tone=warning para medir`);
    }
    await pBadge.close();
  }

  // =========================================================== V14 =====
  // Branding: la misma propuesta en tienda-dos (verde, radius: round).
  {
    const p = await browser.newPage({ viewport: MOVIL });
    await p.goto(`${BASE}/tienda-dos/pedido/${f6.code}`, { waitUntil: "networkidle" });
    await prepararPagina(p, `V14 pedido/${f6.code}`);
    const boton = p.getByRole("button", { name: /acepto pagar/i });
    await p.locator("summary", { hasText: "Aprobar el cambio" }).click();
    // getComputedStyle en Chromium puede devolver el color en la sintaxis
    // original de la hoja de estilos (aquí `oklch(0.62 0.17 145)`, no
    // `rgb()`) — un regex ingenuo sobre "todos los números" leyó L/C/H como
    // si fueran R/G/B y comparó mal (0.17 no es "mayor que" nada). Se
    // normaliza a RGB de verdad pintando un canvas de 1x1, la misma técnica
    // que `medirContraste`.
    const colorBoton = await boton.evaluate((el) => {
      const lienzo = document.createElement("canvas");
      lienzo.width = 1;
      lienzo.height = 1;
      const ctx = lienzo.getContext("2d", { willReadFrequently: true });
      ctx.fillStyle = getComputedStyle(el).backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b };
    });
    checkTrue(
      "V14 — el botón de aprobar se pinta con la marca verde de tienda-dos (canal G domina en RGB)",
      colorBoton.g > colorBoton.r && colorBoton.g > colorBoton.b,
    );
    const radio = await p.locator("#propuesta").evaluate((el) => getComputedStyle(el).borderRadius);
    checkTrue(
      "V14 — la tarjeta del panel hereda radius:round (border-radius > 0)",
      parseFloat(radio) > 0,
    );
    const totalTexto = await p.locator("#propuesta dl dd").first().innerText();
    checkTrue(
      "V14 — el total sigue legible (no vacío) con la marca de tienda-dos",
      totalTexto.trim().length > 0,
    );
    await shot(p, "V14-branding-tienda-dos");
    await p.close();
  }

  // =========================================================== V15 =====
  // Oscuro: la tira warning, la insignia "Cancelado: no respondiste a
  // tiempo" y la cita del mensaje — capturas, para inspección visual además
  // de la medición numérica que ya hace V13.
  {
    const p = await browser.newPage({ viewport: MOVIL, colorScheme: "dark" });
    await p.goto(`${BASE}/tienda-demo/pedido/${f1.code}`, { waitUntil: "networkidle" });
    await prepararPagina(p, `V15 tira+cita oscuro`);
    await shot(p, "V15-tira-y-cita-oscuro");
    await p.close();

    // "Cancelado: no respondiste a tiempo" exige un pedido EXPIRY real: se
    // sacrifica F2 (ya usado para medir el plazo-danger en V13, no para
    // aprobar/rechazar) forzándolo vencido y corriendo el cron.
    await setExpiresAt(f2.code, -3_600_000);
    const cronRes = await fetch(`${BASE}/api/crons/expire-proposals`, {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    checkTrue("V15 — el cron de vencimiento respondió 200", cronRes.status === 200);
    const p2 = await browser.newPage({ viewport: MOVIL, colorScheme: "dark" });
    await p2.goto(`${BASE}/tienda-demo/pedido/${f2.code}`, { waitUntil: "networkidle" });
    await prepararPagina(p2, `V15 insignia EXPIRY oscuro`);
    const textoInsignia = await p2
      .locator("span")
      .filter({ hasText: "no respondiste a tiempo" })
      .count();
    checkTrue(
      'V15 — la insignia "Cancelado: no respondiste a tiempo" aparece en oscuro',
      textoInsignia > 0,
    );
    await shot(p2, "V15-insignia-expiry-oscuro");
    await p2.close();
  }

  // =========================================================== V16 =====
  // Lector de pantalla: sin VoiceOver real (headless), se lee el mismo
  // árbol de accesibilidad que un lector consume — `locator.ariaSnapshot()`
  // expone exactamente el nombre accesible y la estructura role-por-role que
  // Chromium calcula, que es la fuente que VoiceOver/NVDA anuncian.
  {
    const p = await browser.newPage({ viewport: MOVIL });
    await p.goto(`${BASE}/tienda-demo/pedido/${f1.code}`, { waitUntil: "networkidle" });
    await prepararPagina(p, `V16 pedido/${f1.code}`);

    checkTrue(
      "V16 — se entra al panel por landmark (section con nombre accesible)",
      (await p.locator('section[aria-labelledby="propuesta-titulo"]').count()) > 0,
    );

    const snapshot = await p.locator("#propuesta").ariaSnapshot();
    const idxActual = snapshot.indexOf("Total actual");
    const idxPropuesto = snapshot.indexOf("Total propuesto");
    const idxDiferencia = snapshot.indexOf("Diferencia");
    checkTrue(
      'V16 — el orden de lectura es "Total actual" → "Total propuesto" → "Diferencia"',
      idxActual >= 0 && idxActual < idxPropuesto && idxPropuesto < idxDiferencia,
    );
    checkTrue(
      'V16 — la diferencia se anuncia con la palabra "más" (no solo el signo)',
      /más/.test(snapshot),
    );

    // Estado expandido: un <details> cerrado no expone su contenido al árbol
    // de accesibilidad; al abrirlo (clic real, sin aria-expanded a mano) el
    // botón con su importe se vuelve anunciable — comprobado leyendo el
    // árbol, no una captura.
    const aprobarDetails = p.locator("details", {
      has: p.locator("summary", { hasText: "Aprobar el cambio" }),
    });
    const cerradoSnap = await aprobarDetails.ariaSnapshot();
    checkTrue(
      "V16 — cerrado, el <details> de aprobar NO expone el botón (el lector lo anuncia colapsado)",
      !/acepto pagar/i.test(cerradoSnap),
    );
    await aprobarDetails.locator("summary").click();
    const abiertoSnap = await aprobarDetails.ariaSnapshot();
    checkTrue(
      "V16 — abierto, el botón se anuncia CON el importe dentro de su nombre accesible",
      /acepto pagar \$[\d.,]+/i.test(abiertoSnap),
    );
    await shot(p, "V16-lector-de-pantalla");
    await p.close();
  }

  // ================================================ criterio 9 en pantalla
  // Reportar IN_TRANSIT deja copia propia, distinta de READY — comparando
  // capturas/HTML antes y después, no leyendo el componente (ya lo hace
  // scripts/renegotiate-order.mjs por texto; aquí además queda la captura).
  {
    const p = await browser.newPage({ viewport: MOVIL });
    await p.goto(`${BASE}/tienda-dos/pedido/${f7.code}`, { waitUntil: "networkidle" });
    await prepararPagina(p, `criterio9 envío antes`);
    const antes = await p.locator("body").innerText();
    await shot(p, "criterio9-envio-antes-READY");
    await reportStatus(f7.id, "IN_TRANSIT");
    await p.reload({ waitUntil: "networkidle" });
    const despues = await p.locator("body").innerText();
    checkTrue("criterio 9 (envío) — 'En camino' NO estaba antes", !antes.includes("En camino"));
    checkTrue("criterio 9 (envío) — 'En camino' SÍ está después", despues.includes("En camino"));
    await shot(p, "criterio9-envio-despues-IN_TRANSIT");
    await p.close();

    const p2 = await browser.newPage({ viewport: MOVIL });
    await p2.goto(`${BASE}/tienda-demo/pedido/${f8.code}`, { waitUntil: "networkidle" });
    await prepararPagina(p2, `criterio9 retiro antes`);
    const antes2 = await p2.locator("body").innerText();
    await shot(p2, "criterio9-retiro-antes-READY");
    await reportStatus(f8.id, "IN_TRANSIT");
    await p2.reload({ waitUntil: "networkidle" });
    const despues2 = await p2.locator("body").innerText();
    checkTrue(
      "criterio 9 (retiro) — 'lo puso en camino' NO estaba antes",
      !antes2.includes("lo puso en camino"),
    );
    checkTrue(
      "criterio 9 (retiro) — 'lo puso en camino' SÍ está después",
      despues2.includes("lo puso en camino"),
    );
    checkTrue(
      "criterio 9 — las dos copias (envío/retiro) son DISTINTAS entre sí",
      despues.includes("En camino") && !despues2.includes("En camino"),
    );
    await shot(p2, "criterio9-retiro-despues-IN_TRANSIT");
    await p2.close();
  }
} catch (e) {
  fail(`el guion visual se rompió: ${e.stack ?? e.message}`);
} finally {
  await browser.close();
  await db.end();
}

console.log(`\n${fails} aserciones fallidas`);
process.exit(fails === 0 ? 0 : 1);
