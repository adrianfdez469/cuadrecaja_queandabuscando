import { z } from "zod";
import {
  END_OF_DAY,
  OPENING_HOURS_DAY_KEYS,
  OPENING_HOURS_MAX_CHARS,
  OPENING_HOURS_MAX_WINDOWS_PER_DAY,
  OPENING_HOURS_VERSION,
} from "@/constants/storeHours";

/**
 * F-022 § Datos y contrato: the calendar a `Store` publishes, plus the
 * (currently unconsumed — see `evaluateStoreHours` below) evaluator of
 * open/closed. Pure, no Prisma, no React (AGENTS.md § Arquitectura). ONE
 * schema, TWO modes (R9): the writer (the sync handler) treats a failed
 * `safeParse` as a reason to reject the whole event; the reader
 * (`parseOpeningHours`, and everything built on it) treats it as "nothing to
 * show", never as a crash.
 */

export type DayKey = (typeof OPENING_HOURS_DAY_KEYS)[number];
export type OpeningWindow = { from: string; to: string };
export type OpeningHours = { version: 1; days: Record<DayKey, OpeningWindow[]> };

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const timeSchema = z.string().regex(TIME_PATTERN);
const closingTimeSchema = z.union([timeSchema, z.literal(END_OF_DAY)]);

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/** `"24:00"` normalizes to 1440 minutes ONLY inside this module's own
 *  comparisons — it is never rewritten back into the stored column or shown
 *  as a clock time (R10). */
function closingMinutes(value: string): number {
  return value === END_OF_DAY ? 1440 : toMinutes(value);
}

const openingWindowSchema = z
  .object({ from: timeSchema, to: closingTimeSchema })
  .strict()
  .refine((window) => toMinutes(window.from) !== closingMinutes(window.to), {
    message: "a window's from and to cannot be equal — zero length is ambiguous",
    path: ["to"],
  });

/**
 * § Datos y contrato, caso límite 4 y 7: 0-4 windows, strictly ordered by
 * `from` without overlapping, and at most one crossing-midnight window
 * (`to < from`) — which, if present, MUST be the last one.
 */
const dayWindowsSchema = z
  .array(openingWindowSchema)
  .max(OPENING_HOURS_MAX_WINDOWS_PER_DAY)
  .superRefine((windows, ctx) => {
    windows.forEach((window, index) => {
      const isLast = index === windows.length - 1;
      const fromMinutes = toMinutes(window.from);
      const toMinutesValue = closingMinutes(window.to);
      // Only the LAST window of the day may cross midnight (to <= from); any
      // other window that does is a validation error, not silently allowed.
      if (!isLast && toMinutesValue <= fromMinutes) {
        ctx.addIssue({
          code: "custom",
          message: "only the last window of a day may cross midnight",
          path: [index, "to"],
        });
      }
      if (index > 0) {
        const previous = windows[index - 1];
        const previousToMinutes = closingMinutes(previous.to);
        if (fromMinutes < previousToMinutes) {
          ctx.addIssue({
            code: "custom",
            message: "windows of a day must be strictly ordered by from, without overlapping",
            path: [index, "from"],
          });
        }
      }
    });
  });

const daysSchema = z
  .object(
    Object.fromEntries(OPENING_HOURS_DAY_KEYS.map((day) => [day, dayWindowsSchema])) as Record<
      DayKey,
      typeof dayWindowsSchema
    >,
  )
  .strict();

/**
 * ESTRICTO (`.strict()` at both levels): the writer's schema. E10/SP3: a
 * value that fails this is rejected whole by `assertOpeningHoursValid`
 * (`src/features/sync/server/handlers/store.ts`) — never partially applied.
 */
export const openingHoursSchema: z.ZodType<OpeningHours> = z
  .object({ version: z.literal(OPENING_HOURS_VERSION), days: daysSchema })
  .strict()
  .refine((value) => JSON.stringify(value).length <= OPENING_HOURS_MAX_CHARS, {
    message: `serialized openingHours must be at most ${OPENING_HOURS_MAX_CHARS} characters`,
  });

/**
 * TOLERANTE (R9, E12): `safeParse` of the SAME schema. `null` when the value
 * does not comply — an old shape, an unknown `version`, hand-written
 * garbage — leaving ONE `console.warn("[hours] ...")` with the reason, never
 * the whole JSON and never `console.error` (AGENTS.md § Cosas que muerden).
 * `value == null` returns `null` WITHOUT warning: that is today's normal
 * state (E8) — every row has `openingHours IS NULL`.
 */
export function parseOpeningHours(value: unknown): OpeningHours | null {
  if (value == null) return null;
  const result = openingHoursSchema.safeParse(value);
  if (!result.success) {
    console.warn(
      `[hours] unreadable openingHours: ${result.error.issues[0]?.message ?? "invalid shape"}`,
    );
    return null;
  }
  return result.data;
}

/**
 * What the page passes to the cartel (architecture.md § Contratos internos,
 * punto 4). Tolerant: `null` when there is no horario or it cannot be read,
 * and then NOTHING is painted (E8, E12). When it returns a value, it is
 * ALWAYS seven entries in `mon → sun` order, taken from
 * `OPENING_HOURS_DAY_KEYS` — never the insertion order of the `Json`
 * column's own keys, which is the POS's and can start on any day.
 */
export type WeeklyScheduleDay = { day: DayKey; windows: OpeningWindow[] };

export function readWeeklySchedule(value: unknown): WeeklyScheduleDay[] | null {
  const parsed = parseOpeningHours(value);
  if (parsed === null) return null;
  return OPENING_HOURS_DAY_KEYS.map((day) => ({ day, windows: parsed.days[day] }));
}

/**
 * R6: pure. Never calls `Date.now()` — the instant enters by parameter.
 * `hours` and `timezone` enter RAW, exactly as the row carries them: this is
 * the only function that knows how to interpret them, and no view re-does
 * the calculation.
 *
 * IMPORTANT (§ Alcance, punto 4; R14; A5 de design.md): with `AP1` = (b) this
 * function has NO production caller this cycle. It is built and tested
 * because criterio 2 demands it word for word, and F-011 is its consumer.
 * Nothing under `src/app/` or `src/components/` may import it — that guard
 * lives in `src/lib/boundaries.test.ts`, not here.
 */
export type StoreHoursStatus =
  | { state: "unknown" }
  | { state: "open"; closesAt: string; closesNextDay: boolean }
  | { state: "closed"; next: { at: string; day: DayKey; inDays: number } | null };

/** `Intl.DateTimeFormat` costs 23,4 µs per construction vs. 0,9 µs reused
 *  (26×, measured) — cached by zone, bounded by the 418 possible values. */
const wallTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function wallTimeFormatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = wallTimeFormatterCache.get(timeZone);
  if (!formatter) {
    // R2: the ONLY source of the store's local time is `formatToParts` with
    // `timeZone` set — never `getHours()`/`getDay()`/a hand-rolled offset.
    // `hourCycle: "h23"`, never `hour12: false`: depending on the ICU
    // version the latter can format midnight as `"24:00"` instead of
    // `"00:00"`. The locale is fixed to `"en-US"` so the weekday string is
    // stable regardless of the runtime's own locale.
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    wallTimeFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

const WEEKDAY_SHORT_TO_DAY_KEY: Record<string, DayKey> = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
};

type WallTime = { day: DayKey; minutes: number };

function wallTimeAt(timeZone: string, instant: Date): WallTime | null {
  const parts = wallTimeFormatterFor(timeZone).formatToParts(instant);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  const day = weekday ? WEEKDAY_SHORT_TO_DAY_KEY[weekday] : undefined;
  if (!day || hour === undefined || minute === undefined) return null;
  return { day, minutes: Number(hour) * 60 + Number(minute) };
}

export function evaluateStoreHours(input: {
  hours: unknown;
  timezone: string | null;
  now: Date;
}): StoreHoursStatus {
  const schedule = parseOpeningHours(input.hours);
  if (schedule === null || input.timezone === null) return { state: "unknown" };

  let wallTime: WallTime | null;
  try {
    wallTime = wallTimeAt(input.timezone, input.now);
  } catch {
    console.warn(`[hours] unknown time zone: ${input.timezone}`);
    return { state: "unknown" };
  }
  if (wallTime === null) return { state: "unknown" };

  const todayIndex = OPENING_HOURS_DAY_KEYS.indexOf(wallTime.day);

  // Step 2/3: today's own windows, both the ones that do not cross midnight
  // and the (at most one, and last) one that does.
  for (const window of schedule.days[wallTime.day]) {
    const fromMinutes = toMinutes(window.from);
    const toMinutesValue = closingMinutes(window.to);
    const crosses = toMinutesValue <= fromMinutes;
    if (!crosses) {
      if (wallTime.minutes >= fromMinutes && wallTime.minutes < toMinutesValue) {
        return { state: "open", closesAt: window.to, closesNextDay: false };
      }
    } else if (wallTime.minutes >= fromMinutes) {
      return { state: "open", closesAt: window.to, closesNextDay: true };
    }
  }

  // Step 4: yesterday's LAST window, if it crosses into today (E6).
  const yesterdayKey = OPENING_HOURS_DAY_KEYS[(todayIndex + 6) % 7];
  const yesterdayWindows = schedule.days[yesterdayKey];
  const lastYesterdayWindow = yesterdayWindows[yesterdayWindows.length - 1];
  if (lastYesterdayWindow) {
    const fromMinutes = toMinutes(lastYesterdayWindow.from);
    const toMinutesValue = closingMinutes(lastYesterdayWindow.to);
    if (toMinutesValue <= fromMinutes && wallTime.minutes < toMinutesValue) {
      return { state: "open", closesAt: lastYesterdayWindow.to, closesNextDay: false };
    }
  }

  // Step 5: the next opening, up to 7 days ahead. `inDays` 0 is later today,
  // 7 is the same weekday next week — never further than that.
  for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
    const dayKey = OPENING_HOURS_DAY_KEYS[(todayIndex + daysAhead) % 7];
    for (const window of schedule.days[dayKey]) {
      const fromMinutes = toMinutes(window.from);
      if (daysAhead > 0 || fromMinutes > wallTime.minutes) {
        return { state: "closed", next: { at: window.from, day: dayKey, inDays: daysAhead } };
      }
    }
  }

  return { state: "closed", next: null };
}
