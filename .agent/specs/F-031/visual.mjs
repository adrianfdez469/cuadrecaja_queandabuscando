// Verificación visual de F-031 (envío cotizado al gestionar). La ejecuta
// `bash .agent/verify.sh F-031 --visual` con la app ya levantada;
// $VISUAL_BASE_URL apunta a ella, $VISUAL_SHOTS es la carpeta de capturas y
// $VISUAL_TRACES la carpeta de traces de Playwright.
//
// Por qué existe: `sdd.sh done` lo exige — un feature con `design.md` en
// `listo` no cierra sin este guion, aunque los doce criterios ya estén
// verificados con curl y jsdom (tests.md los cubre así, con razón: I10b dice
// que "el HTML del checkout" es DOM renderizado, no la respuesta del
// servidor). Lo que curl no puede afirmar es lo que design.md fijó cadena a
// cadena y clase a clase: que la coletilla "más el envío por confirmar" vive
// en texto normal y NO en la letra chica que SP4 rechazó, que la fila de
// envío aparece/desaparece según la MODALIDAD del pedido (no según si el
// componente completo hidrata sin reventar), y que nada de esto se rompe a
// 320px. Sigue el patrón de .agent/specs/F-019/visual.mjs (hermano: mismo
// bucle de propuesta, misma página de pedido) y de
// .agent/templates/visual.mjs.
//
// Cinco pasos, los que curl no puede ver (mínimo pedido por el orquestador):
//   V1 — checkout en modo cotizado: el radio de domicilio sin dígitos, y al
//        elegirlo el resumen dice "Por confirmar" / "Total parcial" con la
//        coletilla PEGADA a la cifra, no en `note` (text-fg-muted text-xs).
//   V2 — página del pedido sin cotizar: la fila de envío está PRESENTE
//        (antes de F-031 se ocultaba al valer cero — I4 de spec.md).
//   V3 — retiro en la misma tienda cotizada: la fila de envío está AUSENTE
//        y el total es firme desde el primer momento (E8).
//   V4 — la transición: con la propuesta viva, el titular y los tres `dt`
//        cambian de "Total actual/propuesto/Diferencia" a "Total sin el
//        envío/con el envío/El envío", y el envío pasa de "por confirmar" a
//        la cifra en la tabla nueva, mientras la tabla plegada sigue
//        diciendo "Por confirmar" (I3, I4).
//   V5 — 320px: ni el checkout ni la página del pedido hacen scroll
//        horizontal con "Por confirmar"/"Total parcial" en pantalla.
//
// Fixture: tienda-demo (WHATSAPP, sin envío en el seed — I8 de spec.md), con
// el modo cotizado activado POR SQL (R8: F-032, que lo trae desde
// cuadrecaja, no existe todavía) y restaurado en un `finally` aunque una
// aserción falle. Producto con centavos != "00" (pickCentsProduct, DP1 de
// design.md/tests.md): evita que un total como "$1,000.00" produzca un
// falso positivo o negativo en cualquier aserción de cadena.
//
// Bearer: NO se acuña uno nuevo aquí. `npm run mint:token` ROTA el token del
// negocio en la Postgres COMPARTIDA (ficha
// mint-token-rota-el-token-en-bd-compartida.md) y esta misma sesión ya lo
// rotó una vez para scripts/quote-delivery-order.mjs — rotarlo de nuevo solo
// para este guion le daría un 401 gratuito a cualquier otra sesión que lo
// hubiera reacuñado mientras tanto. Se reutiliza `QAB_BEARER_TOKEN` si está
// exportado (falla con un mensaje claro si no, en vez de acuñar en
// silencio); una corrida futura sin ese valor exportado puede acuñar el
// suyo — es la misma decisión que ya toman renegotiate-order.mjs y
// quote-delivery-order.mjs con `--token=`.
//
// Regla: cada aserción que no se cumpla imprime `VISUAL FAIL <qué>`. Eso es
// lo que el sensor busca para ponerle firma al error.

import "dotenv/config";
import { chromium } from "playwright";
import { Client } from "pg";

const BASE = process.env.VISUAL_BASE_URL ?? "http://localhost:3101";
const SHOTS = process.env.VISUAL_SHOTS ?? ".agent/runs/_libre/shots";
const TRACES = process.env.VISUAL_TRACES ?? ".agent/runs/_libre/traces";
const STORE = "tienda-demo";

const MOVIL = { width: 360, height: 740 };
const ANCHO_320 = { width: 320, height: 740 };

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

async function paso(nombre, fn) {
  console.log(`\n--- ${nombre} ---`);
  try {
    await fn();
  } catch (e) {
    fail(`${nombre} — el paso se rompió: ${e.message}`);
  }
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

// ------------------------------------------------------------ lectura del DOM ----
// Se lee el DOM con `evaluate()` en vez de encadenar locators de Playwright
// porque OrderSummary (checkout) y OrderLinesTable (página del pedido)
// comparten la MISMA forma —`<span>etiqueta</span><span>valor</span>` dentro
// de un `div.flex.justify-between`, con la coletilla como `<p>` hermano del
// contenedor— así que una sola función sirve para las dos superficies, sin
// asumir el texto exacto de la cifra (que cambia con el producto elegido).

function leerFilaPorEtiqueta(etiqueta) {
  const spans = Array.from(document.querySelectorAll("span"));
  const label = spans.find((el) => el.textContent?.trim() === etiqueta);
  if (!label) return null;
  const fila = label.parentElement;
  const valor = fila?.querySelector("span:last-child")?.textContent?.trim() ?? null;
  return { existe: true, valor };
}

async function filaEnvio(page) {
  return page.evaluate(leerFilaPorEtiqueta, "Envío");
}

function leerBloqueTotal() {
  const spans = Array.from(document.querySelectorAll("span"));
  const captionEl = spans.find(
    (el) => el.textContent?.trim() === "Total" || el.textContent?.trim() === "Total parcial",
  );
  if (!captionEl) return null;
  const fila = captionEl.parentElement;
  const monto = fila?.querySelector("span:last-child")?.textContent?.trim() ?? null;
  const contenedor = fila?.parentElement ?? null;
  const notaEl = contenedor
    ? Array.from(contenedor.querySelectorAll("p")).find((p) => p.textContent?.trim())
    : null;
  return {
    etiqueta: captionEl.textContent?.trim() ?? null,
    monto,
    coletilla: notaEl?.textContent?.trim() ?? null,
    coletillaClase: notaEl?.className ?? null,
  };
}

async function bloqueTotal(page) {
  return page.evaluate(leerBloqueTotal);
}

function leerDescripcionRadioDomicilio() {
  const labels = Array.from(document.querySelectorAll("label"));
  const domicilio = labels.find((l) => l.textContent?.includes("Envío a domicilio"));
  if (!domicilio) return null;
  const desc = Array.from(domicilio.querySelectorAll("span")).find((s) =>
    s.className.includes("text-fg-muted"),
  );
  return desc?.textContent?.trim() ?? null;
}

async function descripcionRadioDomicilio(page) {
  return page.evaluate(leerDescripcionRadioDomicilio);
}

function leerDtsPropuesta() {
  const dts = Array.from(document.querySelectorAll("dt")).map((dt) => dt.textContent?.trim());
  return dts;
}

async function dtsPropuesta(page) {
  return page.evaluate(leerDtsPropuesta);
}

// ---------------------------------------------------------------- fixtures ----

const db = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
await db.connect();

// No se acuña un token nuevo aquí — ver el comentario de cabecera.
const AUTH_TOKEN = process.env.QAB_BEARER_TOKEN;
if (!AUTH_TOKEN) {
  console.error(
    "FAIL  QAB_BEARER_TOKEN no está exportado. Este guion NO acuña uno nuevo a propósito " +
      "(ficha mint-token-rota-el-token-en-bd-compartida.md): exporta el que ya tengas para " +
      "seed-negocio-1, o si de verdad no hay ninguno, `npm run mint:token -- seed-negocio-1` " +
      "y avisa — rota el de esa Postgres compartida.",
  );
  await db.end();
  process.exit(1);
}

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

async function activateQuotedMode(slug) {
  const row = await storeRow(slug);
  await db.query(
    `UPDATE "Store" SET "deliveryEnabled" = true, "deliveryFeeMode" = 'QUOTED_PER_ORDER' WHERE id = $1`,
    [row.id],
  );
}

async function restoreStore(slug, original) {
  await db.query(
    `UPDATE "Store" SET "deliveryEnabled" = $2, "deliveryFeeMode" = $3, "deliveryFee" = $4 WHERE id = $1`,
    [original.id, original.deliveryEnabled, original.deliveryFeeMode, original.deliveryFee],
  );
}

async function quote(slug, items) {
  const response = await fetch(`${BASE}/api/orders/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ storeSlug: slug, items }),
  });
  return response.json();
}

/** DP1: el mismo criterio que scripts/quote-delivery-order.mjs — busca en
 *  vivo el primer producto orderable cuya conversión deja centavos != "00",
 *  y de paso trae su `slug` público para poder visitar `/tienda-demo/p/<slug>`
 *  con el navegador (V1 pasa por la UI real, no por la API). */
async function pickCentsProduct(slug) {
  const { rows } = await db.query(
    `SELECT sp.id, sp.slug
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
      return row;
    }
  }
  throw new Error(`Ningún producto orderable de "${slug}" da centavos != "00" (DP1)`);
}

let phoneSeq = 0;
function uniquePhone() {
  phoneSeq += 1;
  return `+53${String(Date.now()).slice(-7)}${String(phoneSeq).padStart(2, "0")}`;
}

async function orderRow(code) {
  const { rows } = await db.query(
    `SELECT id::text AS id, code, status, "currencyCode", subtotal, "deliveryFee"
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

/** Siembra un pedido por la API pública (mismo camino que un comprador, sin
 *  cookie) — usado para V2-V4, que verifican la PÁGINA del pedido, no el
 *  checkout (eso ya lo hace V1 por la UI real). */
async function crearPedido(productId, { fulfillment = "PICKUP" } = {}) {
  const items = [{ storeProductId: productId, qty: 1 }];
  const quoted = await quote(STORE, items);
  const body = {
    storeSlug: STORE,
    items,
    contact: { name: "Visual F-031", phone: uniquePhone() },
    fulfillment,
    ...(fulfillment === "DELIVERY" ? { deliveryAddress: "Calle 23 esq. L, Vedado" } : {}),
    expectedTotal: quoted.subtotal,
  };
  const response = await fetch(`${BASE}/api/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  if (response.status !== 201) {
    throw new Error(`No se pudo sembrar un pedido: ${response.status} ${JSON.stringify(json)}`);
  }
  const row = await orderRow(json.code);
  createdOrderIds.push(row.id);
  return { id: row.id, code: json.code };
}

async function pull(since, limit = 1) {
  await fetch(`${BASE}/api/internal/orders?since=${since}&limit=${limit}`, {
    headers: { authorization: `Bearer ${AUTH_TOKEN}` },
  });
}

async function cotizarEnvio(order, deliveryFee) {
  const row = await orderRow(order.code);
  const items = await orderItemRows(row.id);
  const total = (Number(row.subtotal) + Number(deliveryFee)).toFixed(2);
  const response = await fetch(`${BASE}/api/internal/orders/proposal`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${AUTH_TOKEN}` },
    body: JSON.stringify({
      orderId: row.id,
      currencyCode: row.currencyCode,
      subtotal: row.subtotal,
      discountTotal: "0",
      deliveryFee,
      total,
      message: "Costo de envío confirmado.",
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
  const json = await response.json().catch(() => null);
  if (response.status !== 200) {
    throw new Error(`Cotizar falló: ${response.status} ${JSON.stringify(json)}`);
  }
  return json;
}

// --------------------------------------------------------------- corrida ----

const original = await storeRow(STORE);
await activateQuotedMode(STORE);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: MOVIL });
await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

try {
  const producto = await pickCentsProduct(STORE);

  // ---------------------------------------------------------------- V1 ----
  await paso("V1 — checkout en modo cotizado (360px)", async () => {
    const page = await context.newPage();
    await prepararPagina(page, "checkout");

    await page.goto(`${BASE}/${STORE}/p/${producto.slug}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Agregar al carrito$/ }).click();
    await page.waitForTimeout(200);

    await page.goto(`${BASE}/${STORE}/checkout`, { waitUntil: "networkidle" });
    await page.getByText("Costo por confirmar").waitFor();
    await shot(page, "V1a-checkout-retiro");

    const descripcion = await descripcionRadioDomicilio(page);
    check("el radio de domicilio dice 'Costo por confirmar'", "Costo por confirmar", descripcion);
    checkTrue(
      "la descripción del radio de domicilio NO contiene ningún dígito",
      descripcion && !/\d/.test(descripcion),
    );

    await page.getByRole("radio", { name: /Envío a domicilio/ }).click();
    await page.getByText("Por confirmar", { exact: true }).waitFor();

    const envio = await filaEnvio(page);
    check("la fila de envío del resumen dice 'Por confirmar'", "Por confirmar", envio?.valor);

    const total = await bloqueTotal(page);
    check("el total se nombra 'Total parcial'", "Total parcial", total?.etiqueta);
    checkTrue(
      "el total muestra una cifra, no 'Calculando…'",
      total?.monto && total.monto !== "Calculando…",
    );
    check(
      "la coletilla es, literal, 'más el envío por confirmar'",
      "más el envío por confirmar",
      total?.coletilla,
    );
    // SP4/design.md § 1: la coletilla va `text-fg text-sm`, PEGADA a la
    // cifra — nunca en `note` (`text-fg-muted text-xs`), que es la letra
    // chica que SP4 rechazó explícitamente ("Desde $1.000,00").
    checkTrue(
      "la coletilla NO está en la letra chica (no lleva text-fg-muted ni text-xs)",
      total?.coletillaClase &&
        !total.coletillaClase.includes("text-fg-muted") &&
        !total.coletillaClase.includes("text-xs"),
    );
    checkTrue(
      "la coletilla lleva las clases de texto normal (text-fg y text-sm)",
      total?.coletillaClase &&
        total.coletillaClase.includes("text-fg") &&
        total.coletillaClase.includes("text-sm"),
    );

    await shot(page, "V1b-checkout-domicilio-cotizado");
    await page.close();
  });

  // ---------------------------------------------------------------- V2 ----
  let pendiente;
  await paso("V2 — página del pedido sin cotizar (360px)", async () => {
    pendiente = await crearPedido(producto.id, { fulfillment: "DELIVERY" });
    const page = await context.newPage();
    await prepararPagina(page, "pedido sin cotizar");
    await page.goto(`${BASE}/${STORE}/pedido/${pendiente.code}`, { waitUntil: "networkidle" });

    const envio = await filaEnvio(page);
    checkTrue(
      "la fila de envío está PRESENTE (I4: antes se ocultaba al valer cero)",
      envio?.existe,
    );
    check("la fila de envío dice 'Por confirmar'", "Por confirmar", envio?.valor);

    const total = await bloqueTotal(page);
    check("el total se nombra 'Total parcial'", "Total parcial", total?.etiqueta);
    check(
      "trae la coletilla 'más el envío por confirmar'",
      "más el envío por confirmar",
      total?.coletilla,
    );

    checkTrue("no hay scroll horizontal a 360px", !(await sinDesbordeHorizontal(page)));
    await shot(page, "V2-pedido-sin-cotizar");
    await page.close();
  });

  // ---------------------------------------------------------------- V3 ----
  let retiro;
  await paso("V3 — retiro en la misma tienda cotizada (360px)", async () => {
    retiro = await crearPedido(producto.id, { fulfillment: "PICKUP" });
    const page = await context.newPage();
    await prepararPagina(page, "pedido de retiro");
    await page.goto(`${BASE}/${STORE}/pedido/${retiro.code}`, { waitUntil: "networkidle" });

    const envio = await filaEnvio(page);
    check("la fila de envío está AUSENTE en un retiro (E8)", null, envio);

    const total = await bloqueTotal(page);
    check("el total es 'Total' (firme), no 'Total parcial'", "Total", total?.etiqueta);

    const contenido = await page.locator("body").innerText();
    checkTrue(
      "la página NO dice 'por confirmar' en ningún sitio",
      !contenido.toLowerCase().includes("por confirmar"),
    );

    await shot(page, "V3-retiro-firme");
    await page.close();
  });

  // ---------------------------------------------------------------- V4 ----
  await paso("V4 — la transición: la propuesta viva cambia el titular y los `dt`", async () => {
    await pull((BigInt(pendiente.id) - 1n).toString());
    await cotizarEnvio(pendiente, "180.75"); // centavos != 00 también aquí

    const page = await context.newPage();
    await prepararPagina(page, "pedido con propuesta viva");
    await page.goto(`${BASE}/${STORE}/pedido/${pendiente.code}`, { waitUntil: "networkidle" });

    const titular = await page.locator("text=La tienda ya calculó el envío").count();
    checkTrue("el titular dice 'La tienda ya calculó el envío' (no 'Total actual')", titular > 0);

    const dts = await dtsPropuesta(page);
    checkTrue("el dl trae 'Total sin el envío'", dts.includes("Total sin el envío"));
    checkTrue("el dl trae 'Total con el envío'", dts.includes("Total con el envío"));
    checkTrue("el dl trae 'El envío' (no 'Diferencia')", dts.includes("El envío"));
    checkTrue(
      "el dl NUNCA dice 'Total actual'/'Total propuesto'/'Diferencia'",
      !dts.includes("Total actual") &&
        !dts.includes("Total propuesto") &&
        !dts.includes("Diferencia"),
    );

    checkTrue(
      "el título de la tabla nueva es 'Tu pedido con el envío incluido'",
      (await page.locator("text=Tu pedido con el envío incluido").count()) > 0,
    );
    checkTrue(
      "la tabla plegada sigue diciendo 'Ver tu pedido sin el envío'",
      (await page.locator("text=Ver tu pedido sin el envío").count()) > 0,
    );

    // El envío YA es una cifra en la tabla nueva (arriba, sin desplegar) —
    // "por confirmar" solo debe quedar dentro del `<details>` plegado.
    const envioFilaVisible = await filaEnvio(page);
    checkTrue(
      "la fila de envío VISIBLE (tabla propuesta) ya es una cifra, no 'Por confirmar'",
      envioFilaVisible?.valor && envioFilaVisible.valor !== "Por confirmar",
    );

    await page.getByText("Ver tu pedido sin el envío").click();
    await page.waitForTimeout(150);
    const contenidoExpandido = await page.locator("body").innerText();
    checkTrue(
      "al desplegar, el pedido de ANTES sigue diciendo 'Por confirmar'",
      contenidoExpandido.includes("Por confirmar"),
    );

    await shot(page, "V4-transicion-propuesta-viva");
    await page.close();
  });

  // ---------------------------------------------------------------- V5 ----
  await paso("V5 — 320px: sin scroll horizontal, con la copia de F-031 en pantalla", async () => {
    // Contexto NUEVO a propósito (patrón de F-019/F-021 visual.mjs): el
    // carrito vive en localStorage, que un contexto nuevo no hereda del de
    // `context` — así que hay que volver a agregar el producto aquí, no solo
    // cambiar el viewport de una página ya abierta.
    const contexto320 = await browser.newContext({ viewport: ANCHO_320 });
    const page = await contexto320.newPage();
    await prepararPagina(page, "320px");

    await page.goto(`${BASE}/${STORE}/p/${producto.slug}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Agregar al carrito$/ }).click();
    await page.waitForTimeout(200);

    await page.goto(`${BASE}/${STORE}/checkout`, { waitUntil: "networkidle" });
    await page.getByRole("radio", { name: /Envío a domicilio/ }).click();
    await page.getByText("Por confirmar", { exact: true }).waitFor();
    checkTrue("checkout a 320px: sin scroll horizontal", !(await sinDesbordeHorizontal(page)));
    await shot(page, "V5a-checkout-320");

    await page.goto(`${BASE}/${STORE}/pedido/${pendiente.code}`, {
      waitUntil: "networkidle",
    });
    checkTrue(
      "página del pedido a 320px: sin scroll horizontal",
      !(await sinDesbordeHorizontal(page)),
    );
    await shot(page, "V5b-pedido-320");

    await page.close();
    await contexto320.close();
  });
} catch (e) {
  fail(`el guion visual se rompió: ${e.message}`);
} finally {
  await context.tracing.stop({ path: `${TRACES}/trace.zip` });
  await browser.close();

  if (createdOrderIds.length > 0) {
    await db.query(`DELETE FROM "Order" WHERE id = ANY($1::bigint[])`, [createdOrderIds]);
  }
  await restoreStore(STORE, original);
  await db.end();
}

console.log(`\n${fails} aserciones fallidas`);
process.exit(fails === 0 ? 0 : 1);
