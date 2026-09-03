import { END_OF_DAY } from "@/constants/storeHours";
import type { DayKey, OpeningWindow, WeeklyScheduleDay } from "@/lib/openingHours";

/**
 * F-022. The horario publicado de la semana, painted into the ALREADY
 * cached HTML of `/[slug]` — server component, no state, no events, no
 * `"use client"` (AGENTS.md § Prohibiciones: nothing that renders catalog
 * may ship client JavaScript). Its only prop is the seven-day array
 * `readWeeklySchedule` already produced (architecture.md § Contratos
 * internos, punto 4): this component never reads `hours.days` itself, and
 * it never receives — and could not use — the current instant (R14, A5 de
 * design.md).
 *
 * Text and layout are `sdd-designer`'s (design.md § Textos, § La
 * presentación de la semana): 12-hour clock with `a.m.`/`p.m.` (DP1, R10),
 * days grouped only when CONSECUTIVE, and never a word that depends on
 * "now" (no "hoy", no "Abierta"/"Cerrada ahora" — R11).
 */

const DAY_LABELS: Record<DayKey, string> = {
  mon: "Lunes",
  tue: "Martes",
  wed: "Miércoles",
  thu: "Jueves",
  fri: "Viernes",
  sat: "Sábado",
  sun: "Domingo",
};

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * DP1/R10: arithmetic over the DECLARED STRING, never `Intl`. A `from`/`to`
 * is not an instant — it has no date and no zone — so formatting it through
 * `Intl` would mean inventing a day and a zone just to get the same string
 * back (architecture.md § Contratos internos, punto 4). The five edges that
 * a naive division by 12 gets wrong, spelled out because all five do:
 * `"00:00"` → `12:00 a.m.`, `"12:00"` → `12:00 p.m.`, `"12:30"` → `12:30 p.m.`,
 * `"00:30"` → `12:30 a.m.`, and `"24:00"` is never a clock time — it never
 * reaches this function (`formatWindow` intercepts it first).
 */
function formatClockTime(value: string): string {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const period = hour < 12 ? "a.m." : "p.m.";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minuteText} ${period}`;
}

/**
 * The most delicate wording call (design.md § Las reglas de redacción): the
 * window arrives in the day it OPENS (`fri: 22:00 → 02:00`), which is
 * correct in the data and confusing on screen on its own — the
 * `del día siguiente` suffix says with words what the raw hours cannot.
 * It never depends on the instant: it is a property of the window, so it
 * can be cached with the rest of the block.
 */
function formatWindow(window: OpeningWindow): string {
  if (window.from === "00:00" && window.to === END_OF_DAY) {
    return "abierto las 24 horas";
  }
  if (window.to === END_OF_DAY) {
    return `de ${formatClockTime(window.from)} a medianoche`;
  }
  const crossesMidnight = toMinutes(window.to) < toMinutes(window.from);
  return `de ${formatClockTime(window.from)} a ${formatClockTime(window.to)}${crossesMidnight ? " del día siguiente" : ""}`;
}

function formatDayValue(windows: readonly OpeningWindow[]): string {
  if (windows.length === 0) return "no abre";
  return windows.map(formatWindow).join(" y ");
}

type Segment = { days: DayKey[]; value: string };

/**
 * design.md § Cómo se compacta: only CONSECUTIVE days sharing the same value
 * group into one segment — joining "Monday, Wednesday and Friday" would make
 * the reader rebuild the week in their head, and only "consecutive" means
 * anything because `schedule` always arrives in week order (A3 de
 * design.md; `readWeeklySchedule` is what guarantees that order).
 */
function compactSchedule(schedule: readonly WeeklyScheduleDay[]): Segment[] {
  const segments: Segment[] = [];
  for (const { day, windows } of schedule) {
    const value = formatDayValue(windows);
    const last = segments[segments.length - 1];
    if (last && last.value === value) {
      last.days.push(day);
    } else {
      segments.push({ days: [day], value });
    }
  }
  return segments;
}

function segmentLabel(days: readonly DayKey[]): string {
  if (days.length === 1) return DAY_LABELS[days[0]];
  if (days.length === 2) return `${DAY_LABELS[days[0]]} y ${DAY_LABELS[days[1]].toLowerCase()}`;
  return `${DAY_LABELS[days[0]]} a ${DAY_LABELS[days[days.length - 1]].toLowerCase()}`;
}

export type StoreHoursNoticeProps = { schedule: readonly WeeklyScheduleDay[] };

export function StoreHoursNotice({ schedule }: StoreHoursNoticeProps) {
  const segments = compactSchedule(schedule);

  // P3: the seven days are all "no abre" — a valid calendar meaning "never
  // opens" (caso límite 6), painted as a standalone sentence, never as a
  // labelled empty list.
  if (segments.length === 1 && segments[0].value === "no abre") {
    return (
      <p className="text-fg-muted mb-4 text-sm">
        Esta tienda no tiene ningún día de apertura en su horario.
      </p>
    );
  }

  // P1: one segment spanning all seven days collapses into a single line.
  if (segments.length === 1) {
    return (
      <p className="mb-4 text-sm">
        <span className="font-medium">Horario:</span> todos los días {segments[0].value}
      </p>
    );
  }

  // P2: two to seven segments, each a row of a definition list.
  return (
    <section aria-labelledby="horario" className="mb-4 text-sm">
      <p id="horario" className="font-medium">
        Horario de atención
      </p>
      <dl className="mt-1 sm:grid sm:grid-cols-[8rem_1fr] sm:gap-x-3">
        {segments.map((segment) => (
          <div key={segment.days[0]} className="flex flex-wrap items-baseline gap-x-2 sm:contents">
            <dt className="font-medium">{segmentLabel(segment.days)}</dt>
            <dd className="text-fg-muted">{segment.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
