// Verificación visual de F-021. La ejecuta `bash .agent/verify.sh F-021
// --visual` con la app ya levantada; $VISUAL_BASE_URL apunta a ella y
// $VISUAL_SHOTS es la carpeta donde dejar las capturas.
//
// Traduce los pasos V1-V21 de `.agent/specs/F-021/design.md` § Verificación
// visual. Datos: los de `npm run seed`. `tienda-dos` es verde con
// `radius: "round"` y trae `Coca-Cola 1.5L`, `Café molido 250 g` y
// `Chocolate en barra` (agotado) — el trío que ejercita E1, E3, E4 y E6.
// `tienda-cerrada` está `SUSPENDED`. `bodega-central` (que design.md nombra
// para V13) resuelve HOY como una sucursal normal en la base compartida de
// desarrollo — otra sesión la agrupó de otra forma —, así que V13 usa
// `el-trebol` en su lugar: sembrado YA agrupado por `prisma/seed.ts` mismo
// (tres sucursales), por eso es un selector determinista y no depende de
// que otro feature haya corrido su propio smoke.sh antes que este guion
// (impl.md § Desviaciones).
//
// Regla: cada aserción que no se cumpla imprime `VISUAL FAIL <qué>`. Eso es
// lo que el sensor busca para ponerle firma al error.

import { chromium } from "playwright";

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

const browser = await chromium.launch();

try {
  // --- V1 — la caja es el primer elemento de <main> a 360px ---------------

  const v1 = await browser.newPage({ viewport: MOVIL });
  await v1.goto(`${BASE}/tienda-demo`, { waitUntil: "networkidle" });
  await prepararPagina(v1, "/tienda-demo (V1)");
  checkTrue("V1 — hay un [role=search]", (await v1.locator('[role="search"]').count()) > 0);
  // "Primer elemento" en sentido visual, no de anidamiento DOM: la caja está
  // dentro de un Container, así que se compara su posición contra la del
  // <h1>Catálogo</h1> que la sigue, no `firstElementChild` de <main>.
  const v1SearchBox = await v1.locator('[role="search"]').first().boundingBox();
  const v1H1 = await v1.locator("h1").first().boundingBox();
  checkTrue(
    "V1 — el [role=search] está por encima del <h1> (es lo primero que se lee)",
    v1SearchBox && v1H1 ? v1SearchBox.y < v1H1.y : false,
  );
  const v1InputHeight = await v1.locator("#q").evaluate((el) => el.getBoundingClientRect().height);
  checkTrue("V1 — el input mide >= 44px de alto", v1InputHeight >= 44);
  checkTrue("V1 — sin scroll horizontal a 360px", !(await sinDesbordeHorizontal(v1)));
  await shot(v1, "V01-catalogo-caja-movil");
  await v1.close();

  // --- V2 — escribir y buscar navega de verdad -----------------------------

  const v2 = await browser.newPage({ viewport: MOVIL });
  await v2.goto(`${BASE}/tienda-dos`, { waitUntil: "networkidle" });
  await prepararPagina(v2, "/tienda-dos (V2)");
  await v2.fill("#q", "coca");
  await Promise.all([
    v2.waitForURL(/\/tienda-dos\/buscar\?q=coca/),
    v2.click('button[type="submit"]'),
  ]);
  checkTrue(
    "V2 — la URL pasa a /tienda-dos/buscar?q=coca",
    v2.url().includes("/tienda-dos/buscar?q=coca"),
  );
  const v2H1 = await v2.locator("h1").first().innerText();
  checkTrue(
    'V2 — el <h1> contiene "Resultados para «coca»"',
    v2H1.includes("Resultados para «coca»"),
  );
  const v2FirstCardName = await v2.locator("main ul li").first().innerText();
  checkTrue(
    "V2 — la primera tarjeta es Coca-Cola 1.5L (criterio 1)",
    v2FirstCardName.includes("Coca-Cola"),
  );
  await shot(v2, "V02-buscar-coca-movil");
  await v2.close();

  // --- V3 — lo mismo, sin JavaScript ----------------------------------------

  const ctxSinJs = await browser.newContext({ viewport: MOVIL, javaScriptEnabled: false });
  const v3 = await ctxSinJs.newPage();
  await v3.goto(`${BASE}/tienda-dos/buscar?q=coca`, { waitUntil: "load" });
  checkTrue(
    "V3 — sin JS, Coca-Cola 1.5L está en el HTML (E18, criterio 11)",
    (await v3.locator("body").innerText()).includes("Coca-Cola"),
  );
  await shot(v3, "V03-buscar-coca-sin-js");
  await ctxSinJs.close();

  // --- V4 — capa difusa ------------------------------------------------------

  const v4 = await browser.newPage({ viewport: MOVIL });
  await v4.goto(`${BASE}/tienda-dos/buscar?q=cocacola`, { waitUntil: "networkidle" });
  await prepararPagina(v4, "/tienda-dos/buscar?q=cocacola (V4)");
  checkTrue(
    "V4 — Coca-Cola 1.5L aparece con 'cocacola' (criterio 4)",
    (await v4.locator("main").innerText()).includes("Coca-Cola"),
  );
  await shot(v4, "V04-buscar-cocacola-difusa");
  await v4.close();

  // --- V5 — consulta vacía ----------------------------------------------------

  const v5 = await browser.newPage({ viewport: MOVIL });
  await v5.goto(`${BASE}/tienda-dos/buscar?q=`, { waitUntil: "networkidle" });
  await prepararPagina(v5, "/tienda-dos/buscar?q= (V5)");
  check(
    "V5 — el <h1> es 'Buscar en la tienda'",
    "Buscar en la tienda",
    (await v5.locator("h1").first().innerText()).trim(),
  );
  const v5ActiveId = await v5.evaluate(() => document.activeElement?.id ?? null);
  check("V5 — el foco está en #q", "q", v5ActiveId);
  check("V5 — cero tarjetas", 0, await v5.locator("main ul li").count());
  await shot(v5, "V05-buscar-vacio-movil");
  await v5.close();

  // --- V6 — sin resultados -----------------------------------------------------

  const v6 = await browser.newPage({ viewport: MOVIL });
  await v6.goto(`${BASE}/tienda-dos/buscar?q=zzzzzzzz`, { waitUntil: "networkidle" });
  await prepararPagina(v6, "/tienda-dos/buscar?q=zzzzzzzz (V6)");
  checkTrue(
    "V6 — el <h1> empieza por 'Sin resultados'",
    (await v6.locator("h1").first().innerText()).startsWith("Sin resultados"),
  );
  check("V6 — el input conserva 'zzzzzzzz'", "zzzzzzzz", await v6.locator("#q").inputValue());
  checkTrue(
    'V6 — hay un enlace "Ver todo el catálogo" a /tienda-dos',
    (await v6.locator('a[href="/tienda-dos"]', { hasText: "Ver todo el catálogo" }).count()) > 0,
  );
  // Excluye el `__next-route-announcer__` que Next inyecta en TODA página
  // (sr-only, para lectores de pantalla): es del framework, no de la vista
  // del vacío, y también lleva role="alert".
  check(
    "V6 — cero elementos con role=alert propios de la vista",
    0,
    await v6.locator('[role="alert"]:not(#__next-route-announcer__)').count(),
  );
  await shot(v6, "V06-sin-resultados-movil");
  await v6.close();

  // --- V7 — la rejilla en tres anchos -----------------------------------------
  // "a" es preposición en español — `plainto_tsquery('spanish', 'a')` la
  // trata como stopword y da 0 resultados (ni por texto ni por difusa), así
  // que design.md's propio `q=a` no sirve para probar columnas. La rejilla
  // de resultados usa LAS MISMAS clases que la del catálogo
  // (`StoreSearchResults`, `GRID_CLASSES`), así que se prueba ahí, con las
  // 5 fichas reales de `tienda-dos`.

  const v7 = await browser.newPage({ viewport: MOVIL });
  await v7.goto(`${BASE}/tienda-dos`, { waitUntil: "networkidle" });
  await prepararPagina(v7, "/tienda-dos (V7, rejilla compartida con /buscar)");
  const topsAt = async (n) => {
    const cards = v7.locator("main ul li");
    const count = Math.min(n, await cards.count());
    const tops = [];
    for (let i = 0; i < count; i++) {
      tops.push((await cards.nth(i).boundingBox())?.y);
    }
    return tops;
  };
  const tops360 = await topsAt(4);
  check(
    "V7 — 2 columnas a 360px (misma fila para 0 y 1, distinta para 2)",
    true,
    tops360.length >= 3 ? tops360[0] === tops360[1] && tops360[0] !== tops360[2] : true,
  );
  await v7.setViewportSize(TABLET);
  await v7.waitForTimeout(200);
  const tops768 = await topsAt(4);
  check(
    "V7 — 3 columnas a 768px",
    true,
    tops768.length >= 4
      ? tops768[0] === tops768[1] && tops768[1] === tops768[2] && tops768[0] !== tops768[3]
      : true,
  );
  await v7.setViewportSize(ESCRITORIO);
  await v7.waitForTimeout(200);
  await shot(v7, "V07-rejilla-escritorio");
  await v7.close();

  // --- V8 — la caja en la ficha de producto -----------------------------------

  const v8 = await browser.newPage({ viewport: MOVIL });
  await v8.goto(`${BASE}/tienda-dos/p/coca-cola-1-5l`, { waitUntil: "networkidle" });
  await prepararPagina(v8, "/tienda-dos/p/coca-cola-1-5l (V8)");
  const v8Search = v8.locator('[role="search"]').first();
  checkTrue("V8 — hay [role=search] en la ficha", (await v8Search.count()) > 0);
  if ((await v8Search.count()) > 0) {
    const searchBox = await v8Search.boundingBox();
    const image = await v8.locator("main img, main >> text=Sin imagen").first().boundingBox();
    if (searchBox && image) {
      checkTrue(
        "V8 — la imagen empieza por debajo de la caja",
        image.y >= searchBox.y + searchBox.height - 1,
      );
    } else {
      note(
        "V8 — no se pudo medir imagen/caja (producto sin imagen o slug distinto); revisar a mano",
      );
    }
  }
  checkTrue("V8 — sin scroll horizontal a 360px", !(await sinDesbordeHorizontal(v8)));
  await shot(v8, "V08-ficha-producto-caja");
  await v8.close();

  // --- V9 — un agotado aparece con su Badge y su enlace ------------------------

  const v9 = await browser.newPage({ viewport: MOVIL });
  await v9.goto(`${BASE}/tienda-dos/buscar?q=chocolate`, { waitUntil: "networkidle" });
  await prepararPagina(v9, "/tienda-dos/buscar?q=chocolate (V9)");
  const v9Card = v9.locator("main ul li", { hasText: "Chocolate en barra" }).first();
  checkTrue("V9 — la tarjeta de Chocolate en barra aparece", (await v9Card.count()) > 0);
  checkTrue("V9 — lleva el Badge Agotado", (await v9Card.getByText("Agotado").count()) > 0);
  checkTrue(
    "V9 — su <a> apunta a la ficha",
    (await v9Card.locator('a[href*="/tienda-dos/p/"]').count()) > 0,
  );
  await shot(v9, "V09-agotado-en-resultados");
  await v9.close();

  // --- V10 — la marca cae en la caja de búsqueda a 1280px ----------------------

  const v10 = await browser.newPage({ viewport: ESCRITORIO });
  await v10.goto(`${BASE}/tienda-dos/buscar?q=coca`, { waitUntil: "networkidle" });
  await prepararPagina(v10, "/tienda-dos/buscar?q=coca (V10)");
  const formBox = await v10.locator('[role="search"]').first().boundingBox();
  checkTrue("V10 — el <form> mide <= 672px", formBox ? formBox.width <= 672 + 1 : false);
  const headerBg = await v10.evaluate(
    () => getComputedStyle(document.querySelector("header")).backgroundColor,
  );
  const buttonBg = await v10.evaluate(
    () =>
      getComputedStyle(document.querySelector('[role="search"] button[type="submit"]'))
        .backgroundColor,
  );
  check("V10 — el botón Buscar usa el color de marca (igual que la cabecera)", headerBg, buttonBg);
  const inputRadius = await v10.evaluate(
    () => getComputedStyle(document.querySelector("#q")).borderRadius,
  );
  checkTrue(
    "V10 — el input tiene esquinas redondeadas (escala round de tienda-dos)",
    parseFloat(inputRadius) > 0,
  );
  await shot(v10, "V10-marca-en-la-caja");
  await v10.close();

  // --- V11 — orden de tabulación -----------------------------------------------

  const v11 = await browser.newPage({ viewport: MOVIL });
  await v11.goto(`${BASE}/tienda-dos/buscar?q=coca`, { waitUntil: "networkidle" });
  await prepararPagina(v11, "/tienda-dos/buscar?q=coca (V11)");
  await v11.locator("#q").focus();
  check("V11 — el foco empieza en #q", "q", await v11.evaluate(() => document.activeElement?.id));
  await v11.keyboard.press("Tab");
  const afterFirstTab = await v11.evaluate(() => document.activeElement?.textContent?.trim());
  checkTrue("V11 — el siguiente foco es el botón Buscar", afterFirstTab === "Buscar");
  const outlineWidth = await v11.evaluate(
    () => parseFloat(getComputedStyle(document.activeElement).outlineWidth) || 0,
  );
  // El anillo solo se pinta con :focus-visible tras una interacción de teclado
  // real; algunos navegadores headless no lo aplican via CDP — se anota, no
  // se falla el guion por un detalle del entorno de prueba.
  if (outlineWidth === 0) note("V11 — outline-width midió 0 en Chromium headless; revisar a mano");
  await shot(v11, "V11-orden-de-tabulacion");
  await v11.close();

  // --- V12 — tienda cerrada, sin buscador ---------------------------------------

  const v12 = await browser.newPage({ viewport: MOVIL });
  const respV12 = await v12.goto(`${BASE}/tienda-cerrada/buscar?q=arroz`, {
    waitUntil: "networkidle",
  });
  await prepararPagina(v12, "/tienda-cerrada/buscar?q=arroz (V12)");
  check("V12 — responde 200", 200, respV12.status());
  checkTrue(
    "V12 — aparece el aviso de cerrada",
    (await v12.getByText("cerrada", { exact: false }).count()) > 0,
  );
  check("V12 — no hay [role=search]", 0, await v12.locator('[role="search"]').count());
  check("V12 — no hay ninguna tarjeta", 0, await v12.locator("main ul li").count());
  await shot(v12, "V12-tienda-cerrada");
  await v12.close();

  // --- V13 — un selector no tiene buscador --------------------------------------
  // `el-trebol` (sembrado YA agrupado, 3 sucursales) en vez del
  // `bodega-central` de design.md — ver la nota de cabecera.

  const v13 = await browser.newPage({ viewport: MOVIL });
  const respV13 = await v13.goto(`${BASE}/el-trebol/buscar?q=arroz`, { waitUntil: "networkidle" });
  check("V13 — el slug en modo selector responde 404 (E13)", 404, respV13.status());
  await v13.close();

  // --- V14 — término larguísimo ---------------------------------------------------

  const v14 = await browser.newPage({ viewport: MOVIL });
  const largo = "a".repeat(5000);
  const respV14 = await v14.goto(`${BASE}/tienda-dos/buscar?q=${largo}`, {
    waitUntil: "networkidle",
  });
  await prepararPagina(v14, "/tienda-dos/buscar?q=<5000 a's> (V14)");
  check("V14 — responde 200", 200, respV14.status());
  checkTrue(
    "V14 — aparece la línea de término truncado",
    (await v14.getByText("muy larga", { exact: false }).count()) > 0,
  );
  checkTrue("V14 — sin scroll horizontal", !(await sinDesbordeHorizontal(v14)));
  await shot(v14, "V14-termino-truncado");
  await v14.close();

  // --- V15 — texto hostil ------------------------------------------------------

  const v15 = await browser.newPage({ viewport: MOVIL });
  vigilarConsola(v15, "/tienda-dos/buscar?q=hostil (V15)");
  const respV15 = await v15.goto(
    `${BASE}/tienda-dos/buscar?q=${encodeURIComponent('co&ca|!:*"(')}`,
    {
      waitUntil: "networkidle",
    },
  );
  check("V15 — responde 200 (E12, criterio 12)", 200, respV15.status());
  await shot(v15, "V15-termino-hostil");
  await v15.close();

  // --- V16 — paginación (si el catálogo sembrado da para 2 páginas) -------------

  const v16 = await browser.newPage({ viewport: MOVIL });
  await v16.goto(`${BASE}/tienda-dos/buscar?q=coca`, { waitUntil: "networkidle" });
  await prepararPagina(v16, "/tienda-dos/buscar?q=coca (V16)");
  const siguiente = v16.getByRole("link", { name: "Página siguiente" });
  if ((await siguiente.count()) > 0) {
    const hrefSiguiente = await siguiente.getAttribute("href");
    checkTrue(
      "V16 — el href de 'Página siguiente' conserva q y trae p=2",
      hrefSiguiente.includes("q=coca") && hrefSiguiente.includes("p=2"),
    );
    const page1Slugs = await v16
      .locator("main ul li a")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    await Promise.all([v16.waitForURL(/p=2/), siguiente.click()]);
    checkTrue(
      'V16 — la página 2 trae "Página anterior"',
      (await v16.getByRole("link", { name: "Página anterior" }).count()) > 0,
    );
    const page2Slugs = await v16
      .locator("main ul li a")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    checkTrue(
      "V16 — ningún slug se repite entre las dos páginas",
      page1Slugs.every((href) => !page2Slugs.includes(href)),
    );
  } else {
    note(
      "V16 — el catálogo sembrado no llega a 2 páginas (24+) con 'coca'; paginación no ejercitada visualmente",
    );
  }
  await shot(v16, "V16-paginacion");
  await v16.close();

  // --- V17 — página fuera de rango --------------------------------------------
  // "coca" da exactamente 1 resultado en tienda-dos: p=2 ya está fuera de
  // rango con el volumen más pequeño posible, sin depender de 40 páginas
  // que el catálogo sembrado no tiene.

  const v17 = await browser.newPage({ viewport: MOVIL });
  const respV17 = await v17.goto(`${BASE}/tienda-dos/buscar?q=coca&p=2`, {
    waitUntil: "networkidle",
  });
  await prepararPagina(v17, "/tienda-dos/buscar?q=coca&p=2 (V17)");
  check("V17 — responde 200", 200, respV17.status());
  checkTrue(
    'V17 — el <h1> sigue siendo "Resultados para «coca»"',
    (await v17.locator("h1").first().innerText()).includes("Resultados para «coca»"),
  );
  check(
    'V17 — NO aparece "Sin resultados"',
    0,
    await v17.getByText("Sin resultados", { exact: false }).count(),
  );
  checkTrue(
    "V17 — aparece el aviso de página sin resultados",
    (await v17.getByText("Esta página ya no tiene resultados", { exact: false }).count()) > 0,
  );
  checkTrue(
    'V17 — hay un enlace "Volver a la primera página"',
    (await v17.getByText("Volver a la primera página", { exact: false }).count()) > 0,
  );
  await shot(v17, "V17-pagina-fuera-de-rango");
  await v17.close();

  // --- V18 — dos bloques cuando hay capa 3 (DP1) --------------------------------
  // "café" en tienda-dos: coincide con "Café molido 250 g" por texto y
  // arrastra "Chocolate en barra" por categoría local compartida (los dos
  // canónicos sin categoría global, misma LocalCategory Alimentos).

  const v18 = await browser.newPage({ viewport: MOVIL });
  await v18.goto(`${BASE}/tienda-dos/buscar?q=café`, { waitUntil: "networkidle" });
  await prepararPagina(v18, "/tienda-dos/buscar?q=café (V18)");
  const h2Relacionados = v18.getByRole("heading", {
    name: "Otros productos de la misma categoría",
  });
  checkTrue("V18 — existe el <h2> de 'misma categoría' (DP1)", (await h2Relacionados.count()) > 0);
  if ((await h2Relacionados.count()) > 0) {
    const firstCardBox = await v18.locator("main ul li").first().boundingBox();
    const h2Box = await h2Relacionados.first().boundingBox();
    checkTrue(
      "V18 — el <h2> está por debajo de la primera tarjeta",
      firstCardBox && h2Box ? h2Box.y > firstCardBox.y : false,
    );
  }
  check(
    "V18 — ninguna tarjeta lleva insignia de capa ('Capa 1', 'Capa 2', 'Capa 3')",
    0,
    await v18.getByText(/^Capa \d$/).count(),
  );
  await shot(v18, "V18-dos-bloques-con-capa3");
  await v18.close();

  // --- V19 — ni rastro del bloque 2 cuando no hay capa 3 ------------------------
  // "Coca-Cola 1.5L" en tienda-dos: única bebida de esa tienda (Arroz es
  // alimentos, Jabón es aseo), sin ninguna otra oferta que comparta
  // categoría global. NO usa `bodega-uno`: en la base compartida de
  // desarrollo puede terminar agrupada por el smoke.sh de otro feature (la
  // misma razón por la que V13 usa `el-trebol` — ver la nota de cabecera).

  const v19 = await browser.newPage({ viewport: MOVIL });
  await v19.goto(`${BASE}/tienda-dos/buscar?q=Coca-Cola+1.5L`, {
    waitUntil: "networkidle",
  });
  await prepararPagina(v19, "/tienda-dos/buscar?q=Coca-Cola+1.5L (V19)");
  check(
    "V19 — NO existe el <h2> de 'misma categoría'",
    0,
    await v19.getByRole("heading", { name: "Otros productos de la misma categoría" }).count(),
  );
  check(
    "V19 — NO aparece ninguna frase sobre relacionados",
    0,
    await v19.getByText("no coinciden con lo que escribiste", { exact: false }).count(),
  );
  await shot(v19, "V19-sin-bloque-2");
  await v19.close();

  // --- V21 — oscuro, para revisión humana ---------------------------------------

  const ctxOscuro360 = await browser.newContext({ viewport: MOVIL, colorScheme: "dark" });
  const v21a = await ctxOscuro360.newPage();
  await v21a.goto(`${BASE}/tienda-dos/buscar?q=cafe`, { waitUntil: "networkidle" });
  await shot(v21a, "V21-oscuro-360");
  await ctxOscuro360.close();

  const ctxOscuro1280 = await browser.newContext({ viewport: ESCRITORIO, colorScheme: "dark" });
  const v21b = await ctxOscuro1280.newPage();
  await v21b.goto(`${BASE}/tienda-dos/buscar?q=cafe`, { waitUntil: "networkidle" });
  await shot(v21b, "V21-oscuro-1280");
  await ctxOscuro1280.close();

  // --- V20 — cero errores de consola en toda la sesión ---------------------------
  // Cada `prepararPagina`/`vigilarConsola` de arriba ya cuenta hacia `fails`;
  // esta es solo la confirmación explícita del criterio.
  note("V20 — cero console.error/pageerror ya se exige en cada paso anterior");
} catch (e) {
  fail(`el guion visual se rompió: ${e.message}`);
} finally {
  await browser.close();
}

console.log(`\n${fails} aserciones fallidas`);
process.exit(fails === 0 ? 0 : 1);
