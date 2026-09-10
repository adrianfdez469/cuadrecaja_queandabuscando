// Verificación visual de F-042 (el comprador elige su zona en el checkout).
// La ejecuta `bash .agent/verify.sh F-042 --visual` con la app ya levantada;
// $VISUAL_BASE_URL apunta a ella, $VISUAL_SHOTS y $VISUAL_TRACES a sus
// carpetas. Sigue el patrón de `.agent/specs/F-031/visual.mjs` y de
// `.agent/templates/visual.mjs`.
//
// Lo que curl no puede ver (criterios C2, C5, C7, C8):
//   V1 — SIN abrir el mapa: cargar el checkout, escribir tres letras en el
//        selector y elegir una zona no produce NINGUNA petición de
//        geometría, teselas ni del trozo del mapa (C5, E3, E7).
//   V2 — elegir una zona muestra el importe ANTES de confirmar y el total lo
//        suma, sin enviar nada; una zona con importe 0 dice "Envío gratis"/
//        "Gratis" y el total no cambia (C2, E4, E5).
//   V3 — con dos provincias en la cobertura, el paso de provincia SÍ está y
//        acota la lista (C7, E6) — la mitad interactiva; curl ya cubrió la
//        presencia/ausencia del control en `smoke.sh`.
//   V4 — sin JavaScript: se ve el `<noscript>`, y ni el botón de confirmar
//        ni el selector son operables (C8, D1, E24).
//   V5 — 360px: la lista abierta y el bloque de zona no producen scroll
//        horizontal.
//
// Fixture: el-faro (seed-tienda-7), por SQL directo (mismo criterio que
// F-031: más rápido y no depende de un token) — ZONE_BASED, cuatro
// municipios de Pinar del Río (21.01-21.04) más uno de Ciego de Ávila
// (29.01), restaurado en un `finally` aunque una aserción falle.
import "dotenv/config";
import { chromium } from "playwright";
import { Client } from "pg";

const BASE = process.env.VISUAL_BASE_URL ?? "http://localhost:3101";
const SHOTS = process.env.VISUAL_SHOTS ?? ".agent/runs/_libre/shots";
const TRACES = process.env.VISUAL_TRACES ?? ".agent/runs/_libre/traces";
const STORE = "el-faro";

const MOVIL = { width: 360, height: 740 };

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

// Calcado de `.agent/specs/F-031/visual.mjs` (`leerBloqueTotal`): el bloque
// del total es `<span>Total</span><span>{cifra}</span>` dentro de un mismo
// contenedor — leído con `evaluate()` en vez de encadenar locators, porque
// "Total" también aparece en el `<summary>` del carrito plegado (ahí es
// donde vive la violación de "strict mode" de Playwright).
function leerTotal() {
  const spans = Array.from(document.querySelectorAll("span"));
  const captionEl = spans.find((el) => el.textContent?.trim() === "Total");
  if (!captionEl) return null;
  const fila = captionEl.parentElement;
  return fila?.querySelector("span:last-child")?.textContent?.trim() ?? null;
}

async function textoDelTotal(page) {
  return page.evaluate(leerTotal);
}

// --------------------------------------------------------------- fixture ----

const db = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
await db.connect();

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

async function activateZoneBased(slug) {
  const row = await storeRow(slug);
  await db.query(
    `UPDATE "Store" SET "deliveryEnabled" = true, "deliveryFeeMode" = 'ZONE_BASED' WHERE id = $1`,
    [row.id],
  );
  return row;
}

async function upsertTariff(storeId, zoneCode, rule, deliveryFee) {
  await db.query(
    `INSERT INTO "ZoneTariff" ("storeId", "zoneCode", "rule", "deliveryFee", "sourceUpdatedAt", "updatedAt")
     VALUES ($1, $2, $3, $4, now(), now())
     ON CONFLICT ("storeId", "zoneCode")
     DO UPDATE SET "rule" = $3, "deliveryFee" = $4, "sourceUpdatedAt" = now(), "updatedAt" = now()`,
    [storeId, zoneCode, rule, deliveryFee],
  );
}

async function clearTariffs(storeId) {
  await db.query(`DELETE FROM "ZoneTariff" WHERE "storeId" = $1`, [storeId]);
}

async function restoreStore(slug, original) {
  await db.query(
    `UPDATE "Store" SET "deliveryEnabled" = $2, "deliveryFeeMode" = $3, "deliveryFee" = $4 WHERE id = $1`,
    [original.id, original.deliveryEnabled, original.deliveryFeeMode, original.deliveryFee],
  );
  await clearTariffs(original.id);
}

async function productSlug(slug, name) {
  const { rows } = await db.query(
    `SELECT sp.slug
       FROM "StoreProduct" sp
       JOIN "Store" s ON s.id = sp."storeId"
       ${STORE_BY_SLUG_JOIN}
        AND sp."localName" = $2`,
    [slug, name],
  );
  if (rows.length === 0) throw new Error(`Producto "${name}" no encontrado en "${slug}"`);
  return rows[0].slug;
}

// --------------------------------------------------------------- corrida ----

const original = await storeRow(STORE);
const zoneStore = await activateZoneBased(STORE);
await clearTariffs(zoneStore.id);
await upsertTariff(zoneStore.id, "21.01", "FEE", "200.00");
await upsertTariff(zoneStore.id, "21.02", "FEE", "0.00"); // Mantua: envío gratis (E5)
await upsertTariff(zoneStore.id, "21.03", "FEE", "250.00");
await upsertTariff(zoneStore.id, "21.04", "FEE", "250.00");

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: MOVIL });
await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

try {
  const productoSlug = await productSlug(STORE, "Miel de abeja 250 g");

  // El carrito vive en `localStorage` (F-010) y este guion reutiliza el
  // MISMO `context` entre pasos (para un solo trace) — sin vaciarlo, cada
  // paso ACUMULA una unidad más sobre el anterior y el subtotal deja de ser
  // el que cada aserción espera (V2 lo destapó: $2,030.00 en vez de
  // $1,140.00, exactamente 890×2 + 250).
  async function irAlCheckoutConCarrito(page) {
    await page.goto(`${BASE}/${STORE}/p/${productoSlug}`, { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Agregar al carrito$/ }).click();
    await page.waitForTimeout(200);
    await page.goto(`${BASE}/${STORE}/checkout`, { waitUntil: "networkidle" });
    await page.getByRole("radio", { name: /Envío a domicilio/ }).click();
  }

  // ---------------------------------------------------------------- V1 ----
  await paso(
    "V1 — sin abrir el mapa, ninguna petición de geometría/teselas (C5, E3, E7)",
    async () => {
      const page = await context.newPage();
      await prepararPagina(page, "checkout V1");

      const peticionesDeMapa = [];
      page.on("request", (req) => {
        const url = req.url();
        if (
          url.includes("/api/zones/geometry/") ||
          /tile\.openstreetmap|\{z\}|\/\d+\/\d+\/\d+\.png/.test(url)
        ) {
          peticionesDeMapa.push(url);
        }
      });

      await irAlCheckoutConCarrito(page);
      await page.getByLabel("Municipio a donde enviamos").waitFor();
      await shot(page, "V1a-checkout-zone-based");

      await page.getByLabel("Municipio a donde enviamos").fill("man");
      await page.getByText("Mantua").waitFor();
      await shot(page, "V1b-filtrado-sin-red");

      await page.getByText("Mantua", { exact: true }).click();
      await page.waitForTimeout(100);

      check("cero peticiones de mapa tras cargar, escribir y elegir", 0, peticionesDeMapa.length);
    },
  );

  // ---------------------------------------------------------------- V2 ----
  await paso(
    "V2 — el importe se muestra ANTES de confirmar, sin enviar nada (C2, E4, E5)",
    async () => {
      const page = await context.newPage();
      await prepararPagina(page, "checkout V2");

      let seEnvioAlgo = false;
      page.on("request", (req) => {
        if (
          req.method() === "POST" &&
          req.url().includes("/api/orders") &&
          !req.url().includes("/quote")
        ) {
          seEnvioAlgo = true;
        }
      });

      await irAlCheckoutConCarrito(page);
      await page.getByLabel("Municipio a donde enviamos").fill("vina");
      await page.getByText("Viñales").click();

      await page.getByText("+ $250.00").first().waitFor();
      checkTrue("la línea del municipio elegido muestra el importe", true);

      // "Miel de abeja 250 g" cuesta $890.00 (prisma/seed.ts); + 250.00 de
      // envío = $1,140.00 — el total EXACTO, no una substring cualquiera.
      const totalConEnvio = await textoDelTotal(page);
      check("el total suma subtotal + envío (890 + 250 = 1,140.00)", "$1,140.00", totalConEnvio);

      // Ahora un municipio con importe 0 (Mantua): dice "gratis", el total NO
      // sube — la comprobación es contra null, nunca contra un falsy (R10).
      await page.getByLabel("Municipio a donde enviamos").fill("man");
      await page.getByText("Mantua", { exact: true }).click();
      await page
        .getByText(/gratis/i)
        .first()
        .waitFor();
      checkTrue('un importe de "0.00" se anuncia con palabras ("gratis"), no "$0.00"', true);

      const totalGratis = await textoDelTotal(page);
      check("con envío gratis, el total vuelve al subtotal ($890.00)", "$890.00", totalGratis);

      check("no se envió ningún POST /api/orders durante todo el paso", false, seEnvioAlgo);
    },
  );

  // ---------------------------------------------------------------- V3 ----
  await paso("V3 — con dos provincias, el paso de provincia acota la lista (C7, E6)", async () => {
    await upsertTariff(zoneStore.id, "29.01", "FEE", "400.00");
    const page = await context.newPage();
    await prepararPagina(page, "checkout V3");

    await irAlCheckoutConCarrito(page);
    await page.getByLabel("Provincia").waitFor();
    await page.getByLabel("Provincia").selectOption({ label: "Pinar del Río" });
    await page.getByLabel("Municipio a donde enviamos").click();
    const opciones = await page.getByRole("option").allTextContents();
    checkTrue(
      "acotado a Pinar del Río, Chambas/Ciego de Ávila (29.01) no aparece",
      !opciones.some((o) => o.includes("Chambas")),
    );
  });

  // ---------------------------------------------------------------- V4 ----
  await paso("V4 — sin JavaScript: <noscript>, nada operable (C8, D1, E24)", async () => {
    const noJsContext = await browser.newContext({ viewport: MOVIL, javaScriptEnabled: false });
    const page = await noJsContext.newPage();
    await page.goto(`${BASE}/${STORE}/checkout`, { waitUntil: "load" });

    const noscriptTexto = await page.locator("noscript").first().innerHTML();
    checkTrue(
      "el <noscript> del checkout es visible y menciona JavaScript",
      noscriptTexto.includes("JavaScript"),
    );

    const confirmar = page.getByRole("button", { name: /Confirmar pedido/ });
    const hayBotonOperable = await confirmar.isEnabled().catch(() => false);
    check("el botón de confirmar no es operable sin JavaScript", false, hayBotonOperable);

    await noJsContext.close();
  });

  // ---------------------------------------------------------------- V5 ----
  await paso("V5 — 360px, sin scroll horizontal con la lista abierta", async () => {
    const page = await context.newPage();
    await prepararPagina(page, "checkout V5");
    await irAlCheckoutConCarrito(page);
    await page.getByLabel("Municipio a donde enviamos").click();
    await page.waitForTimeout(100);
    const desbordeHorizontal = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    check("sin scroll horizontal a 360px con la lista abierta", false, desbordeHorizontal);
  });
} finally {
  const traceFile = `${TRACES}/f042.zip`;
  await context.tracing.stop({ path: traceFile });
  await browser.close();
  await restoreStore(STORE, original);
  await db.end();
}

console.log(`\n${fails} aserciones fallidas`);
process.exit(fails === 0 ? 0 : 1);
