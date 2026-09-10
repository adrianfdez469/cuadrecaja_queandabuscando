// Verificación visual de F-040 (la tienda muda). La ejecuta
// `bash .agent/verify.sh F-040 --visual` con la app ya levantada;
// $VISUAL_BASE_URL apunta a ella, $VISUAL_SHOTS es la carpeta de capturas y
// $VISUAL_TRACES la del trace de Playwright.
//
// Traduce a aserciones los SEIS pasos de `design.md` § «Lo que queda por
// mirar cuando el código exista» (§ Verificación visual), los que `smoke.sh`
// —HTTP con `curl`— no puede ver: que la pantalla aguante 360 px sin
// desbordar, que no quede ningún rastro en el DOM de algo que nunca debía
// pintarse, que la marca propia tiña el botón pero no el aviso, y que la
// recuperación en vivo (E14) haga desaparecer el aviso sin que el
// comprador recargue a mano.
//
// Siembra su propio fixture con `.agent/specs/F-040/seed-muted-store.ts`
// (el mismo que usa `smoke.sh`) y lo borra en el `finally`, pase lo que
// pase.
//
// Regla: cada aserción que no se cumpla imprime `VISUAL FAIL <qué>`. Eso es
// lo que el sensor busca para ponerle firma al error.

import { chromium } from "playwright";
import { execSync } from "node:child_process";

const BASE = process.env.VISUAL_BASE_URL ?? "http://localhost:3101";
const SHOTS = process.env.VISUAL_SHOTS ?? ".agent/runs/_libre/shots";
const TRACES = process.env.VISUAL_TRACES ?? ".agent/runs/_libre/traces";

const MOVIL = { width: 360, height: 740 };

const FRASE =
  "Esta tienda no puede mostrar sus precios ahora mismo, así que no está tomando pedidos.";

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
  // `networkidle` puede resolver ANTES de que la hidratación termine de
  // reconciliar: se vio en vivo con /c/no-existe bajo una tienda muda,
  // donde el HTML servido es correcto pero el cliente, ~300-500ms después,
  // lo sustituye por el `not-found.tsx` de la categoría (ver hallazgo en
  // tests.md). Sin este margen, una lectura del DOM demasiado temprana daría
  // un verde que no vio lo que el comprador de verdad ve.
  await page.waitForTimeout(400);
}

async function shot(page, nombre) {
  await page.screenshot({ path: `${SHOTS}/${nombre}.png`, fullPage: true });
}

async function sinDesbordeHorizontal(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
}

// El `role="alert"` de `StoreClosedNotice` NO es el único de la página: Next
// inyecta su propio `<div id="__next-route-announcer__" role="alert">`
// (el anunciador de ruta para lectores de pantalla), vacío la mayor parte
// del tiempo y presente en TODAS las páginas — `getByRole("alert")` a
// secas lo confunde con el aviso real y da falsos vacíos o falsos "sigue
// habiendo un aviso". Se excluye por su id, que es el mismo en cualquier
// versión de Next.
function avisoLocator(page) {
  return page.locator('[role="alert"]:not([id="__next-route-announcer__"])');
}

// `textContent()`/`.textContent` incluye el texto de CUALQUIER nodo
// descendiente, incluidos los `<script>` con el payload de streaming de
// React — un id de referencia como "sesion-cerrada" dentro de ese JSON
// puede colarse como si fuera texto visible. `innerText()` respeta el
// layout calculado (visibilidad, `display:none`) y es lo que de verdad ve
// quien mira la pantalla.
async function textoVisible(page) {
  return page.locator("body").innerText();
}

// El fixture es el mismo que usa smoke.sh: `up` siembra (Prisma directo —
// Business.baseCurrencyCode y la fila Slug que la resolución pública
// necesita no se pueden montar con `createFixtureSession`, ver tests.md §
// Por qué no dbFixtures.ts), `down` borra todo por el sufijo, sin importar
// si el guion terminó en verde o en rojo.
const SUFFIX = `f040vi${Date.now()}`;

function seedUp() {
  const raw = execSync(`npx tsx .agent/specs/F-040/seed-muted-store.ts up ${SUFFIX}`, {
    encoding: "utf8",
  }).trim();
  return JSON.parse(raw);
}

function seedDown() {
  execSync(`npx tsx .agent/specs/F-040/seed-muted-store.ts down ${SUFFIX}`, { encoding: "utf8" });
}

// now-ish ISO, estrictamente creciente entre llamadas — mismo motivo que
// F-036/F-039 smoke.sh: `date` de macOS no tiene %N.
let nowCounter = 0;
function nowIso() {
  nowCounter += 1;
  return new Date(Date.now() + nowCounter).toISOString();
}

const fixture = seedUp();
console.log(`fixture sembrado: ${JSON.stringify(fixture)}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: MOVIL });
await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

try {
  const { mudaBase } = fixture;
  const SIETE_URLS = [
    ["portada", `/${mudaBase.slug}`],
    ["ficha", `/${mudaBase.slug}/p/${mudaBase.productSlugs[0]}`],
    ["catalogo", `/${mudaBase.slug}/catalogo`],
    ["categoria", `/${mudaBase.slug}/c/${mudaBase.categorySlug}`],
    ["buscar", `/${mudaBase.slug}/buscar?q=algo`],
    ["carrito", `/${mudaBase.slug}/carrito`],
    ["checkout", `/${mudaBase.slug}/checkout`],
  ];

  // ==========================================================================
  // V1 (design.md § Verificación visual, punto 1) — las siete URL de una
  // tienda muda DE VERDAD, a 360px: la MISMA cadena en las siete, y ni una
  // tarjeta, ni un importe, ni "Consultar", ni una insignia.
  // ==========================================================================
  console.log("--- V1: las siete vistas a 360px ---");

  let frasePrimeraVista = null;
  for (const [nombre, path] of SIETE_URLS) {
    const page = await context.newPage();
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await prepararPagina(page, `V1 ${nombre}`);

    check(
      `V1 (${nombre}) — sin scroll horizontal a 360px`,
      false,
      await sinDesbordeHorizontal(page),
    );

    const alerta = avisoLocator(page).first();
    const textoAlerta = (await alerta.innerText().catch(() => null))?.trim() ?? null;
    if (frasePrimeraVista === null) {
      frasePrimeraVista = textoAlerta;
      check(`V1 (${nombre}) — el aviso trae la frase prescrita`, true, textoAlerta === FRASE);
    } else {
      check(
        `V1 (${nombre}) — MISMA frase que la portada (criterio 7 extendido a las 7)`,
        frasePrimeraVista,
        textoAlerta,
      );
    }

    check(
      `V1 (${nombre}) — cero tarjetas de producto (.shadow-card)`,
      0,
      await page.locator(".shadow-card").count(),
    );
    check(
      `V1 (${nombre}) — sin 'Consultar' en pantalla`,
      0,
      await page.getByText("Consultar", { exact: false }).count(),
    );
    check(
      `V1 (${nombre}) — sin insignia 'Agotado'`,
      0,
      await page.getByText("Agotado", { exact: false }).count(),
    );
    check(
      `V1 (${nombre}) — sin insignia 'Pocas unidades'`,
      0,
      await page.getByText("Pocas unidades", { exact: false }).count(),
    );

    const bodyText = (await textoVisible(page)) ?? "";
    check(
      `V1 (${nombre}) — sin ningún importe con forma de precio`,
      false,
      /\$[0-9]{1,3}(,[0-9]{3})*\.[0-9]{2}/.test(bodyText),
    );

    await shot(page, `V1-${nombre}-360`);
    await page.close();
  }

  // ==========================================================================
  // V2 (punto 2) — disabledMessage no deja NINGÚN rastro: el párrafo de
  // texto libre del cierre del comerciante (R8) no existe en el DOM, nunca
  // se ocultó con CSS.
  // ==========================================================================
  console.log("--- V2: disabledMessage sin rastro en el DOM ---");

  const v2 = await context.newPage();
  await v2.goto(`${BASE}/${mudaBase.slug}`, { waitUntil: "networkidle" });
  await prepararPagina(v2, "V2 portada");
  // `.whitespace-pre-line` es la clase EXACTA que StoreClosedNotice.tsx solo
  // aplica al párrafo de `disabledMessage` — si el nodo no existe en el DOM
  // (no solo oculto), el selector cuenta cero.
  check(
    "V2 — cero nodos .whitespace-pre-line (el párrafo de disabledMessage)",
    0,
    await v2.locator(".whitespace-pre-line").count(),
  );
  await v2.close();

  // ==========================================================================
  // V3 (punto 3) — una tienda con marca propia: cabecera y botón de
  // WhatsApp en SU color, aviso en el warning del SISTEMA (no recoloreado).
  // ==========================================================================
  console.log("--- V3: marca propia — botón teñido, aviso no ---");

  const v3 = await context.newPage();
  await v3.goto(`${BASE}/${mudaBase.slug}`, { waitUntil: "networkidle" });
  await prepararPagina(v3, "V3 marca propia");
  const whatsappBrandColor = await v3
    .locator('a[href^="https://wa.me/"]')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const alertColorMuda = await avisoLocator(v3)
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  await shot(v3, "V3-marca-propia-360");
  await v3.close();

  // La tienda cerrada de verdad del seed (`tienda-principal`, sin
  // themeTokens propios — paleta por defecto) es el control: su botón de
  // WhatsApp lleva EXACTAMENTE la misma clase `bg-brand`, así que si el
  // color computado difiere, es la marca propia la que lo hace, no otra
  // cosa. Nada de esto se sembró: es un fixture que `prisma/seed.ts` ya
  // deja siempre.
  const v3control = await context.newPage();
  await v3control.goto(`${BASE}/tienda-principal`, { waitUntil: "networkidle" });
  await prepararPagina(v3control, "V3 control (tienda-principal)");
  const whatsappDefaultColor = await v3control
    .locator('a[href^="https://wa.me/"]')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor)
    .catch(() => null);
  const alertColorControl = await avisoLocator(v3control)
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  await v3control.close();

  if (whatsappDefaultColor === null) {
    fail(
      "V3 — no se encontró el botón de WhatsApp en tienda-principal (control) — revisa prisma/seed.ts",
    );
  } else {
    check(
      "V3 — el botón de WhatsApp de la marca propia usa OTRO color que el de la paleta por defecto",
      true,
      whatsappBrandColor !== whatsappDefaultColor,
    );
  }
  check(
    "V3 — el aviso (tono warning) usa el MISMO color con marca propia y sin ella — no se recolorea",
    alertColorControl,
    alertColorMuda,
  );

  // ==========================================================================
  // V4 (punto 4) — /p/no-existe y /c/no-existe bajo tienda muda: la MISMA
  // pantalla, sin 404 y sin nombrar nada (E5, E6).
  // ==========================================================================
  console.log("--- V4: producto y categoría inexistentes ---");

  for (const [nombre, path] of [
    ["producto-no-existe", `/${mudaBase.slug}/p/no-existe`],
    ["categoria-no-existe", `/${mudaBase.slug}/c/no-existe`],
  ]) {
    const page = await context.newPage();
    const response = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await prepararPagina(page, `V4 ${nombre}`);
    check(`V4 (${nombre}) — responde 200, nunca 404`, 200, response?.status() ?? null);
    const texto =
      (
        await avisoLocator(page)
          .first()
          .innerText()
          .catch(() => null)
      )?.trim() ?? null;
    check(`V4 (${nombre}) — la MISMA frase que la portada`, frasePrimeraVista, texto);
    const bodyText = (await textoVisible(page)) ?? "";
    check(
      `V4 (${nombre}) — no nombra ningún producto de la tienda`,
      false,
      bodyText.includes(`F-040 producto muda base ${SUFFIX}`),
    );
    check(
      `V4 (${nombre}) — no nombra la categoría`,
      false,
      bodyText.includes(`F-040 categoría ${SUFFIX}`),
    );
    await shot(page, `V4-${nombre}`);
    await page.close();
  }

  // ==========================================================================
  // V5 (punto 5) — comparación lado a lado con una tienda cerrada de
  // verdad: se distinguen por la frase, NUNCA por el diseño, y la muda no
  // dice "cerrada" en ningún sitio.
  // ==========================================================================
  console.log("--- V5: tienda muda vs. tienda cerrada de verdad ---");

  const muda = await context.newPage();
  await muda.goto(`${BASE}/${mudaBase.slug}`, { waitUntil: "networkidle" });
  await prepararPagina(muda, "V5 muda");
  const mudaBodyText = ((await textoVisible(muda)) ?? "").toLowerCase();
  check("V5 — la tienda muda NUNCA dice 'cerrada'", false, mudaBodyText.includes("cerrada"));
  check("V5 — la tienda muda NUNCA dice 'cerrado'", false, mudaBodyText.includes("cerrado"));
  const mudaAlertClass = await avisoLocator(muda).first().getAttribute("class");
  await shot(muda, "V5-muda-360");
  await muda.close();

  // `tienda-cerrada` (SUSPENDED, sin teléfono ni marca — el aviso más
  // corto posible, design.md § Se miró la pantalla de verdad) es el
  // cierre real.
  const cerrada = await context.newPage();
  await cerrada.goto(`${BASE}/tienda-cerrada`, { waitUntil: "networkidle" });
  await prepararPagina(cerrada, "V5 cerrada de verdad");
  const cerradaText =
    (
      await avisoLocator(cerrada)
        .first()
        .innerText()
        .catch(() => null)
    )?.trim() ?? null;
  const cerradaAlertClass = await avisoLocator(cerrada).first().getAttribute("class");
  await shot(cerrada, "V5-cerrada-de-verdad-360");
  await cerrada.close();

  check(
    "V5 — el mismo componente de aviso (misma clase Alert) en las dos",
    cerradaAlertClass,
    mudaAlertClass,
  );
  check(
    "V5 — pero la FRASE es distinta entre la muda y la cerrada de verdad",
    true,
    cerradaText !== frasePrimeraVista,
  );

  // ==========================================================================
  // V6 (punto 6, E14) — la recuperación EN VIVO: sembrar la tasa que
  // faltaba por el mismo canal que el POS (el sync), revalidar, recargar, y
  // que no quede NI RASTRO del aviso.
  // ==========================================================================
  console.log("--- V6: recuperación en vivo (E14) ---");

  const v6 = await context.newPage();
  await v6.goto(`${BASE}/${mudaBase.slug}`, { waitUntil: "networkidle" });
  await prepararPagina(v6, "V6 antes de la tasa");
  const fraseAntes =
    (
      await avisoLocator(v6)
        .first()
        .innerText()
        .catch(() => null)
    )?.trim() ?? null;
  check("V6 — antes de la tasa, la tienda sigue muda", frasePrimeraVista, fraseAntes);

  const evento = {
    eventId: `evt-f040-visual-${SUFFIX}`,
    entity: "EXCHANGE_RATE",
    operation: "CREATE",
    occurredAt: nowIso(),
    payload: {
      businessId: fixture.businessMudaExternalId,
      currency: "XXX",
      rate: 1,
      updatedAt: nowIso(),
    },
  };
  const syncResponse = await v6.evaluate(
    async ({ base, token, businessId, evento }) => {
      const res = await fetch(`${base}/api/internal/sync/catalog`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ businessId, events: [evento] }),
      });
      return { status: res.status, body: await res.json() };
    },
    {
      base: BASE,
      token: fixture.businessMudaSyncToken,
      businessId: fixture.businessMudaExternalId,
      evento,
    },
  );
  check(
    "V6 — el EXCHANGE_RATE se procesó (207, ok:[eventId])",
    true,
    syncResponse.status === 207 && syncResponse.body.ok?.includes(evento.eventId),
  );

  // La PRIMERA visita posterior a la invalidación, sin esperar el suelo de
  // 3600s (R10) y sin ninguna acción del comprador salvo recargar.
  await v6.reload({ waitUntil: "networkidle" });
  await prepararPagina(v6, "V6 después de la tasa");
  const avisoDespues = await avisoLocator(v6).count();
  check("V6 — CERO avisos de cierre tras la recuperación (ni rastro)", 0, avisoDespues);
  check(
    "V6 — 'Consultar' no aparece (el catálogo resolvió precio)",
    0,
    await v6.getByText("Consultar", { exact: false }).count(),
  );
  check(
    "V6 — al menos una tarjeta de producto vuelve a pintarse",
    true,
    (await v6.locator(".shadow-card").count()) > 0,
  );
  await shot(v6, "V6-recuperada-360");
  await v6.close();
} catch (e) {
  fail(`el guion visual se rompió: ${e.message}`);
} finally {
  await context.tracing.stop({ path: `${TRACES}/trace.zip` });
  await browser.close();
  seedDown();
}

console.log(`\n${fails} aserciones fallidas`);
process.exit(fails === 0 ? 0 : 1);
