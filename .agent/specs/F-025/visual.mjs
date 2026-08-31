// Verificación visual de F-025 (rastro de navegación / breadcrumb). La
// ejecuta `bash .agent/verify.sh F-025 --visual` con la app ya levantada;
// $VISUAL_BASE_URL apunta a ella, $VISUAL_SHOTS es la carpeta de capturas y
// $VISUAL_TRACES la del trace de Playwright.
//
// Traduce los ONCE pasos V1-V11 de `.agent/specs/F-025/design.md` §
// Verificación visual. `plan.md` firma «V1-V10» porque V11 nació después de
// la firma, para verificar PP1/DP1 — no es alcance nuevo (progress/F-025.md §
// Notas para quien retome).
//
// V1-V4 y V9 son los que un `curl` NO puede comprobar: posición en el DOM,
// alto de la fila, desplazamiento horizontal, recorte por prioridad y el 404
// pulsado de verdad (no leído). Copiado con el criterio de
// `.agent/specs/F-026/visual.mjs`: mismos helpers, mismo patrón de crear datos
// sintéticos por sync con un `externalId` de un solo uso y limpiarlos en un
// `finally`, y la MISMA técnica para V9 (navegador headless, clic real,
// comprobar a dónde aterriza — un `href` correcto sin pulsarlo no demuestra
// nada, architecture.md § El 404 dentro de una tienda).
//
// AVISO heredado de `.agent/specs/F-026/visual.mjs` V9 (impl.md § Qué
// necesita quien pruebe, progress/F-025.md § Notas para quien retome): ese
// guion pulsaba el «Ver todo el catálogo» PROPIO del 404 de categoría, que el
// paso 6 de este feature borró (los tres `not-found.tsx` perdieron su enlace
// propio; la salida canónica la pone la cabecera de `src/app/[slug]/layout.tsx`,
// architecture.md § Los dos `not-found.tsx` sin `params`). Se corrigió AQUÍ,
// en `.agent/specs/F-026/visual.mjs`, cambiando su V9 para pulsar esa misma
// cabecera — es lo que este comentario deja anotado para que quien lea el
// diff entienda por qué un feature ya cerrado cambió.
//
// Regla: cada aserción que no se cumpla imprime `VISUAL FAIL <qué>`. Eso es
// lo que el sensor busca para ponerle firma al error.
//
// Regla de datos: todo lo que este guion crea (V3-pathological, V4) usa un
// `externalId` con sufijo `visual25-…-$SUFFIX`, nunca los nombres de la
// fixture real, y se autolimpia con SQL directo en un `finally`. La
// agrupación de bodega-uno/bodega-dos NO la hace este guion — la hace
// `smoke.sh` (agrupar no tiene vuelta atrás, así que solo un guion la
// intenta, de forma idempotente) — este guion solo LEE el resultado si ya
// está agrupada, y se salta con una nota si no lo está todavía (por ejemplo
// si `--visual` corre antes que `--smoke` en la misma sesión).

import "dotenv/config";
import { chromium } from "playwright";
import { execSync } from "node:child_process";

const BASE = process.env.VISUAL_BASE_URL ?? "http://localhost:3101";
const SHOTS = process.env.VISUAL_SHOTS ?? ".agent/runs/_libre/shots";
const TRACES = process.env.VISUAL_TRACES ?? ".agent/runs/_libre/traces";
const TOKEN = process.env.QAB_BEARER_TOKEN ?? "";
const BUSINESS_ID = "seed-negocio-1";
const SUFFIX = Date.now().toString(36);

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

function checkClose(que, esperado, obtenido, tolerancia = 2) {
  const ok = typeof obtenido === "number" && Math.abs(obtenido - esperado) <= tolerancia;
  if (ok) {
    console.log(`  ok   ${que} (${obtenido}, esperaba ~${esperado})`);
  } else {
    console.log(`VISUAL FAIL ${que} — esperaba ~${esperado} (±${tolerancia}), obtuve ${obtenido}`);
    fails++;
  }
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

async function crumbCount(page) {
  return page.locator('nav[aria-label="Ruta"] ol > li').count();
}

// --- sync real, mismos helpers que F-026/visual.mjs -------------------------

let nowCounter = 0;
function now() {
  nowCounter += 1;
  return new Date(Date.now() + nowCounter).toISOString();
}

async function syncCatalog(events) {
  const res = await fetch(`${BASE}/api/internal/sync/catalog`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ businessId: BUSINESS_ID, events }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function categoryEvent(categoryId, operation, name) {
  return {
    eventId: `evt-${categoryId}-${operation}-${now()}`,
    entity: "CATEGORY",
    operation,
    occurredAt: now(),
    payload: { categoryId, businessId: BUSINESS_ID, name, color: null, updatedAt: now() },
  };
}

function productEvent(storeProductId, productId, storeId, localName, localCategoryId, price) {
  return {
    eventId: `evt-${storeProductId}-${now()}`,
    entity: "PRODUCT",
    operation: "UPDATE",
    occurredAt: now(),
    payload: {
      storeProductId,
      productId,
      businessId: BUSINESS_ID,
      storeId,
      localName,
      barcodes: [],
      localCategoryId,
      price,
      currency: "CUP",
      canonicalProductId: null,
      imageUrl: null,
      publishToStore: true,
      updatedAt: now(),
    },
  };
}

function psql(sql) {
  return execSync(
    `docker exec queandabuscando-postgres psql -U postgres -d queandabuscando -Atc "${sql.replace(/"/g, '\\"')}"`,
    { encoding: "utf8" },
  ).trim();
}

if (!TOKEN) {
  fail(
    "QAB_BEARER_TOKEN no está en el entorno — los pasos con nombres patológicos necesitan sync real",
  );
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: MOVIL });
await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

const paraLimpiar = { categoryExternalIds: [] };

try {
  // --- V1 · la fila está donde dice R10, en las diez ----------------------
  // (nueve con curl bastaría, pero design.md pide medir DE VERDAD contra el
  // DOM; se cubren las diez pantallas del inventario, no solo las diez que
  // design.md lista de ejemplo — carrito/checkout de una marca de una sola
  // sucursal, más el-trebol para selector/sucursal-con-BranchBar/sucursales).

  const paginasV1 = [
    "/tienda-demo",
    "/tienda-demo/c/bebidas",
    "/tienda-demo/p/jugo-de-mango-1-l",
    "/tienda-demo/buscar?q=jugo",
    "/tienda-demo/buscar",
    "/tienda-demo/carrito",
    "/tienda-demo/checkout",
    "/el-trebol",
    "/el-trebol-centro",
    "/el-trebol-centro/sucursales",
  ];
  for (const ruta of paginasV1) {
    const page = await context.newPage();
    await page.goto(`${BASE}${ruta}`, { waitUntil: "networkidle" });
    await prepararPagina(page, `${ruta} (V1)`);
    const nav = page.locator('nav[aria-label="Ruta"]');
    checkTrue(`V1 — ${ruta} — el nav[aria-label="Ruta"] existe`, (await nav.count()) > 0);
    const h1 = page.locator("h1").first();
    const navBox = await nav.boundingBox();
    const h1Box = (await h1.count()) > 0 ? await h1.boundingBox() : null;
    if (h1Box) {
      checkTrue(`V1 — ${ruta} — el rastro está por encima del <h1>`, navBox.y < h1Box.y);
    }
    // El top vale 84 salvo en las pantallas con BranchBar (marca
    // multi-sucursal, resolución de sucursal): ahí BranchBar se apila a
    // 360px y empuja el rastro hacia abajo (medido: y=176 en
    // /el-trebol-centro). design.md § Estructura por breakpoint lo dice
    // explícitamente: "en las que no tienen BranchBar".
    const tieneBranchBar = (await page.locator('nav[aria-label="Sucursal"]').count()) > 0;
    if (!tieneBranchBar) {
      checkClose(`V1 — ${ruta} — top del rastro = 84px`, 84, navBox?.y, 1);
    } else {
      note(`V1 — ${ruta} — tiene BranchBar, no se exige top=84 (medido: ${navBox?.y})`);
    }
    if (ruta === "/tienda-demo/p/jugo-de-mango-1-l") await shot(page, "V01-ficha-360");
    await page.close();
  }

  // --- Criterio 2 · con JavaScript deshabilitado, el eslabón de la sucursal
  //     navega y responde 200 ------------------------------------------------
  // design.md no le da un paso V numerado propio (§ Coste de cliente lo da
  // por estructuralmente cierto: "la fila son <a href> en el HTML servido,
  // y no hay nada que explicarle a nadie"), pero el criterio 2 de
  // features.json exige `page.setJavaScriptEnabled(false)` explícitamente y
  // el mandato de este ciclo es EJECUTAR, no dar por bueno un razonamiento
  // estructural. Se PULSA el enlace, no se lee su `href`.

  {
    const ctxSinJs = await browser.newContext({ viewport: MOVIL, javaScriptEnabled: false });
    const page = await ctxSinJs.newPage();
    const resp = await page.goto(`${BASE}/tienda-demo/p/jugo-de-mango-1-l`, { waitUntil: "load" });
    check("Criterio 2 — la ficha responde 200 sin JavaScript", 200, resp.status());
    const link = page.locator('nav[aria-label="Ruta"] a[href="/tienda-demo"]');
    checkTrue(
      "Criterio 2 — el eslabón de la sucursal es un <a href> real",
      (await link.count()) > 0,
    );
    const [respNav] = await Promise.all([page.waitForNavigation(), link.first().click()]);
    check(
      "Criterio 2 — PULSAR el eslabón navega a /tienda-demo",
      `${BASE}/tienda-demo`,
      page.url(),
    );
    check("Criterio 2 — la página de destino responde 200", 200, respNav.status());
    await shot(page, "criterio2-sin-js-despues-del-clic");
    await ctxSinJs.close();
  }

  // --- V2 · la fila mide 44px con uno y con cuatro eslabones --------------

  const v2casos = [
    { ruta: "/tienda-demo", n: 1 }, // marca de una sucursal: un solo eslabón
    { ruta: "/bodega-dos/p/cerveza-cristal", n: 4 }, // Marca›Sucursal›Categoría›Producto
  ];
  for (const { ruta, n } of v2casos) {
    for (const [nombre, viewport] of [
      ["360px", MOVIL],
      ["768px", TABLET],
      ["1280px", ESCRITORIO],
    ]) {
      const page = await context.newPage({ viewport });
      await page.goto(`${BASE}${ruta}`, { waitUntil: "networkidle" });
      const nav = page.locator('nav[aria-label="Ruta"]');
      const box = await nav.boundingBox();
      const crumbs = await crumbCount(page);
      check(`V2 — ${ruta} @ ${nombre} — ${n} eslabones`, n, crumbs);
      checkClose(`V2 — ${ruta} @ ${nombre} — la fila mide 44px`, 44, box?.height, 1);
      await page.close();
    }
  }

  // --- V3 · ninguna pantalla gana desplazamiento horizontal ---------------
  // En las diez pantallas de V1, a los tres anchos, y también con un nombre
  // de producto de 120 caracteres (creado por sync, limpiado al final).

  let slugProd4Global = null;

  for (const ruta of paginasV1) {
    for (const [nombre, viewport] of [
      ["360px", MOVIL],
      ["768px", TABLET],
      ["1280px", ESCRITORIO],
    ]) {
      const page = await context.newPage({ viewport });
      await page.goto(`${BASE}${ruta}`, { waitUntil: "networkidle" });
      checkTrue(
        `V3 — ${ruta} @ ${nombre} — sin desplazamiento horizontal`,
        !(await sinDesbordeHorizontal(page)),
      );
      await page.close();
    }
  }

  if (TOKEN) {
    const catId = `visual25-longcat-${SUFFIX}`;
    const prodId = `visual25-longprod-${SUFFIX}`;
    // Segundo producto sintético, en bodega-dos (marca de DOS sucursales ya
    // agrupada por smoke.sh): cuatro eslabones con nombres patológicos, para
    // V4 — con nombres reales (cerveza-cristal) nada compite por ancho y la
    // aserción de "el penúltimo es el que más recibe" no se llega a
    // ejercitar (probado: los cuatro caben enteros, sin recorte).
    const catId4 = `visual25-longcat4-${SUFFIX}`;
    const prodId4 = `visual25-longprod4-${SUFFIX}`;
    paraLimpiar.categoryExternalIds.push(catId, catId4);
    const longCatName = `Categoria con nombre absurdamente largo para forzar el recorte visual ${SUFFIX}`;
    const longProdName = `Producto con un nombre de exactamente ciento veinte caracteres de largo para forzar el recorte visual del rastro de navegacion ${SUFFIX}`;
    const longCatName4 = `Categoria patologicamente larga para el caso de cuatro eslabones ${SUFFIX}`;
    const longProdName4 = `Producto patologicamente largo para el caso de cuatro eslabones en 360px ${SUFFIX}`;
    const { status: sV3 } = await syncCatalog([
      categoryEvent(catId, "CREATE", longCatName),
      productEvent(
        prodId,
        `visual25-longprodid-${SUFFIX}`,
        "seed-tienda-1",
        longProdName,
        catId,
        999,
      ),
      categoryEvent(catId4, "CREATE", longCatName4),
      productEvent(
        prodId4,
        `visual25-longprodid4-${SUFFIX}`,
        "seed-tienda-6", // bodega-dos
        longProdName4,
        catId4,
        999,
      ),
    ]);
    check("V3 — el producto/categoría de nombre largo se sincroniza (207)", 207, sV3);

    const slugProd = psql(`SELECT slug FROM "StoreProduct" WHERE "externalId"='${prodId}'`);
    const slugProd4 = psql(`SELECT slug FROM "StoreProduct" WHERE "externalId"='${prodId4}'`);
    slugProd4Global = slugProd4 || null;
    if (slugProd) {
      for (const [nombre, viewport] of [
        ["360px", MOVIL],
        ["768px", TABLET],
        ["1280px", ESCRITORIO],
      ]) {
        const page = await context.newPage({ viewport });
        await page.goto(`${BASE}/tienda-demo/p/${slugProd}`, { waitUntil: "networkidle" });
        checkTrue(
          `V3 — ficha con nombre de 120+ caracteres @ ${nombre} — sin desplazamiento horizontal`,
          !(await sinDesbordeHorizontal(page)),
        );
        const nav = page.locator('nav[aria-label="Ruta"]');
        const box = await nav.boundingBox();
        checkClose(
          `V3 — ficha con nombre largo @ ${nombre} — la fila sigue midiendo 44px`,
          44,
          box?.height,
          1,
        );
        if (nombre === "360px") await shot(page, "V03-nombre-largo-360");
        await page.close();
      }
    } else {
      fail("V3 — no se pudo sembrar el producto de nombre largo");
    }
  } else {
    fail("V3 (nombre largo) — no se pudo sembrar (falta QAB_BEARER_TOKEN)");
  }

  // --- V4 · el eslabón de vuelta no se recorta cuando hay hueco -----------

  {
    const page = await context.newPage();
    await page.goto(`${BASE}/el-trebol-centro`, { waitUntil: "networkidle" });
    // /el-trebol-centro es la propia sucursal: su nombre es el eslabón
    // ACTUAL (aria-current, sin href), no el de vuelta — es la pantalla que
    // design.md mide para "el eslabón sin recorte cuando hay hueco" (aquí
    // solo hay dos eslabones, así que ninguno compite por ancho).
    const span = page.locator('nav[aria-label="Ruta"] [aria-current="page"] span.truncate');
    const overflow = await span.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    checkTrue(
      'V4 — "El Trébol · Centro Habana" se ve entero (no recortado) en /el-trebol-centro',
      !overflow,
    );
    await page.close();
  }
  {
    // Ficha real de cuatro eslabones (Bodega Uno › Bodega Dos › Bebidas ›
    // Cerveza Cristal): confirma la ESTRUCTURA (cuatro eslabones) con datos
    // reales del seed. Con nombres cortos como estos nada compite por
    // ancho —medido: los cuatro caben enteros, sin recorte—, así que la
    // aserción de "cuál recibe más ancho" no se puede probar aquí; se
    // prueba con el producto sintético de nombres patológicos, abajo.
    const page = await context.newPage();
    await page.goto(`${BASE}/bodega-dos/p/cerveza-cristal`, { waitUntil: "networkidle" });
    check(
      "V4 — la ficha de bodega-dos/cerveza-cristal tiene 4 eslabones",
      4,
      await crumbCount(page),
    );
    await shot(page, "V04-cuatro-eslabones-360");
    await page.close();
  }
  if (slugProd4Global) {
    // Ficha sintética de cuatro eslabones con nombres patológicos (Bodega
    // Uno › Bodega Dos › <categoría larga> › <producto largo>): aquí SÍ hay
    // competencia real por ancho, y el penúltimo (el eslabón de vuelta)
    // tiene que ser el que más recibe — medido antes de escribir esta
    // aserción: [48, 48, 184, 48] a 360px.
    const page = await context.newPage();
    await page.goto(`${BASE}/bodega-dos/p/${slugProd4Global}`, { waitUntil: "networkidle" });
    const items = page.locator('nav[aria-label="Ruta"] ol > li');
    const n = await items.count();
    check("V4 — la ficha patológica tiene 4 eslabones", 4, n);
    if (n === 4) {
      const widths = [];
      for (let i = 0; i < n; i++) widths.push((await items.nth(i).boundingBox())?.width ?? 0);
      const penultimo = widths[n - 2];
      const esElMasAncho = widths.every((w, i) => i === n - 2 || w <= penultimo + 0.5);
      checkTrue(
        `V4 — el eslabón de vuelta es el que más ancho recibe de los cuatro (medido: ${JSON.stringify(widths)})`,
        esElMasAncho,
      );
    }
    checkTrue(
      "V4 — sin desplazamiento horizontal con nombres patológicos",
      !(await sinDesbordeHorizontal(page)),
    );
    await shot(page, "V04-cuatro-eslabones-patologicos-360");
    await page.close();
  } else {
    fail("V4 — no se pudo sembrar el producto patológico de cuatro eslabones");
  }

  // --- V5 · el foco se ve y no se recorta ----------------------------------
  // Tabulando desde la cabecera en una ficha de cuatro eslabones: cada
  // eslabón enlazable recibe un anillo visible completo y el actual (el
  // nombre del producto) NUNCA recibe foco.

  {
    const page = await context.newPage();
    await page.goto(`${BASE}/bodega-dos/p/cerveza-cristal`, { waitUntil: "networkidle" });
    await prepararPagina(page, "/bodega-dos/p/cerveza-cristal (V5)");
    // El primer Tab cae en la cabecera (el nombre de la tienda); iteramos
    // hasta ver los tres eslabones enlazables del rastro (Bodega Uno,
    // Bodega Dos, Bebidas) y confirmamos que "Cerveza Cristal" (el actual)
    // nunca aparece como foco.
    const vistos = [];
    let vioCervezaComoFoco = false;
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        return { text: el?.textContent?.trim() ?? "", tag: el?.tagName ?? "" };
      });
      vistos.push(info.text);
      if (info.text.includes("Cerveza Cristal")) vioCervezaComoFoco = true;
      if (["Bodega Uno", "Bodega Dos", "Bebidas"].includes(info.text) && info.tag === "A") {
        const box = await page.evaluate(() => {
          const r = document.activeElement.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        });
        const outline = await page.evaluate(() => {
          const cs = getComputedStyle(document.activeElement);
          return { width: parseFloat(cs.outlineWidth) || 0, style: cs.outlineStyle };
        });
        checkTrue(
          `V5 — el anillo de foco de "${info.text}" es visible`,
          outline.width > 0 && outline.style !== "none",
        );
        checkTrue(
          `V5 — el anillo de foco de "${info.text}" no se recorta (dentro de 360px)`,
          box.left >= -1 && box.right <= 360 + 1,
        );
      }
    }
    checkTrue("V5 — el eslabón actual (Cerveza Cristal) nunca recibe foco", !vioCervezaComoFoco);
    checkTrue(
      "V5 — el foco recorrió los tres eslabones enlazables del rastro",
      ["Bodega Uno", "Bodega Dos", "Bebidas"].every((n) => vistos.includes(n)),
    );
    // Vuelta con Shift+Tab: el último enlazable visto tiene que reaparecer.
    await page.keyboard.press("Shift+Tab");
    const back = await page.evaluate(() => document.activeElement?.textContent?.trim());
    checkTrue("V5 — Shift+Tab vuelve a un eslabón del rastro", vistos.includes(back));
    await shot(page, "V05-foco-360");
    await page.close();
  }

  // --- V6 · las dos paletas y los dos esquemas de color --------------------

  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: MOVIL, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/tienda-dos/carrito`, { waitUntil: "networkidle" });
    await prepararPagina(page, `/tienda-dos/carrito (V6 ${scheme})`);
    const back = page.locator('nav[aria-label="Ruta"] a').first();
    const current = page.locator('nav[aria-label="Ruta"] [aria-current="page"]');
    const backStyle = await back.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { decoration: cs.textDecorationLine, weight: cs.fontWeight };
    });
    const currentStyle = await current.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { decoration: cs.textDecorationLine, weight: cs.fontWeight };
    });
    check(
      `V6 — ${scheme} — el eslabón de vuelta está subrayado`,
      "underline",
      backStyle.decoration,
    );
    check(`V6 — ${scheme} — el eslabón de vuelta pesa 500 (medium)`, "500", backStyle.weight);
    checkTrue(
      `V6 — ${scheme} — el actual NO está subrayado (se distingue sin mirar el color)`,
      currentStyle.decoration === "none",
    );
    await shot(page, `V06-tienda-dos-${scheme}-360`);
    await ctx.close();
  }

  // --- V7 · el rastro y los chips no se confunden --------------------------

  {
    const page = await context.newPage();
    await page.goto(`${BASE}/tienda-demo/c/bebidas`, { waitUntil: "networkidle" });
    await prepararPagina(page, "/tienda-demo/c/bebidas (V7)");
    const navRuta = page.locator('nav[aria-label="Ruta"]');
    const rutaStyle = await navRuta.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, borderWidth: cs.borderWidth, radius: cs.borderRadius };
    });
    checkTrue("V7 — el rastro no tiene fondo", rutaStyle.bg === "rgba(0, 0, 0, 0)");
    checkTrue("V7 — el rastro no tiene borde", parseFloat(rutaStyle.borderWidth) === 0);
    const navCats = page.locator('nav[aria-label="Categorías"]');
    const catsBox = await navCats.boundingBox();
    checkClose("V7 — la fila de chips sigue midiendo 52px", 52, catsBox?.height, 1);
    const primerChip = navCats.locator("a").first();
    const chipRadius = await primerChip.evaluate((el) =>
      parseFloat(getComputedStyle(el).borderRadius),
    );
    checkTrue(
      "V7 — el primer chip SÍ tiene esquinas redondeadas (se distingue del rastro)",
      chipRadius > 0,
    );
    await shot(page, "V07-rastro-vs-chips-360");
    await page.close();
  }

  // --- V8 · un solo control de vuelta en /…/sucursales ---------------------
  // Se lee CONTRA EL DOM RENDERIZADO, no el HTML crudo: el 404 global de la
  // plataforma («Volver al inicio») viaja embebido, preexistente e invisible,
  // en el payload de React Flight de TODA página — visible con `curl`/`grep`
  // crudo (1 aparición, no 0: ver smoke.sh y tests.md § Fallos encontrados),
  // pero NO en el texto que el navegador pinta. bodega-uno/sucursales
  // necesita que bodega-uno y bodega-dos estén agrupadas (smoke.sh lo hace,
  // de forma idempotente porque agrupar no tiene vuelta atrás); si esta
  // corrida es anterior a esa agrupación, se salta con una nota.

  {
    const grouped = psql(
      `SELECT s1."storefrontId" = s2."storefrontId" FROM "Store" s1, "Store" s2
       WHERE s1."externalId"='seed-tienda-5' AND s2."externalId"='seed-tienda-6'`,
    );
    if (grouped !== "t") {
      note(
        "V8 — bodega-uno/bodega-dos todavía no están agrupadas en esta base — corre --smoke primero o agrúpalas a mano",
      );
    } else {
      const page = await context.newPage();
      await page.goto(`${BASE}/bodega-uno/sucursales`, { waitUntil: "networkidle" });
      await prepararPagina(page, "/bodega-uno/sucursales (V8)");
      const bodyText = await page.evaluate(() => document.body.innerText);
      checkTrue(
        'V8 — "Volver a" NO aparece en el texto renderizado',
        !bodyText.includes("Volver a"),
      );
      check(
        'V8 — exactamente un nav[aria-label="Ruta"]',
        1,
        await page.locator('nav[aria-label="Ruta"]').count(),
      );
      await shot(page, "V08-sucursales-360");
      await page.close();
    }
  }

  // --- V9 · el 404 conserva la tienda y su salida lleva al canónico -------
  // Única prueba del criterio 9 (reformulado el 2026-08-31 para navegador).
  // Cuatro asertos: 404 real, data-store en el DOM ya renderizado, la
  // cabecera SE PULSA (no se lee el href) y aterriza en el slug canónico —
  // dos veces, entrando directo y entrando por un alias.

  {
    const page = await context.newPage();
    const resp = await page.goto(`${BASE}/tienda-demo/p/no-existe-${SUFFIX}`, {
      waitUntil: "networkidle",
    });
    await prepararPagina(page, "/tienda-demo/p/no-existe (V9)");
    check("V9 — el 404 de producto responde 404", 404, resp.status());
    const dataStore = await page.evaluate(() =>
      document.querySelector("[data-store]")?.getAttribute("data-store"),
    );
    check("V9 — [data-store] en el DOM ya renderizado", "tienda-demo", dataStore);
    const headerLink = page.getByRole("link", { name: /La Rampa/ });
    checkTrue("V9 — existe el enlace de la cabecera de la tienda", (await headerLink.count()) > 0);
    await shot(page, "V09-404-producto-antes-del-clic");
    // Se PULSA, no se lee el href (design.md V9.3): el clic es una
    // navegación de cliente (Link/RSC), así que el estado 200 se confirma
    // con una petición aparte a la URL en la que el navegador aterrizó, no
    // adivinando el `Response` de la navegación soft de React.
    await Promise.all([page.waitForURL(/\/tienda-demo\/?$/), headerLink.first().click()]);
    const landedStatus = (await page.request.get(page.url())).status();
    check("V9 — PULSAR la cabecera aterriza en /tienda-demo con 200", 200, landedStatus);
    check(
      "V9 — la URL final es /tienda-demo (no la raíz del sitio)",
      `${BASE}/tienda-demo`,
      page.url().replace(/\/$/, ""),
    );
    checkTrue(
      "V9 — la página de destino trae el catálogo (no un segundo 404)",
      (await page.locator("h1").count()) > 0,
    );
    await shot(page, "V09-404-producto-despues-del-clic");
    await page.close();
  }
  {
    // Mismo guion, entrando por un alias: la salida tiene que aterrizar en
    // el CANÓNICO (bodega-central), nunca en el alias por el que se entró.
    const page = await context.newPage();
    const resp = await page.goto(`${BASE}/bodega-central-vedado/c/no-existe-${SUFFIX}`, {
      waitUntil: "networkidle",
    });
    await prepararPagina(page, "/bodega-central-vedado/c/no-existe (V9 alias)");
    check("V9 (alias) — el 404 de categoría responde 404", 404, resp.status());
    const headerLink = page.getByRole("link", { name: /Bodega Central/ });
    checkTrue("V9 (alias) — existe el enlace de la cabecera", (await headerLink.count()) > 0);
    const hrefAntes = await headerLink.first().getAttribute("href");
    check("V9 (alias) — el href de la cabecera ya es el canónico", "/bodega-central", hrefAntes);
    await Promise.all([page.waitForURL(/\/bodega-central\/?$/), headerLink.first().click()]);
    const landedStatusAlias = (await page.request.get(page.url())).status();
    check("V9 (alias) — PULSAR aterriza en /bodega-central con 200", 200, landedStatusAlias);
    check(
      "V9 (alias) — la URL final es el canónico, no el alias por el que se entró",
      `${BASE}/bodega-central`,
      page.url().replace(/\/$/, ""),
    );
    await shot(page, "V09-404-alias-despues-del-clic");
    await page.close();
  }

  // --- V10 · la tienda cerrada ----------------------------------------------

  {
    const page = await context.newPage();
    const resp = await page.goto(`${BASE}/tienda-cerrada/carrito`, { waitUntil: "networkidle" });
    check("V10 — /tienda-cerrada/carrito responde 200", 200, resp.status());
    check(
      "V10 — el rastro está completo (2 eslabones: sucursal + Carrito)",
      2,
      await crumbCount(page),
    );
    await shot(page, "V10-tienda-cerrada-carrito");
    await page.close();
  }
  {
    const page = await context.newPage();
    const resp = await page.goto(`${BASE}/tienda-cerrada/c/lo-que-sea-${SUFFIX}`, {
      waitUntil: "networkidle",
    });
    check("V10 — /tienda-cerrada/c/<cualquiera> responde 200", 200, resp.status());
    check(
      "V10 — el rastro se detiene en la sucursal (1 eslabón, sin categoría)",
      1,
      await crumbCount(page),
    );
    const current = page.locator('nav[aria-label="Ruta"] [aria-current="page"]');
    checkTrue("V10 — el único eslabón es la sucursal, sin href", (await current.count()) === 1);
    await shot(page, "V10-tienda-cerrada-categoria");
    await page.close();
  }

  // --- V11 · en la ficha, la categoría aparece una sola vez y dentro del
  //     rastro (DP1/PP1) ----------------------------------------------------

  {
    const page = await context.newPage();
    await page.goto(`${BASE}/tienda-demo/p/jugo-de-mango-1-l`, { waitUntil: "networkidle" });
    await prepararPagina(page, "/tienda-demo/p/jugo-de-mango-1-l (V11)");
    const enlaceBebidasEnNav = page.locator('nav[aria-label="Ruta"] a', { hasText: "Bebidas" });
    check(
      "V11 — exactamente un <a> con texto Bebidas dentro del rastro",
      1,
      await enlaceBebidasEnNav.count(),
    );
    // :text-is() cuenta el elemento MÁS PEQUEÑO cuyo texto sea exactamente
    // "Bebidas" — así el <a> y su <span> interior no se cuentan dos veces,
    // y el <script type="application/ld+json"> (que SÍ lleva la cadena,
    // R13) no cuenta porque no es texto renderizado.
    const todosBebidas = await page.locator(':text-is("Bebidas")').count();
    check("V11 — CERO elementos con texto Bebidas fuera del rastro", 1, todosBebidas);
    const h1EsPrimero = await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      return h1 != null && h1.parentElement.firstElementChild === h1;
    });
    checkTrue("V11 — el <h1> es el primer hijo de su columna (no hay línea encima)", h1EsPrimero);
    await shot(page, "V11-ficha-una-sola-bebidas");
    await page.close();
  }
  {
    // Control de que DP1 no se pasó de largo: el chip del catálogo (F-026)
    // sigue en su sitio, sin tocar.
    const page = await context.newPage();
    await page.goto(`${BASE}/tienda-demo/c/bebidas`, { waitUntil: "networkidle" });
    const chipActivo = page.locator('nav[aria-label="Categorías"] a[aria-current="page"]');
    check(
      "V11 — el chip Bebidas sigue activo en /c/bebidas (StoreCategoryNav intacto)",
      "Bebidas",
      (await chipActivo.innerText()).trim(),
    );
    await page.close();
  }
} catch (e) {
  fail(`el guion visual se rompió: ${e.message}`);
} finally {
  try {
    if (paraLimpiar.categoryExternalIds.length > 0) {
      psql(`DELETE FROM "StoreProduct" WHERE "externalId" LIKE 'visual25-longprod%-${SUFFIX}'`);
      const patron = paraLimpiar.categoryExternalIds.map((id) => `'${id}'`).join(",");
      psql(`DELETE FROM "LocalCategory" WHERE "externalId" IN (${patron})`);
      psql(`DELETE FROM "CanonicalProduct" cp
        WHERE NOT EXISTS (SELECT 1 FROM "StoreProduct" sp WHERE sp."canonicalProductId" = cp.id)
          AND cp.name LIKE '%${SUFFIX}%'`);
      // Mismo aviso que F-026/visual.mjs: el DELETE es SQL directo y no pasa
      // por revalidateTag(), así que el proceso que atendió este guion se
      // quedaría sirviendo la versión vieja desde su Data Cache hasta que
      // expire STOREFRONT_REVALIDATE. Un evento de sync trivial (mismo precio
      // de siempre) es lo único que la refresca de verdad.
      if (TOKEN) {
        await syncCatalog([
          productEvent(
            "seed-tienda-1-p0",
            "seed-producto-0",
            "seed-tienda-1",
            "Refresco de cola 1.5 L",
            "seed-cat-bebidas",
            450,
          ),
        ]);
      }
    }
  } catch (e) {
    fail(`la limpieza final falló — revisar la base a mano: ${e.message}`);
  }
  await context.tracing.stop({ path: `${TRACES}/trace.zip` });
  await browser.close();
}

console.log(`\n${fails} aserciones fallidas`);
process.exit(fails === 0 ? 0 : 1);
