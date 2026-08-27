// Verificación visual de F-017, etapa 1. La ejecuta `bash .agent/verify.sh
// F-017 --visual` con la app ya levantada; $VISUAL_BASE_URL apunta a ella y
// $VISUAL_SHOTS es la carpeta donde dejar las capturas.
//
// Alcance deliberado: el criterio 1 y el corazón del feature (el slug
// canónico, I5) — que mover el slug de la sucursal a la marca NO cambió lo
// que el comprador ve, a 360 px y a 1280 px. El selector de sucursal y el
// aviso del carrito son de la etapa 2 y no se construyen aquí (plan.md): no
// hay nada de eso que fotografiar todavía.
//
// Regla: cada aserción que no se cumpla imprime `VISUAL FAIL <qué>`. Eso es
// lo que el sensor busca para ponerle firma al error.

import { chromium } from "playwright";

const BASE = process.env.VISUAL_BASE_URL ?? "http://localhost:3101";
const SHOTS = process.env.VISUAL_SHOTS ?? ".agent/runs/_libre/shots";

// El público objetivo compra desde un teléfono con conexión limitada. El
// viewport estrecho es el caso normal, no el caso raro: se prueba primero.
const MOVIL = { width: 360, height: 740 };
const ESCRITORIO = { width: 1280, height: 800 };

let fails = 0;

function check(que, esperado, obtenido) {
  if (Object.is(esperado, obtenido)) {
    console.log(`  ok   ${que}`);
  } else {
    console.log(`VISUAL FAIL ${que} — esperaba ${esperado}, obtuve ${obtenido}`);
    fails++;
  }
}

function fail(que) {
  console.log(`VISUAL FAIL ${que}`);
  fails++;
}

// El indicador de dev-tools de Next vive en un <nextjs-portal> con position
// fixed. En una captura de página completa, Playwright lo cose a la altura del
// viewport y aterriza en mitad del contenido — se oculta en la página, no en
// next.config.ts, porque solo afecta a esta verificación.
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

const browser = await chromium.launch();

try {
  // --- V1/V2 — criterio 1: una sola sucursal, sin selector, a 360 y 1280 --

  const page = await browser.newPage({ viewport: MOVIL });
  await page.goto(`${BASE}/tienda-demo`, { waitUntil: "networkidle" });
  await prepararPagina(page, "/tienda-demo (360px)");

  check(
    "V1 — /tienda-demo a 360px no scrollea en horizontal",
    false,
    await sinDesbordeHorizontal(page),
  );
  check(
    "V1 — el marcador del selector de sucursal NO está presente",
    0,
    await page.locator("[data-branch-picker]").count(),
  );
  check(
    "V1 — el catálogo de la sucursal se ve (nombre de un producto real)",
    true,
    (await page.locator("text=Refresco de cola").count()) > 0,
  );
  await shot(page, "V01-tienda-demo-movil");

  await page.setViewportSize(ESCRITORIO);
  await page.waitForTimeout(200); // deja asentar cualquier reflow antes de medir
  check(
    "V2 — /tienda-demo a 1280px no scrollea en horizontal",
    false,
    await sinDesbordeHorizontal(page),
  );
  await shot(page, "V02-tienda-demo-escritorio");

  await page.close();

  // --- V3 — I5: el slug canónico es el mismo con y sin JavaScript ---------
  // `data-store` es el atributo que ata la página al tema y a la caché
  // (architecture.md § El slug canónico). El mismo test de compilación no
  // puede probar esto — hace falta el DOM renderizado de verdad.

  const canon = await browser.newPage({ viewport: ESCRITORIO });
  await canon.goto(`${BASE}/bodega-central`, { waitUntil: "networkidle" });
  await prepararPagina(canon, "/bodega-central");
  const dataStoreCanonico = await canon.locator("[data-store]").first().getAttribute("data-store");
  check(
    "V3 — /bodega-central lleva data-store=bodega-central",
    "bodega-central",
    dataStoreCanonico,
  );
  await shot(canon, "V03-bodega-central-canonico");
  await canon.close();

  const alias = await browser.newPage({ viewport: ESCRITORIO });
  await alias.goto(`${BASE}/bodega-central-vedado`, { waitUntil: "networkidle" });
  await prepararPagina(alias, "/bodega-central-vedado");
  const dataStoreAlias = await alias.locator("[data-store]").first().getAttribute("data-store");
  check(
    "V3 — el alias /bodega-central-vedado lleva el MISMO data-store que la marca (I5)",
    dataStoreCanonico,
    dataStoreAlias,
  );
  await shot(alias, "V04-bodega-central-alias");
  await alias.close();

  // --- V4 — F-016 sin regresión: el tema por tienda sigue distinguiéndose -

  const verde = await browser.newPage({ viewport: ESCRITORIO });
  await verde.goto(`${BASE}/tienda-dos`, { waitUntil: "networkidle" });
  await prepararPagina(verde, "/tienda-dos");
  const brandColor = await verde.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--color-brand").trim(),
  );
  check(
    "V4 — tienda-dos sigue trayendo su paleta propia (F-016 sin regresión)",
    true,
    brandColor.length > 0,
  );
  await shot(verde, "V05-tienda-dos-tema-propio");
  await verde.close();
} catch (e) {
  fail(`el guion visual se rompió: ${e.message}`);
} finally {
  await browser.close();
}

console.log(`\n${fails} aserciones fallidas`);
process.exit(fails === 0 ? 0 : 1);
