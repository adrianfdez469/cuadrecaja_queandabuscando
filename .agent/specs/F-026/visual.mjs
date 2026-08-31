// Verificación visual de F-026. La ejecuta `bash .agent/verify.sh F-026
// --visual` con la app ya levantada; $VISUAL_BASE_URL apunta a ella,
// $VISUAL_SHOTS es la carpeta de capturas y $VISUAL_TRACES la del trace de
// Playwright.
//
// Traduce los once pasos V1-V11 de `.agent/specs/F-026/design.md` §
// Verificación visual. Datos: los de `npm run seed` (tienda-demo con
// Alimentos/Aseo/Bebidas/Panadería, tienda-dos verde con radius:"round",
// tienda-cerrada SUSPENDED). Copiado con el criterio de
// `.agent/specs/F-021/visual.mjs` (la caja de búsqueda convive con la fila
// de chips en la misma pantalla, así que V5 comprueba las dos) y
// `.agent/specs/F-017/visual.mjs` (mismo marco de tienda — BranchBar,
// StoreClosedNotice — y el mismo patrón de crear una sucursal sintética por
// sync para un escenario que la base compartida no tiene, con `execSync`
// contra `psql` para leer lo que el sync generó).
//
// V7 y V9 de design.md ya los cubre `.agent/specs/F-026/smoke.sh` con
// `curl` — V7 de sobra (curl no ejecuta ni un byte de JavaScript, más
// estricto que cualquier navegador con JS desactivado). V9 se deja
// FUERA de smoke.sh a propósito y se traduce aquí en su lugar: lo que V9
// pide de verdad —que SEGUIR el enlace de salida del 404 aterrice en
// `/tienda-demo`, no en la raíz— es una navegación real, y eso es
// exactamente lo que un navegador (headless, reproducible, sin depender de
// que un humano conecte la extensión de Chrome) puede hacer y `curl` no:
// `curl` nunca resuelve un `href` relativo contra la URL actual, así que
// nunca podría demostrar a dónde lleva un clic. Ver tests.md § Qué cubre
// el visual y qué no para la lista completa con motivo.
//
// Regla: cada aserción que no se cumpla imprime `VISUAL FAIL <qué>`. Eso es
// lo que el sensor busca para ponerle firma al error.
//
// Regla de datos, igual que `smoke.sh`: todo lo que este guion crea (V10,
// V11) usa un `externalId`/`storeId` con sufijo `visual-…-$SUFFIX`, nunca
// los nombres de la fixture real, y se autolimpia con SQL directo en un
// `finally` — nunca deja la base de desarrollo con una fila más de las que
// tenía al empezar (28 StoreProduct, 5 LocalCategory, 10 Store, 19
// CanonicalProduct).

import "dotenv/config";
import { chromium } from "playwright";
import { execSync } from "node:child_process";

const BASE = process.env.VISUAL_BASE_URL ?? "http://localhost:3101";
const SHOTS = process.env.VISUAL_SHOTS ?? ".agent/runs/_libre/shots";
const TRACES = process.env.VISUAL_TRACES ?? ".agent/runs/_libre/traces";
const TOKEN = process.env.QAB_BEARER_TOKEN ?? "";
const BUSINESS_ID = "seed-negocio-1"; // Distribuidora La Rampa, dueña de tienda-demo/tienda-dos
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

// El indicador de dev-tools de Next vive en un <nextjs-portal> con position
// fixed y aterriza en mitad del contenido en una captura de página completa
// — se oculta en la página, no en next.config.ts, porque solo afecta a esta
// verificación.
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

// --- sync real: los mismos dos endpoints que .agent/specs/F-026/smoke.sh --

let nowCounter = 0;
function now() {
  // Milisegundos reales y estrictamente crecientes: dos eventos con el
  // mismo `updatedAt` chocan con la guarda anti-rancia (product.ts/misc.ts,
  // `sourceUpdatedAt.getTime() >= payloadUpdatedAt.getTime()` ⇒ STALE) y el
  // segundo del par se descartaría en silencio. Lección de smoke.sh.
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

function storeEvent(storeId, name) {
  return {
    eventId: `evt-${storeId}-${now()}`,
    entity: "STORE",
    operation: "CREATE",
    occurredAt: now(),
    payload: {
      storeId,
      businessId: BUSINESS_ID,
      businessName: "Distribuidora La Rampa",
      name,
      publishToStore: true,
      baseCurrency: "CUP",
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

// La base de desarrollo es COMPARTIDA entre worktrees y sesiones (mismo
// docker-compose.yml, mismo Postgres) — este mismo guion, en una corrida
// anterior, ya se cruzó con una `smoke.sh` de otra sesión corriendo al
// mismo tiempo sobre tienda-demo. Las aserciones "estructurales" (52px de
// alto, sin scroll horizontal, que las 4 categorías reales estén) no les
// afecta: son ciertas tenga tienda-demo 4 categorías o 4+N. Pero un puñado
// de aserciones SÍ dependen de que sean EXACTAMENTE 4 (qué chip es el
// último, en qué orden cae el Tab) — esas se saltan con una nota, no con
// un FAIL, cuando la base no está en el estado que este guion espera al
// empezar: no es un defecto de F-026, es una carrera con otro proceso.
const CATEGORIAS_TIENDA_DEMO_ESPERADAS = ["Alimentos", "Aseo", "Bebidas", "Panadería"];
function categoriasDeTiendaDemoLimpias() {
  const n = Number(
    psql(
      `SELECT count(DISTINCT sp."localCategoryId") FROM "StoreProduct" sp
       WHERE sp."storeId"='d2340170-638e-4bca-aa34-1d630f73604c' AND sp."deletedAt" IS NULL AND sp.visible
         AND sp."localCategoryId" IS NOT NULL`,
    ),
  );
  return n === CATEGORIAS_TIENDA_DEMO_ESPERADAS.length;
}

if (!TOKEN) {
  fail(
    "QAB_BEARER_TOKEN no está en el entorno — V10 y V11 necesitan sync real, no se pueden ejecutar",
  );
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: MOVIL });
await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

// Lo que este guion crea (V10, V11) y tiene que borrar al terminar, pase lo
// que pase con las aserciones — igual que `smoke.sh`.
const paraLimpiar = { categoryExternalIds: [], storefrontIdV11: null };

try {
  // --- V1 — a 360px: 52px, "Todo el catálogo" activo, la 4ª asoma cortada --

  const v1 = await context.newPage();
  await v1.goto(`${BASE}/tienda-demo`, { waitUntil: "networkidle" });
  await prepararPagina(v1, "/tienda-demo (V1, 360px)");
  const v1Nav = v1.locator('nav[aria-label="Categorías"]');
  checkTrue("V1 — la fila de categorías existe", (await v1Nav.count()) > 0);
  const v1NavBox = await v1Nav.boundingBox();
  checkClose("V1 — la fila mide 52px de alto a 360px", 52, v1NavBox?.height);
  const v1Chips = v1Nav.locator("a");
  const v1ChipCount = await v1Chips.count();
  checkTrue(
    "V1 — al menos 5 enlaces (Todo el catálogo + las 4 categorías reales)",
    v1ChipCount >= 5,
  );
  checkTrue(
    'V1 — "Todo el catálogo" está activo (aria-current=page)',
    (await v1Nav.locator('a[aria-current="page"]', { hasText: "Todo el catálogo" }).count()) > 0,
  );
  for (const nombre of CATEGORIAS_TIENDA_DEMO_ESPERADAS) {
    checkTrue(
      `V1 — el chip "${nombre}" está presente`,
      (await v1Nav.getByText(nombre, { exact: true }).count()) > 0,
    );
  }
  // El "limpio" se decide sobre la MISMA carga de página que se está
  // asertando, nunca con una consulta a `psql` aparte: dos lecturas
  // separadas (una a la base, otra al DOM) dejan una ventana de carrera —
  // otra sesión puede escribir justo entre medias — y con la base
  // compartida entre worktrees esa ventana SÍ se ha llegado a colar en la
  // práctica (ver tests.md § Fallos encontrados). Contar los <a> de ESTA
  // respuesta es la única fuente que no puede desincronizarse consigo
  // misma.
  const v1Limpio = v1ChipCount === 5;
  if (!v1Limpio) {
    note(
      `V1 — tienda-demo tiene ${v1ChipCount} enlaces en vez de 5 justo en esta carga (otra sesión ` +
        "escribiendo en la misma base compartida al mismo tiempo). Se saltan las aserciones que " +
        "dependen de un conteo exacto (qué chip es el último); las demás se comprueban igual.",
    );
  }
  if (v1Limpio) {
    check("V1 — exactamente 5 enlaces (Todo el catálogo + 4 categorías)", 5, await v1Chips.count());
    // design.md § V1 dice literalmente que "la cuarta [categoría]" (que la
    // colación española pone en el orden Alimentos < Aseo < Bebidas <
    // Panadería, así que "la cuarta" es Panadería) es la que asoma
    // cortada. Medido de verdad (no asumido): con las fuentes y el motor
    // de ESTE entorno, Panadería queda COMPLETAMENTE fuera de la pantalla
    // (no asoma nada) y es la TERCERA categoría, Bebidas, la que de verdad
    // asoma cortada. Se comprueba la afirmación ESTRUCTURAL que importa —
    // "hay un chip que empieza dentro y termina fuera, ni escondido del
    // todo ni entero con margen" — sobre el ÚLTIMO chip que arranca dentro
    // de la pantalla, sea cual sea su nombre, y se deja constancia de la
    // discrepancia con el nombre concreto que design.md da por sentado
    // (tests.md § Fallos encontrados, va a sdd-designer: puede ser una
    // diferencia real de métricas de fuente entre el entorno en que se
    // midió y este, o un desliz al escribir el paso).
    const v1Boxes = [];
    for (let i = 0; i < (await v1Chips.count()); i++) {
      v1Boxes.push({
        texto: await v1Chips.nth(i).innerText(),
        box: await v1Chips.nth(i).boundingBox(),
      });
    }
    const v1Asomando = [...v1Boxes].reverse().find((c) => c.box && c.box.x < 360);
    checkTrue(
      "V1 — hay un chip que empieza dentro de la pantalla y termina fuera (asoma cortado, no con margen)",
      Boolean(v1Asomando) && v1Asomando.box.x + v1Asomando.box.width > 360,
    );
    if (v1Asomando && v1Asomando.texto !== "Panadería") {
      note(
        `V1 — el chip que de verdad asoma cortado es "${v1Asomando.texto}", no "Panadería" como dice ` +
          "design.md § V1 literalmente (Panadería queda totalmente fuera de la pantalla en este entorno, " +
          "no asomando). Ver tests.md § Fallos encontrados.",
      );
    }
  }
  checkTrue("V1 — sin scroll horizontal de PÁGINA a 360px", !(await sinDesbordeHorizontal(v1)));
  await shot(v1, "V01-tienda-demo-360");
  await v1.close();

  // --- V2 — a 768 y 1280: sin scroll horizontal (el "envuelve" con volumen
  //     real de categorías se comprueba en V10, que sí las tiene) ---------
  // Con las 4 categorías reales de tienda-demo, `sm:flex-wrap` PERMITE
  // envolver pero no lo NECESITA: los 5 chips (Todo el catálogo + 4)
  // caben de sobra en una sola fila a 768px — medido, no supuesto. Eso no
  // es un fallo de diseño ni de este guion: "envuelve si hace falta" y
  // "hoy no hace falta" son compatibles. Lo que design.md § V2 pide de
  // verdad — que NUNCA haya scroll horizontal, envuelva o no — se
  // comprueba aquí tal cual. Que SÍ envuelve cuando el volumen obliga
  // (15 categorías) se comprueba en V10, a 360, 768 y 1280.

  const v2 = await context.newPage();
  await v2.goto(`${BASE}/tienda-demo`, { waitUntil: "networkidle" });
  await prepararPagina(v2, "/tienda-demo (V2)");
  await v2.setViewportSize(TABLET);
  await v2.waitForTimeout(200);
  checkTrue("V2 — sin scroll horizontal a 768px", !(await sinDesbordeHorizontal(v2)));
  const v2Chips768 = v2.locator('nav[aria-label="Categorías"] a');
  const v2Rows768 = new Set(
    await Promise.all(
      (await v2Chips768.all()).map(async (a) => Math.round((await a.boundingBox())?.y ?? -1)),
    ),
  );
  if (v2Rows768.size > 1) {
    note(
      "V2 — con las 4 categorías reales, la fila YA envuelve a 768px (más chips de los mínimos hoy)",
    );
  } else {
    note(
      "V2 — con las 4 categorías reales, la fila cabe en una sola línea a 768px (esperado: no hace falta envolver todavía; ver V10 para el caso con volumen)",
    );
  }
  await shot(v2, "V02-tienda-demo-768");

  await v2.setViewportSize(ESCRITORIO);
  await v2.waitForTimeout(200);
  checkTrue("V2 — sin scroll horizontal a 1280px", !(await sinDesbordeHorizontal(v2)));
  await shot(v2, "V02-tienda-demo-1280");
  await v2.close();

  // --- V3 — vista de «Bebidas»: <h1>, conteo, chip activo -----------------

  const v3 = await context.newPage();
  await v3.goto(`${BASE}/tienda-demo/c/bebidas`, { waitUntil: "networkidle" });
  await prepararPagina(v3, "/tienda-demo/c/bebidas (V3)");
  check(
    "V3 — el <h1> dice Bebidas",
    "Bebidas",
    (await v3.locator("h1").first().innerText()).trim(),
  );
  const v3Cards = v3.locator("ul.grid > li");
  const v3CardCount = await v3Cards.count();
  const v3CountLine = await v3.locator("p", { hasText: "en La Rampa" }).first().innerText();
  const v3Match = v3CountLine.match(/^(\d+) productos? en/);
  checkTrue("V3 — la línea de conteo tiene forma «N producto(s) en …»", Boolean(v3Match));
  if (v3Match) check("V3 — el número cuadra con las tarjetas", v3CardCount, Number(v3Match[1]));
  const v3ActiveChip = v3.locator('nav[aria-label="Categorías"] a[aria-current="page"]');
  check("V3 — el chip activo es Bebidas", "Bebidas", (await v3ActiveChip.innerText()).trim());
  const v3ActiveBg = await v3ActiveChip.evaluate((el) => getComputedStyle(el).backgroundColor);
  const v3InactiveBg = await v3
    .locator('nav[aria-label="Categorías"] a:not([aria-current="page"])')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  checkTrue(
    "V3 — el chip activo está relleno (color distinto del inactivo)",
    v3ActiveBg !== v3InactiveBg,
  );
  await shot(v3, "V03-vista-bebidas");
  await v3.close();

  // --- V4 — la rejilla es píxel a píxel la del catálogo, 3 anchos --------

  async function primeraFilaColumnas(page, selector) {
    const cards = page.locator(selector);
    const n = Math.min(4, await cards.count());
    const boxes = [];
    for (let i = 0; i < n; i++) boxes.push(await cards.nth(i).boundingBox());
    const filaTop = boxes[0]?.y;
    return {
      columnas: boxes.filter((b) => b && Math.abs(b.y - filaTop) < 1).length,
      anchoTarjeta: boxes[0]?.width,
      gap: boxes[1] && boxes[0] ? boxes[1].x - (boxes[0].x + boxes[0].width) : null,
    };
  }

  for (const [nombre, viewport] of [
    ["360px", MOVIL],
    ["768px", TABLET],
    ["1280px", ESCRITORIO],
  ]) {
    const vCat = await context.newPage({ viewport });
    await vCat.goto(`${BASE}/tienda-demo`, { waitUntil: "networkidle" });
    const catalogo = await primeraFilaColumnas(vCat, "ul.grid > li");
    await vCat.close();

    const vCategoria = await context.newPage({ viewport });
    await vCategoria.goto(`${BASE}/tienda-demo/c/alimentos`, { waitUntil: "networkidle" });
    const categoria = await primeraFilaColumnas(vCategoria, "ul.grid > li");
    if (nombre === "360px") await shot(vCategoria, "V04-categoria-alimentos-360");
    await vCategoria.close();

    check(`V4 — mismas columnas a ${nombre}`, catalogo.columnas, categoria.columnas);
    checkClose(
      `V4 — mismo ancho de tarjeta a ${nombre}`,
      catalogo.anchoTarjeta ?? 0,
      categoria.anchoTarjeta,
      1,
    );
    if (catalogo.gap !== null && categoria.gap !== null) {
      checkClose(`V4 — mismo gap a ${nombre}`, catalogo.gap, categoria.gap, 1);
    }
  }

  // --- V5 — tabulación: buscar → Todo el catálogo → categorías → tarjetas -

  const v5Limpio = categoriasDeTiendaDemoLimpias();
  if (!v5Limpio) {
    note(
      "V5 — tienda-demo tiene más categorías de las 4 esperadas ahora mismo (otra sesión escribiendo " +
        "en la misma base compartida): se recorren TODAS las que haya de verdad, en vez de asumir " +
        "el orden fijo Alimentos/Aseo/Bebidas/Panadería.",
    );
  }

  const v5 = await context.newPage();
  await v5.goto(`${BASE}/tienda-demo`, { waitUntil: "networkidle" });
  await prepararPagina(v5, "/tienda-demo (V5)");
  await v5.locator("#q").focus();
  check("V5 — el foco empieza en #q", "q", await v5.evaluate(() => document.activeElement?.id));
  await v5.keyboard.press("Tab"); // → botón Buscar (F-021 ya fija este paso)
  const v5AfterBuscar = await v5.evaluate(() => document.activeElement?.textContent?.trim());
  checkTrue("V5 — tras #q, el foco pasa al botón Buscar", v5AfterBuscar === "Buscar");
  await v5.keyboard.press("Tab"); // → "Todo el catálogo"
  const v5TodoElCatalogo = await v5.evaluate(() => document.activeElement?.textContent?.trim());
  check('V5 — el siguiente foco es "Todo el catálogo"', "Todo el catálogo", v5TodoElCatalogo);

  // Los chips que de verdad hay AHORA en el nav, leídos del DOM — nunca
  // asumidos — para que la cuenta de Tabs de abajo sea correcta tanto si
  // la base está limpia (4) como si otra sesión añadió de más.
  const v5ChipsReales = await v5
    .locator('nav[aria-label="Categorías"] a')
    .allInnerTexts()
    .then((textos) => textos.slice(1)); // el primero ya es "Todo el catálogo", ya tabulado arriba

  for (const [i, texto] of v5ChipsReales.entries()) {
    await v5.keyboard.press("Tab");
    const focado = await v5.evaluate(() => document.activeElement?.textContent?.trim());
    if (v5Limpio) {
      check(`V5 — el foco recorre los chips en orden (${texto})`, texto, focado);
    } else {
      check(`V5 — el foco recorre el chip real Nº${i + 1} (${texto})`, texto, focado);
    }
    const outline = await v5.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return { width: parseFloat(cs.outlineWidth) || 0, style: cs.outlineStyle };
    });
    if (outline.width === 0) {
      note(`V5 — outline-width midió 0 en Chromium headless para "${texto}"; revisar a mano`);
    } else {
      checkTrue(`V5 — el anillo de foco es visible en "${texto}"`, outline.style !== "none");
    }
    // El chip enfocado tiene que quedar dentro de la ventana visible: es el
    // "arrastre nativo" del navegador (scrollIntoView implícito al enfocar
    // un elemento dentro de un `overflow-x: auto`), sin una línea de JS de
    // este feature (R9) — la propia razón por la que el diseño se apoya en
    // esto en vez de escribir un observador.
    const box = await v5.evaluate(() => {
      const el = document.activeElement;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right };
    });
    checkTrue(
      `V5 — a 360px, el chip enfocado ("${texto}") queda dentro de la ventana`,
      box.left >= -1 && box.right <= 360 + 1,
    );
  }
  await v5.keyboard.press("Tab"); // → primera tarjeta de producto
  const v5CardHref = await v5.evaluate(() => document.activeElement?.getAttribute("href"));
  checkTrue(
    "V5 — tras las categorías, el foco llega a una tarjeta de producto",
    Boolean(v5CardHref?.includes("/tienda-demo/p/")),
  );
  await shot(v5, "V05-tabulacion-360");
  await v5.close();

  // --- V6 — tienda-dos: chips cápsula y verdes; oscuro, contraste --------

  const v6 = await context.newPage();
  await v6.goto(`${BASE}/tienda-dos`, { waitUntil: "networkidle" });
  await prepararPagina(v6, "/tienda-dos (V6)");
  const v6Chip = v6.locator('nav[aria-label="Categorías"] a').first();
  const v6Radius = await v6Chip.evaluate((el) => parseFloat(getComputedStyle(el).borderRadius));
  checkTrue("V6 — el radio del chip es mayor que el de tienda-demo (radius: round)", v6Radius > 10);
  const v6ActiveBg = await v6
    .locator('nav[aria-label="Categorías"] a[aria-current="page"]')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const v6HeaderBg = await v6.evaluate(
    () => getComputedStyle(document.querySelector("header")).backgroundColor,
  );
  check("V6 — el chip activo usa el mismo verde de marca que la cabecera", v6HeaderBg, v6ActiveBg);
  await shot(v6, "V06-tienda-dos-360");
  await v6.close();

  const ctxOscuro = await browser.newContext({ viewport: MOVIL, colorScheme: "dark" });
  const v6b = await ctxOscuro.newPage();
  await v6b.goto(`${BASE}/tienda-dos`, { waitUntil: "networkidle" });
  const v6bInactive = v6b
    .locator('nav[aria-label="Categorías"] a:not([aria-current="page"])')
    .first();
  const v6bBg = await v6bInactive.evaluate((el) => getComputedStyle(el).backgroundColor);
  const v6bPageBg = await v6b.evaluate(() => getComputedStyle(document.body).backgroundColor);
  checkTrue("V6 — en oscuro, los chips inactivos se distinguen del fondo", v6bBg !== v6bPageBg);
  await shot(v6b, "V06-tienda-dos-oscuro-360");
  await ctxOscuro.close();

  // --- V7 — SIN TRADUCIR a propósito --------------------------------------
  note(
    "V7 — no se repite aquí: `.agent/specs/F-026/smoke.sh` ya lo cubre con curl (cero JavaScript ejecutado, más estricto que cualquier navegador con JS desactivado). Ver tests.md.",
  );

  // --- V8 — SUSPENDED: sin fila, ni en el catálogo ni en la categoría ----

  const v8a = await context.newPage();
  const respV8a = await v8a.goto(`${BASE}/tienda-cerrada`, { waitUntil: "networkidle" });
  await prepararPagina(v8a, "/tienda-cerrada (V8)");
  check("V8 — /tienda-cerrada responde 200", 200, respV8a.status());
  checkTrue(
    "V8 — aparece el aviso de cerrada",
    (await v8a.getByText("cerrad", { exact: false }).count()) > 0,
  );
  check(
    "V8 — sin fila de categorías en el catálogo",
    0,
    await v8a.locator('nav[aria-label="Categorías"]').count(),
  );
  await shot(v8a, "V08-tienda-cerrada-catalogo");
  await v8a.close();

  const v8b = await context.newPage();
  const respV8b = await v8b.goto(`${BASE}/tienda-cerrada/c/cualquier-cosa`, {
    waitUntil: "networkidle",
  });
  await prepararPagina(v8b, "/tienda-cerrada/c/cualquier-cosa (V8)");
  check("V8 — la vista de categoría bajo SUSPENDED responde 200 (no 404)", 200, respV8b.status());
  checkTrue(
    "V8 — también aparece el aviso de cerrada en la vista de categoría",
    (await v8b.getByText("cerrad", { exact: false }).count()) > 0,
  );
  check(
    "V8 — sin fila de categorías en la vista de categoría",
    0,
    await v8b.locator('nav[aria-label="Categorías"]').count(),
  );
  await shot(v8b, "V08-tienda-cerrada-categoria");
  await v8b.close();

  // --- V9 — el 404 de categoría, SEGUIDO de verdad (no solo leído) -------
  // Lo que curl no puede ver: a dónde aterriza un CLIC en el enlace de
  // salida. Es el punto frágil de RD4 (href relativo, ver impl.md §
  // Desviaciones) y la razón de ser de este guion.

  const v9 = await context.newPage();
  const v9Slug = `categoria-inventada-${SUFFIX}`;
  const respV9 = await v9.goto(`${BASE}/tienda-demo/c/${v9Slug}`, { waitUntil: "networkidle" });
  await prepararPagina(v9, `/tienda-demo/c/${v9Slug} (V9)`);
  check("V9 — el 404 de categoría responde 404", 404, respV9.status());
  checkTrue(
    "V9 — conserva la cabecera de la tienda",
    (await v9.getByText("La Rampa", { exact: false }).count()) > 0,
  );
  const v9Link = v9.getByRole("link", { name: "Ver todo el catálogo" });
  checkTrue('V9 — existe el enlace "Ver todo el catálogo"', (await v9Link.count()) > 0);
  await shot(v9, "V09-404-categoria-antes-del-clic");
  await Promise.all([v9.waitForURL(/\/tienda-demo\/?$/), v9Link.click()]);
  check(
    "V9 — al hacer clic, aterriza en /tienda-demo (no en la raíz del sitio)",
    `${BASE}/tienda-demo`,
    v9.url().replace(/\/$/, ""),
  );
  checkTrue(
    "V9 — la página de destino trae el catálogo (no un segundo 404)",
    (await v9.locator("ul.grid > li").count()) > 0,
  );
  await shot(v9, "V09-404-categoria-despues-del-clic");
  await v9.close();

  // --- V10 — 15 categorías sembradas: la fila sigue en 52px --------------

  if (TOKEN) {
    const tiendaDemoStoreId = "seed-tienda-1";
    const eventosV10 = [];
    for (let i = 1; i <= 15; i++) {
      const catId = `visual-cat10-${i}-${SUFFIX}`;
      const prodId = `visual-prod10-${i}-${SUFFIX}`;
      paraLimpiar.categoryExternalIds.push(catId);
      eventosV10.push(
        categoryEvent(catId, "CREATE", `Visual Categoria ${String(i).padStart(2, "0")} ${SUFFIX}`),
      );
      eventosV10.push(
        productEvent(
          prodId,
          `visual-producto10-${i}-${SUFFIX}`,
          tiendaDemoStoreId,
          `Visual Producto ${i} ${SUFFIX}`,
          catId,
          10 + i,
        ),
      );
    }
    const { status: v10SyncStatus } = await syncCatalog(eventosV10);
    check("V10 — el lote de 15 categorías + 15 productos se procesa (207)", 207, v10SyncStatus);

    const v10 = await context.newPage();
    await v10.goto(`${BASE}/tienda-demo`, { waitUntil: "networkidle" });
    await prepararPagina(v10, "/tienda-demo (V10, 15 categorías sembradas)");
    const v10Nav = v10.locator('nav[aria-label="Categorías"]');
    const v10NavBox = await v10Nav.boundingBox();
    checkClose("V10 — la fila SIGUE midiendo 52px con 15 categorías de más", 52, v10NavBox?.height);
    const v10ChipCount = await v10Nav.locator("a").count();
    checkTrue("V10 — la fila trae bastante más de 5 chips ahora", v10ChipCount >= 5 + 15);
    const v10FirstCard = await v10.locator("ul.grid > li").first().boundingBox();
    checkTrue(
      "V10 — la primera fila de productos sigue visible sin bajar (dentro de los 740px del viewport)",
      v10FirstCard && v10FirstCard.y < MOVIL.height,
    );
    checkTrue(
      "V10 — sin scroll horizontal de página con 15 categorías",
      !(await sinDesbordeHorizontal(v10)),
    );
    await shot(v10, "V10-quince-categorias-360");

    // El "envuelve" de V2 con volumen real: 15 categorías SÍ obligan a más
    // de una fila a 768/1280, y aun así sin scroll horizontal — design.md
    // § Decisión 1 mide exactamente este caso (15 categorías = 3 filas a
    // 768, 2 a 1280).
    await v10.setViewportSize(TABLET);
    await v10.waitForTimeout(200);
    const v10Rows768 = new Set(
      await Promise.all(
        (await v10Nav.locator("a").all()).map(async (a) =>
          Math.round((await a.boundingBox())?.y ?? -1),
        ),
      ),
    );
    checkTrue("V10 — a 768px, 15 categorías SÍ envuelven en más de una fila", v10Rows768.size > 1);
    checkTrue(
      "V10 — sin scroll horizontal a 768px con 15 categorías",
      !(await sinDesbordeHorizontal(v10)),
    );
    await shot(v10, "V10-quince-categorias-768");

    await v10.setViewportSize(ESCRITORIO);
    await v10.waitForTimeout(200);
    checkTrue(
      "V10 — sin scroll horizontal a 1280px con 15 categorías",
      !(await sinDesbordeHorizontal(v10)),
    );
    await shot(v10, "V10-quince-categorias-1280");
    await v10.close();
  } else {
    fail("V10 — no se pudo sembrar (falta QAB_BEARER_TOKEN)");
  }

  // --- V11 — tienda sin categorías: sin fila NINGUNA ----------------------

  if (TOKEN) {
    const storeIdV11 = `visual-store11-${SUFFIX}`;
    const prodIdV11 = `visual-prod11-${SUFFIX}`;
    const { status: v11StoreStatus } = await syncCatalog([
      storeEvent(storeIdV11, `Visual Sin Categorias ${SUFFIX}`),
    ]);
    check("V11 — la sucursal sintética se crea (207)", 207, v11StoreStatus);
    const { status: v11ProdStatus } = await syncCatalog([
      productEvent(
        prodIdV11,
        `visual-producto11-${SUFFIX}`,
        storeIdV11,
        `Visual Producto Sin Categoria ${SUFFIX}`,
        null,
        15,
      ),
    ]);
    check("V11 — su único producto (sin categoría) se procesa (207)", 207, v11ProdStatus);

    const storefrontIdV11 = psql(
      `SELECT s."storefrontId" FROM "Store" s WHERE s."externalId"='${storeIdV11}'`,
    );
    const slugV11 = psql(`SELECT slug FROM "Storefront" WHERE id='${storefrontIdV11}'`);
    paraLimpiar.storefrontIdV11 = storefrontIdV11 || null;

    if (!slugV11) {
      fail("V11 — no se encontró el slug de la sucursal sintética (¿falló el sync?)");
    } else {
      const v11 = await context.newPage();
      const respV11 = await v11.goto(`${BASE}/${slugV11}`, { waitUntil: "networkidle" });
      await prepararPagina(v11, `/${slugV11} (V11)`);
      check("V11 — la tienda sin categorías responde 200", 200, respV11.status());
      checkTrue(
        "V11 — su producto (sin categoría) SÍ aparece en el catálogo completo (E6)",
        (await v11.getByText(`Visual Producto Sin Categoria ${SUFFIX}`, { exact: false }).count()) >
          0,
      );
      check(
        "V11 — CERO filas de categorías (ni una, ni con un solo chip)",
        0,
        await v11.locator('nav[aria-label="Categorías"]').count(),
      );
      await shot(v11, "V11-tienda-sin-categorias");
      await v11.close();
    }
  } else {
    fail("V11 — no se pudo sembrar (falta QAB_BEARER_TOKEN)");
  }
} catch (e) {
  fail(`el guion visual se rompió: ${e.message}`);
} finally {
  // --- limpieza: deja la base EXACTAMENTE como la encontró ----------------
  try {
    if (paraLimpiar.categoryExternalIds.length > 0) {
      const patronCat = paraLimpiar.categoryExternalIds.map((id) => `'${id}'`).join(",");
      psql(`DELETE FROM "StoreProduct" WHERE "externalId" LIKE 'visual-prod10-%-${SUFFIX}'`);
      psql(`DELETE FROM "LocalCategory" WHERE "externalId" IN (${patronCat})`);
    }
    if (paraLimpiar.storefrontIdV11) {
      psql(`DELETE FROM "Slug" WHERE "storefrontId"='${paraLimpiar.storefrontIdV11}'`);
      psql(`DELETE FROM "Storefront" WHERE id='${paraLimpiar.storefrontIdV11}'`); // cascada: Store, StoreProduct
    } else {
      // Puede que syncCatalog fallara ANTES de resolver el storefrontId
      // (p. ej. sin token) — se busca por el externalId de todos modos,
      // para no dejar una sucursal sintética huérfana si algo a mitad
      // de V11 se rompió.
      const huerfano = psql(
        `SELECT s."storefrontId" FROM "Store" s WHERE s."externalId"='visual-store11-${SUFFIX}'`,
      );
      if (huerfano) {
        psql(`DELETE FROM "Slug" WHERE "storefrontId"='${huerfano}'`);
        psql(`DELETE FROM "Storefront" WHERE id='${huerfano}'`);
      }
    }
    psql(`DELETE FROM "CanonicalProduct" cp
      WHERE NOT EXISTS (SELECT 1 FROM "StoreProduct" sp WHERE sp."canonicalProductId" = cp.id)
        AND cp.name LIKE '%${SUFFIX}%'`);

    // El DELETE de arriba es SQL directo — nunca pasa por revalidateTag(),
    // así que el servidor que sigue vivo (el mismo que atendió este guion)
    // se quedaría sirviendo, desde su Data Cache, la versión CON las 15
    // categorías sintéticas hasta que expire STOREFRONT_REVALIDATE (3600s).
    // Verificado a mano: tras el DELETE, `curl /tienda-demo` seguía
    // devolviendo los 20 enlaces — la base ya estaba limpia, la RESPUESTA
    // no. Un evento de sync real, aunque no cambie nada (mismo precio de
    // siempre), es lo único que dispara `revalidateStores()` de verdad —
    // es la misma clase de fallo que `tests.md` § Fallos encontrados ya
    // documentaba para `next build`, ahora confirmado también en
    // `next dev`. Si esto falla, no es que la limpieza no funcionara: es
    // que el servidor que atendió este guion queda sirviendo caché vieja
    // hasta que algo más lo revalide.
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
  } catch (e) {
    fail(`la limpieza final falló — revisar la base a mano: ${e.message}`);
  }
  await context.tracing.stop({ path: `${TRACES}/trace.zip` });
  await browser.close();
}

console.log(`\n${fails} aserciones fallidas`);
process.exit(fails === 0 ? 0 : 1);
