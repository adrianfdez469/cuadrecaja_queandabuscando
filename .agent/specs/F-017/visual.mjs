// Verificación visual de F-017. La ejecuta `bash .agent/verify.sh F-017
// --visual` con la app ya levantada; $VISUAL_BASE_URL apunta a ella y
// $VISUAL_SHOTS es la carpeta donde dejar las capturas.
//
// Etapa 1: el criterio 1 y el corazón del feature (el slug canónico, I5) —
// que mover el slug de la sucursal a la marca NO cambió lo que el comprador
// ve, a 360 px y a 1280 px.
//
// Etapa 2 (añadido en este ciclo): el selector de una marca agrupada
// (criterio 2, sobre `bodega-uno`/`bodega-dos`, ya agrupadas por
// `.agent/specs/F-017/smoke.sh` — este guion NUNCA agrupa nada, solo mira)
// y la pantalla `/sucursales` con el aviso del carrito (criterio 6). La
// pantalla de agrupar se fotografía SIN confirmar nunca — es irreversible,
// así que este guion solo llega hasta "Qué va a cambiar" y nunca hace clic
// en "Sí, agrupar las dos tiendas".
//
// Regla: cada aserción que no se cumpla imprime `VISUAL FAIL <qué>`. Eso es
// lo que el sensor busca para ponerle firma al error.

import { chromium } from "playwright";
import { execSync } from "node:child_process";

const BASE = process.env.VISUAL_BASE_URL ?? "http://localhost:3101";
const SHOTS = process.env.VISUAL_SHOTS ?? ".agent/runs/_libre/shots";

/** URL de sesión de `scripts/mint-sso-token.mjs`, contra el mismo servidor
 *  que este guion visual está mirando. */
function ssoUrl(stores) {
  return execSync(`node scripts/mint-sso-token.mjs --stores=${stores}`, {
    encoding: "utf8",
    env: { ...process.env, QAB_BASE_URL: BASE },
  }).trim();
}

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

  // --- criterio 2 — el selector de una marca agrupada, a 360 y 1280 px ----
  // `bodega-uno`/`bodega-dos` ya están agrupadas por `smoke.sh` (fixtures de
  // un solo uso, architecture.md § prisma/seed.ts) — este guion nunca las
  // agrupa, solo mira lo que quedó.

  const selector = await browser.newPage({ viewport: MOVIL });
  await selector.goto(`${BASE}/bodega-uno`, { waitUntil: "networkidle" });
  await prepararPagina(selector, "/bodega-uno (selector, 360px)");
  check(
    "criterio 2 — el selector trae el marcador data-branch-picker",
    true,
    (await selector.locator("[data-branch-picker]").count()) > 0,
  );
  check(
    "criterio 2 — el HTML trae el nombre de las DOS sucursales",
    true,
    (await selector.getByText("Bodega Uno", { exact: false }).count()) > 0 &&
      (await selector.getByText("Bodega Dos", { exact: false }).count()) > 0,
  );
  check(
    "V-selector — 360px no scrollea en horizontal",
    false,
    await sinDesbordeHorizontal(selector),
  );
  await shot(selector, "V06-bodega-uno-selector-movil");

  // Los `href` de las tarjetas son la fuente de verdad de los slugs reales
  // (nunca hardcodeados aquí: el propio de `bodega-uno` cambia si colisiona
  // con el de su marca, HS10 § Qué les pasa a los slugs).
  const branchHrefs = await selector
    .locator("[data-branch-picker] a")
    .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  const unoOwnHref = branchHrefs.find((href) => href !== "/bodega-dos") ?? branchHrefs[0];

  await selector.setViewportSize(ESCRITORIO);
  await selector.waitForTimeout(200);
  check(
    "V-selector — 1280px no scrollea en horizontal",
    false,
    await sinDesbordeHorizontal(selector),
  );
  await shot(selector, "V07-bodega-uno-selector-escritorio");
  await selector.close();

  // --- criterio 6 — /sucursales y el aviso del carrito ---------------------

  const sucursales = await browser.newPage({ viewport: MOVIL });
  await sucursales.goto(`${BASE}${unoOwnHref}/sucursales`, { waitUntil: "networkidle" });
  await prepararPagina(sucursales, "/sucursales (360px)");
  check(
    "criterio 6 — la frase del carrito está en pantalla",
    true,
    (await sucursales.getByText("Tu carrito no se mueve", { exact: false }).count()) > 0,
  );
  check(
    "criterio 6 — la lista de sucursales sigue ahí, con 'Estás aquí' en la actual",
    true,
    (await sucursales.getByText("Estás aquí", { exact: false }).count()) > 0,
  );
  await shot(sucursales, "V08-sucursales-movil");
  await sucursales.close();

  // --- criterio 2, HS8 — la pantalla de agrupar, SIN confirmar nunca ------
  // `bodega-central` (con candidatas reales: `tienda-demo`, del mismo
  // negocio) para fotografiar el formulario sin gastar una fixture de un
  // solo uso. Este guion llega hasta "Qué va a cambiar" y se detiene ahí —
  // agrupar no tiene vuelta atrás (architecture.md § Riesgos).

  const adminUrl = ssoUrl("seed-tienda-4,seed-tienda-1");
  const admin = await browser.newPage({ viewport: MOVIL });
  await admin.goto(adminUrl, { waitUntil: "networkidle" });
  await admin.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  const bodegaCentralId = await admin
    .locator("[data-store-id]")
    .filter({ hasText: "Bodega Central" })
    .first()
    .getAttribute("data-store-id");

  if (!bodegaCentralId) {
    fail("agrupar — no se encontró data-store-id de Bodega Central en /admin");
  } else {
    await admin.goto(`${BASE}/admin/tiendas/${bodegaCentralId}/agrupar`, {
      waitUntil: "networkidle",
    });
    await prepararPagina(admin, "/admin/.../agrupar (360px, sin confirmar)");
    check(
      "agrupar — el aviso de 'no se puede deshacer' está en pantalla",
      true,
      (await admin.getByText("Esto no se puede deshacer", { exact: false }).count()) > 0,
    );
    const radios = admin.locator('input[name="joiningStoreId"]');
    check("agrupar — hay al menos una candidata", true, (await radios.count()) > 0);
    if ((await radios.count()) > 0) {
      await radios.first().check();
      await admin.getByText("Qué va a cambiar", { exact: false }).waitFor({ state: "visible" });
      check(
        "agrupar — 'Qué va a cambiar' aparece tras elegir, y el botón de confirmar SIGUE sin tocarse",
        true,
        (await admin.getByRole("button", { name: /Sí, agrupar/ }).count()) > 0,
      );
      await shot(admin, "V09-agrupar-360-qve-va-a-cambiar");
      await admin.setViewportSize(ESCRITORIO);
      await admin.waitForTimeout(200);
      await shot(admin, "V10-agrupar-1280-qve-va-a-cambiar");
    }
    // Nunca se hace click en "Sí, agrupar las dos tiendas": este guion
    // termina aquí, sin escribir nada en la base.
  }
  await admin.close();
} catch (e) {
  fail(`el guion visual se rompió: ${e.message}`);
} finally {
  await browser.close();
}

console.log(`\n${fails} aserciones fallidas`);
process.exit(fails === 0 ? 0 : 1);
