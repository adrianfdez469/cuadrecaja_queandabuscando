// Verificación visual de F-012 (cuenta opcional del cliente final). La
// ejecuta `bash .agent/verify.sh F-012 --visual` con la app ya levantada;
// $VISUAL_BASE_URL apunta a ella, $VISUAL_SHOTS es la carpeta de capturas y
// $VISUAL_TRACES la carpeta de traces de Playwright (uno por contexto).
//
// Traduce V1–V21 de design.md § Verificación visual — los pasos que
// necesitan navegador porque `curl` no puede verlos: el icono de la cabecera
// en sus tres estados sin saltar de layout, el foco al cambiar de paso en
// `/cuenta/entrar`, el teclado numérico y el pegado del código, el
// autocompletado del checkout sin pisar lo tecleado, y el ida-y-vuelta
// completo de D4 con el carrito intacto.
//
// V6 y V15 NO están aquí — están excluidos con su motivo, no fingidos:
// ambos necesitan `NEXT_PUBLIC_SUPABASE_URL=""`, una variable NEXT_PUBLIC_*
// que Next fija por proceso (dev o build), no por request. El único server
// que este guion recibe ya está arriba con el `.env` normal (Auth
// configurado) — apagarla exigiría un `next build`+`next start` APARTE,
// dentro de este mismo guion, con una .next distinta a la que usa el
// servidor compartido. Eso ya se hizo, real, con curl + build (no con
// Playwright: no hay nada que un navegador vea aquí que el HTML no diga
// ya) y quedó en tests.md § Criterio 6 / smoke.sh — repetirlo con un
// segundo Chromium no añade nada, solo minutos.
//
// Cada paso Vn corre en su propio `paso()` (try/catch): que uno se rompa no
// impide que los demás se ejecuten y reporten lo suyo. Regla: cada aserción
// que no se cumpla imprime `VISUAL FAIL <qué>` — lo que el sensor busca para
// ponerle firma al error.

import { chromium } from "playwright";

const BASE = process.env.VISUAL_BASE_URL ?? "http://localhost:3101";
const SHOTS = process.env.VISUAL_SHOTS ?? ".agent/runs/_libre/shots";
const TRACES = process.env.VISUAL_TRACES ?? ".agent/runs/_libre/traces";
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:54324";

const MOVIL = { width: 360, height: 740 };
const TABLET = { width: 768, height: 1024 };
// No hace falta un viewport de 1280 aparte: design.md § Estructura por
// breakpoint dice, para cada zona nueva de este feature, "igual que 768" —
// nada cambia entre 768 y 1280, así que no hay un V-paso propio que probar
// ahí (a diferencia de F-010, que sí reorganiza a dos columnas).

// Productos en existencia en tienda-demo, los mismos tres que ya usa
// F-010/visual.mjs (evita jugo-de-mango-1-l, el fixture AGOTADO a propósito).
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
  await page.screenshot({ path: `${SHOTS}/${nombre}.png`, fullPage: true }).catch(() => {});
}

function vigilarConsola(page, donde) {
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // Chrome registra AUTOMÁTICAMENTE cualquier respuesta no-2xx de un
    // `fetch` como "error" de consola, aunque la app la maneje perfecto —
    // y buena parte de este guion ejercita a propósito caminos de error
    // (código incorrecto → 401, teléfono inválido → 400, RATE_LIMITED →
    // 429). Esa cadena concreta de Chrome nunca es un error de JS: es el
    // eco del propio `fetch` que la app ya está leyendo. Lo que sigue
    // contando como fallo real es cualquier OTRA cosa en consola y
    // cualquier excepción no atrapada (`pageerror`).
    if (/^Failed to load resource: the server responded with a status of/.test(m.text())) return;
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

// ---------------------------------------------------------------------------
// Sesiones reales. Mismo patrón que scripts/auth-otp.mjs --mode app, pero
// devolviendo cookies listas para `context.addCookies` (no un `Cookie:`
// crudo) — así el navegador las manda solo en las peticiones que le
// corresponden, como haría con cualquier sesión real.
// ---------------------------------------------------------------------------

async function leerCodigoDeCorreo(email, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  const query = encodeURIComponent(`to:${email}`);
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${query}`).catch(() => null);
    if (res?.ok) {
      const body = await res.json();
      if (body.messages?.length > 0) {
        const detail = await fetch(`${MAILPIT}/api/v1/message/${body.messages[0].ID}`).then((r) =>
          r.json(),
        );
        const code = /\b(\d{6})\b/.exec(detail.Text ?? detail.HTML ?? "")?.[1];
        if (code) return code;
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no llegó ningún correo con código a ${email} en ${timeoutMs}ms`);
}

/** Bandeja vacía para ESTE destinatario antes de pedir nada (R10, como auth-otp.mjs). */
async function vaciarBandeja(email) {
  await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`, {
    method: "DELETE",
  }).catch(() => {});
}

/**
 * Crea una sesión real por las rutas PROPIAS de F-012 (POST /api/account/otp,
 * POST /api/account/otp/verify) sin pasar por el navegador — para el
 * bootstrap de escenarios que no son, ellos mismos, el paso V bajo prueba
 * (V16-V18, V20, y el perfil previo de V21). El flujo de "entrar" en sí
 * (V8-V14, la primera mitad de V21) sí se conduce por la UI real más abajo.
 */
async function crearSesionReal(email) {
  await vaciarBandeja(email);
  const send = await fetch(`${BASE}/api/account/otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!send.ok) throw new Error(`POST /api/account/otp falló: ${send.status}`);
  const code = await leerCodigoDeCorreo(email);
  const verify = await fetch(`${BASE}/api/account/otp/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, token: code }),
  });
  if (verify.status !== 200)
    throw new Error(`POST /api/account/otp/verify falló: ${verify.status}`);
  // `getSetCookie()` da la cabecera ENTERA por cookie ("nombre=valor;
  // Path=/; Expires=…; Max-Age=…; SameSite=lax") — quedarse solo con el
  // primer par es lo mismo que hacen scripts/auth-otp.mjs y smoke.sh.
  const rawCookies = verify.headers.getSetCookie();
  return rawCookies.map((c) => {
    const par = c.split(";")[0];
    const eq = par.indexOf("=");
    return { name: par.slice(0, eq), value: par.slice(eq + 1), url: BASE };
  });
}

async function guardarPerfil(cookies, perfil) {
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const res = await fetch(`${BASE}/api/account/profile`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: cookieHeader },
    body: JSON.stringify(perfil),
  });
  if (res.status !== 200) throw new Error(`PUT /api/account/profile falló: ${res.status}`);
}

/** Agrega productos al carrito de tienda-demo pasando por la UI real (F-010). */
async function agregarAlCarrito(page, slugs, tienda = "tienda-demo") {
  for (const slug of slugs) {
    await page.goto(`${BASE}/${tienda}/p/${slug}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Agregar al carrito$/ }).click();
    await page.waitForTimeout(200);
  }
}

/** El truco de canvas de F-010/visual.mjs: normaliza cualquier color CSS
 * (oklch/color-mix incluidos) a RGBA pintando 1x1 px, para medir contraste
 * WCAG sin parsear la sintaxis de color. */
function medirContrasteEnElNavegador({ selectorFg, propiedadFg, selectorBg, propiedadBg }) {
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
  const fgEl = document.querySelector(selectorFg);
  const bgEl = document.querySelector(selectorBg);
  if (!fgEl || !bgEl) return { encontrado: false };
  let fg = aRGBA(getComputedStyle(fgEl)[propiedadFg]);
  const bg = aRGBA(getComputedStyle(bgEl)[propiedadBg]);
  if (fg.a < 1) fg = componer(fg, bg);
  return { encontrado: true, razon: razon(fg, bg) };
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: MOVIL });
await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
const page = await context.newPage();
prepararPagina(page, "sesión principal");

try {
  // =========================================================================
  // Cabecera — V1-V5 (V6 excluido, ver cabecera del archivo)
  // =========================================================================

  await paso("V1 — 360px: glifo a la derecha de Carrito, cabecera a 68px", async () => {
    await page.goto(`${BASE}/tienda-demo`, { waitUntil: "networkidle" });
    await prepararPagina(page, "/tienda-demo 360");
    await shot(page, "V01-cabecera-360");

    const header = page.locator("header").first();
    const headerBox = await header.boundingBox();
    check("la cabecera mide 68px de alto a 360px", 68, Math.round(headerBox.height));

    const nombreBox = await page
      .locator("header a", { hasText: "La Rampa" })
      .first()
      .boundingBox()
      .catch(async () => await header.locator("a, span").first().boundingBox());
    const cuentaLink = page.locator(
      'header a[aria-label*="cuenta" i], header a[aria-label*="Cuenta" i]',
    );
    const cuentaBox = await cuentaLink.first().boundingBox();
    check("el glifo de cuenta existe a 360px", true, Boolean(cuentaBox));
    if (nombreBox && cuentaBox) {
      check(
        "el glifo de cuenta queda a la derecha del nombre de la tienda",
        true,
        cuentaBox.x > nombreBox.x,
      );
    }

    // El nombre de la tienda no se parte en dos líneas: su alto se queda en
    // una sola línea de text-xl (28px, design.md § 0), no el doble.
    const nombreAlto = await header
      .locator("a.truncate, span.truncate")
      .first()
      .evaluate((el) => el.getBoundingClientRect().height);
    check("el nombre de la tienda no se parte en dos líneas a 360px", true, nombreAlto < 40);
  });

  await paso("V2 — 768px: aparece «Cuenta», la ciudad sigue, nada se solapa", async () => {
    await page.setViewportSize(TABLET);
    await page.waitForTimeout(300);
    await shot(page, "V02-cabecera-768");

    const cuentaTexto = await page
      .locator("header")
      .getByText("Cuenta", { exact: true })
      .isVisible();
    check("la palabra «Cuenta» aparece junto al glifo a 768px", true, cuentaTexto);

    const ciudad = page.locator("header").getByText("La Habana");
    const ciudadVisible = await ciudad.isVisible().catch(() => false);
    check("la ciudad sigue visible a 768px", true, ciudadVisible);

    // Nada se solapa: el link de cuenta y el link de Carrito no se cruzan.
    const carritoBox = await page.locator('header a[aria-label^="Carrito"]').first().boundingBox();
    const cuentaBox = await page.locator('header a[aria-label*="cuenta" i]').first().boundingBox();
    if (carritoBox && cuentaBox) {
      const seSolapan = carritoBox.x + carritoBox.width > cuentaBox.x + 1;
      check("Carrito y el enlace de cuenta no se solapan a 768px", false, seSolapan);
    }

    await page.setViewportSize(MOVIL);
  });

  await paso("V3 — sin JavaScript: el glifo sigue en el HTML y enlaza a /cuenta", async () => {
    const ctxSinJs = await browser.newContext({ viewport: MOVIL, javaScriptEnabled: false });
    const paginaSinJs = await ctxSinJs.newPage();
    await paginaSinJs.goto(`${BASE}/tienda-demo`);
    await shot(paginaSinJs, "V03-cabecera-sin-js");

    const cuentaLink = paginaSinJs.locator('header a[aria-label*="cuenta" i]').first();
    const existe = (await cuentaLink.count()) > 0;
    check("el glifo de cuenta existe en el HTML sin JavaScript", true, existe);
    if (existe) {
      const href = await cuentaLink.getAttribute("href");
      check("su enlace apunta a /cuenta (sin JS)", true, Boolean(href && href.includes("/cuenta")));
    }
    await ctxSinJs.close();
  });

  await paso("V4 — la cabecera no salta al hidratar, con y sin sesión", async () => {
    async function medirCabecera(cookies) {
      const ctx = await browser.newContext({ viewport: MOVIL });
      if (cookies.length > 0) await ctx.addCookies(cookies);
      const p = await ctx.newPage();
      await p.goto(`${BASE}/tienda-demo`, { waitUntil: "domcontentloaded" });
      const antesNombre = await p.locator("header a, header span").first().boundingBox();
      const antesCuenta = await p.locator('header a[aria-label*="cuenta" i]').first().boundingBox();
      await p.waitForTimeout(1200); // deja asentar la hidratación
      const despuesNombre = await p.locator("header a, header span").first().boundingBox();
      const despuesCuenta = await p
        .locator('header a[aria-label*="cuenta" i]')
        .first()
        .boundingBox();
      const puntoVisible = await p
        .locator('header a[aria-label*="cuenta" i] span[class*="rounded-full"]')
        .isVisible()
        .catch(() => false);
      await ctx.close();
      return { antesNombre, antesCuenta, despuesNombre, despuesCuenta, puntoVisible };
    }

    const invitado = await medirCabecera([]);
    check(
      "el nombre de la tienda no se mueve entre el HTML servido y el hidratado (invitado)",
      invitado.antesNombre?.y,
      invitado.despuesNombre?.y,
    );
    check(
      "el glifo de cuenta no se mueve entre el HTML servido y el hidratado (invitado)",
      JSON.stringify({ x: invitado.antesCuenta?.x, y: invitado.antesCuenta?.y }),
      JSON.stringify({ x: invitado.despuesCuenta?.x, y: invitado.despuesCuenta?.y }),
    );
    check("sin sesión, el punto no aparece", false, invitado.puntoVisible);

    const conHint = await medirCabecera([{ name: "qab-shopper-hint", value: "1", url: BASE }]);
    check(
      "el glifo de cuenta ocupa el MISMO sitio con sesión que sin sesión (el punto no desplaza nada)",
      JSON.stringify({ x: invitado.despuesCuenta?.x, y: invitado.despuesCuenta?.y }),
      JSON.stringify({ x: conHint.despuesCuenta?.x, y: conHint.despuesCuenta?.y }),
    );
    check("con la cookie de sesión, el punto aparece tras hidratar", true, conHint.puntoVisible);
  });

  await paso("V5 — el glifo y el punto se leen en dos marcas de color distinto", async () => {
    async function contrasteEnTienda(slug, cookies) {
      const ctx = await browser.newContext({ viewport: MOVIL });
      if (cookies.length > 0) await ctx.addCookies(cookies);
      const p = await ctx.newPage();
      await p.goto(`${BASE}/${slug}`, { waitUntil: "networkidle" });
      await p.waitForTimeout(300);
      const svgContraste = await p.evaluate(medirContrasteEnElNavegador, {
        selectorFg: "header a[aria-label*='cuenta' i] svg",
        propiedadFg: "color",
        selectorBg: "header",
        propiedadBg: "backgroundColor",
      });
      const puntoContraste = await p.evaluate(medirContrasteEnElNavegador, {
        selectorFg: "header a[aria-label*='cuenta' i] span[class*='rounded-full']",
        propiedadFg: "backgroundColor",
        selectorBg: "header",
        propiedadBg: "backgroundColor",
      });
      await ctx.close();
      return { svgContraste, puntoContraste };
    }

    const hint = [{ name: "qab-shopper-hint", value: "1", url: BASE }];
    const demo = await contrasteEnTienda("tienda-demo", hint);
    const dos = await contrasteEnTienda("tienda-dos", hint);

    for (const [nombre, resultado] of [
      ["tienda-demo", demo],
      ["tienda-dos", dos],
    ]) {
      if (resultado.svgContraste.encontrado) {
        check(
          `el glifo de cuenta tiene contraste ≥ 3:1 (icono, WCAG) en ${nombre}`,
          true,
          resultado.svgContraste.razon >= 3,
        );
      } else {
        fail(`${nombre}: no se pudo medir el contraste del glifo`);
      }
      if (resultado.puntoContraste.encontrado) {
        check(
          `el punto de «con sesión» tiene contraste ≥ 3:1 en ${nombre}`,
          true,
          resultado.puntoContraste.razon >= 3,
        );
      } else {
        fail(`${nombre}: no se pudo medir el contraste del punto (¿la cookie de hint no llegó?)`);
      }
    }
  });

  // =========================================================================
  // /cuenta/entrar — V7-V14 (V15 excluido, ver cabecera del archivo)
  // =========================================================================

  await paso(
    "V7 — 360px: la tarjeta cabe sin scroll horizontal, los 4 métodos visibles",
    async () => {
      await page.goto(`${BASE}/cuenta/entrar`, { waitUntil: "networkidle" });
      await prepararPagina(page, "/cuenta/entrar 360");
      await shot(page, "V07-entrar-360");

      const desborde = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      check("no hay scroll horizontal a 360px", false, desborde);

      for (const label of ["Google", "Facebook", "Apple"]) {
        const visible = await page
          .getByRole("button", { name: new RegExp(`Continuar con ${label}`) })
          .isVisible();
        check(`el botón de ${label} está visible a 360px`, true, visible);
      }
      const correoVisible = await page.getByLabel("Correo").isVisible();
      check("el campo Correo está visible a 360px", true, correoVisible);

      const alturaTotal = await page.locator("body").evaluate((el) => el.scrollHeight);
      check(
        "la tarjeta cabe en un desplazamiento corto (< 1300px de alto)",
        true,
        alturaTotal < 1300,
      );
    },
  );

  await paso(
    "V8 — pedir un código: cambia el paso sin navegar, foco al campo, teclado numérico",
    async () => {
      await page.goto(`${BASE}/cuenta/entrar`, { waitUntil: "networkidle" });
      const urlAntes = page.url();
      const email = `visual-v8+${Date.now()}@local.test`;
      await page.getByLabel("Correo").fill(email);
      await page.getByRole("button", { name: "Enviarme un código" }).click();
      await page.waitForSelector("#signin-code", { timeout: 5000 });
      await shot(page, "V08-entrar-paso-codigo");

      check("la URL no cambia al pasar al paso «código» (R3)", urlAntes, page.url());

      const activo = await page.evaluate(() => document.activeElement?.id);
      check("el foco cae en el campo del código al llegar al paso 2", "signin-code", activo);

      const inputMode = await page.locator("#signin-code").getAttribute("inputmode");
      const pattern = await page.locator("#signin-code").getAttribute("pattern");
      check("el campo del código pide teclado numérico (inputMode=numeric)", "numeric", inputMode);
      check("el campo del código restringe el patrón a dígitos", "[0-9]*", pattern);
    },
  );

  await paso(
    "V9 [fallo real] — pegar deja los 6 dígitos completos; teclear no comprueba solo",
    async () => {
      await page.goto(`${BASE}/cuenta/entrar`, { waitUntil: "networkidle" });
      const email = `visual-v9+${Date.now()}@local.test`;
      await page.getByLabel("Correo").fill(email);
      await page.getByRole("button", { name: "Enviarme un código" }).click();
      await page.waitForSelector("#signin-code", { timeout: 5000 });

      // Teclear uno a uno NO comprueba solo: solo habilita el botón.
      let peticionesVerify = 0;
      const contador = (req) => {
        if (req.url().includes("/api/account/otp/verify")) peticionesVerify++;
      };
      page.on("request", contador);
      await page.locator("#signin-code").pressSequentially("111111", { delay: 15 });
      await page.waitForTimeout(400);
      check("teclear 6 dígitos uno a uno NO dispara la comprobación", 0, peticionesVerify);
      const entrarHabilitado = await page.getByRole("button", { name: "Entrar" }).isEnabled();
      check("teclear 6 dígitos uno a uno SÍ habilita «Entrar»", true, entrarHabilitado);
      page.off("request", contador);

      // Pegar "123 456" (con espacio) desde el portapapeles REAL — no
      // .fill(), un paste de verdad vía navigator.clipboard + Ctrl/Cmd+V.
      // Un correo NUEVO, no "Cambiar el correo" + reenviar al mismo: el
      // propio Auth (no F-012, R5) rechaza un segundo /otp inmediato para
      // el MISMO correo con 429 RATE_LIMITED — confirmado pidiendo dos
      // códigos seguidos para una dirección igual, sin esperar.
      const email2 = `visual-v9b+${Date.now()}@local.test`;
      await page.goto(`${BASE}/cuenta/entrar`, { waitUntil: "networkidle" });
      await page.getByLabel("Correo").fill(email2);
      await page.getByRole("button", { name: "Enviarme un código" }).click();
      await page.waitForSelector("#signin-code", { timeout: 5000 });
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.evaluate(async () => {
        await navigator.clipboard.writeText("123 456");
      });
      await page.locator("#signin-code").focus();
      await page.keyboard.press("ControlOrMeta+v");
      await page.waitForTimeout(500);
      const valorPegado = await page.locator("#signin-code").inputValue();
      check(
        'pegar "123 456" desde el portapapeles deja "123456" (design.md § 2)',
        "123456",
        valorPegado,
      );
    },
  );

  await paso("V10 — autocompletado del sistema (one-time-code)", async () => {
    // No hay forma headless de accionar el autorrelleno NATIVO de iOS/Android
    // sobre el teclado — ni Playwright ni Chromium lo exponen (ficha del
    // mismo tipo que la de VoiceOver en F-010/visual.mjs). Lo automatizable
    // sin fingir nada es la señal que ese autorrelleno consume: el atributo.
    const autocomplete = await page.locator("#signin-code").getAttribute("autocomplete");
    check(
      'el campo del código anuncia autoComplete="one-time-code" (lo que activa el autorrelleno nativo)',
      "one-time-code",
      autocomplete,
    );
  });

  await paso(
    "V11 — tres códigos incorrectos: 2→1→agotado, el campo desaparece, foco al aviso",
    async () => {
      await page.goto(`${BASE}/cuenta/entrar`, { waitUntil: "networkidle" });
      const email = `visual-v11+${Date.now()}@local.test`;
      await page.getByLabel("Correo").fill(email);
      await page.getByRole("button", { name: "Enviarme un código" }).click();
      await page.waitForSelector("#signin-code", { timeout: 5000 });

      // Un intento fallido NO vacía el campo (design.md § 2: "el foco vuelve
      // al campo CON EL TEXTO SELECCIONADO, para que teclear reemplace sin
      // borrar"): rellenar con el MISMO valor otra vez no dispara un nuevo
      // "arrived all at once" (el delta de longitud es 0). Vaciar antes de
      // cada intento es lo que de verdad simula "escribir encima de lo
      // seleccionado" con un valor nuevo cada vez.
      await page.locator("#signin-code").fill("000000");
      await page.waitForTimeout(500);
      const msg1 = await page.locator("#signin-code-error").textContent();
      check(
        "primer código incorrecto: «Te quedan 2 intentos»",
        true,
        /2 intentos/.test(msg1 ?? ""),
      );

      await page.locator("#signin-code").fill("");
      await page.locator("#signin-code").fill("111111");
      await page.waitForTimeout(500);
      const msg2 = await page.locator("#signin-code-error").textContent();
      check(
        "segundo código incorrecto: «Te queda 1 intento»",
        true,
        /1 intento\b/.test(msg2 ?? ""),
      );

      await page.locator("#signin-code").fill("");
      await page.locator("#signin-code").fill("222222");
      await page.waitForTimeout(500);
      await shot(page, "V11-codigo-agotado");

      const campoExiste = (await page.locator("#signin-code").count()) > 0;
      check("al tercer fallo, el campo del código desaparece", false, campoExiste);

      const alertaAgotado = page.getByRole("alert").filter({ hasText: "ya no sirve" });
      const alertaVisible = await alertaAgotado.isVisible().catch(() => false);
      check("aparece el aviso «Ese código ya no sirve. Pide uno nuevo.»", true, alertaVisible);

      const foco = await page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        contieneAlerta: Boolean(document.activeElement?.querySelector('[role="alert"]')),
      }));
      check(
        "el foco cae en el contenedor del aviso agotado (no en <body>)",
        true,
        foco.tag !== "BODY" && foco.contieneAlerta,
      );

      const pedirNuevo = await page
        .getByRole("button", { name: "Pedir un código nuevo" })
        .isVisible();
      check("aparece «Pedir un código nuevo»", true, pedirNuevo);
    },
  );

  await paso(
    "V12 — cuenta atrás de 30s del reenvío, y el reenvío limpia campo+foco+intentos",
    async () => {
      await page.goto(`${BASE}/cuenta/entrar`, { waitUntil: "networkidle" });
      const email = `visual-v12+${Date.now()}@local.test`;
      await page.getByLabel("Correo").fill(email);
      await page.getByRole("button", { name: "Enviarme un código" }).click();
      await page.waitForSelector("#signin-code", { timeout: 5000 });

      const botonReenviar = page.getByRole("button", { name: /Reenviar el código/ });
      const textoInicial = await botonReenviar.textContent();
      check(
        "el reenvío arranca deshabilitado con cuenta atrás (~30 s)",
        true,
        /\(3?0 s\)|\(29 s\)/.test(textoInicial ?? ""),
      );
      const deshabilitadoInicial = await botonReenviar.isDisabled();
      check(
        "«Reenviar el código» está deshabilitado durante la cuenta atrás",
        true,
        deshabilitadoInicial,
      );

      // design.md pide `aria-live="off"` en el número del contador, para que
      // el segundero no se anuncie solo. No está en el código (SignInCard.tsx
      // no pone aria-live en este botón) — severidad baja: un <button> sin
      // aria-live tampoco es una región activa por defecto, así que el efecto
      // observable (nadie oye el segundero) coincide, pero el atributo
      // explícito que pide el diseño no está.
      const ariaLive = await botonReenviar.getAttribute("aria-live");
      check(
        'el botón de reenvío tiene aria-live="off" en el número (design.md § 2)',
        "off",
        ariaLive,
      );

      await page.waitForTimeout(31000);
      await botonReenviar.waitFor({ state: "visible" });
      const habilitadoTrasEspera = await botonReenviar.isEnabled();
      check("«Reenviar el código» se habilita a los 30 s", true, habilitadoTrasEspera);

      // Deja algo escrito antes de reenviar, para comprobar que se vacía.
      await page.locator("#signin-code").fill("12");
      await botonReenviar.click();
      await page.waitForTimeout(400);
      const valorTrasReenvio = await page.locator("#signin-code").inputValue();
      check("al reenviar, el campo se vacía", "", valorTrasReenvio);
      const focoTrasReenvio = await page.evaluate(() => document.activeElement?.id);
      check("al reenviar, el foco vuelve al campo del código", "signin-code", focoTrasReenvio);

      // Un fallo tras el reenvío debe decir «2 intentos», no arrastrar los
      // que ya se habían gastado antes.
      await page.locator("#signin-code").fill("000000");
      await page.waitForTimeout(500);
      const msg = await page.locator("#signin-code-error").textContent();
      check(
        "tras reenviar, el contador de intentos vuelve a 3 (el fallo dice «2 intentos»)",
        true,
        /2 intentos/.test(msg ?? ""),
      );
    },
  );

  await paso(
    "V13 [fallo real] — el campo del código es anunciable con una descripción única",
    async () => {
      await page.goto(`${BASE}/cuenta/entrar`, { waitUntil: "networkidle" });
      const email = `visual-v13@local.test`;
      await page.getByLabel("Correo").fill(email);
      await page.getByRole("button", { name: "Enviarme un código" }).click();
      await page.waitForSelector("#signin-code", { timeout: 5000 });

      const describedBy = await page.locator("#signin-code").getAttribute("aria-describedby");
      check("el campo del código declara aria-describedby", true, Boolean(describedBy));

      // El id al que apunta tiene que ser ÚNICO en el documento — si hay dos
      // elementos con el mismo id, la referencia es ambigua y lo que un
      // lector de pantalla compone como "descripción" deja de ser fiable
      // (depende de qué nodo devuelva primero el user agent, no de qué diga
      // el marcado).
      const idsReferenciados = (describedBy ?? "").split(/\s+/).filter(Boolean);
      for (const id of idsReferenciados) {
        const cuantos = await page.locator(`[id="${id}"]`).count();
        check(
          `el id "${id}" referenciado por aria-describedby es único en el documento`,
          1,
          cuantos,
        );
      }

      // Lo que design.md pide en concreto: que la descripción efectiva
      // mencione el correo al que se mandó el código.
      const textoDescripcion = await page.evaluate((ids) => {
        return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
      }, idsReferenciados);
      check(
        "la descripción del campo menciona el correo al que se mandó el código",
        true,
        textoDescripcion.includes(email),
      );
    },
  );

  await paso(
    "V14 — /cuenta/entrar?aviso=* pinta sus tres banners, con el JS bloqueado",
    async () => {
      const ctxSinJs = await browser.newContext({ viewport: MOVIL, javaScriptEnabled: false });
      const paginaSinJs = await ctxSinJs.newPage();

      const casos = [
        ["caducado", "El acceso caducó. Vuelve a intentarlo."],
        ["cancelado", "No se completó el acceso."],
        ["sesion", "Tu sesión se cerró. Vuelve a entrar."],
      ];
      for (const [aviso, texto] of casos) {
        await paginaSinJs.goto(`${BASE}/cuenta/entrar?aviso=${aviso}`);
        const cuerpo = await paginaSinJs.locator("body").innerText();
        check(`?aviso=${aviso} pinta "${texto}" sin JavaScript`, true, cuerpo.includes(texto));
      }
      await shot(paginaSinJs, "V14-aviso-caducado-sin-js");
      await ctxSinJs.close();
    },
  );

  // =========================================================================
  // /cuenta — V16-V18
  // =========================================================================

  await paso("V16 — con sesión y perfil: los 3 campos llegan rellenos en el HTML", async () => {
    const email = `visual-v16+${Date.now()}@local.test`;
    const cookies = await crearSesionReal(email);
    await guardarPerfil(cookies, { name: "Visual Dieciséis", phone: "+5355516161", email });

    const ctxSinJs = await browser.newContext({ viewport: MOVIL, javaScriptEnabled: false });
    await ctxSinJs.addCookies(cookies);
    const paginaSinJs = await ctxSinJs.newPage();
    await paginaSinJs.goto(`${BASE}/cuenta`);
    await shot(paginaSinJs, "V16-cuenta-rellena-sin-js");

    const nombre = await paginaSinJs.locator("#profile-name").inputValue();
    const telefono = await paginaSinJs.locator("#profile-phone").inputValue();
    const correo = await paginaSinJs.locator("#profile-email").inputValue();
    check("el nombre llega relleno en el HTML (sin JS)", "Visual Dieciséis", nombre);
    check("el teléfono llega relleno en el HTML (sin JS)", "+5355516161", telefono);
    check("el correo llega relleno en el HTML (sin JS)", email, correo);
    await ctxSinJs.close();

    // «Guardar cambios» deshabilitado hasta que algo cambie — esto sí
    // necesita JS (es estado de cliente), contexto aparte con la misma
    // sesión.
    const ctx = await browser.newContext({ viewport: MOVIL });
    await ctx.addCookies(cookies);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/cuenta`, { waitUntil: "networkidle" });
    const deshabilitadoAlLlegar = await p
      .getByRole("button", { name: "Guardar cambios" })
      .isDisabled();
    check(
      "«Guardar cambios» está deshabilitado al llegar (nada cambió)",
      true,
      deshabilitadoAlLlegar,
    );
    await p.locator("#profile-name").fill("Visual Dieciséis Editado");
    const habilitadoTrasCambiar = await p
      .getByRole("button", { name: "Guardar cambios" })
      .isEnabled();
    check("«Guardar cambios» se habilita en cuanto algo cambia", true, habilitadoTrasCambiar);
    await ctx.close();
  });

  await paso(
    "V17 [fallo real] — teléfono de 3 dígitos: no guarda, foco al resumen, lo demás queda",
    async () => {
      const email = `visual-v17+${Date.now()}@local.test`;
      const cookies = await crearSesionReal(email);
      const ctx = await browser.newContext({ viewport: MOVIL });
      await ctx.addCookies(cookies);
      const p = await ctx.newPage();
      await p.goto(`${BASE}/cuenta`, { waitUntil: "networkidle" });

      await p.locator("#profile-name").fill("Visual Diecisiete");
      await p.locator("#profile-phone").fill("123");
      await p.getByRole("button", { name: "Guardar cambios" }).click();
      await p.waitForTimeout(700);
      await shot(p, "V17-cuenta-invalido");

      const resumen = p.getByRole("alert").filter({ hasText: "Revisa" });
      const resumenVisible = await resumen.isVisible().catch(() => false);
      check("aparece el resumen «Revisa … antes de guardar»", true, resumenVisible);

      const foco = await p.evaluate(() => ({
        tag: document.activeElement?.tagName,
        contieneAlerta: Boolean(document.activeElement?.querySelector('[role="alert"]')),
        esAlerta: document.activeElement?.getAttribute("role") === "alert",
      }));
      check(
        "el foco salta al resumen de errores tras el envío inválido (design.md V17)",
        true,
        foco.tag !== "BODY" && (foco.contieneAlerta || foco.esAlerta),
      );

      const nombreSigueAhi = await p.locator("#profile-name").inputValue();
      check(
        "lo tecleado en el nombre sigue ahí tras el error",
        "Visual Diecisiete",
        nombreSigueAhi,
      );

      // Y de verdad no se guardó nada: releyendo /cuenta con JS bloqueado, el
      // nombre del servidor sigue siendo el de antes (vacío en este caso).
      const ctxSinJs = await browser.newContext({ viewport: MOVIL, javaScriptEnabled: false });
      await ctxSinJs.addCookies(cookies);
      const p2 = await ctxSinJs.newPage();
      await p2.goto(`${BASE}/cuenta`);
      const nombreEnServidor = await p2.locator("#profile-name").inputValue();
      check("el envío inválido no guardó nada en el servidor", "", nombreEnServidor);
      await ctxSinJs.close();
      await ctx.close();
    },
  );

  await paso(
    "V18 — cerrar sesión con el carrito lleno: llega a /, el carrito sigue completo",
    async () => {
      const email = `visual-v18+${Date.now()}@local.test`;
      const cookies = await crearSesionReal(email);
      const ctx = await browser.newContext({ viewport: MOVIL });
      await ctx.addCookies(cookies);
      const p = await ctx.newPage();

      await agregarAlCarrito(p, PRODUCTOS_EN_STOCK);
      await p.goto(`${BASE}/tienda-demo/carrito`, { waitUntil: "networkidle" });
      const lineasAntes = await p.locator("ul > li").count();
      check(
        "el carrito tiene líneas antes de cerrar sesión",
        true,
        lineasAntes === PRODUCTOS_EN_STOCK.length,
      );

      await p.goto(`${BASE}/cuenta`, { waitUntil: "networkidle" });
      await p.getByRole("button", { name: "Cerrar sesión" }).click();
      await p.waitForURL(`${BASE}/`, { timeout: 10000 });
      check("cerrar sesión navega a /", `${BASE}/`, p.url());

      await p.goto(`${BASE}/tienda-demo/carrito`, { waitUntil: "networkidle" });
      await shot(p, "V18-carrito-tras-logout");
      const lineasDespues = await p.locator("ul > li").count();
      check("el carrito sigue completo tras cerrar sesión", lineasAntes, lineasDespues);
      await ctx.close();
    },
  );

  // =========================================================================
  // Checkout — V19-V21
  // =========================================================================

  await paso("V19 — sin sesión: 3 campos vacíos, sin errores, nada deshabilitado", async () => {
    const ctx = await browser.newContext({ viewport: MOVIL });
    const p = await ctx.newPage();
    await agregarAlCarrito(p, [PRODUCTOS_EN_STOCK[0]]);
    await p.goto(`${BASE}/tienda-demo/checkout`, { waitUntil: "networkidle" });
    await p.waitForTimeout(1000);
    await shot(p, "V19-checkout-invitado");

    check("nombre vacío sin sesión", "", await p.locator("#field-name").inputValue());
    check("teléfono vacío sin sesión", "", await p.locator("#field-phone").inputValue());
    check("correo vacío sin sesión", "", await p.locator("#field-email").inputValue());

    // Next deja siempre un `#__next-route-announcer__` con role="alert"
    // vacío (para SPA nav) — no es un error de la app, así que se excluye
    // exigiendo texto real.
    const hayError = await p
      .locator('[role="alert"]')
      .filter({ hasText: /\S/ })
      .first()
      .isVisible()
      .catch(() => false);
    check("no hay ningún error visible al llegar sin sesión", false, hayError);

    const nombreDeshabilitado = await p.locator("#field-name").isDisabled();
    check("el campo de nombre no está deshabilitado sin sesión", false, nombreDeshabilitado);

    const lineaEstado = await p
      .getByText(/La tienda te va a contactar por aquí/)
      .first()
      .textContent();
    check(
      "la línea de estado invita a entrar (variante inicial)",
      true,
      /Si ya tienes cuenta/.test(lineaEstado ?? ""),
    );

    // El pedido de invitado llega hasta el comprobante (design.md V19).
    const telefono = `+53${Date.now().toString().slice(-9)}`;
    await p.locator("#field-name").fill("Visual Diecinueve");
    await p.locator("#field-phone").fill(telefono);
    await p.waitForTimeout(1000);
    const confirmar = p.getByRole("button", { name: /^Confirmar pedido$/ });
    await confirmar.waitFor({ state: "visible" });
    await confirmar.click();
    await p.waitForURL(/\/pedido\//, { timeout: 15000 });
    check(
      "el pedido de invitado llega al comprobante (/pedido/<code>)",
      true,
      /\/pedido\//.test(p.url()),
    );
    await ctx.close();
  });

  await paso(
    "V20 — con sesión y red lenta: se puede escribir ya, el perfil solo rellena lo vacío",
    async () => {
      const email = `visual-v20+${Date.now()}@local.test`;
      const cookies = await crearSesionReal(email);
      await guardarPerfil(cookies, { name: "Visual Veinte", phone: "+5355520202", email });

      const ctx = await browser.newContext({ viewport: MOVIL });
      await ctx.addCookies(cookies);
      const p = await ctx.newPage();
      await agregarAlCarrito(p, [PRODUCTOS_EN_STOCK[0]]);

      // Simula "Slow 3G" retrasando SOLO la petición que a este paso le
      // importa (/api/account/profile) — mismo motivo que
      // F-010/visual.mjs § demorarCotizacion: estrangular next dev entero no
      // es determinista. 1500ms y NO 3000: `PROFILE_FETCH_TIMEOUT_MS` (el
      // propio `AbortController` de accountStore.ts) corta a los 3000ms en
      // punto — con un retraso igual a ese timeout la petición se ABORTA
      // (net::ERR_ABORTED) antes de que este paso llegue a ver el perfil
      // aplicado, y el paso deja de probar lo que dice probar (E11, no E12).
      await p.route("**/api/account/profile", async (route) => {
        await new Promise((r) => setTimeout(r, 1500));
        await route.continue();
      });

      await p.goto(`${BASE}/tienda-demo/checkout`, { waitUntil: "domcontentloaded" });
      await p.waitForTimeout(200);

      // Escribible desde el primer instante, antes de que el perfil llegue.
      await p.locator("#field-name").fill("Tecleado Antes");
      const nombreTrasEscribir = await p.locator("#field-name").inputValue();
      check(
        "el campo de nombre se puede escribir antes de que llegue el perfil",
        "Tecleado Antes",
        nombreTrasEscribir,
      );

      // El teléfono lo dejamos vacío y con foco puesto (para probar que el
      // cursor no se mueve cuando llegue el perfil).
      await p.locator("#field-phone").focus();
      await p.locator("#field-phone").pressSequentially("+535552", { delay: 10 });
      const seleccionAntes = await p
        .locator("#field-phone")
        .evaluate((el) => ({ start: el.selectionStart, end: el.selectionEnd, value: el.value }));

      const posicionCamposAntes = {
        name: await p.locator("#field-name").boundingBox(),
        phone: await p.locator("#field-phone").boundingBox(),
      };
      const lineaAntes = await p
        .getByText(/contactar por aquí/)
        .first()
        .textContent();

      // Deja llegar el perfil demorado.
      await p.waitForTimeout(2200);
      await p.unroute("**/api/account/profile").catch(() => {});

      const nombreTrasPerfil = await p.locator("#field-name").inputValue();
      check(
        "el nombre YA escrito no se pisa cuando llega el perfil (E13)",
        "Tecleado Antes",
        nombreTrasPerfil,
      );
      const telefonoTrasPerfil = await p.locator("#field-phone").inputValue();
      check(
        "el teléfono enfocado y a medio escribir no se pisa (enfocar ya lo hace «suyo»)",
        seleccionAntes.value,
        telefonoTrasPerfil,
      );
      const seleccionDespues = await p
        .locator("#field-phone")
        .evaluate((el) => ({ start: el.selectionStart, end: el.selectionEnd }));
      check(
        "el cursor del teléfono no se mueve cuando llega el perfil",
        JSON.stringify(seleccionAntes.start),
        JSON.stringify(seleccionDespues.start),
      );

      const posicionCamposDespues = {
        name: await p.locator("#field-name").boundingBox(),
        phone: await p.locator("#field-phone").boundingBox(),
      };
      check(
        "el campo de nombre no cambia de posición cuando llega el perfil",
        posicionCamposAntes.name?.y,
        posicionCamposDespues.name?.y,
      );
      check(
        "el campo de teléfono no cambia de posición cuando llega el perfil",
        posicionCamposAntes.phone?.y,
        posicionCamposDespues.phone?.y,
      );

      const lineaDespues = await p
        .getByText(/Rellenamos tus datos guardados|contactar por aquí/)
        .first()
        .textContent();
      check(
        "la línea de estado cambia de texto cuando llega el perfil (sin campo vacío que rellenar quedó email)",
        true,
        lineaAntes !== lineaDespues || /Rellenamos/.test(lineaDespues ?? ""),
      );
      await shot(p, "V20-checkout-slow3g-perfil");
      await ctx.close();
    },
  );

  await paso(
    "V21 — checkout con carrito lleno: entra → entrar → volver, carrito y campos intactos",
    async () => {
      const email = `visual-v21+${Date.now()}@local.test`;
      // Perfil previo, creado ANTES de este flujo (así el checkout puede
      // rellenarlo al volver) — bootstrap por fetch, no es el paso bajo
      // prueba.
      const cookiesPrevias = await crearSesionReal(email);
      await guardarPerfil(cookiesPrevias, {
        name: "Visual Veintiuno",
        phone: "+5355521212",
        email,
      });
      // Cierra esa sesión: V21 empieza SIN sesión, desde el checkout.
      await fetch(`${BASE}/api/account/logout`, {
        method: "POST",
        headers: { cookie: cookiesPrevias.map((c) => `${c.name}=${c.value}`).join("; ") },
      });

      const ctx = await browser.newContext({ viewport: MOVIL });
      const p = await ctx.newPage();
      await agregarAlCarrito(p, PRODUCTOS_EN_STOCK);
      await p.goto(`${BASE}/tienda-demo/checkout`, { waitUntil: "networkidle" });
      await p.waitForTimeout(800);

      const cantidadesAntes = await p.locator("ul > li").count();

      // Campos vacíos: "entra" navega directo, sin confirmar nada. Con
      // {exact:true} y acotado a <main>: el icono de la cabecera también se
      // llama "Entrar a tu cuenta" y "entra" (substring) lo confunde con él.
      await p.locator("main").getByRole("link", { name: "entra", exact: true }).click();
      await p.waitForURL(/\/cuenta\/entrar/, { timeout: 5000 });
      check(
        "«entra» lleva a /cuenta/entrar con next=…/checkout",
        true,
        /next=%2Ftienda-demo%2Fcheckout|next=\/tienda-demo\/checkout/.test(p.url()),
      );

      await p.getByLabel("Correo").fill(email);
      await p.getByRole("button", { name: "Enviarme un código" }).click();
      await p.waitForSelector("#signin-code", { timeout: 5000 });
      const codigo = await leerCodigoDeCorreo(email);
      await p.locator("#signin-code").fill(codigo);
      await p.waitForURL(/\/tienda-demo\/checkout/, { timeout: 10000 });
      await shot(p, "V21-checkout-tras-entrar");

      check(
        "vuelve exactamente a /tienda-demo/checkout",
        true,
        p.url().endsWith("/tienda-demo/checkout"),
      );

      await p.waitForTimeout(500);
      const cantidadesDespues = await p.locator("ul > li").count();
      check(
        "el carrito trae la misma cantidad de líneas al volver",
        cantidadesAntes,
        cantidadesDespues,
      );

      const nombreRelleno = await p.locator("#field-name").inputValue();
      const telefonoRelleno = await p.locator("#field-phone").inputValue();
      check("el nombre llega relleno con el perfil guardado", "Visual Veintiuno", nombreRelleno);
      check("el teléfono llega relleno con el perfil guardado", "+5355521212", telefonoRelleno);

      await ctx.close();

      // Segunda mitad, D4: "con algo escrito, entra avisa que se pierde".
      // NO en la misma sesión: la línea con el enlace "entra" solo existe
      // en el estado SIN sesión (design.md § 5) — la `p` de arriba ya quedó
      // autenticada al volver, así que el enlace ya no está ahí (es
      // esperable, no un fallo). Un contexto invitado nuevo, carrito propio.
      const ctx2 = await browser.newContext({ viewport: MOVIL });
      const p2 = await ctx2.newPage();
      await agregarAlCarrito(p2, [PRODUCTOS_EN_STOCK[0]]);
      await p2.goto(`${BASE}/tienda-demo/checkout`, { waitUntil: "networkidle" });
      await p2.waitForTimeout(800);
      await p2.locator("#field-name").fill("Algo escrito antes de irme");

      const linkEntra = p2.locator("main").getByRole("link", { name: "entra", exact: true });
      await linkEntra.click();
      await p2.waitForTimeout(400);
      const avisoPerdida = await p2
        .getByText(/se pierde lo que escribiste/)
        .isVisible()
        .catch(() => false);
      check('con texto sin guardar, "entra" muestra el aviso de que se pierde', true, avisoPerdida);
      const siEntrar = await p2
        .getByRole("link", { name: "Sí, entrar" })
        .isVisible()
        .catch(() => false);
      check('el aviso ofrece "Sí, entrar"', true, siEntrar);
      await shot(p2, "V21-aviso-se-pierde");
      check("no navegó todavía: sigue en /checkout", true, p2.url().includes("/checkout"));
      const nombreSigueEscrito = await p2.locator("#field-name").inputValue();
      check(
        "lo tecleado sigue ahí mientras se decide",
        "Algo escrito antes de irme",
        nombreSigueEscrito,
      );

      await ctx2.close();
    },
  );

  // -------------------------------------------------------------------------
} catch (e) {
  fail(`el guion visual se rompió: ${e.message}`);
} finally {
  await context.tracing.stop({ path: `${TRACES}/F-012-sesion-principal.zip` });
  await browser.close();
}

console.log(`\n${fails} aserciones fallidas`);
process.exit(fails === 0 ? 0 : 1);
