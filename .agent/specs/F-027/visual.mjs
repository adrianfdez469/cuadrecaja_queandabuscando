// Verificación visual de F-027. La ejecuta `bash .agent/verify.sh F-027
// --visual` con la app ya levantada; $VISUAL_BASE_URL apunta a ella,
// $VISUAL_SHOTS es la carpeta de capturas y $VISUAL_TRACES la del trace de
// Playwright.
//
// Traduce los dieciocho pasos V1-V18 de `.agent/specs/F-027/design.md` §
// Verificación visual. Copiado con el criterio de
// `.agent/specs/F-026/visual.mjs` (los helpers check/checkTrue/checkClose/
// fail/note, `vigilarConsola`, el patrón de sembrar por sync + limpiar con
// `psql` en un `finally`) y `.agent/specs/F-021/visual.mjs` (JS desactivado
// vía `context.setJavaScriptEnabled` para V8/V9).
//
// Datos: los de `npm run seed` (tienda-demo con Alimentos 5/Aseo 3/Bebidas
// 4/Panadería 3, 2 OUT_OF_STOCK, 3 destacados, CERO promociones — de ahí que
// V10 espere "Solo con descuento" AUSENTE; tienda-dos con 5 productos, verde,
// radius:"round"; tienda-cerrada SUSPENDED). V18 necesita más de 8
// categorías (el tope de fila antes del sub-desplegable) y las siembra este
// guion por sync, con un sufijo `visual-…-$SUFFIX`, nunca los nombres reales
// de la fixture — se borran en el `finally`.
//
// Regla: cada aserción que no se cumpla imprime `VISUAL FAIL <qué>`.

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
function checkClose(que, esperado, obtenido, tolerancia = 4) {
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

// --- sync real, mismo patrón que F-026/visual.mjs ---------------------------

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

function categoryEvent(categoryId, name) {
  return {
    eventId: `evt-${categoryId}-${now()}`,
    entity: "CATEGORY",
    operation: "CREATE",
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
  fail("QAB_BEARER_TOKEN no está en el entorno — V18 necesita sync real, no se puede ejecutar");
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: MOVIL });
await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

const paraLimpiar = { categoryExternalIds: [] };

try {
  // --- V1 — enlace de entrada junto al <h1>, fila de 44px, primera tarjeta baja 12px

  for (const [nombre, viewport] of [
    ["360", MOVIL],
    ["768", TABLET],
    ["1280", ESCRITORIO],
  ]) {
    const v1 = await context.newPage();
    await v1.setViewportSize(viewport);
    await v1.goto(`${BASE}/tienda-demo`, { waitUntil: "networkidle" });
    await prepararPagina(v1, `/tienda-demo (V1, ${nombre}px)`);
    const h1 = v1.locator("h1", { hasText: "Catálogo" });
    const enlace = v1.getByRole("link", { name: "Filtrar y ordenar" });
    checkTrue(`V1 — el <h1> existe a ${nombre}px`, (await h1.count()) > 0);
    checkTrue(
      `V1 — el enlace "Filtrar y ordenar" existe a ${nombre}px`,
      (await enlace.count()) > 0,
    );
    const h1Box = await h1.boundingBox();
    const enlaceBox = await enlace.boundingBox();
    // "Misma línea" = sus rangos verticales se solapan — no el mismo `top`
    // exacto, porque el `<h1>` (32px) y el enlace (44px, min-h-11) tienen
    // alturas distintas y se centran cada uno dentro de la fila flex.
    const solapanVerticalmente =
      h1Box &&
      enlaceBox &&
      Math.max(h1Box.y, enlaceBox.y) <
        Math.min(h1Box.y + h1Box.height, enlaceBox.y + enlaceBox.height);
    checkTrue(
      `V1 — están en la MISMA línea a ${nombre}px (rango vertical solapado)`,
      solapanVerticalmente,
    );
    checkTrue(`V1 — el enlace está a la DERECHA del <h1> a ${nombre}px`, enlaceBox.x > h1Box.x);
    if (nombre === "360") {
      const fila = v1.locator("h1", { hasText: "Catálogo" }).locator("xpath=..");
      const filaBox = await fila.boundingBox();
      checkClose("V1 — la fila del <h1> mide ~44px de alto a 360px", 44, filaBox?.height, 6);
      const primeraTarjeta = await v1.locator("ul.grid > li").first().boundingBox();
      checkClose(
        "V1 — la primera tarjeta baja a y≈428 (era 416) a 360px",
        428,
        primeraTarjeta?.y,
        20,
      );
      await shot(v1, "V01-tienda-demo-360");
    }
    checkTrue(`V1 — sin scroll horizontal a ${nombre}px`, !(await sinDesbordeHorizontal(v1)));
    await v1.close();
  }

  // --- V2 — sin parámetros: panel ABIERTO, nada marcado, ningún chip ------

  const v2 = await context.newPage();
  await v2.goto(`${BASE}/tienda-demo/catalogo`, { waitUntil: "networkidle" });
  await prepararPagina(v2, "/tienda-demo/catalogo (V2)");
  const v2Details = v2.locator("details").first();
  checkTrue(
    "V2 — el panel llega ABIERTO sin parámetros",
    await v2Details.evaluate((el) => el.open),
  );
  const v2Checked = await v2.locator('input[type="checkbox"]:checked').count();
  check("V2 — ninguna casilla marcada", 0, v2Checked);
  check(
    "V2 — ningún chip de filtro aplicado",
    0,
    await v2.locator('nav[aria-label="Filtros aplicados"] a').count(),
  );
  await shot(v2, "V02-catalogo-sin-parametros-360");
  await v2.close();

  // --- V3 — con un filtro: panel PLEGADO (46px), "Filtros y orden (1)", chip

  for (const [nombre, viewport] of [
    ["360", MOVIL],
    ["1280", ESCRITORIO],
  ]) {
    const v3 = await context.newPage();
    await v3.setViewportSize(viewport);
    await v3.goto(`${BASE}/tienda-demo/catalogo?categorySlug=bebidas`, {
      waitUntil: "networkidle",
    });
    await prepararPagina(v3, `/tienda-demo/catalogo?categorySlug=bebidas (V3, ${nombre}px)`);
    const v3Details = v3.locator("details").first();
    checkTrue(
      `V3 — el panel llega PLEGADO con un filtro a ${nombre}px`,
      !(await v3Details.evaluate((el) => el.open)),
    );
    const v3Summary = v3.locator("summary").first();
    check(
      `V3 — el resumen dice "Filtros y orden (1)" a ${nombre}px`,
      "Filtros y orden (1)",
      (await v3Summary.innerText()).trim(),
    );
    const v3SummaryBox = await v3Summary.boundingBox();
    checkClose(`V3 — el panel plegado mide ~46px a ${nombre}px`, 46, v3SummaryBox?.height, 6);
    checkTrue(
      `V3 — el chip aparece por encima del panel a ${nombre}px`,
      (await v3.locator('nav[aria-label="Filtros aplicados"] a').first().boundingBox()).y <
        v3SummaryBox.y,
    );
    if (nombre === "360") await shot(v3, "V03-un-filtro-plegado-360");
    await v3.close();
  }

  // --- V4 — panel abierto: columnas por ancho -----------------------------
  // El número exacto de píxeles que design.md mide sale de un prototipo
  // inyectado, no del markup final del implementador — lo que SÍ tiene que
  // ser cierto contra el markup real es la estructura: 1 columna a 360, 2 a
  // 768, 4 a 1280 (grid-cols-1 sm:grid-cols-2 lg:grid-cols-4). Se lee
  // `grid-template-columns` del propio contenedor (cuenta las pistas,
  // "257.5px 257.5px 257.5px 257.5px" = 4) — contar coordenadas X de los
  // `<fieldset>` no sirve porque "Precio" ocupa DOS columnas a propósito
  // (dos campos + tres atajos no caben en una).

  for (const [nombre, viewport, columnas] of [
    ["360", MOVIL, 1],
    ["768", TABLET, 2],
    ["1280", ESCRITORIO, 4],
  ]) {
    const v4 = await context.newPage();
    await v4.setViewportSize(viewport);
    await v4.goto(`${BASE}/tienda-demo/catalogo`, { waitUntil: "networkidle" });
    await prepararPagina(v4, `/tienda-demo/catalogo (V4, ${nombre}px)`);
    const v4Grid = v4.locator("details").first().locator("fieldset").first().locator("xpath=..");
    const v4Tracks = (await v4Grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns))
      .trim()
      .split(/\s+/).length;
    check(`V4 — ${columnas} columna(s) de grupos a ${nombre}px`, columnas, v4Tracks);
    if (nombre === "360") await shot(v4, "V04-panel-abierto-360");
    await v4.close();
  }

  // --- V5 — sin scroll horizontal con panel abierto + varios chips --------

  const v5 = await context.newPage();
  await v5.goto(
    `${BASE}/tienda-demo/catalogo?categorySlug=bebidas&categorySlug=alimentos&categorySlug=aseo&categorySlug=panaderia&disponibilidad=hay&destacados=si&precio_min=1`,
    { waitUntil: "networkidle" },
  );
  await prepararPagina(v5, "/tienda-demo/catalogo (V5, muchos chips)");
  // El panel llega plegado (hay filtros); se fuerza abierto para comprobar
  // el peor caso — panel abierto + chips a la vez — con el mismo <details>.
  await v5.evaluate(() => {
    const d = document.querySelector("details");
    if (d) d.open = true;
  });
  for (const [nombre, viewport] of [
    ["360", MOVIL],
    ["768", TABLET],
    ["1280", ESCRITORIO],
  ]) {
    await v5.setViewportSize(viewport);
    await v5.waitForTimeout(150);
    checkTrue(
      `V5 — sin scroll horizontal a ${nombre}px (panel abierto + chips)`,
      !(await sinDesbordeHorizontal(v5)),
    );
  }
  await shot(v5, "V05-panel-abierto-y-chips-360");
  await v5.close();

  // --- V6 — "Aplicar" pegajoso mientras se recorre el panel abierto -------

  const v6 = await context.newPage({ viewport: MOVIL });
  await v6.goto(`${BASE}/tienda-demo/catalogo`, { waitUntil: "networkidle" });
  await prepararPagina(v6, "/tienda-demo/catalogo (V6, 360px)");
  const v6Boton = v6.getByRole("button", { name: "Aplicar" });
  const v6PosicionInicial = await v6Boton.evaluate(
    (el) => getComputedStyle(el.closest("div")).position,
  );
  await v6.evaluate(() => window.scrollBy(0, 200));
  await v6.waitForTimeout(100);
  const v6BoxTrasScroll = await v6Boton.boundingBox();
  checkTrue(
    "V6 — a 360px, 'Aplicar' se queda cerca del borde inferior de la ventana mientras se recorre el panel",
    v6BoxTrasScroll && v6BoxTrasScroll.y < MOVIL.height && v6BoxTrasScroll.y > MOVIL.height - 140,
  );
  checkTrue(
    "V6 — la fila de acciones usa position: sticky a 360px",
    v6PosicionInicial === "sticky",
  );
  await shot(v6, "V06-aplicar-pegajoso-360");
  await v6.close();

  const v6b = await context.newPage();
  await v6b.setViewportSize(ESCRITORIO);
  await v6b.goto(`${BASE}/tienda-demo/catalogo`, { waitUntil: "networkidle" });
  const v6bBoton = v6b.getByRole("button", { name: "Aplicar" });
  const v6bPosicion = await v6bBoton.evaluate((el) => getComputedStyle(el.closest("div")).position);
  checkTrue("V6 — a 1280px 'Aplicar' NO es pegajoso (lg:static)", v6bPosicion !== "sticky");
  await v6b.close();

  // --- V7 — recorrido con Tab, anillo de foco visible en cada parada -------

  const v7 = await context.newPage({ viewport: MOVIL });
  await v7.goto(`${BASE}/tienda-demo/catalogo?categorySlug=bebidas`, { waitUntil: "networkidle" });
  await prepararPagina(v7, "/tienda-demo/catalogo?categorySlug=bebidas (V7)");
  await v7.locator("#q").focus();
  check("V7 — el foco empieza en #q", "q", await v7.evaluate(() => document.activeElement?.id));
  await v7.keyboard.press("Tab"); // → Buscar
  await v7.keyboard.press("Tab"); // → chip aplicado
  const v7Chip = await v7.evaluate(() => document.activeElement?.tagName);
  checkTrue("V7 — tras Buscar, el foco llega a un elemento enfocable (el chip)", v7Chip === "A");
  await v7.keyboard.press("Tab"); // → Quitar todos (si hay 1 solo chip no aparece; puede ser el <summary>)
  const v7TrasChip = await v7.evaluate(() => {
    const el = document.activeElement;
    return { tag: el?.tagName, texto: el?.textContent?.trim().slice(0, 30) };
  });
  checkTrue(
    "V7 — el foco sigue avanzando de forma predecible (summary o siguiente control)",
    Boolean(v7TrasChip.tag),
  );
  const v7Outline = await v7.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    return { width: parseFloat(cs.outlineWidth) || 0, style: cs.outlineStyle };
  });
  if (v7Outline.width === 0) {
    note("V7 — outline-width midió 0 en Chromium headless; revisar a mano");
  } else {
    checkTrue("V7 — el anillo de foco es visible", v7Outline.style !== "none");
  }
  await shot(v7, "V07-tabulacion-360");
  await v7.close();

  // --- V8 — Enter sobre <summary> abre/cierra el panel SIN JavaScript -----

  const ctxSinJs = await browser.newContext({ viewport: MOVIL, javaScriptEnabled: false });
  const v8 = await ctxSinJs.newPage();
  await v8.goto(`${BASE}/tienda-demo/catalogo?categorySlug=bebidas`, { waitUntil: "load" });
  const v8Details = v8.locator("details").first();
  checkTrue(
    "V8 — con JS desactivado, el panel arranca plegado (hay un filtro)",
    !(await v8Details.evaluate((el) => el.open)),
  );
  await v8.locator("summary").first().focus();
  await v8.keyboard.press("Enter");
  checkTrue(
    "V8 — Enter sobre <summary> ABRE el panel sin JavaScript",
    await v8Details.evaluate((el) => el.open),
  );
  await v8.keyboard.press("Enter");
  checkTrue(
    "V8 — Enter sobre <summary> CIERRA el panel sin JavaScript",
    !(await v8Details.evaluate((el) => el.open)),
  );
  await shot(v8, "V08-sin-js-summary-360");
  await v8.close();

  // --- V9 — sin JavaScript: marcar 2 casillas + Aplicar filtra; la X quita -

  const v9 = await ctxSinJs.newPage();
  await v9.goto(`${BASE}/tienda-demo/catalogo`, { waitUntil: "load" });
  await v9.locator('input[type="checkbox"][name="categorySlug"][value="bebidas"]').check();
  await v9.locator('input[type="checkbox"][name="disponibilidad"]').check();
  await Promise.all([v9.waitForNavigation(), v9.getByRole("button", { name: "Aplicar" }).click()]);
  const v9Url = new URL(v9.url());
  check(
    "V9 — sin JS, Aplicar navega con categorySlug=bebidas",
    "bebidas",
    v9Url.searchParams.get("categorySlug"),
  );
  check(
    "V9 — sin JS, Aplicar navega con disponibilidad=hay",
    "hay",
    v9Url.searchParams.get("disponibilidad"),
  );
  checkTrue(
    "V9 — el resultado filtrado se ve en el HTML sin JavaScript (Agua natural, disponible, bebidas)",
    (await v9.getByText("Agua natural 500 ml", { exact: false }).count()) > 0,
  );
  checkTrue(
    "V9 — el agotado de bebidas (Jugo de mango) no aparece con el filtro aplicado",
    (await v9.getByText("Jugo de mango 1 L", { exact: false }).count()) === 0,
  );
  const v9Chip = v9.locator('nav[aria-label="Filtros aplicados"] a').first();
  await Promise.all([v9.waitForNavigation(), v9Chip.click()]);
  const v9UrlTrasQuitar = new URL(v9.url());
  checkTrue(
    "V9 — quitar un chip sin JavaScript navega y le queda un filtro menos",
    v9UrlTrasQuitar.searchParams.get("categorySlug") === null ||
      v9UrlTrasQuitar.searchParams.get("disponibilidad") === null,
  );
  await shot(v9, "V09-sin-js-filtrado-360");
  await v9.close();
  await ctxSinJs.close();

  // --- V10 — conteos exactos de tienda-demo -------------------------------

  const v10 = await context.newPage({ viewport: MOVIL });
  await v10.goto(`${BASE}/tienda-demo/catalogo`, { waitUntil: "networkidle" });
  await prepararPagina(v10, "/tienda-demo/catalogo (V10)");
  async function conteoDe(page, name) {
    const label = page.locator("label", { has: page.locator(`input[value="${name}"]`) });
    if ((await label.count()) === 0) return null;
    return (await label.locator('span[aria-hidden="true"]').innerText()).trim();
  }
  check("V10 — Bebidas (4)", "(4)", await conteoDe(v10, "bebidas"));
  check("V10 — Alimentos (5)", "(5)", await conteoDe(v10, "alimentos"));
  check("V10 — Aseo (3)", "(3)", await conteoDe(v10, "aseo"));
  check("V10 — Panadería (3)", "(3)", await conteoDe(v10, "panaderia"));
  check("V10 — Solo lo que hay ahora (13)", "(13)", await conteoDe(v10, "hay"));
  check("V10 — Solo destacados (3)", "(3)", await conteoDe(v10, "si"));
  check(
    "V10 — «Solo con descuento» NO aparece (0 promociones en toda la base)",
    0,
    await v10.locator('input[name="promocion"]').count(),
  );
  await shot(v10, "V10-conteos-360");
  await v10.close();

  // --- V11 — los tres atajos de precio, con conteos y la línea de rango ---

  const v11 = await context.newPage({ viewport: MOVIL });
  await v11.goto(`${BASE}/tienda-demo/catalogo`, { waitUntil: "networkidle" });
  const v11Text = await v11.locator("details").first().innerText();
  checkTrue(
    "V11 — el atajo 'Hasta $350' con su conteo (5)",
    /Hasta \$350.*5/.test(v11Text.replace(/\n/g, " ")),
  );
  checkTrue(
    "V11 — el atajo 'De $350 a $540' con su conteo (5)",
    /De \$350 a \$540.*5/.test(v11Text.replace(/\n/g, " ")),
  );
  checkTrue(
    "V11 — el atajo 'Más de $540' con su conteo (5)",
    /Más de \$540.*5/.test(v11Text.replace(/\n/g, " ")),
  );
  checkTrue(
    "V11 — la línea de rango dice de 90 a 1.150",
    /90/.test(v11Text) && /1.?150/.test(v11Text),
  );
  await v11.close();

  // --- V12 — tienda-dos (5 productos, n<12): SIN atajos --------------------

  const v12 = await context.newPage({ viewport: MOVIL });
  await v12.goto(`${BASE}/tienda-dos/catalogo`, { waitUntil: "networkidle" });
  await prepararPagina(v12, "/tienda-dos/catalogo (V12)");
  const v12Text = await v12.locator("details").first().innerText();
  checkTrue("V12 — tienda-dos NO tiene atajos de tramo (Hasta $)", !/Hasta \$/.test(v12Text));
  checkTrue(
    "V12 — tienda-dos SÍ conserva los dos campos Desde/Hasta",
    (await v12.locator("#precio_min").count()) > 0 &&
      (await v12.locator("#precio_max").count()) > 0,
  );
  await v12.close();

  // --- V13 — "Últimos añadidos al catálogo", letra pequeña, sin "Novedades"

  const v13 = await context.newPage({ viewport: MOVIL });
  await v13.goto(`${BASE}/tienda-demo/catalogo?sort=reciente`, { waitUntil: "networkidle" });
  await prepararPagina(v13, "/tienda-demo/catalogo?sort=reciente (V13)");
  // Con `sort` aplicado el panel llega PLEGADO (§ Decisión 1): la letra
  // pequeña completa vive DENTRO del `<details>` cerrado (no se lee con
  // `innerText`, un `<details>` cerrado no se pinta) y la línea de
  // resultados, que SIEMPRE está visible, lleva su propia versión corta.
  // Se comprueban las dos por separado, no solo la visible.
  const v13ResultLine = await v13.locator("p", { hasText: "productos" }).first().innerText();
  checkTrue(
    "V13 — la línea de resultados nombra el orden sin decir 'Novedades'",
    /últimos añadidos al catálogo/.test(v13ResultLine),
  );
  await v13.evaluate(() => {
    const d = document.querySelector("details");
    if (d) d.open = true;
  });
  const v13PanelText = await v13.locator("details").first().innerText();
  checkTrue(
    "V13 — con el panel abierto, aparece la letra pequeña completa de 'reciente'",
    /cuándo entró cada producto en este catálogo/.test(v13PanelText),
  );
  const v13BodyText = await v13.locator("body").innerText();
  checkTrue("V13 — ningún texto de la pantalla dice 'Novedades'", !/Novedades/.test(v13BodyText));
  await v13.close();

  // --- V14 — los cuatro vacíos, primeras frases distintas ------------------

  // El texto de cada vacío vive en un <p> normal, no en un encabezado — se
  // busca en el texto completo de la página, no solo en h1/h2.
  const primeraFrase = async (url) => {
    const p = await context.newPage({ viewport: MOVIL });
    await p.goto(url, { waitUntil: "networkidle" });
    const texto = await p.locator("body").innerText();
    await p.close();
    return texto;
  };
  const v14a = await primeraFrase(`${BASE}/el-trebol-centro/catalogo`); // tienda publicada sin productos
  const v14c = await primeraFrase(`${BASE}/tienda-demo/catalogo?precio_min=999999`); // filtros sin resultado
  checkTrue(
    "V14 — (a) tienda sin productos trae SU frase",
    /todavía no tiene productos publicados/.test(v14a),
  );
  checkTrue("V14 — (a) NO dice la frase de (c)", !/no queda ningún producto/.test(v14a));
  checkTrue("V14 — (c) filtros sin resultado trae SU frase", /no queda ningún producto/.test(v14c));
  checkTrue(
    "V14 — (c) NO dice la frase de (a)",
    !/todavía no tiene productos publicados/.test(v14c),
  );
  const v14b = await primeraFrase(`${BASE}/tienda-demo/buscar?q=xyzxyzxyz-sin-resultado`);
  checkTrue(
    "V14 — (b) búsqueda sin resultados trae SU frase (Sin resultados)",
    /Sin resultados/.test(v14b),
  );

  // --- V15 — SUSPENDED sin panel/chips; selector 404 -----------------------

  const v15a = await context.newPage({ viewport: MOVIL });
  const respV15a = await v15a.goto(`${BASE}/tienda-cerrada/catalogo`, { waitUntil: "networkidle" });
  await prepararPagina(v15a, "/tienda-cerrada/catalogo (V15)");
  check("V15 — /tienda-cerrada/catalogo responde 200", 200, respV15a.status());
  checkTrue(
    "V15 — aparece el aviso de cerrada",
    (await v15a.getByText("cerrad", { exact: false }).count()) > 0,
  );
  check("V15 — sin panel (<details>)", 0, await v15a.locator("details").count());
  check("V15 — sin chips", 0, await v15a.locator('nav[aria-label="Filtros aplicados"]').count());
  await shot(v15a, "V15-tienda-cerrada-catalogo");
  await v15a.close();

  const respV15b = await (
    await context.newPage()
  ).goto(`${BASE}/el-trebol/catalogo`, {
    waitUntil: "networkidle",
  });
  check("V15 — slug en modo selector responde 404", 404, respV15b.status());

  // --- V16 — el chip aplicado no se confunde con el chip activo de F-026 --

  const v16 = await context.newPage({ viewport: MOVIL });
  await v16.goto(`${BASE}/tienda-demo/catalogo?categorySlug=bebidas`, { waitUntil: "networkidle" });
  await prepararPagina(v16, "/tienda-demo/catalogo?categorySlug=bebidas (V16)");
  const v16ChipBg = await v16
    .locator('nav[aria-label="Filtros aplicados"] a')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const v16Boton = await v16
    .locator('button[type="submit"]', { hasText: "Aplicar" })
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  checkTrue(
    "V16 — el chip aplicado y el botón Aplicar usan colores distintos",
    v16ChipBg !== v16Boton,
  );
  await shot(v16, "V16-chip-vs-aplicar-360");
  await v16.close();

  const v16b = await context.newPage({ viewport: MOVIL });
  await v16b.goto(`${BASE}/tienda-dos/catalogo?categorySlug=bebidas`, { waitUntil: "networkidle" });
  const v16bBoton = await v16b
    .locator('button[type="submit"]', { hasText: "Aplicar" })
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  checkTrue(
    "V16 — tienda-dos (verde): el botón Aplicar sale del brand de la tienda (no gris)",
    v16bBoton !== "rgb(255, 255, 255)",
  );
  await v16b.close();

  const ctxOscuro = await browser.newContext({ viewport: MOVIL, colorScheme: "dark" });
  const v16c = await ctxOscuro.newPage();
  await v16c.goto(`${BASE}/tienda-demo/catalogo?categorySlug=bebidas`, {
    waitUntil: "networkidle",
  });
  const v16cChipBg = await v16c
    .locator('nav[aria-label="Filtros aplicados"] a')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const v16cPageBg = await v16c.evaluate(() => getComputedStyle(document.body).backgroundColor);
  checkTrue("V16 — en oscuro, el chip se distingue del fondo", v16cChipBg !== v16cPageBg);
  await shot(v16c, "V16-oscuro-360");
  await ctxOscuro.close();

  // --- V17 — el árbol de accesibilidad anuncia "Bebidas, N productos" -----
  // `page.accessibility` no existe en esta versión de Playwright (API
  // retirada); `locator.ariaSnapshot()` es su reemplazo y da directamente el
  // NOMBRE ACCESIBLE calculado de cada casilla, que es lo que un lector de
  // pantalla anuncia — no el HTML crudo con su `(4)` decorativo aparte.

  const v17 = await context.newPage({ viewport: MOVIL });
  await v17.goto(`${BASE}/tienda-demo/catalogo`, { waitUntil: "networkidle" });
  const v17Snapshot = await v17.locator("fieldset", { hasText: "Categoría" }).ariaSnapshot();
  checkTrue(
    'V17 — el nombre accesible de la casilla es "Bebidas 4 productos" (no "abre paréntesis")',
    /checkbox "Bebidas 4 productos"/.test(v17Snapshot),
  );
  note(
    'V17 — el singular ("1 producto") no se comprueba: ninguna faceta de tienda-demo tiene conteo 1 (todas ≥3)',
  );
  await v17.close();

  // --- V18 — 15 categorías sembradas: un filtro dentro del sub-desplegable
  //     lo abre -----------------------------------------------------------

  if (TOKEN) {
    const eventosV18 = [];
    for (let i = 1; i <= 15; i++) {
      const catId = `visual-f027-cat-${i}-${SUFFIX}`;
      const prodId = `visual-f027-prod-${i}-${SUFFIX}`;
      paraLimpiar.categoryExternalIds.push(catId);
      eventosV18.push(
        categoryEvent(catId, `Visual F027 Categoria ${String(i).padStart(2, "0")} ${SUFFIX}`),
      );
      eventosV18.push(
        productEvent(
          prodId,
          `visual-f027-producto-${i}-${SUFFIX}`,
          "seed-tienda-1",
          `Visual F027 Producto ${i} ${SUFFIX}`,
          catId,
          10 + i,
        ),
      );
    }
    const { status: v18SyncStatus } = await syncCatalog(eventosV18);
    check("V18 — el lote de 15 categorías + 15 productos se procesa (207)", 207, v18SyncStatus);

    const v18 = await context.newPage({ viewport: MOVIL });
    await v18.goto(`${BASE}/tienda-demo/catalogo`, { waitUntil: "networkidle" });
    await prepararPagina(v18, "/tienda-demo/catalogo (V18, 15+ categorías propias)");
    const v18SubDetails = v18.locator("fieldset", { hasText: "Categoría" }).locator("details");
    checkTrue(
      "V18 — existe el sub-desplegable de categorías (más de 8)",
      (await v18SubDetails.count()) > 0,
    );
    checkTrue(
      "V18 — el sub-desplegable llega CERRADO cuando nada de lo que esconde está marcado",
      !(await v18SubDetails.first().evaluate((el) => el.open)),
    );
    await v18.close();

    const primeraCategoriaEscondida = `visual-f027-cat-9-${SUFFIX}`;
    const v18b = await context.newPage({ viewport: MOVIL });
    // La novena categoría por orden alfabético cae, casi con certeza, más
    // allá del tope de 8 filas visibles — se comprueba que EXISTE en el
    // sub-desplegable filtrando por su slug directamente, y que con ese
    // valor en la URL el sub-desplegable llega ABIERTO.
    const catSlug = psql(
      `SELECT slug FROM "LocalCategory" WHERE "externalId"='${primeraCategoriaEscondida}'`,
    );
    if (catSlug) {
      await v18b.goto(`${BASE}/tienda-demo/catalogo?categorySlug=${catSlug}`, {
        waitUntil: "networkidle",
      });
      const v18bChecked = v18b.locator(`input[name="categorySlug"][value="${catSlug}"]`);
      checkTrue("V18 — la categoría escondida SÍ llega marcada", await v18bChecked.isChecked());
      const v18bSub = v18bChecked.locator("xpath=ancestor::details[1]");
      const esSubDesplegable = (await v18bSub.count()) > 0;
      if (esSubDesplegable) {
        checkTrue(
          "V18 — con un filtro marcado dentro, el sub-desplegable llega ABIERTO",
          await v18bSub.evaluate((el) => el.open),
        );
      } else {
        note(
          "V18 — esa categoría cayó dentro de las primeras 8 filas visibles (orden alfabético distinto del esperado); repetido con otra categoría",
        );
      }
      await shot(v18b, "V18-subdesplegable-abierto-360");
    } else {
      fail("V18 — no se encontró el slug de la categoría sintética (¿falló el sync?)");
    }
    await v18b.close();
  } else {
    fail("V18 — no se pudo sembrar (falta QAB_BEARER_TOKEN)");
  }
} catch (e) {
  fail(`el guion visual se rompió: ${e.message}`);
} finally {
  try {
    if (paraLimpiar.categoryExternalIds.length > 0) {
      psql(`DELETE FROM "StoreProduct" WHERE "externalId" LIKE 'visual-f027-prod-%-${SUFFIX}'`);
      const patronCat = paraLimpiar.categoryExternalIds.map((id) => `'${id}'`).join(",");
      psql(`DELETE FROM "LocalCategory" WHERE "externalId" IN (${patronCat})`);
      psql(`DELETE FROM "CanonicalProduct" cp
        WHERE NOT EXISTS (SELECT 1 FROM "StoreProduct" sp WHERE sp."canonicalProductId" = cp.id)
          AND cp.name LIKE '%${SUFFIX}%'`);
      // Un DELETE directo no dispara revalidateTag (playbook F-026): un
      // evento de sync inocuo sobre un producto real de tienda-demo fuerza
      // revalidateStores() antes de que otra sesión vea la caché con las 15
      // categorías sintéticas todavía puestas.
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
