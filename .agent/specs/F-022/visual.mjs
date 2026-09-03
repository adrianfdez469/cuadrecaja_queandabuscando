// Verificación visual de F-022 (zona horaria de la tienda y el horario
// publicado de la semana en /[slug]). La ejecuta `bash .agent/verify.sh
// F-022 --visual` con la app ya levantada; $VISUAL_BASE_URL apunta a ella,
// $VISUAL_SHOTS es la carpeta de capturas y $VISUAL_TRACES la del trace de
// Playwright.
//
// Traduce los QUINCE pasos V1-V15 de design.md § Verificación visual
// (design.md:837-851). Corrección sobre una versión anterior de este mismo
// guion: solo cubría V1-V12 porque el primer resumen del orquestador se
// cortó en la fila V12 de la tabla y nadie —ni él, ni yo— se dio cuenta de
// que la tabla seguía hasta V15. Los tres se añadieron después, sin que
// nadie los hubiera excluido nunca.
//
// Datos: `npm run seed` deja `tienda-demo` con el calendario del caso 3
// (dos ventanas un día, un día cerrado, un cruce de medianoche en viernes,
// un día de 24 horas en sábado) — es, medido, el PEOR caso de siete tramos
// que V3 pide, así que no hace falta sembrar nada nuevo. `tienda-dos` no
// tiene horario (V6) pero SÍ tiene una marca distinta (verde, V13).
// `tienda-cerrada` está SUSPENDED y tampoco tiene horario (V12).
//
// V8 (`npm run check:bundle`) NO se ejecuta dentro de este guion: necesita
// `next build`, y ese build escribe en el MISMO `.next/` que el `next dev`
// que este guion está usando en paralelo — correrlos a la vez arriesga
// corromper la caché del dev server a mitad de la verificación. Se corre
// aparte, con el dev server parado (mismo criterio que ya usó
// `.agent/specs/F-023/tests.md` § criterio 7), y su resultado se pega en
// `tests.md`, no aquí.
//
// V11 (el grep del módulo de copy) y V15 (ausencia de <Suspense>/fallback/
// loading.tsx) tampoco necesitan el navegador: son lectura de archivos, así
// que corren antes de abrir Chromium.
//
// V14 (los tres casos de § La presentación de la semana y los cinco bordes
// del reloj, con el texto literal del documento) tampoco toca el
// navegador NI Postgres: `design.md:853-856` dice, con esas palabras, que
// "como nada depende del instante, los tres casos y los cinco bordes se
// provocan cambiando el calendario sembrado" — pero cambiar el calendario
// de una tienda SEMBRADA (tienda-demo/tienda-dos) para probar ocho formas
// pasajeras significaría mutar datos que otros worktrees comparten en la
// MISMA Postgres, y hacerlo por el único camino de escritura real (el sync)
// exige un token de negocio que, al acuñarse, ROTA — la trampa de
// `.agent/playbook/mint-token-rota-el-token-en-bd-compartida.md`, que le
// dejaría un 401 a cualquier otra sesión que tuviera el token de
// `seed-negocio-1` exportado. `StoreHoursNotice` no tiene más entrada que
// `{ schedule }` (architecture.md § Componentes: nunca lee una tienda, una
// marca o un instante), así que renderizarlo aislado con
// `react-dom/server` — en `renderHoursNotice.mjs`, vía `npx tsx` porque
// `node` no entiende `.tsx` — es el MISMO código de producción, no un
// sustituto, y no toca ni el navegador ni la base compartida.
//
// Headless y por Bash a propósito: la extensión de Chrome necesita que un
// humano la conecte, no existe en CI y no se repite entre sesiones.
//
// Regla: cada aserción que no se cumpla imprime `VISUAL FAIL <qué>`. Eso es
// lo que el sensor busca para ponerle firma al error.

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.VISUAL_BASE_URL ?? "http://localhost:3101";
const SHOTS = process.env.VISUAL_SHOTS ?? ".agent/runs/_libre/shots";
const TRACES = process.env.VISUAL_TRACES ?? ".agent/runs/_libre/traces";

// V3 fija 360×800 explícitamente (no el 360×740 genérico de otras
// features): con menos alto la primera fila de tarjetas no cabría nunca,
// aunque el bloque midiera 0px.
const MOVIL = { width: 360, height: 800 };
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

function checkTrue(que, cond) {
  if (cond) {
    console.log(`  ok   ${que}`);
  } else {
    console.log(`VISUAL FAIL ${que}`);
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
// fixed y, en una captura de página completa, aterriza en mitad del
// contenido — no es un defecto de la interfaz.
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

/** Compone un color CSS (oklch/color-mix incluidos) contra el fondo real
 *  pintando un canvas de 1x1 — misma técnica que F-019/visual.mjs y
 *  F-010/visual.mjs V17: Tailwind v4 resuelve muchos colores con
 *  `color-mix()`/`oklch()`, y el canvas 2D los normaliza a RGBA de verdad. */
function medirContraste(selector) {
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
  const el = document.querySelector(selector);
  if (!el) return { encontrado: false };
  let bg = { r: 255, g: 255, b: 255, a: 0 };
  let nodo = el;
  const capas = [];
  while (nodo && nodo !== document.documentElement) {
    capas.unshift(getComputedStyle(nodo).backgroundColor);
    nodo = nodo.parentElement;
  }
  capas.unshift(getComputedStyle(document.body).backgroundColor);
  for (const capa of capas) {
    const c = aRGBA(capa);
    bg = c.a > 0 ? componer(c, bg) : bg;
  }
  const fg = aRGBA(getComputedStyle(el).color);
  return { encontrado: true, razon: razon(fg, bg) };
}

async function contraste(page, selector) {
  return page.evaluate(medirContraste, selector);
}

// --- V11 — el módulo de copy no usa una sola palabra relativa al ahora, ni
// el vocabulario del interruptor (R10, R11). Corre sin navegador. El grep
// es sobre el CÓDIGO SIN COMENTARIOS: la cabecera del módulo cita "hoy" y
// "Abierta"/"Cerrada ahora" precisamente para explicar por qué R11 las
// prohíbe (igual que el propio criterio 6 de F-022 acepta que un comentario
// mencione "umbral" sin que exista la columna) — grepear el archivo entero
// confundiría la explicación de la regla con una violación de la regla. ---
{
  const fuenteCompleta = readFileSync("src/components/store/StoreHoursNotice.tsx", "utf8");
  const sinComentarios = fuenteCompleta
    .replace(/\/\*[\s\S]*?\*\//g, "") // bloques /** ... */
    .replace(/\/\/.*$/gm, ""); // líneas // ...
  const prohibidas = /\b(hoy|ahora|mañana|Abierta|Cerrada|Suspendida)\b/gi;
  const hallazgos = sinComentarios.match(prohibidas);
  checkTrue(
    "V11 — el CÓDIGO de StoreHoursNotice.tsx (sin comentarios) no usa hoy/ahora/mañana/Abierta/Cerrada/Suspendida",
    hallazgos === null,
  );
  if (hallazgos) fail(`V11 — encontrado fuera de un comentario: ${hallazgos.join(", ")}`);
}

// --- V14 — los tres casos de § La presentación de la semana y los cinco
// bordes del reloj de 12 horas, con el texto LITERAL de design.md. Corre
// sin navegador y sin Postgres: ver la cabecera de este archivo para el
// motivo (mutar el calendario sembrado rota un token compartido). El
// renderer es un archivo aparte porque necesita `npx tsx` (importa un
// `.tsx`), no `node` — que es lo que `correr_visual` usa para ESTE archivo. -
{
  const script = ".agent/specs/F-022/renderHoursNotice.mjs";
  try {
    const salida = execFileSync("npx", ["tsx", script], { encoding: "utf8" });
    console.log(salida.trimEnd());
    const fallidas = (salida.match(/^VISUAL FAIL /gm) ?? []).length;
    fails += fallidas;
  } catch (e) {
    // execFileSync lanza cuando el proceso hijo sale con código != 0 — su
    // stdout (con las líneas "VISUAL FAIL ..." de renderHoursNotice.mjs) va
    // en e.stdout, no en e.message.
    console.log((e.stdout ?? "").toString().trimEnd());
    const fallidas = ((e.stdout ?? "").toString().match(/^VISUAL FAIL /gm) ?? []).length;
    fails += fallidas > 0 ? fallidas : 1;
    if (fallidas === 0) fail(`V14 — renderHoursNotice.mjs se rompió: ${e.message}`);
  }
}

// --- V15 — ni <Suspense>, ni fallback, ni esqueleto, ni loading.tsx en
// ninguno de los archivos que este feature crea o toca (architecture.md §
// Archivos). Es la guarda del trilema del ISR (AP1 = (b)): si cualquiera de
// los cuatro se colara, la página dejaría de estar cacheada tal cual está y
// el argumento de "cero JavaScript de cliente" se caería con ella. Corre
// sin navegador: es lectura de archivos y un `find`. --------------------
{
  const ARCHIVOS_DEL_FEATURE = [
    "src/components/store/StoreHoursNotice.tsx",
    "src/app/[slug]/page.tsx",
    "src/features/catalog/server/queries.ts",
    "src/features/sync/server/handlers/store.ts",
    "src/features/admin/server/mutations.ts",
    "src/app/api/admin/_lib/respond.ts",
    "src/features/admin/types.ts",
    "src/constants/storeHours.ts",
    "src/constants/sync.ts",
    "src/constants/admin.ts",
    "src/lib/timezone.ts",
    "src/lib/openingHours.ts",
  ];
  // Deliberadamente ESTRECHO: `fallback` es una palabra genérica que
  // store.ts ya usa para su propio parámetro de configuración
  // (`assertDeliveryConsistent(config, fallback)`), sin relación con
  // Suspense. Lo que se prohíbe es la FORMA de un fallback de React:
  // `fallback={` (la prop de <Suspense>) o `<Suspense` en sí.
  const PROHIBIDO = /<Suspense\b|\bfallback=\{|<Skeleton\b|animate-pulse/;
  for (const archivo of ARCHIVOS_DEL_FEATURE) {
    const fuente = readFileSync(archivo, "utf8");
    const hallazgo = PROHIBIDO.test(fuente);
    checkTrue(`V15 — ${archivo} no tiene <Suspense>/fallback/esqueleto`, !hallazgo);
  }
  // `src/app/[slug]/layout.tsx` está explícitamente en la lista de "lo que
  // NO se toca" de architecture.md — y es donde viviría un `loading.tsx`
  // hermano si alguien lo añadiera.
  checkTrue(
    "V15 — no existe src/app/[slug]/loading.tsx",
    !existsSync("src/app/[slug]/loading.tsx"),
  );
}

const browser = await chromium.launch();

try {
  // --- V1 — el bloque entre la ruta y el buscador, en los tres anchos, y EN
  // ESE ORDEN en el DOM. -----------------------------------------------
  {
    const context = await browser.newContext({ viewport: MOVIL });
    // Trace de esta secuencia (la más larga) — el resto de contextos son de
    // un solo paso y no lo necesitan tanto.
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const page = await context.newPage();
    await page.goto(`${BASE}/tienda-demo`, { waitUntil: "networkidle" });
    await prepararPagina(page, "/tienda-demo (V1/V2/V3/V9)");

    for (const [nombre, viewport] of [
      ["360px", MOVIL],
      ["768px", TABLET],
      ["1280px", ESCRITORIO],
    ]) {
      await page.setViewportSize(viewport);
      const orden = await page.evaluate(() => {
        const nodos = document.querySelectorAll(
          'nav[aria-label="Ruta"], section:has(#horario), form[role="search"]',
        );
        return Array.from(nodos).map((n) => n.tagName);
      });
      check(
        `V1 — orden DOM (ruta, horario, buscador) a ${nombre}`,
        "NAV,SECTION,FORM",
        orden.join(","),
      );
    }
    await shot(page, "V01-orden-dom-1280");

    // --- V2 — sin scroll horizontal a 360px, con el calendario del caso 3.
    await page.setViewportSize(MOVIL);
    const desborde = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    check("V2 — sin scroll horizontal a 360px", false, desborde);
    await shot(page, "V02-movil-360");

    // --- V3 — la y de la primera imagen de producto, 360×800, peor caso de
    // siete tramos (tienda-demo: mon/tue/wed/thu/fri/sat/sun son 7 valores
    // distintos, cero se compactan — es el peor caso, medido). ------------
    const primeraTarjeta = page.locator("main ul li").first();
    const caja = await primeraTarjeta.boundingBox();
    checkTrue(
      `V3 — la primera tarjeta de producto empieza por debajo de 0 (y=${caja?.y})`,
      caja !== null,
    );
    if (caja) check("V3 — y de la primera tarjeta < 600px a 360×800", true, caja.y < 600);

    // --- V9 — el tabulador desde la cabecera hasta la primera tarjeta NO
    // pasa por el horario (que no debe tener nada enfocable). ------------
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    let tocoHorario = false;
    let llegoATarjeta = false;
    for (let i = 0; i < 25 && !llegoATarjeta; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return { enHorario: false, esTarjeta: false };
        const horario = el.closest("section:has(#horario)");
        const tarjeta = el.closest("main ul li");
        return { enHorario: horario !== null, esTarjeta: tarjeta !== null };
      });
      if (info.enHorario) tocoHorario = true;
      if (info.esTarjeta) llegoATarjeta = true;
    }
    checkTrue("V9 — se alcanzó la primera tarjeta con Tab (el recorrido avanzó)", llegoATarjeta);
    check("V9 — el horario nunca recibió el foco en el recorrido", false, tocoHorario);

    await context.tracing.stop({ path: `${TRACES}/V1-V2-V3-V9.zip` });
    await context.close();
  }

  // --- V4 — contraste del rótulo y de las horas, canvas 1×1, claro y oscuro.
  for (const modo of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: MOVIL, colorScheme: modo });
    const page = await context.newPage();
    await page.goto(`${BASE}/tienda-demo`, { waitUntil: "networkidle" });
    await prepararPagina(page, `/tienda-demo (V4 ${modo})`);

    const rotulo = await contraste(page, "#horario");
    checkTrue(`V4 — el rótulo "#horario" existe en ${modo}`, rotulo.encontrado);
    if (rotulo.encontrado) {
      checkTrue(
        `V4 — contraste del rótulo ≥ 4.5:1 en ${modo} (${rotulo.razon.toFixed(2)}:1)`,
        rotulo.razon >= 4.5,
      );
    }

    const horas = await contraste(page, "dl dd");
    checkTrue(`V4 — las horas ("dl dd") existen en ${modo}`, horas.encontrado);
    if (horas.encontrado) {
      checkTrue(
        `V4 — contraste de las horas ≥ 4.5:1 en ${modo} (${horas.razon.toFixed(2)}:1)`,
        horas.razon >= 4.5,
      );
    }

    await shot(page, `V04-contraste-${modo}`);
    await context.close();
  }

  // --- V10 — árbol de accesibilidad del <dl> a 768px, con sm:contents. ---
  {
    const context = await browser.newContext({ viewport: TABLET });
    const page = await context.newPage();
    await page.goto(`${BASE}/tienda-demo`, { waitUntil: "networkidle" });
    await prepararPagina(page, "/tienda-demo (V10, 768px)");

    // Confirma que el breakpoint sm: (640px) está activo a 768px: el <div>
    // que envuelve cada <dt>/<dd> pasa a display:contents y desaparece de
    // la caja, dejando sus hijos como hijos directos del <dl> a ojos del
    // árbol de accesibilidad.
    const wrapperDisplay = await page.evaluate(() => {
      const wrapper = document.querySelector("dl > div");
      return wrapper ? getComputedStyle(wrapper).display : null;
    });
    check(
      "V10 — el <div> envolvente de cada tramo es display:contents a 768px",
      "contents",
      wrapperDisplay,
    );

    const tramosEnElDom = await page.evaluate(() => document.querySelectorAll("dl dt").length);

    const dl = page.locator("dl");
    checkTrue("V10 — el <dl> existe", (await dl.count()) === 1);

    // Snapshot ARIA de verdad (no el DOM): si `sm:contents` no aplicara, el
    // <div> envolvente seguiría en el árbol y ariaSnapshot lo mostraría como
    // una capa extra en vez de dt/dd colgando directo del dl.
    const ariaTexto = await dl.ariaSnapshot();
    note(`V10 — aria snapshot del <dl>: ${ariaTexto.replace(/\n/g, " | ")}`);

    const roleTerm = dl.getByRole("term");
    const roleDefinition = dl.getByRole("definition");
    check(
      "V10 — nº de roles 'term' en el árbol de accesibilidad = nº de tramos",
      tramosEnElDom,
      await roleTerm.count(),
    );
    check(
      "V10 — nº de roles 'definition' en el árbol de accesibilidad = nº de tramos",
      tramosEnElDom,
      await roleDefinition.count(),
    );

    await shot(page, "V10-dl-768");
    await context.close();
  }

  // --- V12 — una tienda con el interruptor apagado: StoreClosedNotice y
  // NINGÚN horario (E9), aunque tuviera uno guardado. --------------------
  {
    const context = await browser.newContext({ viewport: MOVIL });
    const page = await context.newPage();
    await page.goto(`${BASE}/tienda-cerrada`, { waitUntil: "networkidle" });
    await prepararPagina(page, "/tienda-cerrada (V12)");

    const alerta = await page.locator('[role="alert"]').count();
    checkTrue("V12 — StoreClosedNotice se pinta ([role=alert] presente)", alerta > 0);
    const horario = await page.locator("#horario").count();
    check("V12 — ningún horario se pinta en una tienda no publicada", 0, horario);

    await shot(page, "V12-tienda-cerrada");
    await context.close();
  }

  // --- V13 — la marca: tienda-demo (tema por defecto) y tienda-dos (verde,
  // themeTokens.brand distinto) — el horario se lee igual en las dos y
  // NINGUN color de marca lo toca. `tienda-dos` no tiene openingHours
  // sembrado (E8), así que esto NO compara dos horarios pintados: compara
  // dos tiendas con marcas DE VERDAD distintas contra el hecho, medible en
  // las dos, de que la única fuente de --color-brand/--color-accent
  // (`src/features/theming/storeTheme.ts::CUSTOM_PROPERTY`) nunca toca
  // --color-fg-muted/--color-fg, que es lo único que StoreHoursNotice usa. -
  {
    const context = await browser.newContext({ viewport: MOVIL });
    const page = await context.newPage();

    await page.goto(`${BASE}/tienda-demo`, { waitUntil: "networkidle" });
    await prepararPagina(page, "/tienda-demo (V13)");
    const brandDemo = await page.evaluate(() =>
      getComputedStyle(document.querySelector("[data-store]") ?? document.body)
        .getPropertyValue("--color-brand")
        .trim(),
    );
    const fgMutedDemo = await page.evaluate(() =>
      getComputedStyle(document.body).getPropertyValue("--color-fg-muted").trim(),
    );

    await page.goto(`${BASE}/tienda-dos`, { waitUntil: "networkidle" });
    await prepararPagina(page, "/tienda-dos (V13)");
    const brandDos = await page.evaluate(() =>
      getComputedStyle(document.querySelector("[data-store]") ?? document.body)
        .getPropertyValue("--color-brand")
        .trim(),
    );
    const fgMutedDos = await page.evaluate(() =>
      getComputedStyle(document.body).getPropertyValue("--color-fg-muted").trim(),
    );

    checkTrue(
      `V13 — tienda-demo y tienda-dos tienen --color-brand REALMENTE distinto (${brandDemo} vs ${brandDos})`,
      brandDemo !== "" && brandDos !== "" && brandDemo !== brandDos,
    );
    check(
      "V13 — --color-fg-muted (lo único que StoreHoursNotice usa) es IDÉNTICO en las dos tiendas, pese a la marca distinta",
      fgMutedDemo,
      fgMutedDos,
    );

    // Y la prueba estructural, no solo la del token: ninguna clase del
    // componente referencia brand/accent — la única puerta por la que una
    // marca podría tocar el bloque.
    const fuenteComponente = readFileSync("src/components/store/StoreHoursNotice.tsx", "utf8");
    checkTrue(
      "V13 — StoreHoursNotice.tsx no usa ninguna clase bg-brand/text-brand/bg-accent/text-accent",
      !/\b(bg|text|border)-(brand|accent)\b/.test(fuenteComponente),
    );
    // Y la fuente misma de la marca: CUSTOM_PROPERTY (storeTheme.ts) es la
    // ÚNICA puerta por la que un Storefront.themeTokens llega al CSS, y
    // nunca declara --color-fg-muted/--color-fg — confirmado leyendo el
    // propio mapa, no solo confiando en que hoy no lo haga.
    const fuenteTema = readFileSync("src/features/theming/storeTheme.ts", "utf8");
    const mapaCustomProperty = fuenteTema.match(/CUSTOM_PROPERTY[\s\S]*?\n};/)?.[0] ?? "";
    checkTrue(
      "V13 — CUSTOM_PROPERTY (storeTheme.ts) nunca declara --color-fg — es estructuralmente imposible que un theme toque el horario",
      mapaCustomProperty.length > 0 && !/--color-fg/.test(mapaCustomProperty),
    );

    await context.close();
  }
} catch (e) {
  fail(`el guion visual se rompió: ${e.message}`);
} finally {
  await browser.close();
}

// --- V5/V6/V7 — sobre el HTML SERVIDO, con curl: lo que un navegador con
// JavaScript desactivado vería, más estricto que cualquier aserción de
// Playwright sobre el DOM ya hidratado. ------------------------------------
try {
  // V5 — el horario está en el HTML que sirve el servidor.
  const html1 = await (await fetch(`${BASE}/tienda-demo`)).text();
  checkTrue(
    "V5 — 'Horario de atención' está en el HTML servido de /tienda-demo",
    html1.includes("Horario de atención"),
  );
  checkTrue(
    "V5 — un tramo formateado (lunes, 9:00 a.m. a 6:00 p.m.) está en el HTML servido",
    html1.includes("9:00 a.m. a 6:00 p.m."),
  );

  // V6 — una tienda con openingHours nulo: nada de horario aparece, en
  // ninguna parte del HTML (tienda-dos, PUBLISHED, sin calendario).
  const htmlSinHorario = await (await fetch(`${BASE}/tienda-dos`)).text();
  checkTrue(
    "V6 — /tienda-dos (sin horario) no contiene la palabra 'horario'",
    !/horario/i.test(htmlSinHorario),
  );
  checkTrue("V6 — /tienda-dos no tiene el id #horario", !htmlSinHorario.includes('id="horario"'));

  // V7 — dos peticiones a la misma URL, separadas en el tiempo (cruzando
  // cualquier borde de ventana del calendario si lo hubiera), dan el MISMO
  // horario — la página no afirma nada del instante (R14).
  await new Promise((r) => setTimeout(r, 1500));
  const html2 = await (await fetch(`${BASE}/tienda-demo`)).text();
  function extraerHorario(html) {
    const inicio = html.indexOf('id="horario"');
    const fin = html.indexOf("</dl>", inicio);
    return html.slice(inicio, fin === -1 ? inicio + 2000 : fin);
  }
  check(
    "V7 — el horario es idéntico en dos peticiones separadas en el tiempo",
    extraerHorario(html1),
    extraerHorario(html2),
  );
} catch (e) {
  fail(`V5/V6/V7 (curl) fallaron: ${e.message}`);
}

console.log(`\n${fails} aserciones fallidas`);
process.exit(fails === 0 ? 0 : 1);
