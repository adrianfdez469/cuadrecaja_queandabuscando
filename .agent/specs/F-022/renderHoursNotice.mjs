// Companion of visual.mjs, V14. Renders the REAL `StoreHoursNotice`
// component (unmodified — the same file the app imports) against synthetic
// calendars, offline, with `react-dom/server`. Run with `npx tsx` (plain
// `node` cannot load a `.tsx` import) — never with plain `node`, and never
// imported by visual.mjs itself, which runs under plain `node` per
// `.agent/verify.sh::correr_visual`.
//
// Why not drive this through the browser like the rest of the file: the
// three cases and the five clock edges do not depend on any store, any
// theme or any instant (design.md:853-856 says so explicitly — "como nada
// depende del instante, los tres casos y los cinco bordes se provocan
// cambiando el calendario sembrado"). Changing a SEEDED store's calendar to
// exercise eight throwaway shapes would mean either mutating `tienda-demo`
// (used by V1-V12 and by other worktrees' own dev sessions against the same
// shared Postgres) or minting/rotating a sync token for a shared `Business`
// row — exactly the trap `.agent/playbook/mint-token-rota-el-token-en-bd-compartida.md`
// describes. `StoreHoursNotice`'s only prop is `{ schedule }` (architecture.md
// § Componentes): it never reads a store, a theme or an instant, so
// rendering it directly is not a shortcut — it is the same code, isolated
// from what it does not need, and DB-free.
import { renderToStaticMarkup } from "react-dom/server";
import { StoreHoursNotice } from "@/components/store/StoreHoursNotice";
import { OPENING_HOURS_DAY_KEYS, OPENING_HOURS_VERSION } from "@/constants/storeHours";
import { readWeeklySchedule } from "@/lib/openingHours";

let fails = 0;
function check(que, esperado, obtenido) {
  if (esperado === obtenido) {
    console.log(`  ok   ${que}`);
  } else {
    console.log(
      `VISUAL FAIL ${que} — esperaba ${JSON.stringify(esperado)}, obtuve ${JSON.stringify(obtenido)}`,
    );
    fails++;
  }
}
function checkIncludes(que, html, texto) {
  check(`${que} (contiene "${texto}")`, true, html.includes(texto));
}

function emptyWeek() {
  return Object.fromEntries(OPENING_HOURS_DAY_KEYS.map((d) => [d, []]));
}

function render(days) {
  const schedule = readWeeklySchedule({ version: OPENING_HOURS_VERSION, days });
  return renderToStaticMarkup(StoreHoursNotice({ schedule }));
}

// --- Los tres casos de design.md § La presentación de la semana, con el
// texto LITERAL de sus bloques de código. ----------------------------------

// Caso 1 — un solo tramo, P1.
{
  const days = emptyWeek();
  for (const d of OPENING_HOURS_DAY_KEYS) days[d] = [{ from: "09:00", to: "18:00" }];
  const html = render(days);
  checkIncludes("V14 caso 1", html, "Horario:");
  checkIncludes("V14 caso 1", html, "todos los días de 9:00 a.m. a 6:00 p.m.");
}

// Caso 2 — el caso típico, tres tramos, P2.
{
  const days = emptyWeek();
  for (const d of ["mon", "tue", "wed", "thu", "fri"]) days[d] = [{ from: "09:00", to: "18:00" }];
  days.sat = [{ from: "09:00", to: "13:00" }];
  days.sun = [];
  const html = render(days);
  checkIncludes("V14 caso 2", html, "Horario de atención");
  checkIncludes("V14 caso 2 (Lunes a viernes)", html, "Lunes a viernes");
  checkIncludes("V14 caso 2 (de 9:00 a.m. a 6:00 p.m.)", html, "de 9:00 a.m. a 6:00 p.m.");
  checkIncludes("V14 caso 2 (Sábado)", html, "Sábado");
  checkIncludes("V14 caso 2 (de 9:00 a.m. a 1:00 p.m.)", html, "de 9:00 a.m. a 1:00 p.m.");
  checkIncludes("V14 caso 2 (Domingo)", html, "Domingo");
  checkIncludes("V14 caso 2 (no abre)", html, "no abre");
}

// Caso 3 — el peor caso, siete tramos, el mismo calendario sembrado en
// tienda-demo (`prisma/seed.ts::DEMO_OPENING_HOURS`) y ya visto en vivo por
// V1/V5/V9/V10. Repetido aquí, offline, contra el texto literal exacto del
// bloque de código de design.md.
{
  const days = {
    mon: [{ from: "09:00", to: "18:00" }],
    tue: [
      { from: "09:00", to: "13:00" },
      { from: "15:00", to: "18:00" },
    ],
    wed: [],
    thu: [{ from: "09:00", to: "18:00" }],
    fri: [{ from: "22:00", to: "02:00" }],
    sat: [{ from: "00:00", to: "24:00" }],
    sun: [],
  };
  const html = render(days);
  const literal = [
    "Lunes",
    "de 9:00 a.m. a 6:00 p.m.",
    "Martes",
    "de 9:00 a.m. a 1:00 p.m. y de 3:00 p.m. a 6:00 p.m.",
    "Miércoles",
    "no abre",
    "Jueves",
    "Viernes",
    "de 10:00 p.m. a 2:00 a.m. del día siguiente",
    "Sábado",
    "abierto las 24 horas",
    "Domingo",
  ];
  for (const texto of literal) checkIncludes("V14 caso 3", html, texto);
}

// --- Los cinco bordes del reloj de 12 horas (design.md § Las reglas de
// redacción), cada uno aislado en su propia ventana mínima. -----------------

function conVentana(from, to) {
  const days = emptyWeek();
  days.mon = [{ from, to }];
  return render(days);
}

checkIncludes('V14 borde "00:00" → "12:00 a.m."', conVentana("00:00", "01:00"), "12:00 a.m.");
checkIncludes('V14 borde "12:00" → "12:00 p.m."', conVentana("12:00", "13:00"), "12:00 p.m.");
checkIncludes('V14 borde "12:30" → "12:30 p.m."', conVentana("12:30", "13:30"), "12:30 p.m.");
checkIncludes('V14 borde "00:30" → "12:30 a.m."', conVentana("00:30", "01:30"), "12:30 a.m.");
checkIncludes(
  'V14 borde "24:00" → "medianoche" (nunca como hora)',
  conVentana("22:00", "24:00"),
  "de 10:00 p.m. a medianoche",
);
checkIncludes(
  "V14 el cruce de medianoche se dice con todas las letras",
  conVentana("22:00", "02:00"),
  "del día siguiente",
);

// Y las dos formas fijas que no dependen de ningún borde concreto.
checkIncludes("V14 abierto las 24 horas", conVentana("00:00", "24:00"), "abierto las 24 horas");
{
  const html = render(emptyWeek());
  checkIncludes(
    "V14 los siete días vacíos (P3)",
    html,
    "Esta tienda no tiene ningún día de apertura en su horario.",
  );
}

console.log(`\n${fails} aserciones fallidas (V14)`);
process.exit(fails === 0 ? 0 : 1);
