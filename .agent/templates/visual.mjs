// Verificación visual del feature F-XXX. La ejecuta `bash .agent/verify.sh
// F-XXX --visual` con la app ya levantada; $VISUAL_BASE_URL apunta a ella y
// $VISUAL_SHOTS es la carpeta donde dejar las capturas.
//
// Esto comprueba lo que `curl` no puede ver: si la lista salta mientras carga,
// si el foco va donde debe, si el formulario es anunciable, si la pantalla
// aguanta 360 px de ancho, si el flujo sobrevive a una conexión de 3G.
//
// Headless y por Bash a propósito: la extensión de Chrome necesita que un humano
// la conecte, no existe en CI y no se repite entre sesiones. Esto lo corre
// cualquier agente que tenga Bash.
//
// Regla: cada aserción que no se cumpla imprime `VISUAL FAIL <qué>`. Eso es lo
// que el sensor busca para ponerle firma al error.

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
// viewport y aterriza en mitad del contenido: parece un defecto de la interfaz
// tapando un producto, y no lo es. Costó media investigación la primera vez.
// Se oculta en la página, no en next.config.ts: el indicador es útil para el
// humano que desarrolla, y esto solo afecta a la verificación.
const SIN_OVERLAY_DE_DEV = `
  nextjs-portal, [data-nextjs-dev-tools-button], [data-nextjs-toast] {
    display: none !important;
  }
`;

async function prepararPagina(page, donde) {
  vigilarConsola(page, donde);
  await page.addStyleTag({ content: SIN_OVERLAY_DE_DEV });
}

// Una captura por paso, nombrada por el paso. Quedan en .agent/runs/<ID>/shots/
// y el log del sensor las lista: es lo que permite comparar dos ejecuciones y
// lo único que un humano puede mirar después sin repetir el ciclo.
async function shot(page, nombre) {
  await page.screenshot({ path: `${SHOTS}/${nombre}.png`, fullPage: true });
}

// Los errores de consola del navegador son fallos, no ruido: un componente de
// cliente que revienta al hidratar deja la pantalla servida y muerta, y el HTML
// sigue viéndose bien en curl.
function vigilarConsola(page, donde) {
  page.on("console", (m) => {
    if (m.type() === "error") fail(`error de consola en ${donde}: ${m.text()}`);
  });
  page.on("pageerror", (e) => fail(`excepción en ${donde}: ${e.message}`));
}

const browser = await chromium.launch();

try {
  // --- Ejemplos; sustitúyelos por los pasos V* de design.md -----------------

  const page = await browser.newPage({ viewport: MOVIL });
  await page.goto(`${BASE}/tienda-demo`, { waitUntil: "networkidle" });
  await prepararPagina(page, "/tienda-demo");
  await shot(page, "V01-catalogo-movil");

  // Que la página no se desborde a lo ancho: es el fallo responsive que más
  // fácil se cuela y que ninguna aserción de HTML detecta.
  const desborde = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  check("el catálogo no scrollea en horizontal a 360 px", false, desborde);

  // Que una lista no «salte» cuando llega un dato asíncrono: se mide la posición
  // de un elemento antes y después, no se mira una captura.
  const antes = await page.locator("main").first().boundingBox();
  await page.waitForTimeout(1500);
  const despues = await page.locator("main").first().boundingBox();
  check("el contenido no se desplaza al hidratar", antes?.y, despues?.y);

  // Accesibilidad de un formulario: cada campo con su etiqueta accesible. Un
  // input sin nombre es invisible para un lector de pantalla.
  const anchos = await page.locator("main input:not([type=hidden])").all();
  for (const [i, input] of anchos.entries()) {
    const nombre = await input.evaluate((el) => {
      const porAria = el.getAttribute("aria-label");
      if (porAria) return porAria;
      const id = el.getAttribute("id");
      if (id && document.querySelector(`label[for="${id}"]`)) return "label";
      return el.closest("label") ? "label" : "";
    });
    if (!nombre) fail(`el input #${i} no tiene etiqueta accesible`);
  }

  await page.setViewportSize(ESCRITORIO);
  await shot(page, "V02-catalogo-escritorio");

  await page.close();

  // -------------------------------------------------------------------------
} catch (e) {
  fail(`el guion visual se rompió: ${e.message}`);
} finally {
  await browser.close();
}

console.log(`\n${fails} aserciones fallidas`);
process.exit(fails === 0 ? 0 : 1);
