// Verificación visual de F-023 (imágenes de producto optimizadas al subir,
// servidas del CDN de Supabase). La ejecuta `bash .agent/verify.sh F-023
// --visual` con la app ya levantada; $VISUAL_BASE_URL apunta a ella y
// $VISUAL_SHOTS es la carpeta donde dejar las capturas.
//
// Cubre los doce pasos V1-V12 de design.md § Verificación visual:
//
//   V1-V6  — necesitan ojo humano o datos reales (design.md los dejó SIN
//            ejecutar: "el navegador de este entorno no cambia de tamaño").
//            Aquí se automatiza todo lo objetivamente medible (geometría de
//            caja, columnas de la rejilla, ausencia de <img> roto, contraste
//            estructural) y se deja constancia en comentario de lo que sigue
//            siendo un juicio asistido por captura (V6).
//   V7-V12 — "ejecutables sin ojo humano" según el propio design.md. Ya
//            viven en espíritu en `scripts/check-image-budget.mjs` y en los
//            criterios 1/3/4/5/6 de `tests.md`; se repiten aquí porque
//            aportan algo que ni el smoke ni check-image-budget miran: el
//            marcado EXACTO de un `<picture>` de tarjeta (un único
//            candidato por formato, D3), el de la ficha (dos candidatos con
//            `sizes` en `calc()`), y `loading`/`fetchpriority` tarjeta por
//            tarjeta — y lo hacen sobre un catálogo que además incluye, a
//            propósito, un producto con URL heredada de F-011 y uno sin
//            imágenes (la "trampa" de V11 que design.md señala: una URL
//            heredada no vive dentro de un <picture> y por tanto el
//            presupuesto no la cuenta).
//
// Datos: el seed (`prisma/seed.ts::seedProductImages`) deja los 15 productos
// de `tienda-demo` con una imagen real generada por el pipeline de F-023.
// Este guion, en su § Preparación, toma DOS de esos quince y los desvía —
// por la única puerta que el panel ya expone (`PUT` del editor) — a los dos
// estados que design.md exige ver "en la misma pantalla que el caso normal":
// uno sin ninguna imagen (E8) y otro con una URL heredada de F-011, real y
// cargable, subida directo a Storage con la forma de ruta que aquel feature
// dejaba (`<uuid>.<ext>`, sin directorio — R11). La limpieza final
// (`npm run seed`) reescribe esos dos productos con su imagen determinista
// de siempre: el guion se puede correr dos veces seguidas.
//
// Headless y por Bash a propósito: la extensión de Chrome necesita que un
// humano la conecte, no existe en CI y no se repite entre sesiones.
//
// Regla: cada aserción que no se cumpla imprime `VISUAL FAIL <qué>`.

import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const BASE = process.env.VISUAL_BASE_URL ?? "http://localhost:3101";
const SHOTS = process.env.VISUAL_SHOTS ?? ".agent/runs/_libre/shots";

const MOVIL = { width: 360, height: 740 };
const TABLET = { width: 768, height: 900 };
const ESCRITORIO = { width: 1280, height: 800 };

// Duplicado a propósito, no importado: este guion es un `.mjs` y no puede
// importar `src/constants/media.ts` (TypeScript) — la misma razón por la que
// `scripts/check-image-budget.mjs` ya hardcodea su propio presupuesto.
const CATALOG_EAGER_IMAGE_COUNT = 4;
const IMAGE_VARIANT_WIDTH_CARD = 400;

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

// Ver .agent/templates/visual.mjs: el indicador de dev-tools de Next vive en
// un <nextjs-portal> con position fixed que se cose a la altura del viewport
// en una captura de página completa y parece un defecto de interfaz.
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

function ssoUrl(stores) {
  return execSync(`node scripts/mint-sso-token.mjs --stores=${stores}`, {
    encoding: "utf8",
    env: { ...process.env, QAB_BASE_URL: BASE },
  }).trim();
}

// La tarjeta (li) de un producto por su nombre — sin depender de clases de
// Tailwind con ":" (inválidas como selector CSS), buscando el <h3> y subiendo
// al <li> que lo contiene. Funciona igual en la rejilla del catálogo que en
// la de resultados de búsqueda.
function cardLi(page, nombre) {
  return page
    .getByRole("heading", { level: 3, name: nombre, exact: true })
    .locator("xpath=ancestor::li[1]");
}

// React's static markup renders the srcset attribute as `srcSet` (camelCase)
// — HTML lo trata igual (insensible a mayúsculas), pero un grep que no lo
// sepa no matchea nada. Mismo hallazgo que impl.md § Qué necesita quien
// pruebe deja escrito para quien grep-ee HTML crudo.
function extractSrcset(tag) {
  return tag.match(/srcset="([^"]*)"/i)?.[1] ?? null;
}

console.log(
  "== preparación: sembrar (idempotente) — 15 productos con imagen real en tienda-demo ==",
);
execSync("npm run seed", { stdio: "inherit" });

const browser = await chromium.launch();

let storeId = null;
let pidSinImagen = null;
let pidHeredada = null;
let pidConImagen = null;
let legacyUrl = null;
let fichaUrl = null;

try {
  // === Preparación: dos de los quince productos de tienda-demo se desvían a
  // los estados que V1-V6 exigen ver junto al caso normal (E8, E9/R11). =====

  const setup = await browser.newPage({ viewport: ESCRITORIO });
  await setup.goto(ssoUrl("seed-tienda-1"), { waitUntil: "networkidle" });
  await setup.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  storeId = await setup.evaluate(() => {
    const cards = [...document.querySelectorAll("[data-store-id]")];
    const found = cards.find((c) => c.textContent?.includes("La Rampa · Vedado"));
    return found?.getAttribute("data-store-id") ?? null;
  });
  if (!storeId) {
    fail("no se encontró tienda-demo (La Rampa · Vedado) en /admin — revisa prisma/seed.ts");
    throw new Error("preparación fallida");
  }

  await setup.goto(`${BASE}/admin/tiendas/${storeId}/productos`, { waitUntil: "networkidle" });
  [pidSinImagen, pidHeredada, pidConImagen] = await setup.evaluate(() => {
    const rows = [...document.querySelectorAll("li[data-store-product-id]")];
    const find = (needle) =>
      rows.find((r) => r.textContent?.includes(needle))?.getAttribute("data-store-product-id") ??
      null;
    return [find("Galletas de sal"), find("Papel sanitario x4"), find("Refresco de cola 1.5 L")];
  });
  if (!pidSinImagen || !pidHeredada || !pidConImagen) {
    fail("no se encontraron los tres productos fixture en tienda-demo — revisa prisma/seed.ts");
    throw new Error("preparación fallida");
  }

  // Sube un objeto REAL a Storage con la forma de ruta que F-011 dejaba
  // (<uuid>.<ext>, SIN directorio) — architecture.md § Rutas y derivación: es
  // justo lo que hace que `deriveImageVariants` la trate como heredada
  // (R11), a diferencia de una URL de F-023 (`<uuid>/original.<ext>`).
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "store-media";
  if (!supabaseUrl || !serviceRoleKey) {
    fail(
      "faltan NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY en .env — no se puede fabricar la URL heredada de prueba",
    );
    throw new Error("preparación fallida");
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const legacyBytes = readFileSync(".agent/specs/F-011/fixtures/sample.jpg");
  const legacyPath = `stores/${storeId}/products/${pidHeredada}/f011-legacy-fixture.jpg`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(bucket)
    .upload(legacyPath, legacyBytes, { contentType: "image/jpeg", upsert: true });
  if (uploadError) {
    fail(`no se pudo subir el objeto "heredado" de prueba: ${uploadError.message}`);
    throw new Error("preparación fallida");
  }
  legacyUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${legacyPath}`;

  const apiUrl = (pid) => `${BASE}/api/admin/stores/${storeId}/products/${pid}`;
  const putSinImagen = await setup.request.put(apiUrl(pidSinImagen), {
    data: { description: null, imageUrls: [], visible: true, featured: false, priceOverride: null },
  });
  check(
    "preparación — PUT que deja 'Galletas de sal' sin imágenes (E8)",
    200,
    putSinImagen.status(),
  );

  const putHeredada = await setup.request.put(apiUrl(pidHeredada), {
    data: {
      description: null,
      imageUrls: [legacyUrl],
      visible: true,
      featured: false,
      priceOverride: null,
    },
  });
  check(
    "preparación — PUT que deja 'Papel sanitario x4' con una URL heredada de F-011 (E9/R11)",
    200,
    putHeredada.status(),
  );

  // La URL de la ficha de un producto CON imagen real (D5, V3, V6, V9) se lee
  // del propio `<a href>` del catálogo público — nunca se construye a mano,
  // el slug no se adivina.
  const anonForHref = await browser.newPage({ viewport: ESCRITORIO });
  await anonForHref.goto(`${BASE}/tienda-demo`, { waitUntil: "networkidle" });
  const hrefRefresco = await anonForHref
    .getByRole("heading", { level: 3, name: "Refresco de cola 1.5 L", exact: true })
    .locator("xpath=ancestor::a[1]")
    .getAttribute("href");
  await anonForHref.close();
  if (!hrefRefresco) {
    fail("no se encontró el enlace a la ficha de 'Refresco de cola 1.5 L' en /tienda-demo");
    throw new Error("preparación fallida");
  }
  fichaUrl = `${BASE}${hrefRefresco}`;

  await setup.close();

  // === V1/V2/V4 — catálogo (/tienda-demo): geometría por breakpoint, los
  // estados E8/E9 junto al normal, y modo oscuro. Una sola página, tres
  // tamaños: el resize no exige recargar, Chromium relayoutea solo. ========

  const catalogo = await browser.newPage({ viewport: MOVIL });
  await catalogo.goto(`${BASE}/tienda-demo`, { waitUntil: "networkidle" });
  await prepararPagina(catalogo, "/tienda-demo (360px)");

  check("V1 — 360px sin scroll horizontal", false, await sinDesbordeHorizontal(catalogo));

  // design.md § Estructura por breakpoint: la rejilla es 2/3/4 columnas y la
  // caja de imagen mide 156/229/264 CSS px. No hay una captura "de antes" de
  // este ciclo contra la que diferenciar píxel a píxel (el feature ya está
  // implementado); en su lugar se mide la GEOMETRÍA que design.md declaró
  // que no cambiaría, que es lo objetivamente verificable de "no se movió
  // ni un píxel".
  async function medirRejilla(page, anchoEsperado, columnasEsperadas, etiqueta) {
    const refresco = cardLi(page, "Refresco de cola 1.5 L");
    const caja = refresco.locator("xpath=.//a/div[1]");
    const box = await caja.boundingBox();
    if (!box) {
      fail(`${etiqueta} — no se pudo medir la caja de imagen de 'Refresco de cola 1.5 L'`);
      return;
    }
    check(
      `${etiqueta} — la caja de imagen es cuadrada`,
      true,
      Math.abs(box.width - box.height) <= 2,
    );
    check(
      `${etiqueta} — la caja de imagen mide ~${anchoEsperado}px (±4)`,
      true,
      Math.abs(box.width - anchoEsperado) <= 4,
    );
    const ul = refresco.locator("xpath=ancestor::ul[1]");
    const columnas = await ul.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length,
    );
    check(
      `${etiqueta} — la rejilla tiene ${columnasEsperadas} columnas`,
      columnasEsperadas,
      columnas,
    );
    const destacado = await refresco.getByText("Destacado").count();
    check(
      `${etiqueta} — la cinta 'Destacado' sigue presente (featured: true)`,
      true,
      destacado > 0,
    );
  }
  await medirRejilla(catalogo, 156, 2, "V1@360");

  // V2 @360 — el hueco "Sin imagen" y la URL heredada, en la misma pantalla
  // que el caso normal, sin destacar.
  const sinImagen360 = cardLi(catalogo, "Galletas de sal");
  check(
    "V2@360 — 'Galletas de sal' muestra 'Sin imagen'",
    true,
    (await sinImagen360.getByText("Sin imagen").count()) > 0,
  );
  check(
    "V2@360 — 'Galletas de sal' no emite ningún <img>",
    0,
    await sinImagen360.locator("img").count(),
  );
  check(
    "V2@360 — 'Galletas de sal' no emite ningún <source>",
    0,
    await sinImagen360.locator("source").count(),
  );

  const heredada360 = cardLi(catalogo, "Papel sanitario x4");
  check(
    "V2@360 — 'Papel sanitario x4' (URL heredada) NO muestra 'Sin imagen'",
    0,
    await heredada360.getByText("Sin imagen").count(),
  );
  check(
    "V2@360 — 'Papel sanitario x4' emite un <img> simple (sin <picture>)",
    0,
    await heredada360.locator("picture").count(),
  );
  check(
    "V2@360 — 'Papel sanitario x4' emite exactamente un <img>",
    1,
    await heredada360.locator("img").count(),
  );
  const srcHeredada = await heredada360.locator("img").getAttribute("src");
  check("V2@360 — el <img> heredado apunta a la URL heredada exacta", legacyUrl, srcHeredada);
  const cajaHeredada = heredada360.locator("xpath=.//a/div[1]");
  check(
    "V2@360 — la caja de 'Papel sanitario x4' conserva bg-surface-muted (misma tarjeta que cualquier otra)",
    true,
    (await cajaHeredada.getAttribute("class"))?.includes("bg-surface-muted") ?? false,
  );

  await shot(catalogo, "V01-V02-catalogo-360");

  await catalogo.setViewportSize(TABLET);
  await catalogo.waitForTimeout(100);
  check("V1 — 768px sin scroll horizontal", false, await sinDesbordeHorizontal(catalogo));
  await medirRejilla(catalogo, 229, 3, "V1@768");
  await shot(catalogo, "V01-catalogo-768");

  await catalogo.setViewportSize(ESCRITORIO);
  await catalogo.waitForTimeout(100);
  check("V1 — 1280px sin scroll horizontal", false, await sinDesbordeHorizontal(catalogo));
  await medirRejilla(catalogo, 264, 4, "V1@1280");

  const sinImagen1280 = cardLi(catalogo, "Galletas de sal");
  check(
    "V2@1280 — 'Galletas de sal' sigue mostrando 'Sin imagen'",
    true,
    (await sinImagen1280.getByText("Sin imagen").count()) > 0,
  );
  const heredada1280 = cardLi(catalogo, "Papel sanitario x4");
  check(
    "V2@1280 — 'Papel sanitario x4' sigue sin destacar (mismo <img> simple)",
    1,
    await heredada1280.locator("img").count(),
  );
  await shot(catalogo, "V01-V02-catalogo-1280");

  // V4 — modo oscuro. design.md ya calculó el contraste (5,99:1) por
  // aritmética de oklch(); aquí se confirma ESTRUCTURALMENTE que el fondo de
  // la caja y el fondo de la página no colapsan al mismo color, y que el
  // texto sigue teniendo color propio — la evidencia visual queda en la
  // captura para que un humano confirme el ratio con el ojo si quiere.
  await catalogo.emulateMedia({ colorScheme: "dark" });
  await catalogo.waitForTimeout(100);
  check("V4 — 1280px oscuro sin scroll horizontal", false, await sinDesbordeHorizontal(catalogo));
  const contraste = await sinImagen1280.evaluate((li) => {
    const caja = li.querySelector("a > div");
    const texto = [...li.querySelectorAll("*")].find(
      (el) => el.textContent?.trim() === "Sin imagen",
    );
    const bg = caja ? getComputedStyle(caja).backgroundColor : null;
    const pageBg = getComputedStyle(document.body).backgroundColor;
    const fg = texto ? getComputedStyle(texto).color : null;
    return { bg, pageBg, fg };
  });
  check(
    "V4 — el hueco 'Sin imagen' tiene un fondo distinto del fondo de la página (oscuro)",
    true,
    contraste.bg != null && contraste.bg !== contraste.pageBg,
  );
  check(
    "V4 — el texto 'Sin imagen' tiene un color distinto de su propio fondo (oscuro)",
    true,
    contraste.fg != null && contraste.fg !== contraste.bg,
  );
  await shot(catalogo, "V04-catalogo-oscuro-1280");
  await catalogo.emulateMedia({ colorScheme: "light" });

  // === V10/V12 — sobre el mismo catálogo ya cargado: las cuatro primeras
  // tarjetas sin loading="lazy" (solo la 0 con fetchpriority="high"), el
  // resto con loading="lazy"; el producto sin imágenes, cero <img>/<source>.

  const tarjetas = await catalogo.locator('ul[class*="grid-cols-2"] > li').all();
  check(
    "V10 — la rejilla del catálogo tiene 15 tarjetas (los productos del seed)",
    15,
    tarjetas.length,
  );
  for (let i = 0; i < tarjetas.length; i++) {
    const imgCount = await tarjetas[i].locator("img").count();
    if (imgCount === 0) continue; // el producto sin imágenes no emite <img> — V12 lo cubre aparte
    const img = tarjetas[i].locator("img").first();
    const loading = await img.getAttribute("loading");
    const fetchPriority = await img.getAttribute("fetchpriority");
    if (i === 0) {
      check("V10 — tarjeta índice 0 (LCP) sin atributo loading", null, loading);
      check("V10 — tarjeta índice 0 (LCP) con fetchpriority=high", "high", fetchPriority);
    } else if (i < CATALOG_EAGER_IMAGE_COUNT) {
      check(`V10 — tarjeta índice ${i} (eager) sin atributo loading`, null, loading);
      check(`V10 — tarjeta índice ${i} (eager) sin fetchpriority`, null, fetchPriority);
    } else {
      check(`V10 — tarjeta índice ${i} con loading=lazy`, "lazy", loading);
    }
  }

  const sinImagenFinal = cardLi(catalogo, "Galletas de sal");
  check(
    "V12 — 'Galletas de sal' no emite ningún <img>",
    0,
    await sinImagenFinal.locator("img").count(),
  );
  check(
    "V12 — 'Galletas de sal' no emite ningún <source>",
    0,
    await sinImagenFinal.locator("source").count(),
  );

  await catalogo.close();

  // === V6 — el juicio de D3 a DPR2. Lo objetivo (ancho intrínseco real del
  // candidato, factor de escalado) se mide y se afirma; si la tarjeta "se ve
  // aceptablemente nítida" es un juicio que esta línea NO puede emitir por sí
  // sola — queda como verificación asistida por captura: la screenshot
  // ampliada de una tarjeta a DPR2 para que un humano la mire. =============

  const retina = await browser.newPage({ viewport: ESCRITORIO, deviceScaleFactor: 2 });
  await retina.goto(`${BASE}/tienda-demo`, { waitUntil: "networkidle" });
  await prepararPagina(retina, "/tienda-demo (1280px, DPR2)");
  const refrescoRetina = cardLi(retina, "Refresco de cola 1.5 L");
  const imgRetina = refrescoRetina.locator("img").first();
  const natural = await imgRetina.evaluate((img) => img.naturalWidth);
  check(
    "V6 — el candidato de tarjeta a DPR2 sigue siendo el de 400px (D3: un solo candidato)",
    IMAGE_VARIANT_WIDTH_CARD,
    natural,
  );
  const cajaRetina = await refrescoRetina.locator("xpath=.//a/div[1]").boundingBox();
  if (cajaRetina) {
    const escala = (cajaRetina.width * 2) / natural;
    console.log(
      `  info V6 — caja ${cajaRetina.width.toFixed(0)}css px × DPR2 = ${(cajaRetina.width * 2).toFixed(0)}px ` +
        `necesarios; se sirve ${natural}px → escalado ${escala.toFixed(2)}× ` +
        `(design.md D3 acepta hasta 1,32× en escritorio retina; el veredicto de "se ve aceptablemente ` +
        `nítida" queda para quien mire V06-tarjeta-dpr2.png, no para esta aserción)`,
    );
  }
  await shot(retina, "V06-tarjeta-dpr2");
  await retina.close();

  // === V3/V9 — ficha de producto: geometría por breakpoint y el <picture>
  // con dos candidatos por formato + sizes en calc(). ======================

  const ficha = await browser.newPage({ viewport: MOVIL });
  await ficha.goto(fichaUrl, { waitUntil: "networkidle" });
  await prepararPagina(ficha, "ficha de producto (360px)");
  check("V3 — 360px sin scroll horizontal", false, await sinDesbordeHorizontal(ficha));

  const h1 = ficha.getByRole("heading", { level: 1 });
  const columnaDatos = h1.locator("xpath=..");
  const cajaImagen = columnaDatos.locator("xpath=preceding-sibling::div[1]");
  const imgFicha = cajaImagen.locator("img").first();

  async function medirFicha(anchoEsperado, etiqueta) {
    const cajaBox = await cajaImagen.boundingBox();
    const imgBox = await imgFicha.boundingBox();
    if (!cajaBox || !imgBox) {
      fail(`${etiqueta} — no se pudo medir la caja/imagen de la ficha`);
      return;
    }
    check(
      `${etiqueta} — la foto llena su caja (object-cover, tolerancia 2px)`,
      true,
      Math.abs(cajaBox.width - imgBox.width) <= 2 && Math.abs(cajaBox.height - imgBox.height) <= 2,
    );
    check(
      `${etiqueta} — la caja de imagen mide ~${anchoEsperado}px (±6)`,
      true,
      Math.abs(cajaBox.width - anchoEsperado) <= 6,
    );
  }
  await medirFicha(328, "V3@360");
  // A 360 la disposición está apilada: la foto va ARRIBA de la columna de
  // datos (design.md § 2).
  const cajaBox360 = await cajaImagen.boundingBox();
  const datosBox360 = await columnaDatos.boundingBox();
  check(
    "V3@360 — apilado: la foto está por encima de los datos",
    true,
    !!cajaBox360 && !!datosBox360 && cajaBox360.y < datosBox360.y,
  );
  await shot(ficha, "V03-ficha-360");

  await ficha.setViewportSize(TABLET);
  await ficha.waitForTimeout(100);
  check("V3 — 768px sin scroll horizontal", false, await sinDesbordeHorizontal(ficha));
  await medirFicha(344, "V3@768");
  // Dos columnas IGUALES a 768 — design.md § Estructura por breakpoint.
  const cajaBox768 = await cajaImagen.boundingBox();
  const datosBox768 = await columnaDatos.boundingBox();
  check(
    "V3@768 — las dos columnas son iguales (±4px)",
    true,
    !!cajaBox768 && !!datosBox768 && Math.abs(cajaBox768.width - datosBox768.width) <= 4,
  );
  await shot(ficha, "V03-ficha-768");

  await ficha.setViewportSize(ESCRITORIO);
  await ficha.waitForTimeout(100);
  check("V3 — 1280px sin scroll horizontal", false, await sinDesbordeHorizontal(ficha));
  await medirFicha(536, "V3@1280");
  await shot(ficha, "V03-ficha-1280");
  await ficha.close();

  // === V7-V9, V11 — marcado exacto sobre HTML crudo (curl + parseo, como
  // pide design.md), ya con el catálogo perturbado por la preparación. =====

  console.log("\n== V7: ninguna URL de /_next/image en las tres páginas de tienda ==");
  const buscarUrl = `${BASE}/tienda-demo/buscar?q=cola`;
  for (const url of [`${BASE}/tienda-demo`, buscarUrl, fichaUrl]) {
    const html = await (await fetch(url)).text();
    const count = (html.match(/_next\/image/g) ?? []).length;
    check(`V7 — ${url} no referencia /_next/image`, 0, count);
  }

  console.log(
    "\n== V8: cada <picture> de tarjeta tiene un único candidato AVIF y uno WebP (D3, D5) ==",
  );
  const catalogoHtml = await (await fetch(`${BASE}/tienda-demo`)).text();
  const pictureBlocks = catalogoHtml.match(/<picture>[\s\S]*?<\/picture>/g) ?? [];
  // 13, no 15: los dos productos desviados por la preparación (sin imagen y
  // URL heredada) no emiten ningún <picture> — E8 y R11.
  check(
    "V8 — 13 <picture> de tarjeta en /tienda-demo (15 productos − 2 desviados)",
    13,
    pictureBlocks.length,
  );
  pictureBlocks.forEach((block, i) => {
    const avifSources = block.match(/<source\b[^>]*type="image\/avif"[^>]*>/gi) ?? [];
    const webpSources = block.match(/<source\b[^>]*type="image\/webp"[^>]*>/gi) ?? [];
    check(`V8 — <picture> #${i}: exactamente un <source avif>`, 1, avifSources.length);
    check(`V8 — <picture> #${i}: exactamente un <source webp>`, 1, webpSources.length);
    const avifSrcset = extractSrcset(avifSources[0] ?? "");
    if (avifSrcset?.includes(","))
      fail(`V8 — <picture> #${i}: el candidato AVIF trae más de uno (D3)`);
    const imgTag = block.match(/<img\b[^>]*>/i)?.[0] ?? "";
    const imgSrc = imgTag.match(/\bsrc="([^"]+)"/i)?.[1] ?? "";
    if (!imgSrc.endsWith("w400.webp"))
      fail(`V8 — <picture> #${i}: el <img> de respaldo no es w400.webp (${imgSrc})`);
  });

  console.log("\n== V9: la ficha ofrece dos candidatos por formato con sizes en calc() ==");
  const fichaHtml = await (await fetch(fichaUrl)).text();
  const fichaPictures = fichaHtml.match(/<picture>[\s\S]*?<\/picture>/g) ?? [];
  check("V9 — la ficha tiene exactamente un <picture>", 1, fichaPictures.length);
  const fichaBlock = fichaPictures[0] ?? "";
  const avifTagFicha = fichaBlock.match(/<source\b[^>]*type="image\/avif"[^>]*>/i)?.[0] ?? "";
  const webpTagFicha = fichaBlock.match(/<source\b[^>]*type="image\/webp"[^>]*>/i)?.[0] ?? "";
  const avifSrcFicha = extractSrcset(avifTagFicha) ?? "";
  const webpSrcFicha = extractSrcset(webpTagFicha) ?? "";
  check(
    "V9 — el candidato AVIF trae 400w y 800w",
    true,
    avifSrcFicha.includes("400w") && avifSrcFicha.includes("800w"),
  );
  check(
    "V9 — el candidato WebP trae 400w y 800w",
    true,
    webpSrcFicha.includes("400w") && webpSrcFicha.includes("800w"),
  );
  const sizesFicha = avifTagFicha.match(/sizes="([^"]*)"/i)?.[1] ?? "";
  check(
    "V9 — el sizes usa calc() (geometría real, no 100vw/50vw a bulto)",
    true,
    sizesFicha.includes("calc("),
  );
  check("V9 — el sizes trae el tope de 536px", true, sizesFicha.includes("536px"));

  console.log(
    "\n== V11: el presupuesto de imágenes, con el catálogo YA perturbado (heredada + sin imagen) ==",
  );
  let budgetOutput = "";
  let budgetCode = 0;
  try {
    budgetOutput = execSync(
      `node scripts/check-image-budget.mjs --base=${BASE} --slug=tienda-demo`,
      {
        encoding: "utf8",
      },
    );
  } catch (e) {
    budgetOutput = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    budgetCode = typeof e.status === "number" ? e.status : 1;
  }
  console.log(
    budgetOutput
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n"),
  );
  check("V11 — check-image-budget.mjs sigue en 0 con el catálogo perturbado", 0, budgetCode);
  check(
    "V11 — la trampa de design.md: la URL heredada NO cuenta (13 imágenes medidas, no 14 ni 15)",
    true,
    /\b13 imágenes medidas\b/.test(budgetOutput),
  );

  // === V5 — panel: galería del editor (nítida, sin badge para una URL del
  // bucket sin variantes) y miniatura del listado (sr-only, no texto
  // partido). =================================================================

  const panel = await browser.newPage({ viewport: ESCRITORIO });
  await panel.goto(ssoUrl("seed-tienda-1"), { waitUntil: "networkidle" });
  await panel.goto(`${BASE}/admin/tiendas/${storeId}/productos`, { waitUntil: "networkidle" });
  await prepararPagina(panel, "listado del panel (1280px)");

  const filaSinImagen = panel.locator(`li[data-store-product-id="${pidSinImagen}"]`);
  const miniaturaSinImagen = filaSinImagen.locator(".size-12");
  const srOnly = miniaturaSinImagen.getByText("Sin imagen");
  check(
    "V5 — la miniatura sin imagen SÍ anuncia 'Sin imagen' al lector de pantalla",
    1,
    await srOnly.count(),
  );
  const srOnlyBox = await srOnly.boundingBox();
  check(
    "V5 — pero ese texto es sr-only: su caja visual es del tamaño de un pixel, no texto partido a la vista",
    true,
    !!srOnlyBox && srOnlyBox.width <= 1 && srOnlyBox.height <= 1,
  );

  const filaHeredada = panel.locator(`li[data-store-product-id="${pidHeredada}"]`);
  check(
    "V5 — el listado NO distingue la fila con URL heredada (sin badge, es diagnóstico solo del editor)",
    0,
    await filaHeredada.getByText("Imagen externa").count(),
  );
  await shot(panel, "V05-panel-listado-1280");

  await panel.goto(`${BASE}/admin/tiendas/${storeId}/productos/${pidConImagen}`, {
    waitUntil: "networkidle",
  });
  const galeriaImg = panel.locator("img").first();
  const galeriaNatural = await galeriaImg.evaluate((img) => img.naturalWidth).catch(() => 0);
  check(
    "V5 — la galería del editor sirve la variante de 400px (nítida hasta DPR3 en celdas de ~140px)",
    400,
    galeriaNatural,
  );
  await shot(panel, "V05-panel-editor-con-imagen-1280");

  await panel.goto(`${BASE}/admin/tiendas/${storeId}/productos/${pidHeredada}`, {
    waitUntil: "networkidle",
  });
  check(
    "V5 — el editor de 'Papel sanitario x4' (URL del bucket, sin variantes) NO lleva 'Imagen externa' (design.md § 3)",
    0,
    await panel.getByText("Imagen externa").count(),
  );
  check(
    "V5 — pero sí carga: hay un <img>, no 'Sin imagen'",
    0,
    await panel.getByText("Sin imagen").count(),
  );
  await shot(panel, "V05-panel-editor-heredada-1280");
  await panel.close();
} catch (e) {
  fail(`el guion visual se rompió: ${e.message}`);
} finally {
  await browser.close();
  console.log(
    "\n== limpieza: reseed para devolver 'Galletas de sal' y 'Papel sanitario x4' a su imagen sembrada ==",
  );
  try {
    execSync("npm run seed", { stdio: "inherit" });
  } catch {
    fail("la limpieza final (npm run seed) no terminó en 0 — revisa tienda-demo a mano");
  }
}

console.log(`\n${fails} verificaciones visuales fallidas`);
process.exit(fails === 0 ? 0 : 1);
