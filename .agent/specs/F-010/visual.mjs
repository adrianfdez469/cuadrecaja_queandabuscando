// Verificación visual del feature F-010 (carrito y checkout). La ejecuta
// `bash .agent/verify.sh F-010 --visual` con la app ya levantada;
// $VISUAL_BASE_URL apunta a ella, $VISUAL_SHOTS es la carpeta de capturas y
// $VISUAL_TRACES la carpeta de traces de Playwright (uno por contexto).
//
// Traduce los pasos V7–V22 de design.md § Verificación — los que necesitan
// navegador porque `curl` no puede verlos: si la lista salta al llegar la
// cotización, el rebote de la recotización, offline con «Continuar de todos
// modos», el foco del formulario, 360px sin scroll horizontal, branding,
// oscuro, localStorage bloqueado y sin JavaScript. V1–V6 no viven aquí: no
// necesitan navegador y ya se verifican con curl (spec.md).
//
// Regla: cada aserción que no se cumpla imprime `VISUAL FAIL <qué>`. Eso es lo
// que el sensor busca para ponerle firma al error. Cada paso Vn corre en su
// propio try/catch: que uno se rompa no debe impedir que los demás se
// ejecuten y reporten lo suyo.

import { chromium } from "playwright";

const BASE = process.env.VISUAL_BASE_URL ?? "http://localhost:3101";
const SHOTS = process.env.VISUAL_SHOTS ?? ".agent/runs/_libre/shots";
// Un trace por contexto: timeline navegable (DOM, red, consola, una captura
// por acción) que se abre con `npx playwright show-trace <archivo>`. Más
// pesado que una captura suelta, pero es lo único que deja "reproducir" la
// corrida entera en vez de mirar fotos aisladas — headless no tiene ventana
// que ver en vivo, esto es el sustituto.
const TRACES = process.env.VISUAL_TRACES ?? ".agent/runs/_libre/traces";

const MOVIL = { width: 360, height: 740 };
const TABLET = { width: 768, height: 1024 };
const ESCRITORIO = { width: 1280, height: 800 };

// Productos en existencia en tienda-demo — evitar jugo-de-mango-1-l, que es
// el fixture AGOTADO a propósito (design.md V1, spec.md).
const PRODUCTOS_EN_STOCK = ["cerveza-cristal", "agua-natural-500-ml", "pan-suave"];

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

function ok(que) {
  console.log(`  ok   ${que}`);
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

async function prepararPagina(page, donde) {
  vigilarConsola(page, donde);
  await page.addStyleTag({ content: SIN_OVERLAY_DE_DEV }).catch(() => {});
}

async function shot(page, nombre) {
  await page.screenshot({ path: `${SHOTS}/${nombre}.png`, fullPage: true });
}

// V13/V15 abortan a propósito la petición de cotización para simular la red
// caída — eso el navegador lo reporta como un error de consola real
// (`net::ERR_FAILED`), pero no es un bug de la app: es el propio guion
// rompiendo la red. Sin este interruptor, vigilarConsola lo confundiría con
// una excepción del cliente.
let ignorarFallosDeRedEsperados = false;

function vigilarConsola(page, donde) {
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (ignorarFallosDeRedEsperados && /Failed to load resource|ERR_FAILED/.test(m.text())) return;
    fail(`error de consola en ${donde}: ${m.text()}`);
  });
  page.on("pageerror", (e) => fail(`excepción en ${donde}: ${e.message}`));
}

async function paso(nombre, fn) {
  console.log(`\n--- ${nombre} ---`);
  try {
    await fn();
  } catch (e) {
    fail(`${nombre} — el paso se rompió: ${e.message}`);
  }
}

/** Agrega productos al carrito de tienda-demo pasando por la UI real, no por
 * localStorage: así V7-V15 ejercitan el mismo camino que un comprador. */
async function agregarAlCarrito(page, slugs, tienda = "tienda-demo") {
  for (const slug of slugs) {
    await page.goto(`${BASE}/${tienda}/p/${slug}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Agregar al carrito$/ }).click();
    await page.waitForTimeout(200);
  }
}

// Estrangular TODA la conexión (CDP Network.emulateNetworkConditions) resultó
// poco práctico contra `next dev`: el websocket de HMR y los propios chunks
// de compilación se estrangulan con todo lo demás y el tiempo hasta el primer
// byte deja de ser predecible (se midió más de 10s sin resolver ni siquiera
// `domcontentloaded` con un perfil de 4s de latencia). En su lugar, se
// retrasa solo la petición que a la app le importa — la cotización — con
// `page.route`: mismo efecto observable (el usuario ve "Calculando…" un buen
// rato), determinista de verdad.
function demorarCotizacion(page, ms) {
  return page.route("**/api/orders/quote", async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

function romperCotizacion(page) {
  return page.route("**/api/orders/quote", (route) => route.abort("failed"));
}

async function quitarRuta(page, patron) {
  await page.unroute(patron).catch(() => {});
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: MOVIL });
await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
const page = await context.newPage();
prepararPagina(page, "sesión principal");

let ordenCodigo = null;

// Un teléfono fijo colisiona con el tope de abuso (5 pedidos por teléfono en
// 10 minutos, ORDER_RATE_LIMIT_MAX_PENDING) en cuanto este guion se corre
// más de 5 veces seguidas mientras se depura — pasó de verdad. Uno al azar
// por corrida hace que la etapa se pueda repetir tantas veces como haga falta.
const TELEFONO_PEDIDO = `+53${Math.floor(10000000 + Math.random() * 89999999)}`;

try {
  // ---------------------------------------------------------------- V07 ----
  await paso("V07 — 360px /carrito con 3 líneas", async () => {
    await agregarAlCarrito(page, PRODUCTOS_EN_STOCK);
    await page.goto(`${BASE}/tienda-demo/carrito`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200); // deja asentar la cotización
    await shot(page, "V07-carrito-movil");

    const desborde = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    check("el carrito no scrollea en horizontal a 360px", false, desborde);

    // La barra del subtotal es `fixed bottom-0`: comprobar que no tapa la
    // última línea significa comprobar que, tras hacer scroll hasta el
    // final, la última línea queda por encima de donde empieza la barra —
    // no que sus posiciones absolutas antes de scrollear no se crucen (eso
    // es esperable: el usuario todavía no llegó ahí).
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(150);
    const footerBox = await page.locator("div.fixed.bottom-0").boundingBox();
    const lastLiBox = await page.locator("ul > li").last().boundingBox();
    check(
      "la última línea queda por encima de la barra fija tras hacer scroll",
      true,
      lastLiBox.y + lastLiBox.height <= footerBox.y + 1,
    );

    // −/+/Quitar ≥ 44px de alto (criterio táctil).
    const botones = await page
      .locator('button[aria-label*="unidad"], button:has-text("Quitar")')
      .all();
    let algunoChico = false;
    for (const b of botones) {
      const box = await b.boundingBox();
      if (!box || box.height < 44) algunoChico = true;
    }
    check("−/+/Quitar miden ≥ 44px de alto", false, algunoChico);
  });

  // ---------------------------------------------------------------- V08 ----
  await paso("V08 — 360px /checkout con teclado sobre el teléfono", async () => {
    await page.goto(`${BASE}/tienda-demo/checkout`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await shot(page, "V08-checkout-movil");

    // No hay una barra `position: fixed` que pueda flotar sobre el teclado
    // virtual en esta pantalla — el botón Confirmar vive en el flujo normal
    // del documento (solo `lg:sticky`, nunca `fixed`). Confirmarlo es lo que
    // prueba que el teclado del teléfono, que solo reduce el viewport visual,
    // no puede taparlo con nada flotante.
    const panelResumen = page.locator("div.bg-surface.shadow-card").last();
    const posicion = await panelResumen.evaluate((el) => getComputedStyle(el).position);
    check("el panel de resumen no usa position:fixed a 360px", "static", posicion);
  });

  // ---------------------------------------------------------------- V09 ----
  await paso("V09 — 768px: resumen visible y nombre/teléfono en fila", async () => {
    await page.setViewportSize(TABLET);
    await page.waitForTimeout(300);
    await shot(page, "V09-checkout-tablet");

    // "Sale desplegado": el resumen (subtotal/envío/total + Confirmar) es
    // contenido normal del documento, no algo detrás de un acordeón que haya
    // que abrir — a diferencia del detalle de líneas, que si vive en un
    // <details>.
    const resumenVisible = await page.locator("div.bg-surface.shadow-card").last().isVisible();
    check("el panel de resumen está visible sin interacción", true, resumenVisible);

    const nombreBox = await page.locator("#field-name").boundingBox();
    const telefonoBox = await page.locator("#field-phone").boundingBox();
    check("nombre y teléfono están en la misma fila a 768px", nombreBox.y, telefonoBox.y);
  });

  // ---------------------------------------------------------------- V10 ----
  await paso("V10 — 1280px: dos columnas y resumen sticky", async () => {
    await page.setViewportSize(ESCRITORIO);
    await page.waitForTimeout(300);
    await shot(page, "V10-checkout-escritorio");

    const columnas = await page.evaluate(() => {
      const el = document.querySelector("h1")?.closest("[class*='lg:grid']");
      return el ? getComputedStyle(el).gridTemplateColumns.split(" ").length : 0;
    });
    check("el checkout usa dos columnas a 1280px", 2, columnas);

    const panel = page.locator("div.bg-surface.shadow-card").last();
    const posicionInicial = await panel.evaluate((el) => getComputedStyle(el).position);
    check("el panel de resumen es sticky a 1280px", "sticky", posicionInicial);
    // "Acompaña el scroll sin salirse de su tarjeta": lo que lo hace posible
    // es `top-6` (24px) + sticky — con solo 3 líneas la página no llega a
    // tener overflow que forzar, así que se comprueba la causa (el offset),
    // no un scroll que en esta cotización nunca ocurre.
    const topOffset = await panel.evaluate((el) => getComputedStyle(el).top);
    check("el panel sticky tiene un offset superior fijo (top-6)", "24px", topOffset);

    await page.goto(`${BASE}/tienda-demo/carrito`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const columnasCarrito = await page.evaluate(() => {
      const el = document.querySelector("h1")?.closest("[class*='lg:grid']");
      return el ? getComputedStyle(el).gridTemplateColumns.split(" ").length : 0;
    });
    check("el carrito usa dos columnas a 1280px", 2, columnasCarrito);

    await page.setViewportSize(MOVIL);
  });

  // ---------------------------------------------------------------- V11 ----
  await paso("V11 [c2] — la lista no salta al llegar la cotización", async () => {
    await page.goto(`${BASE}/tienda-demo/carrito`, { waitUntil: "domcontentloaded" });
    const antes = await page.locator("ul > li").first().boundingBox();
    await page.waitForTimeout(1500); // deja llegar y asentar la cotización
    const despues = await page.locator("ul > li").first().boundingBox();
    check(
      "la primera línea no cambia de posición vertical al llegar el precio",
      antes?.y,
      despues?.y,
    );
  });

  // ---------------------------------------------------------------- V12 ----
  await paso("V12 [c2] — cotización lenta muestra precio provisional", async () => {
    await demorarCotizacion(page, 3500);
    try {
      const t0 = Date.now();
      await page.goto(`${BASE}/tienda-demo/carrito`, { waitUntil: "domcontentloaded" });

      // Justo tras cargar, antes de que responda la cotización demorada:
      // precio provisional atenuado, subtotal en "Calculando…", Continuar
      // deshabilitado.
      await page.waitForTimeout(300);
      const subtotalTexto = await page.getByText("Calculando…").first().isVisible();
      check("el subtotal muestra «Calculando…» mientras la cotización tarda", true, subtotalTexto);
      const continuarDeshabilitado = await page
        .getByRole("link", { name: "Continuar" })
        .locator("button")
        .isDisabled();
      check("Continuar está deshabilitado mientras carga", true, continuarDeshabilitado);

      // A los 3s (CART_QUOTE_SLOW_MS) aparece el aviso de conexión lenta.
      // `isVisible()` no espera — hay que darle a Playwright la oportunidad
      // real de reintentar hasta que el temporizador de la app dispare.
      const avisoLento = await page
        .getByText(/conexión lenta/i)
        .first()
        .waitFor({ state: "visible", timeout: 4000 })
        .then(() => true)
        .catch(() => false);
      check("aparece el aviso de conexión lenta a los ~3s", true, avisoLento);
      const transcurrido = Date.now() - t0;
      check("el aviso de lento no aparece antes de los 3s reales", true, transcurrido >= 2900);

      // Y cuando por fin llega, se habilita normalmente.
      await page.waitForSelector('a:has-text("Continuar") button:not([disabled])', {
        timeout: 8000,
      });
      ok("Continuar se habilita en cuanto llega la cotización demorada");
    } finally {
      await quitarRuta(page, "**/api/orders/quote");
    }
  });

  // ---------------------------------------------------------------- V13 ----
  await paso(
    "V13 [c2] — cotización caída: banner, Reintentar, Continuar de todos modos",
    async () => {
      // `context.setOffline(true)` bloquea también la propia navegación
      // (ERR_INTERNET_DISCONNECTED) — en dev, sin service worker, un reload
      // real sin red tampoco cargaría el documento, así que eso no reproduce
      // "la app ya está abierta y la cotización falla" sino "no hay app". Lo
      // fiel a lo que design.md describe es cortar solo la petición que le
      // importa a este paso.
      await romperCotizacion(page);
      ignorarFallosDeRedEsperados = true;
      try {
        await page.goto(`${BASE}/tienda-demo/carrito`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1500);
        await shot(page, "V13-carrito-offline");

        const banner = await page
          .getByRole("alert")
          .filter({ hasText: "No pudimos calcular" })
          .isVisible();
        check("aparece el banner de error de cotización", true, banner);
        const reintentar = await page.getByRole("button", { name: "Reintentar" }).isVisible();
        check("el botón Reintentar está presente", true, reintentar);
        const continuarAntes = await page
          .getByText("Continuar de todos modos")
          .isVisible()
          .catch(() => false);
        check("«Continuar de todos modos» NO aparece en el primer fallo", false, continuarAntes);

        // Reintentar con la red todavía caída: segundo fallo seguido → aparece
        // la vía de escape (errorStreak >= 2, CartView.tsx).
        await page.getByRole("button", { name: "Reintentar" }).click();
        await page.waitForTimeout(800);
        const continuarDespues = await page
          .getByText("Continuar de todos modos")
          .isVisible()
          .catch(() => false);
        check("«Continuar de todos modos» aparece tras el segundo fallo", true, continuarDespues);

        const continuarBoton = await page
          .getByRole("link", { name: "Continuar" })
          .locator("button")
          .isDisabled();
        check("Continuar sigue deshabilitado sin cotización", true, continuarBoton);
      } finally {
        await quitarRuta(page, "**/api/orders/quote");
        ignorarFallosDeRedEsperados = false;
      }
    },
  );

  // ---------------------------------------------------------------- V14 ----
  await paso("V14 [c2] — recotización: tres clics, una sola petición", async () => {
    await page.goto(`${BASE}/tienda-demo/carrito`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    let peticiones = 0;
    const contador = (req) => {
      if (req.url().includes("/api/orders/quote") && req.method() === "POST") peticiones++;
    };
    page.on("request", contador);

    const masBoton = page.locator('button[aria-label*="Agregar una unidad"]').first();
    const filaAntes = await page.locator("ul > li").first().boundingBox();

    await masBoton.click();
    const valorTrasPrimerClic = await page.locator("ul > li").first().locator("input").inputValue();
    await masBoton.click();
    await masBoton.click();
    const valorTrasTercerClic = await page.locator("ul > li").first().locator("input").inputValue();

    // El número sube al instante en cada toque — no espera al rebote.
    check(
      "la cantidad sube en cada clic, sin esperar el rebote",
      Number(valorTrasPrimerClic) + 2,
      Number(valorTrasTercerClic),
    );

    // Espera más que el rebote (400ms) para que la única petición salga.
    await page.waitForTimeout(1200);
    page.off("request", contador);
    check("tres clics seguidos generan UNA sola petición de cotización", 1, peticiones);

    const filaDespues = await page.locator("ul > li").first().boundingBox();
    check(
      "la fila no cambia de alto durante la recotización",
      filaAntes?.height,
      filaDespues?.height,
    );
  });

  // ---------------------------------------------------------------- V15 ----
  await paso("V15 [c2] — checkout sin cotización (offline)", async () => {
    await romperCotizacion(page);
    ignorarFallosDeRedEsperados = true;
    try {
      await page.goto(`${BASE}/tienda-demo/checkout`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      await shot(page, "V15-checkout-offline");

      // Los campos de contacto son HTML plano: se pueden teclear aunque la
      // cotización nunca llegue (no dependen de ella).
      await page.locator("#field-name").fill("Ana Pérez");
      const valorEscrito = await page.locator("#field-name").inputValue();
      check("el campo de nombre acepta texto sin cotización", "Ana Pérez", valorEscrito);

      const confirmarDeshabilitado = await page
        .getByRole("button", { name: /Confirmar/ })
        .isDisabled();
      check("Confirmar permanece deshabilitado sin cotización", true, confirmarDeshabilitado);

      // Reintentar varias veces no lo habilita: sin red no hay cotización
      // honesta que enviar (R6/R7), así que sigue deshabilitado pase lo que pase.
      await page.waitForTimeout(2000);
      const confirmarSigueDeshabilitado = await page
        .getByRole("button", { name: /Confirmar/ })
        .isDisabled();
      check("Confirmar sigue deshabilitado tras esperar", true, confirmarSigueDeshabilitado);
    } finally {
      await quitarRuta(page, "**/api/orders/quote");
      ignorarFallosDeRedEsperados = false;
    }
  });

  // ---------------------------------------------------- (preparación) ----
  // V17, V19 y V21 miran /pedido/<code>: hace falta un pedido real. Se crea
  // uno solo en toda la corrida (el tope de abuso es 5 por teléfono en 10
  // minutos — R14/design.md — y este guion ya usa el mismo teléfono varias
  // veces si algo se reintentara).
  await paso("(preparación) crear un pedido real para /pedido/<code>", async () => {
    await page.goto(`${BASE}/tienda-demo/checkout`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500); // deja llegar la cotización real
    await page.locator("#field-name").fill("Ana Pérez");
    await page.locator("#field-phone").fill(TELEFONO_PEDIDO);
    await page.getByRole("button", { name: /^Confirmar pedido$/ }).click();
    await page.waitForURL(/\/pedido\//, { timeout: 15000 });
    const url = new URL(page.url());
    ordenCodigo = url.pathname.split("/").pop();
    check("se creó un pedido y se navegó a /pedido/<code>", true, Boolean(ordenCodigo));
  });

  // Confirmar pedido vacía el carrito (CheckoutForm.tsx: `cart.clear()` en el
  // 201) — V17-V19 necesitan un carrito con líneas otra vez, o /checkout cae
  // en `<EmptyCart>` y ninguno de sus campos existe.
  await paso("(preparación) rellenar el carrito de nuevo para V17-V19", async () => {
    await agregarAlCarrito(page, PRODUCTOS_EN_STOCK);
  });

  // ---------------------------------------------------------------- V16 ----
  await paso("V16 — branding: tienda-dos (verde, esquinas redondas)", async () => {
    const brandDemo = await page.evaluate(() => {
      const btn = document.querySelector("button:not([disabled])");
      return btn ? getComputedStyle(btn).backgroundColor : null;
    });

    await page.goto(`${BASE}/tienda-dos`, { waitUntil: "networkidle" });
    await prepararPagina(page, "/tienda-dos");
    await shot(page, "V16-tienda-dos-catalogo");

    const brandDos = await page.evaluate(() => {
      const btn = document.querySelector("button:not([disabled])");
      return btn ? getComputedStyle(btn).backgroundColor : null;
    });
    check(
      "tienda-dos usa un color de marca distinto al de tienda-demo",
      true,
      brandDemo !== brandDos && brandDos !== null,
    );

    const radioDemo = await page.evaluate(() => {
      const btn = document.querySelector("button:not([disabled])");
      return btn ? parseFloat(getComputedStyle(btn).borderRadius) : 0;
    });
    // theme tokens: tienda-dos pide radius:"round" — sus esquinas deben ser
    // visiblemente más redondas que las de tienda-demo (radio por defecto).
    await page.goto(`${BASE}/tienda-demo`, { waitUntil: "networkidle" });
    const radioReferencia = await page.evaluate(() => {
      const btn = document.querySelector("button:not([disabled])");
      return btn ? parseFloat(getComputedStyle(btn).borderRadius) : 0;
    });
    check("tienda-dos tiene esquinas notablemente más redondas", true, radioDemo > radioReferencia);

    // "Los importes siguen igual de legibles": el precio se ve, con o sin
    // marca verde encima (design.md habla de los importes del carrito/
    // checkout, en `text-fg` — el de la tarjeta de catálogo sí usa `text-brand`
    // a propósito, así que aquí solo se confirma que el precio está presente
    // y visible, no que ignore la marca).
    const precioVisible = await page
      .locator("p")
      .filter({ hasText: /^\$[\d.,]+$/ })
      .first()
      .isVisible();
    check("hay un precio visible en el catálogo de tienda-dos", true, precioVisible);
  });

  // ---------------------------------------------------------------- V17 ----
  await paso("V17 — oscuro: contraste de los banners warning/danger", async () => {
    await page.emulateMedia({ colorScheme: "dark" });
    try {
      await page.goto(`${BASE}/tienda-demo`, { waitUntil: "networkidle" });
      await prepararPagina(page, "/tienda-demo oscuro");
      await shot(page, "V17-catalogo-oscuro");

      // El carrito de pasos anteriores (V07-V15) ya tiene líneas — sirve tal
      // cual para ver el tema oscuro sin forzar un estado nuevo.
      await page.goto(`${BASE}/tienda-demo/carrito`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1000);
      await shot(page, "V17-carrito-oscuro");

      await page.goto(`${BASE}/tienda-demo/checkout`, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      await shot(page, "V17-checkout-oscuro");

      if (ordenCodigo) {
        await page.goto(`${BASE}/tienda-demo/pedido/${ordenCodigo}`, { waitUntil: "networkidle" });
        await shot(page, "V17-pedido-oscuro");
      }

      // Contraste real, no solo la captura: componer el color de texto sobre
      // el de fondo (ambos con alfa) en un canvas de 1x1 y medir la razón
      // WCAG. bg-warning/15 y bg-danger/12 son colores translúcidos — leer
      // background-color con getComputedStyle da el rgba crudo, no el
      // compuesto contra la tarjeta de abajo, así que hay que componerlo.
      await page.goto(`${BASE}/tienda-demo/checkout`, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      // Forzar un error de validación para que el banner "role=alert" (de
      // fieldErrors) esté en pantalla, con el mismo tono que usan warning/danger.
      await page.getByRole("button", { name: /^Confirmar pedido$/ }).click();

      function medirContrasteEnElNavegador() {
        // tokens.css declara los colores en OKLCH y Tailwind v4 resuelve las
        // variantes de opacidad (`bg-danger/12`) con `color-mix()` — Chromium
        // devuelve `getComputedStyle(...).color` tal cual, en `lab()` /
        // `oklab()`, NUNCA en `rgb()`. Un regex que solo entendía `rgba?(...)`
        // fallaba en silencio con CUALQUIER banner real (encontrado:false
        // pase lo que pase, sin importar cuánto se reintente — así se
        // encontró: 20 reintentos de 500ms tampoco lo arreglaron). Pintar en
        // un canvas de 1×1 y leer el pixel normaliza cualquier color CSS a
        // RGBA sin tener que parsear su sintaxis.
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

        const banner = document.querySelector('[role="alert"]');
        if (!banner) return { encontrado: false };
        const estilo = getComputedStyle(banner);
        const textoColor = aRGBA(estilo.color);
        let bgColor = aRGBA(estilo.backgroundColor);
        const fondoPagina = aRGBA(getComputedStyle(document.body).backgroundColor);
        if (bgColor.a < 1) bgColor = componer(bgColor, fondoPagina);
        return { encontrado: true, razon: razon(textoColor, bgColor) };
      }

      await page.waitForTimeout(300);
      const contraste = await page
        .evaluate(medirContrasteEnElNavegador)
        .catch(() => ({ encontrado: false }));

      if (contraste.encontrado) {
        check(
          "el banner de error tiene contraste ≥ 4.5:1 (WCAG AA texto) en oscuro",
          true,
          contraste.razon >= 4.5,
        );
      } else {
        fail("no se encontró ningún banner role=alert para medir contraste en oscuro");
      }
    } finally {
      await page.emulateMedia({ colorScheme: "light" });
    }
  });

  // ---------------------------------------------------------------- V18 ----
  await paso("V18 — teclado solo: foco al resumen de errores y al campo con error", async () => {
    await page.goto(`${BASE}/tienda-demo/checkout`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    // Enviar vacío con Enter, sin ratón.
    await page.locator("#field-name").focus();
    await page.keyboard.press("Tab"); // deja el campo, foco en teléfono
    await page.locator('button:has-text("Confirmar")').first().focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);

    const foco = await page.evaluate(() => ({
      role: document.activeElement?.getAttribute("role"),
      tag: document.activeElement?.tagName,
    }));
    check(
      "el foco cae en el resumen de errores (role=alert) tras un envío inválido",
      "alert",
      foco.role,
    );

    // El enlace "Teléfono: ..." del resumen lleva al campo.
    const enlaceTelefono = page.getByRole("link", { name: /Teléfono/ });
    await enlaceTelefono.click();
    await page.waitForTimeout(200);
    const idActivo = await page.evaluate(() => document.activeElement?.id);
    check('el enlace "Teléfono" del resumen enfoca #field-phone', "field-phone", idActivo);
  });

  // ---------------------------------------------------------------- V19 ----
  await paso(
    "V19 — proxy de lector de pantalla: aria-live, aria-describedby, deletreo",
    async () => {
      // Nota: no existe forma de accionar VoiceOver real de forma headless —
      // ni siquiera en macOS lo expone Playwright. Este paso comprueba el
      // árbol de accesibilidad que un lector consumiría, que es lo automatizable.
      await page.goto(`${BASE}/tienda-demo/carrito`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1000);

      const subtotalRegion = page.locator('[aria-live="polite"]').first();
      const anuncio = await subtotalRegion
        .locator(".sr-only")
        .first()
        .textContent()
        .catch(() => null);
      check(
        "el subtotal tiene una región aria-live con el anuncio para lector de pantalla",
        true,
        Boolean(anuncio && /Subtotal actualizado/.test(anuncio)),
      );

      // Error de teléfono: aria-describedby apunta al id real del mensaje.
      await page.goto(`${BASE}/tienda-demo/checkout`, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      await page.locator('button:has-text("Confirmar")').first().click();
      await page.waitForTimeout(300);
      const describedBy = await page.locator("#field-phone").getAttribute("aria-describedby");
      const idEsperado = "field-phone-error";
      check(
        "el campo de teléfono con error apunta su aria-describedby al mensaje",
        true,
        Boolean(describedBy && describedBy.includes(idEsperado)),
      );
      const mensajeExiste = (await page.locator(`#${idEsperado}`).count()) > 0;
      check("el nodo del mensaje de error del teléfono existe", true, mensajeExiste);

      // El código de pedido se anuncia deletreado (aria-label con espacios).
      if (ordenCodigo) {
        await page.goto(`${BASE}/tienda-demo/pedido/${ordenCodigo}`, { waitUntil: "networkidle" });
        const ariaLabel = await page
          .locator("p[aria-label^='Código del pedido']")
          .getAttribute("aria-label");
        const deletreado = ariaLabel ? ariaLabel.replace("Código del pedido: ", "") : "";
        // formatOrderCode inserta un guion en medio ("ABCDE-FGHIJ") antes de
        // deletrear letra por letra — hay que quitar también ese guion, no
        // solo los espacios, para comparar contra el código crudo de la URL.
        check(
          "el código del pedido se anuncia con espacios entre caracteres (deletreado)",
          true,
          deletreado.includes(" ") && deletreado.replace(/[\s-]/g, "") === ordenCodigo,
        );
      } else {
        fail(
          "no hay ordenCodigo disponible todavía para comprobar el deletreo (revisa el paso que crea el pedido)",
        );
      }
    },
  );

  // ---------------------------------------------------------------- V20 ----
  await paso(
    "V20 — localStorage bloqueado: agregar, aviso, llegar a confirmar sin errores",
    async () => {
      const ctxPrivado = await browser.newContext({ viewport: MOVIL });
      await ctxPrivado.tracing.start({ screenshots: true, snapshots: true, sources: true });
      const paginaPrivada = await ctxPrivado.newPage();
      vigilarConsola(paginaPrivada, "localStorage bloqueado");

      // Simula el modo privado: cualquier escritura lanza, igual que hace un
      // navegador con el storage bloqueado (cartStorage.ts ya cae a un Map en
      // memoria en ese caso).
      await ctxPrivado.addInitScript(() => {
        const throwBlocked = () => {
          throw new DOMException("blocked", "SecurityError");
        };
        Object.defineProperty(window, "localStorage", {
          get() {
            return {
              getItem: throwBlocked,
              setItem: throwBlocked,
              removeItem: throwBlocked,
              clear: throwBlocked,
            };
          },
        });
      });

      await paginaPrivada.goto(`${BASE}/tienda-demo/p/${PRODUCTOS_EN_STOCK[0]}`, {
        waitUntil: "networkidle",
      });
      await paginaPrivada.getByRole("button", { name: /^Agregar al carrito$/ }).click();
      await paginaPrivada.waitForTimeout(500);
      await shot(paginaPrivada, "V20-aviso-localStorage-bloqueado");

      const aviso = await paginaPrivada.getByText(/no está guardando el carrito/).isVisible();
      check("aparece el aviso de que el navegador no guarda el carrito", true, aviso);

      // Sin localStorage el carrito vive en un Map en memoria (cartStorage.ts)
      // que no sobrevive a una navegación de documento completo — hay que
      // llegar al checkout con un Link (SPA), como haría de verdad alguien en
      // modo privado, no con `page.goto`, que recarga y lo pierde.
      await paginaPrivada.getByRole("link", { name: /Ver carrito/ }).click();
      await paginaPrivada.waitForTimeout(500);
      await paginaPrivada.getByRole("link", { name: "Continuar" }).click();
      await paginaPrivada.waitForTimeout(500);
      await paginaPrivada.locator("#field-name").fill("Ana Pérez");
      await paginaPrivada.locator("#field-phone").fill("+53 5555 5555");
      await paginaPrivada.waitForTimeout(1500); // deja llegar la cotización

      const confirmarHabilitado = await paginaPrivada
        .getByRole("button", { name: /Confirmar/ })
        .isEnabled()
        .catch(() => false);
      check("se puede llegar a Confirmar habilitado sin localStorage", true, confirmarHabilitado);

      await ctxPrivado.tracing.stop({ path: `${TRACES}/V20-localStorage-bloqueado.zip` });
      await ctxPrivado.close();
    },
  );

  // ---------------------------------------------------------------- V21 ----
  await paso("V21 — sin JavaScript: catálogo, ficha, carrito y pedido legibles", async () => {
    const ctxSinJs = await browser.newContext({ viewport: MOVIL, javaScriptEnabled: false });
    await ctxSinJs.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const paginaSinJs = await ctxSinJs.newPage();

    await paginaSinJs.goto(`${BASE}/tienda-demo`);
    const catalogoTexto = await paginaSinJs.locator("body").innerText();
    check("el catálogo se lee entero sin JavaScript", true, catalogoTexto.includes("Carrito"));
    await shot(paginaSinJs, "V21-catalogo-sin-js");

    await paginaSinJs.goto(`${BASE}/tienda-demo/p/${PRODUCTOS_EN_STOCK[0]}`);
    const fichaTexto = await paginaSinJs.locator("body").innerText();
    check(
      "la ficha de producto se lee entera sin JavaScript",
      true,
      /Agregar al carrito/.test(fichaTexto),
    );

    await paginaSinJs.goto(`${BASE}/tienda-demo/carrito`);
    const carritoTexto = await paginaSinJs.locator("body").innerText();
    check(
      "el carrito muestra el mensaje de noscript, no un «Cargando…» sin salida",
      true,
      /activar JavaScript/.test(carritoTexto),
    );
    await shot(paginaSinJs, "V21-carrito-sin-js");

    if (ordenCodigo) {
      await paginaSinJs.goto(`${BASE}/tienda-demo/pedido/${ordenCodigo}`);
      const pedidoTexto = await paginaSinJs.locator("body").innerText();
      check(
        "la página de pedido se ve completa sin JavaScript (no tiene JS propio)",
        true,
        pedidoTexto.includes("Pedido recibido") && pedidoTexto.includes(ordenCodigo.slice(0, 3)),
      );
      await shot(paginaSinJs, "V21-pedido-sin-js");
    } else {
      fail("no hay ordenCodigo disponible todavía para comprobar /pedido sin JS");
    }

    await ctxSinJs.tracing.stop({ path: `${TRACES}/V21-sin-js.zip` });
    await ctxSinJs.close();
  });

  // ---------------------------------------------------------------- V22 ----
  await paso("V22 — conexión lenta en la ficha: precio y botón antes del JS", async () => {
    // Lo que hace "Slow 4G" observable es que el usuario ve el HTML mucho
    // antes de que el JS termine de llegar y ejecutarse — eso es cierto a
    // CUALQUIER velocidad de red, porque los scripts de Next son async: no
    // hace falta estrangular la conexión para probarlo (y estrangular todo
    // el documento en `next dev` resultó no ser fiable — ver el comentario
    // de `demorarCotizacion`). `domcontentloaded` marca justo ese instante:
    // el HTML ya está parseado, la hidratación todavía no corrió.
    await page.goto(`${BASE}/tienda-demo/p/${PRODUCTOS_EN_STOCK[0]}`, {
      waitUntil: "domcontentloaded",
    });
    const textoInicial = await page.locator("body").innerText();
    check(
      "el precio y el botón están en el HTML antes de que llegue el JS",
      true,
      /Agregar al carrito/.test(textoInicial),
    );

    // Cuando por fin hidrata, el botón responde.
    await page.waitForSelector("button:has-text('Agregar al carrito'):not([disabled])", {
      timeout: 20000,
    });
    await page.getByRole("button", { name: /^Agregar al carrito$/ }).click();
    await page.waitForTimeout(300);
    // .first(): tras un segundo "Agregar" ya en el carrito, coinciden el
    // botón "✓ Agregado" Y el párrafo "En tu carrito: N" — dos nodos, y el
    // modo estricto de Playwright rechaza un locator ambiguo en vez de
    // resolverlo, lo que sin .first() se leía como "no respondió".
    const respondio = await page
      .getByText(/Agregado|En tu carrito/)
      .first()
      .isVisible()
      .catch(() => false);
    check("el botón responde en cuanto hidrata", true, respondio);
  });

  // -------------------------------------------------------------------------
} catch (e) {
  fail(`el guion visual se rompió: ${e.message}`);
} finally {
  await context.tracing.stop({ path: `${TRACES}/V07-V19-V22-sesion-principal.zip` });
  await browser.close();
}

console.log(`\n${fails} aserciones fallidas`);
process.exit(fails === 0 ? 0 : 1);
