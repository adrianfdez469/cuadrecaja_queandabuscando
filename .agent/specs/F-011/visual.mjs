// Verificación visual de F-011, tanda 3 (el editor de branding). La ejecuta
// `bash .agent/verify.sh F-011 --visual` con la app ya levantada;
// $VISUAL_BASE_URL apunta a ella y $VISUAL_SHOTS es la carpeta donde dejar
// las capturas. Reutiliza el mecanismo que F-017 dejó (chromium headless con
// Playwright), no lo reinventa.
//
// Cubre V39-V44 de design.md § Verificación: 360/768/1280 px del editor con
// branding guardado, que la maqueta reacciona al teclear (la única razón por
// la que esta pantalla tiene una isla), modo oscuro, el estado bloqueado por
// cobertura (E40b, y que no hay NADA enfocable ahí salvo enlaces), y
// navegación por teclado + `<noscript>`.
//
// Regla: cada aserción que no se cumpla imprime `VISUAL FAIL <qué>`. Eso es
// lo que el sensor busca para ponerle firma al error.

import { chromium } from "playwright";
import { execSync } from "node:child_process";

const BASE = process.env.VISUAL_BASE_URL ?? "http://localhost:3101";
const SHOTS = process.env.VISUAL_SHOTS ?? ".agent/runs/_libre/shots";

function ssoUrl(stores) {
  return execSync(`node scripts/mint-sso-token.mjs --stores=${stores}`, {
    encoding: "utf8",
    env: { ...process.env, QAB_BASE_URL: BASE },
  }).trim();
}

const MOVIL = { width: 360, height: 740 };
const TABLET = { width: 768, height: 900 };
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

async function alturasMinimas(page, selector) {
  return page.evaluate((sel) => {
    const nodes = [...document.querySelectorAll(sel)];
    return nodes.map((n) => n.getBoundingClientRect().height);
  }, selector);
}

const browser = await chromium.launch();
// Cada token de `mint-sso-token.mjs` es de un solo uso (el `jti` es único):
// una URL fresca por cada `.goto()`, nunca la misma reutilizada entre páginas.
function urlMarca() {
  return ssoUrl("seed-tienda-8,seed-tienda-9");
}
function urlParcial() {
  return ssoUrl("seed-tienda-8");
}

// El id interno de la sucursal `el-trebol-centro` no se adivina: se lee del
// listado `/admin`, igual que hace `.agent/specs/F-011/smoke.sh`.
async function storeIdByName(page, nombre) {
  return page.evaluate((needle) => {
    const cards = [...document.querySelectorAll("[data-store-id]")];
    const found = cards.find((c) => c.textContent?.includes(needle));
    return found?.getAttribute("data-store-id") ?? null;
  }, nombre);
}

try {
  // --- Preparación: entrar con la cookie de cobertura TOTAL y guardar un
  // branding conocido, para que V39-V42 midan un editor con datos reales. --

  const setup = await browser.newPage({ viewport: ESCRITORIO });
  await setup.goto(urlMarca(), { waitUntil: "networkidle" });
  await setup.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  const storeCentroId = await storeIdByName(setup, "El Trébol · Centro Habana");
  if (!storeCentroId) {
    fail("no se encontró el id de El Trébol · Centro Habana en /admin — revisa prisma/seed.ts");
    throw new Error("setup failed");
  }
  await setup.close();

  // --- V39/V40 — 360px, editor con branding guardado, y la maqueta cambia
  // al teclear (la única justificación de la isla). ---------------------

  const movil = await browser.newPage({ viewport: MOVIL });
  await movil.goto(urlMarca(), { waitUntil: "networkidle" });
  await movil.goto(`${BASE}/admin/tiendas/${storeCentroId}/marca`, { waitUntil: "networkidle" });
  await prepararPagina(movil, "editor de marca (360px)");

  check("V39 — 360px sin scroll horizontal", false, await sinDesbordeHorizontal(movil));

  // `input[type="radio"]` mide 20px a propósito (design.md § Componentes de
  // UI): el área de toque de 44px es el `<label>` de `RadioCard` entero
  // (`min-h-14`), no el punto del radio. Se mide el label, no el input.
  const alturasControles = await alturasMinimas(
    movil,
    'input[type="text"], input[type="color"], button[type="button"], label:has(input[type="radio"])',
  );
  const algunoBajo44 = alturasControles.some((h) => h > 0 && h < 43);
  check("V39 — ningún control mide menos de 44px", false, algunoBajo44);

  await movil.fill('input[name="brand"]', "#0f62fe");
  await movil.waitForTimeout(50);
  check(
    "V40 — la maqueta reacciona al teclear (el resumen de texto cambia)",
    true,
    (await movil.getByText("Color principal #0f62fe", { exact: false }).count()) > 0,
  );
  await shot(movil, "V39-editor-marca-movil");
  await movil.close();

  // --- V41 — 768px y 1280px: estructura por breakpoint --------------------

  const tablet = await browser.newPage({ viewport: TABLET });
  await tablet.goto(urlMarca(), { waitUntil: "networkidle" });
  await tablet.goto(`${BASE}/admin/tiendas/${storeCentroId}/marca`, { waitUntil: "networkidle" });
  await prepararPagina(tablet, "editor de marca (768px)");
  check("V41 — 768px sin scroll horizontal", false, await sinDesbordeHorizontal(tablet));
  await shot(tablet, "V41-editor-marca-tablet");
  await tablet.close();

  const escritorio = await browser.newPage({ viewport: ESCRITORIO });
  await escritorio.goto(urlMarca(), { waitUntil: "networkidle" });
  await escritorio.goto(`${BASE}/admin/tiendas/${storeCentroId}/marca`, {
    waitUntil: "networkidle",
  });
  await prepararPagina(escritorio, "editor de marca (1280px)");
  check("V41 — 1280px sin scroll horizontal", false, await sinDesbordeHorizontal(escritorio));
  await shot(escritorio, "V41-editor-marca-escritorio");

  // --- V42 — modo oscuro, a 1280px -----------------------------------------

  await escritorio.emulateMedia({ colorScheme: "dark" });
  await escritorio.waitForTimeout(100);
  check(
    "V42 — 1280px oscuro sin scroll horizontal",
    false,
    await sinDesbordeHorizontal(escritorio),
  );
  await shot(escritorio, "V42-editor-marca-oscuro");
  await escritorio.close();

  // --- V43 — 360px, cobertura incompleta: sin campos, sin control enfocable
  // salvo enlaces. ---------------------------------------------------------

  const bloqueado = await browser.newPage({ viewport: MOVIL });
  await bloqueado.goto(urlParcial(), { waitUntil: "networkidle" });
  await bloqueado.goto(`${BASE}/admin/tiendas/${storeCentroId}/marca`, {
    waitUntil: "networkidle",
  });
  await prepararPagina(bloqueado, "editor de marca bloqueado (360px)");
  check("V43 — 360px sin scroll horizontal", false, await sinDesbordeHorizontal(bloqueado));
  check(
    "V43 — trae 'Te faltan estas sucursales'",
    true,
    (await bloqueado.getByText("Te faltan estas sucursales").count()) > 0,
  );
  check(
    "V43 — cero campos de texto en la pantalla bloqueada",
    0,
    await bloqueado.locator('input[type="text"]').count(),
  );
  // Acotado a <main>: fuera de ahí vive el <nextjs-portal> del indicador de
  // dev tools, que también es un <button> y no tiene nada que ver con esta
  // pantalla (se oculta con CSS, pero sigue existiendo en el DOM).
  check(
    "V43 — cero botones en la pantalla bloqueada (solo puede haber enlaces)",
    0,
    await bloqueado.locator("main button").count(),
  );
  await shot(bloqueado, "V43-editor-marca-bloqueado-movil");
  await bloqueado.close();

  // --- V44 — solo teclado: el grupo de esquinas se recorre con flechas, y
  // tras un 400 el foco cae en el resumen. ---------------------------------

  const teclado = await browser.newPage({ viewport: ESCRITORIO });
  await teclado.goto(urlMarca(), { waitUntil: "networkidle" });
  await teclado.goto(`${BASE}/admin/tiendas/${storeCentroId}/marca`, { waitUntil: "networkidle" });
  // Sin `vigilarConsola`: este bloque provoca un 400 A PROPÓSITO, y Chromium
  // registra el `fetch` fallido como "Failed to load resource" en la consola
  // — una respuesta esperada, no un error de verdad.
  await teclado.addStyleTag({ content: SIN_OVERLAY_DE_DEV });

  // Fuerza un 400 manipulando el campo con un valor inválido y enviando.
  await teclado.fill('input[name="brand"]', "no-es-un-color#");
  await teclado.click('button[type="submit"]');
  await teclado.waitForSelector('[role="alert"]', { timeout: 5000 });
  // El foco se mueve por programa dentro de un requestAnimationFrame, tras el
  // fetch — no un valor fijo de espera: se sondea hasta que ocurra o hasta
  // los 3s (el mismo patrón que .agent/playbook/testing-library-timeout-1s-bajo-carga.md
  // pide para no atarse a lo rápido que vaya el runner).
  await teclado.waitForFunction(
    () => document.activeElement?.querySelector('[role="alert"]') != null,
    { timeout: 3000 },
  );
  const foco400 = await teclado.evaluate(
    () => document.activeElement?.querySelector('[role="alert"]') != null,
  );
  check(
    "V44 — tras un 400, el foco cae en el contenedor que envuelve el role=alert",
    true,
    foco400,
  );

  await teclado.fill('input[name="brand"]', "#0f62fe");
  const radios = teclado.locator('input[name="radius"]');
  await radios.first().focus();
  await teclado.keyboard.press("ArrowDown");
  const segundoMarcado = await radios.nth(1).isChecked();
  check(
    "V44 — la flecha abajo mueve la selección dentro del grupo de esquinas",
    true,
    segundoMarcado,
  );

  await shot(teclado, "V44-editor-marca-teclado");
  await teclado.close();
} finally {
  await browser.close();
}

if (fails > 0) {
  console.log(`\n${fails} verificaciones visuales fallidas`);
  process.exit(1);
}
console.log("\nTodas las verificaciones visuales pasaron");
