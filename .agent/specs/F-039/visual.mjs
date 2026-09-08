// Verificación visual de F-039. La ejecuta `bash .agent/verify.sh F-039
// --visual` con la app ya levantada; $VISUAL_BASE_URL apunta a ella,
// $VISUAL_SHOTS es la carpeta de capturas y $VISUAL_TRACES la del trace de
// Playwright.
//
// Traduce los OCHO puntos de `.agent/specs/F-039/design.md` § «Verificación
// visual» a asertos ejecutables. Copiado con el criterio de
// `.agent/specs/F-027/visual.mjs` (los helpers check/checkTrue/checkClose/
// fail/note, vigilarConsola, el patrón de sembrar por sync real + limpiar en
// un `finally`) y `.agent/specs/F-010/visual.mjs` (la medición de contraste
// componiendo colores en un canvas de 1×1, porque Chromium serializa los
// tokens OKLCH/color-mix() de este repo en lab()/oklab(), nunca en rgb()).
//
// DATOS: tienda-demo (seed-negocio-1, displayCurrencies=["CUP","USD","MLC"],
// tasas de las dos — el residuo que deja F-038/smoke.sh) para los puntos
// 1-4, 6 y 8; tienda-dos (misma Business, branding propio --color-brand
// verde) para la mitad de branding del punto 7; el-faro (seed-negocio-2,
// []) para los tres casos raros del punto 5, con su PROPIO token (se acuña
// aquí — ficha mint-token-rota-el-token-en-bd-compartida, aceptado porque el
// árbol es de esta sesión, mismo patrón que .agent/specs/F-018/smoke.sh).
//
// Todo lo que este guion escribe en la base (la lista de el-faro para el
// punto 5, la lista+tasas de tienda-demo para las 40 monedas del punto 6) se
// RESTAURA en un `finally`, así que una corrida interrumpida a medias no deja
// un residuo distinto del que encontró — mismo cuidado que
// `.agent/specs/F-039/smoke.sh`.
//
// Regla: cada aserción que no se cumpla imprime `VISUAL FAIL <qué>`.

import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BASE = process.env.VISUAL_BASE_URL ?? "http://localhost:3101";
const SHOTS = process.env.VISUAL_SHOTS ?? ".agent/runs/_libre/shots";
const TRACES = process.env.VISUAL_TRACES ?? ".agent/runs/_libre/traces";

function tokenFromEnvFile() {
  try {
    const env = readFileSync(".env", "utf8");
    const m = env.match(/^QAB_BEARER_TOKEN="([^"]*)"/m);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}
const TOKEN_A = process.env.QAB_BEARER_TOKEN || tokenFromEnvFile();

const MOVIL = { width: 360, height: 900 };
const TABLET = { width: 768, height: 900 };
const ESCRITORIO = { width: 1280, height: 900 };

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

// El elemento que design.md mide como "la primera tarjeta": el PRIMER <li>
// de la rejilla de productos (`ul.grid` en ProductCard.tsx/StoreCatalogResults),
// NUNCA "main ul > li" a secas — la fila de chips de categoría de encima de
// la rejilla es TAMBIÉN un `<ul><li>`, y confundir las dos da una cifra 80px
// menor que la real (comprobado: así se encontró el selector correcto).
function primeraTarjeta(page) {
  return page.locator("ul.grid > li").first();
}

// --- sync real, mismo patrón que F-026/F-027 visual.mjs ---------------------

let nowCounter = 0;
function now() {
  nowCounter += 1;
  return new Date(Date.now() + nowCounter).toISOString();
}

async function syncCatalog(token, businessId, events) {
  const res = await fetch(`${BASE}/api/internal/sync/catalog`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ businessId, events }),
  });
  return res.json().catch(() => ({}));
}

function businessEvent(businessId, displayCurrencies) {
  return {
    eventId: `evt-visual-biz-${businessId}-${now()}`,
    entity: "BUSINESS",
    operation: "UPDATE",
    occurredAt: now(),
    payload: { businessId, displayCurrencies, updatedAt: now() },
  };
}

function exchangeRateEvent(businessId, currency, rate) {
  return {
    eventId: `evt-visual-rate-${businessId}-${currency}-${now()}`,
    entity: "EXCHANGE_RATE",
    operation: "CREATE",
    occurredAt: now(),
    payload: { businessId, currency, rate, updatedAt: now() },
  };
}

// Las 40 monedas sintéticas de F-038 C10 (mismo generador que
// scripts/send-catalog-batch.mjs BUSINESS_CASES.forty), para el punto 6.
function cuarentaMonedas() {
  return Array.from({ length: 40 }, (_, i) => {
    const a = String.fromCharCode(65 + Math.floor(i / 26));
    const b = String.fromCharCode(65 + (i % 26));
    return `A${a}${b}`;
  });
}

function psql(sql) {
  return execSync(
    `docker exec queandabuscando-postgres psql -U postgres -d queandabuscando -Atc "${sql.replace(/"/g, '\\"')}"`,
    { encoding: "utf8" },
  ).trim();
}

function mintToken(externalId) {
  return execSync(`npx tsx scripts/mint-sync-token.ts ${externalId} 2>/dev/null`, {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .pop();
}

if (!TOKEN_A) {
  fail(
    "QAB_BEARER_TOKEN no está en el entorno ni en .env — los puntos 5 y 6 no se pueden ejecutar",
  );
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: MOVIL });
await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

// Lo que hay que restaurar SIEMPRE, pase lo que pase con las aserciones de
// arriba — mismo cuidado que .agent/specs/F-039/smoke.sh con seed-negocio-2.
const restaurar = { faroBusinessId: null, demoBusinessId: null, tokenB: null };

try {
  // ===========================================================
  // Punto 1 — sin JavaScript, tres monedas: TODOS los equivalentes visibles
  // a 360/768/1280, sin ningún control y sin desplazamiento horizontal.
  // ===========================================================
  for (const [nombre, viewport] of [
    ["360", MOVIL],
    ["768", TABLET],
    ["1280", ESCRITORIO],
  ]) {
    const ctxSinJs = await browser.newContext({ viewport, javaScriptEnabled: false });
    const page = await ctxSinJs.newPage();
    await page.goto(`${BASE}/tienda-demo`, { waitUntil: "load" });
    checkTrue(
      `Punto 1 — ${nombre} — el equivalente de USD está en el DOM`,
      (await page.locator('[data-equiv="USD"]').count()) > 0,
    );
    checkTrue(
      `Punto 1 — ${nombre} — el equivalente de MLC está en el DOM`,
      (await page.locator('[data-equiv="MLC"]').count()) > 0,
    );
    checkTrue(
      `Punto 1 — ${nombre} — el equivalente de USD es VISIBLE (nada lo oculta sin JS, R13)`,
      await page.locator('[data-equiv="USD"]').first().isVisible(),
    );
    checkTrue(
      `Punto 1 — ${nombre} — el equivalente de MLC es VISIBLE (nada lo oculta sin JS, R13)`,
      await page.locator('[data-equiv="MLC"]').first().isVisible(),
    );
    check(
      `Punto 1 — ${nombre} — sin selector (control muerto sin JS, R13)`,
      0,
      await page.locator("select#reference-currency-select").count(),
    );
    checkTrue(
      `Punto 1 — ${nombre} — sin desplazamiento horizontal`,
      !(await sinDesbordeHorizontal(page)),
    );
    if (nombre === "360") await shot(page, "01-sin-js-360");
    await ctxSinJs.close();
  }

  // ===========================================================
  // Punto 2 — con JavaScript y localStorage limpio: UNA línea de
  // equivalente (la primera declarada con tasa) y el selector en
  // «También en USD» (SP1(a)).
  // ===========================================================
  {
    const ctx = await browser.newContext({ viewport: MOVIL });
    const page = await ctx.newPage();
    await prepararPagina(page, "/tienda-demo (localStorage limpio)");
    await page.goto(`${BASE}/tienda-demo`, { waitUntil: "networkidle" });
    checkTrue(
      "Punto 2 — el equivalente de USD es visible",
      await page.locator('[data-equiv="USD"]').first().isVisible(),
    );
    checkTrue(
      "Punto 2 — el equivalente de MLC NO es visible",
      !(await page.locator('[data-equiv="MLC"]').first().isVisible()),
    );
    check(
      "Punto 2 — el selector muestra «También en USD»",
      "También en USD",
      await page.locator("select#reference-currency-select option:checked").textContent(),
    );
    // EX1 — "no se ve pasar el estado de dos equivalentes": ya en
    // domcontentloaded (antes de networkidle, antes de que termine de
    // hidratar) el atributo YA está puesto y MLC YA está oculto — la
    // reducción se decide durante el parseo del HTML, no después.
    const ctxTemprano = await browser.newContext({ viewport: MOVIL });
    const pageTemprano = await ctxTemprano.newPage();
    await pageTemprano.goto(`${BASE}/tienda-demo`, { waitUntil: "domcontentloaded" });
    check(
      "Punto 2 (EX1) — YA en domcontentloaded, data-ref-currency ya está puesto",
      "USD",
      await pageTemprano.evaluate(() => document.documentElement.getAttribute("data-ref-currency")),
    );
    checkTrue(
      "Punto 2 (EX1) — YA en domcontentloaded, MLC ya está oculto (no hay flash de dos líneas)",
      !(await pageTemprano.locator('[data-equiv="MLC"]').first().isVisible()),
    );
    await ctxTemprano.close();
    await shot(page, "02-con-js-una-linea");
    await ctx.close();
  }

  // ===========================================================
  // Punto 3 — el salto que no debe existir (EX2): la primera tarjeta en la
  // MISMA posición antes y después de hidratar. 721px a 360, 637 a 768 y
  // 1280 (design.md § El selector, medido).
  // ===========================================================
  {
    const esperado = { 360: 721, 768: 637, 1280: 637 };
    for (const [nombre, viewport] of [
      ["360", MOVIL],
      ["768", TABLET],
      ["1280", ESCRITORIO],
    ]) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/tienda-demo`, { waitUntil: "domcontentloaded" });
      const antes = await primeraTarjeta(page).boundingBox();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
      const despues = await primeraTarjeta(page).boundingBox();
      check(
        `Punto 3 — ${nombre} — la primera tarjeta NO se mueve al hidratar (EX2)`,
        antes?.y,
        despues?.y,
      );
      checkClose(
        `Punto 3 — ${nombre} — la posición coincide con la medida en design.md`,
        esperado[nombre],
        despues?.y,
        2,
      );
      await ctx.close();
    }
  }

  // ===========================================================
  // Punto 4 — cambiar de moneda mueve los importes SIN petición al
  // servidor, el foco se queda en el selector, y la elección sobrevive a
  // recargar y a navegar (criterio 12).
  // ===========================================================
  {
    const ctx = await browser.newContext({ viewport: MOVIL });
    const page = await ctx.newPage();
    await prepararPagina(page, "/tienda-demo (cambiar de moneda)");
    await page.goto(`${BASE}/tienda-demo`, { waitUntil: "networkidle" });

    let peticiones = 0;
    const contador = () => peticiones++;
    page.on("request", contador);

    const select = page.locator("select#reference-currency-select");
    await select.click(); // foco real, como un comprador — selectOption() a secas nunca enfoca el <select>
    await select.selectOption("MLC");
    await page.waitForTimeout(400);
    page.off("request", contador);

    check("Punto 4 — cambiar de moneda no hace NINGUNA petición al servidor", 0, peticiones);
    checkTrue(
      "Punto 4 — el equivalente de MLC ahora es visible",
      await page.locator('[data-equiv="MLC"]').first().isVisible(),
    );
    checkTrue(
      "Punto 4 — el equivalente de USD ya NO es visible",
      !(await page.locator('[data-equiv="USD"]').first().isVisible()),
    );
    checkTrue(
      "Punto 4 — el foco se queda en el selector",
      await select.evaluate((el) => el === document.activeElement),
    );

    // Sobrevive a recargar.
    await page.reload({ waitUntil: "networkidle" });
    checkTrue(
      "Punto 4 — tras recargar, MLC sigue elegido",
      await page.locator('[data-equiv="MLC"]').first().isVisible(),
    );

    // Sobrevive a navegar, en las cinco pantallas (DH2: un selector único).
    for (const ruta of [
      "/tienda-demo/c/bebidas",
      "/tienda-demo/catalogo",
      "/tienda-demo/buscar?q=agua",
      "/tienda-demo/p/agua-natural-500-ml",
    ]) {
      await page.goto(`${BASE}${ruta}`, { waitUntil: "networkidle" });
      checkTrue(
        `Punto 4 — ${ruta} — MLC sigue elegido sin volver a elegirlo (criterio 12)`,
        await page.locator('[data-equiv="MLC"]').first().isVisible(),
      );
    }
    await ctx.close();
  }

  // ===========================================================
  // Punto 5 — los tres casos raros, en el-faro (seed-negocio-2, lista
  // vacía en el seed). Token propio, acuñado aquí (ficha
  // mint-token-rota-el-token-en-bd-compartida).
  // ===========================================================
  {
    const tokenB = mintToken("seed-negocio-2");
    restaurar.tokenB = tokenB;
    restaurar.faroBusinessId = psql(
      `SELECT id FROM "Business" WHERE "externalId"='seed-negocio-2'`,
    );
    if (!tokenB) {
      fail("Punto 5 — no se pudo acuñar el token de seed-negocio-2");
    } else {
      // (a) ["CUP","USD","EUR"] con tasa SOLO de USD: EUR no se pinta y NO
      // se ofrece en el selector (DH5) — exactamente dos opciones.
      await syncCatalog(tokenB, "seed-negocio-2", [
        businessEvent("seed-negocio-2", ["CUP", "USD", "EUR"]),
      ]);
      await syncCatalog(tokenB, "seed-negocio-2", [
        exchangeRateEvent("seed-negocio-2", "USD", 440),
      ]);

      const ctxA = await browser.newContext({ viewport: MOVIL });
      const pageA = await ctxA.newPage();
      await pageA.goto(`${BASE}/el-faro`, { waitUntil: "networkidle" });
      const opciones = await pageA
        .locator("select#reference-currency-select option")
        .allTextContents();
      check("Punto 5(a) — las opciones del selector son EXACTAMENTE dos (DH5)", 2, opciones.length);
      check("Punto 5(a) — «Solo CUP» primero", "Solo CUP", opciones[0]);
      check("Punto 5(a) — «También en USD» segundo", "También en USD", opciones[1]);
      check(
        "Punto 5(a) — EUR no aparece entre las opciones",
        -1,
        opciones.findIndex((o) => o.includes("EUR")),
      );
      check(
        "Punto 5(a) — el equivalente de EUR no aparece en ningún producto",
        0,
        await pageA.locator('[data-equiv="EUR"]').count(),
      );
      checkTrue(
        "Punto 5(a) — el equivalente de USD sí se pinta",
        (await pageA.locator('[data-equiv="USD"]').count()) > 0,
      );
      await shot(pageA, "05a-eur-sin-tasa");
      await ctxA.close();

      // (b) Llega el EXCHANGE_RATE de EUR: la PRIMERA visita posterior ya
      // lo ofrece y lo pinta, sin que nadie reenvíe BUSINESS (E19).
      await syncCatalog(tokenB, "seed-negocio-2", [
        exchangeRateEvent("seed-negocio-2", "EUR", 500),
      ]);
      const ctxB = await browser.newContext({ viewport: MOVIL });
      const pageB = await ctxB.newPage();
      await pageB.goto(`${BASE}/el-faro`, { waitUntil: "networkidle" });
      const opcionesTrasTasa = await pageB
        .locator("select#reference-currency-select option")
        .allTextContents();
      check(
        "Punto 5(b) — EUR entra SOLO al selector, sin reenviar BUSINESS (E19)",
        3,
        opcionesTrasTasa.length,
      );
      checkTrue(
        "Punto 5(b) — EUR ahora aparece entre las opciones",
        opcionesTrasTasa.some((o) => o.includes("EUR")),
      );
      checkTrue(
        "Punto 5(b) — el equivalente de EUR ya se pinta (en el DOM)",
        (await pageB.locator('[data-equiv="EUR"]').count()) > 0,
      );
      await shot(pageB, "05b-eur-con-tasa");
      await ctxB.close();

      // (c) Lista vacía: la página de hoy, sin sub-barra. Y lo mismo con
      // una lista que declara pero NINGUNA moneda tiene tasa.
      await syncCatalog(tokenB, "seed-negocio-2", [businessEvent("seed-negocio-2", [])]);
      const ctxC1 = await browser.newContext({ viewport: MOVIL });
      const pageC1 = await ctxC1.newPage();
      await pageC1.goto(`${BASE}/el-faro`, { waitUntil: "networkidle" });
      check(
        "Punto 5(c) — lista vacía: sin selector",
        0,
        await pageC1.locator("select#reference-currency-select").count(),
      );
      check(
        "Punto 5(c) — lista vacía: sin ningún equivalente",
        0,
        await pageC1.locator("[data-equiv]").count(),
      );
      await shot(pageC1, "05c-lista-vacia");
      await ctxC1.close();

      // GBP, no USD ni EUR: las otras dos YA tienen tasa desde (a)/(b) de
      // este mismo punto, así que reutilizarlas aquí no probaría "ninguna
      // con tasa" — probaría "con tasa vieja todavía puesta".
      await syncCatalog(tokenB, "seed-negocio-2", [businessEvent("seed-negocio-2", ["GBP"])]);
      const ctxC2 = await browser.newContext({ viewport: MOVIL });
      const pageC2 = await ctxC2.newPage();
      await pageC2.goto(`${BASE}/el-faro`, { waitUntil: "networkidle" });
      check(
        "Punto 5(c) — declara GBP pero SIN tasa: también sin selector (como la lista vacía)",
        0,
        await pageC2.locator("select#reference-currency-select").count(),
      );
      check(
        "Punto 5(c) — declara GBP pero SIN tasa: también sin ningún equivalente",
        0,
        await pageC2.locator("[data-equiv]").count(),
      );
      await ctxC2.close();

      // Restaura el-faro EXACTAMENTE a como lo encontró (I3 de spec.md).
      await syncCatalog(tokenB, "seed-negocio-2", [businessEvent("seed-negocio-2", [])]);
      psql(
        `DELETE FROM "ExchangeRate" WHERE "businessId"='${restaurar.faroBusinessId}' AND "currencyCode" IN ('USD','EUR')`,
      );
    }
  }

  // ===========================================================
  // Punto 6 — cuarenta monedas a 360: legible y desplazable, sin
  // desplazamiento HORIZONTAL, dos columnas alineadas, ninguna imagen
  // deformada. Es el estado SERVIDO (sin JS, o el instante antes de
  // reducir) el que tiene los cuarenta equivalentes — es el peor caso de
  // SP2(a) (design.md § El destello).
  // ===========================================================
  {
    restaurar.demoBusinessId = psql(
      `SELECT id FROM "Business" WHERE "externalId"='seed-negocio-1'`,
    );
    const codigos = cuarentaMonedas();
    await syncCatalog(TOKEN_A, "seed-negocio-1", [
      businessEvent("seed-negocio-1", ["CUP", ...codigos]),
    ]);
    await syncCatalog(
      TOKEN_A,
      "seed-negocio-1",
      codigos.map((c) => exchangeRateEvent("seed-negocio-1", c, 100 + Math.random() * 400)),
    );

    const ctx = await browser.newContext({ viewport: MOVIL, javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/tienda-demo`, { waitUntil: "load" });
    checkTrue(
      "Punto 6 — sin desplazamiento horizontal con 40 monedas",
      !(await sinDesbordeHorizontal(page)),
    );
    const cols = await page.evaluate(
      () =>
        getComputedStyle(document.querySelector("ul.grid")).gridTemplateColumns.split(" ").length,
    );
    check("Punto 6 — la rejilla sigue en DOS columnas alineadas a 360px", 2, cols);
    const imagenes = await page.locator("ul.grid img").all();
    let deformada = false;
    for (const img of imagenes) {
      const box = await img.boundingBox();
      if (box && Math.abs(box.width - box.height) > 2) deformada = true;
    }
    checkTrue("Punto 6 — ninguna imagen deformada", !deformada);
    const alturaTarjeta = (await primeraTarjeta(page).boundingBox())?.height;
    const alturaPagina = await page.evaluate(() => document.documentElement.scrollHeight);
    note(
      `Punto 6 — tarjeta ${alturaTarjeta}px (design.md midió ~792 en su prototipo), página ${alturaPagina}px (~7069 en el prototipo) — el ORDEN de magnitud es el mismo; la cifra exacta depende de los códigos/tasas al azar de esta corrida y de la del prototipo, no es una invariante a reproducir al píxel`,
    );
    await shot(page, "06-cuarenta-monedas-360");
    await ctx.close();

    // Restaura tienda-demo al residuo que F-038/smoke.sh espera.
    await syncCatalog(TOKEN_A, "seed-negocio-1", [
      businessEvent("seed-negocio-1", ["CUP", "USD", "MLC"]),
    ]);
    psql(
      `DELETE FROM "ExchangeRate" WHERE "businessId"='${restaurar.demoBusinessId}' AND "currencyCode" LIKE 'A%' AND "currencyCode" != 'CUP'`,
    );
  }

  // ===========================================================
  // Punto 7 — tema oscuro y una tienda con --color-brand propio: el
  // equivalente sigue legible y el control sigue en --color-surface, no en
  // el color de la marca.
  // ===========================================================
  {
    const ctx = await browser.newContext({ viewport: MOVIL, colorScheme: "dark" });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/tienda-dos`, { waitUntil: "networkidle" });
    await shot(page, "07-oscuro-tienda-dos");

    const medido = await page.evaluate(() => {
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
      const equiv = document.querySelector('[data-equiv="USD"]');
      const card = equiv?.closest("li");
      if (!equiv || !card) return { encontrado: false };
      const textoColor = aRGBA(getComputedStyle(equiv).color);
      let fondoTarjeta = aRGBA(getComputedStyle(card).backgroundColor);
      const fondoPagina = aRGBA(getComputedStyle(document.body).backgroundColor);
      if (fondoTarjeta.a < 1) fondoTarjeta = componer(fondoTarjeta, fondoPagina);
      const select = document.querySelector("select#reference-currency-select");
      const selectBg = getComputedStyle(select).backgroundColor;
      const surfaceVar = getComputedStyle(document.documentElement)
        .getPropertyValue("--color-surface")
        .trim();
      const brandVar = getComputedStyle(document.documentElement)
        .getPropertyValue("--color-brand")
        .trim();
      // El fondo del <select> se compara con el MISMO canvas de 1x1 contra
      // el que produce cada custom property — no una comparación de texto
      // entre "--color-surface" (una variable) y un rgb() calculado, que
      // nunca serían iguales como cadenas.
      const selectBgRGBA = aRGBA(selectBg);
      const surfaceRGBA = aRGBA(surfaceVar);
      const brandRGBA = aRGBA(brandVar);
      const selectEsSurface = JSON.stringify(selectBgRGBA) === JSON.stringify(surfaceRGBA);
      const selectNoEsBrand = JSON.stringify(selectBgRGBA) !== JSON.stringify(brandRGBA);
      return {
        encontrado: true,
        contraste: razon(textoColor, fondoTarjeta),
        selectEsSurface,
        selectNoEsBrand,
      };
    });

    if (medido.encontrado) {
      checkTrue(
        "Punto 7 — en oscuro, el equivalente sigue con contraste ≥ 4.5:1 (WCAG AA texto)",
        medido.contraste >= 4.5,
      );
      note(
        `Punto 7 — contraste medido: ${medido.contraste?.toFixed(2)} (design.md midió 6,63 en su prototipo)`,
      );
      checkTrue("Punto 7 — el <select> sigue en --color-surface", medido.selectEsSurface);
      checkTrue(
        "Punto 7 — el <select> NO toma el --color-brand de la tienda (verde de tienda-dos)",
        medido.selectNoEsBrand,
      );
    } else {
      fail("Punto 7 — no se encontró el equivalente o la tarjeta para medir contraste");
    }
    await ctx.close();
  }

  // ===========================================================
  // Punto 8 — el nombre accesible: con USD elegido, contiene "aproximadamente
  // …" y NO contiene el de MLC. Y cambiar de moneda anuncia UNA frase, no
  // veinticuatro.
  // ===========================================================
  {
    const ctx = await browser.newContext({ viewport: MOVIL });
    const page = await ctx.newPage();
    await prepararPagina(page, "/tienda-demo (nombre accesible)");
    await page.goto(`${BASE}/tienda-demo`, { waitUntil: "networkidle" });

    const tarjeta = page.locator("ul.grid > li", { hasText: "Arroz blanco 1 kg" }).first();
    const snapshot = await tarjeta.locator("a").first().ariaSnapshot();
    checkTrue(
      'Punto 8 — el nombre accesible contiene "aproximadamente "',
      /aproximadamente /.test(snapshot),
    );
    checkTrue(
      'Punto 8 — el nombre accesible contiene el equivalente de USD ("US$")',
      /US\$/.test(snapshot),
    );
    checkTrue("Punto 8 — el nombre accesible NO contiene el de MLC", !/MLC/.test(snapshot));

    // Cambiar de moneda anuncia UNA frase, no veinticuatro: una sola región
    // aria-live en toda la página, con exactamente un mensaje tras elegir.
    check(
      "Punto 8 — hay EXACTAMENTE una región aria-live=polite en la página",
      1,
      await page.locator('[aria-live="polite"]').count(),
    );
    const select = page.locator("select#reference-currency-select");
    await select.click();
    await select.selectOption("MLC");
    await page.waitForTimeout(200);
    const anuncios = await page.locator('[aria-live="polite"]').allTextContents();
    check(
      "Punto 8 — el anuncio es EXACTAMENTE una frase",
      1,
      anuncios.filter((t) => t.trim().length > 0).length,
    );
    check(
      "Punto 8 — el anuncio dice lo que cambió",
      "Ahora también en MLC.",
      anuncios.find((t) => t.trim().length > 0),
    );
    await ctx.close();
  }

  // -------------------------------------------------------------------------
} catch (e) {
  fail(`el guion visual se rompió: ${e.message}`);
} finally {
  // Cinturón y tirantes: si algo lanzó a mitad del punto 5 o 6 antes de
  // llegar a su propia restauración, esto deja las dos tiendas exactamente
  // como las encontró este guion, sin depender de en qué línea reventó.
  try {
    if (restaurar.tokenB && restaurar.faroBusinessId) {
      await syncCatalog(restaurar.tokenB, "seed-negocio-2", [businessEvent("seed-negocio-2", [])]);
      psql(
        `DELETE FROM "ExchangeRate" WHERE "businessId"='${restaurar.faroBusinessId}' AND "currencyCode" IN ('USD','EUR')`,
      );
    }
    if (restaurar.demoBusinessId) {
      const actual = psql(
        `SELECT "displayCurrencies" FROM "Business" WHERE id='${restaurar.demoBusinessId}'`,
      );
      if (actual !== "{CUP,USD,MLC}") {
        await syncCatalog(TOKEN_A, "seed-negocio-1", [
          businessEvent("seed-negocio-1", ["CUP", "USD", "MLC"]),
        ]);
      }
      psql(
        `DELETE FROM "ExchangeRate" WHERE "businessId"='${restaurar.demoBusinessId}' AND "currencyCode" LIKE 'A%' AND "currencyCode" != 'CUP'`,
      );
    }
  } catch (e) {
    fail(`la restauración final de datos falló: ${e.message} — revisar a mano el-faro/tienda-demo`);
  }
  await context.tracing.stop({ path: `${TRACES}/trace.zip` });
  await browser.close();
}

console.log(`\n${fails} aserciones fallidas`);
process.exit(fails === 0 ? 0 : 1);
