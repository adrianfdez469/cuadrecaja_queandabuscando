import { afterEach, describe, expect, it, vi } from "vitest";
import {
  END_OF_DAY,
  OPENING_HOURS_DAY_KEYS,
  OPENING_HOURS_MAX_WINDOWS_PER_DAY,
  OPENING_HOURS_VERSION,
} from "@/constants/storeHours";
import {
  evaluateStoreHours,
  openingHoursSchema,
  parseOpeningHours,
  readWeeklySchedule,
  type DayKey,
  type OpeningWindow,
} from "./openingHours";

const HAVANA = "America/Havana";

/** A calendar with every day closed except the ones named in `overrides`. */
function week(overrides: Partial<Record<DayKey, OpeningWindow[]>> = {}) {
  return {
    version: OPENING_HOURS_VERSION,
    days: Object.fromEntries(OPENING_HOURS_DAY_KEYS.map((day) => [day, overrides[day] ?? []])),
  };
}

describe("openingHoursSchema — the writer (E10/SP3, strict at both levels)", () => {
  it("accepts a calendar with the seven keys, split windows, a midnight crossing and a 24h day", () => {
    const value = week({
      mon: [{ from: "09:00", to: "18:00" }],
      tue: [
        { from: "09:00", to: "13:00" },
        { from: "15:00", to: "18:00" },
      ],
      fri: [{ from: "22:00", to: "02:00" }],
      sat: [{ from: "00:00", to: END_OF_DAY }],
    });
    expect(openingHoursSchema.safeParse(value).success).toBe(true);
  });

  it("caso límite 6: rejects a calendar missing a day key", () => {
    const value = week();
    delete (value.days as Record<string, unknown>).sun;
    expect(openingHoursSchema.safeParse(value).success).toBe(false);
  });

  it("caso límite 6: rejects an unknown day-like key ({lunes: ...})", () => {
    const value = { ...week(), days: { ...week().days, lunes: [] } };
    expect(openingHoursSchema.safeParse(value).success).toBe(false);
  });

  it("§ Datos y contrato: rejects a timezone/tz/offset key riding inside a window", () => {
    const value = week({ mon: [{ from: "09:00", to: "18:00", tz: "America/Havana" } as never] });
    expect(openingHoursSchema.safeParse(value).success).toBe(false);
  });

  it("§ Datos y contrato: rejects a timezone key riding at the root (the zone is Store.timezone, not here)", () => {
    const value = { ...week(), timezone: "America/Havana" };
    expect(openingHoursSchema.safeParse(value).success).toBe(false);
  });

  it("rejects a version other than 1", () => {
    const value = { ...week(), version: 2 };
    expect(openingHoursSchema.safeParse(value).success).toBe(false);
  });

  it("caso límite 4: from == to is rejected as an ambiguous zero-length window", () => {
    const value = week({ mon: [{ from: "09:00", to: "09:00" }] });
    expect(openingHoursSchema.safeParse(value).success).toBe(false);
  });

  it("caso límite 4: 00:00 -> 24:00 is accepted as open-all-day and does not count as crossing", () => {
    const value = week({ mon: [{ from: "00:00", to: END_OF_DAY }] });
    expect(openingHoursSchema.safeParse(value).success).toBe(true);
  });

  it("caso límite 7: rejects windows out of order", () => {
    const value = week({
      mon: [
        { from: "15:00", to: "18:00" },
        { from: "09:00", to: "13:00" },
      ],
    });
    expect(openingHoursSchema.safeParse(value).success).toBe(false);
  });

  it("caso límite 7: rejects overlapping windows", () => {
    const value = week({
      mon: [
        { from: "09:00", to: "14:00" },
        { from: "13:00", to: "18:00" },
      ],
    });
    expect(openingHoursSchema.safeParse(value).success).toBe(false);
  });

  it("caso límite 7: a crossing-midnight window that is NOT the last one is rejected", () => {
    const value = week({
      mon: [
        { from: "22:00", to: "02:00" },
        { from: "10:00", to: "12:00" },
      ],
    });
    expect(openingHoursSchema.safeParse(value).success).toBe(false);
  });

  it("caso límite 7: a crossing-midnight window that IS the last one is accepted", () => {
    const value = week({
      mon: [
        { from: "10:00", to: "12:00" },
        { from: "22:00", to: "02:00" },
      ],
    });
    expect(openingHoursSchema.safeParse(value).success).toBe(true);
  });

  it("rejects more than OPENING_HOURS_MAX_WINDOWS_PER_DAY windows in one day", () => {
    const windows: OpeningWindow[] = Array.from(
      { length: OPENING_HOURS_MAX_WINDOWS_PER_DAY + 1 },
      (_, i) => ({ from: `0${i}:00`, to: `0${i}:30` }),
    );
    const value = week({ mon: windows });
    expect(openingHoursSchema.safeParse(value).success).toBe(false);
  });

  it("rejects malformed HH:MM strings (not zero-padded, out of range, 24:01)", () => {
    for (const bad of ["9:00", "25:00", "12:60", "24:01", "12:5", ""]) {
      const value = week({ mon: [{ from: bad, to: "18:00" }] });
      expect(openingHoursSchema.safeParse(value).success, `from=${bad}`).toBe(false);
    }
  });

  it("caso límite 6: [] for all seven days is valid — it means 'never opens'", () => {
    expect(openingHoursSchema.safeParse(week()).success).toBe(true);
  });
});

describe("parseOpeningHours() — the reader (R9, E12: tolerant, never throws, never console.error)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null for null/undefined WITHOUT warning (E8: today's normal state)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseOpeningHours(null)).toBeNull();
    expect(parseOpeningHours(undefined)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns the parsed value for a well-formed calendar", () => {
    const value = week({ mon: [{ from: "09:00", to: "18:00" }] });
    expect(parseOpeningHours(value)).toEqual(value);
  });

  it("returns null and logs ONE console.warn (never console.error) for unreadable data", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(parseOpeningHours({ garbage: true })).toBeNull();

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/^\[hours\]/);
    expect(error).not.toHaveBeenCalled();
  });

  it("an unknown version is unreadable, not evaluated (R9)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseOpeningHours({ ...week(), version: 2 })).toBeNull();
  });
});

describe("readWeeklySchedule() — what the page receives (architecture.md § Contratos internos, punto 4)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when there is nothing to read (E8/E12)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readWeeklySchedule(null)).toBeNull();
    expect(readWeeklySchedule({ garbage: true })).toBeNull();
  });

  it("always returns the seven days in mon->sun order, regardless of the object's own key order", () => {
    // Simulates what a JSON round-trip can produce: the POS's insertion
    // order can start on any day.
    const outOfOrder = {
      version: OPENING_HOURS_VERSION,
      days: {
        sun: [],
        sat: [{ from: "00:00", to: END_OF_DAY }],
        fri: [],
        thu: [],
        wed: [],
        tue: [],
        mon: [{ from: "09:00", to: "18:00" }],
      },
    };
    const result = readWeeklySchedule(outOfOrder);
    expect(result?.map((d) => d.day)).toEqual([...OPENING_HOURS_DAY_KEYS]);
    expect(result?.[0]).toEqual({ day: "mon", windows: [{ from: "09:00", to: "18:00" }] });
    expect(result?.[5]).toEqual({ day: "sat", windows: [{ from: "00:00", to: END_OF_DAY }] });
  });
});

// --- evaluateStoreHours (criterio 2, E1-E2, E6-E7) --------------------------

type Row = {
  label: string;
  instant: string;
  calendar: ReturnType<typeof week>;
  expect: (status: ReturnType<typeof evaluateStoreHours>) => void;
};

/** The exact eight rows of spec.md AC2, each measured against this runtime. */
const AC2_TABLE: Row[] = [
  {
    label: "wed 10:00 Habana, wed 09:00->18:00 => open, closes 18:00",
    instant: "2026-09-02T14:00:00Z",
    calendar: week({ wed: [{ from: "09:00", to: "18:00" }] }),
    expect: (s) => expect(s).toEqual({ state: "open", closesAt: "18:00", closesNextDay: false }),
  },
  {
    label: "wed 00:30 Habana, wed 09:00->18:00 => closed, opens today 09:00",
    instant: "2026-09-02T04:30:00Z",
    calendar: week({ wed: [{ from: "09:00", to: "18:00" }] }),
    expect: (s) =>
      expect(s).toEqual({
        state: "closed",
        next: { at: "09:00", day: "wed", inDays: 0 },
      }),
  },
  {
    label: "wed 00:30 Habana, tue 22:00->02:00 => open (yesterday's crossing window)",
    instant: "2026-09-02T04:30:00Z",
    calendar: week({ tue: [{ from: "22:00", to: "02:00" }] }),
    expect: (s) => expect(s).toEqual({ state: "open", closesAt: "02:00", closesNextDay: false }),
  },
  {
    label: "wed 00:30 Habana, wed 22:00->02:00 (same window, wrong day) => closed",
    instant: "2026-09-02T04:30:00Z",
    calendar: week({ wed: [{ from: "22:00", to: "02:00" }] }),
    expect: (s) => expect(s.state).toBe("closed"),
  },
  {
    label: "DST fall-back, first 00:30 (GMT-4): sat 22:00->02:00 => open",
    instant: "2026-11-01T04:30:00Z",
    calendar: week({ sat: [{ from: "22:00", to: "02:00" }] }),
    expect: (s) => expect(s).toEqual({ state: "open", closesAt: "02:00", closesNextDay: false }),
  },
  {
    label: "DST fall-back, second 00:30 (GMT-5): sat 22:00->02:00 => open, same response",
    instant: "2026-11-01T05:30:00Z",
    calendar: week({ sat: [{ from: "22:00", to: "02:00" }] }),
    expect: (s) => expect(s).toEqual({ state: "open", closesAt: "02:00", closesNextDay: false }),
  },
  {
    label: "DST spring-forward eve, sat 23:59: sat 22:00->02:00 => open, still today's window",
    instant: "2026-03-08T04:59:00Z",
    calendar: week({ sat: [{ from: "22:00", to: "02:00" }] }),
    expect: (s) => expect(s).toEqual({ state: "open", closesAt: "02:00", closesNextDay: true }),
  },
  {
    label: "DST spring-forward day, sun 01:01: sat 22:00->02:00 => open, yesterday's crossing",
    instant: "2026-03-08T05:01:00Z",
    calendar: week({ sat: [{ from: "22:00", to: "02:00" }] }),
    expect: (s) => expect(s).toEqual({ state: "open", closesAt: "02:00", closesNextDay: false }),
  },
];

/** The two explicit clock-side times the plan calls out for the midnight
 *  crossing (22:00->02:00): 23:00 (today's forward branch) and 01:00
 *  (yesterday's carried-over branch), on top of the 00:30 case AC2/E6 above. */
const CROSSING_TABLE: Row[] = [
  {
    label: "tue 23:00 Habana, tue 22:00->02:00 => open, closes tomorrow at 02:00",
    instant: "2026-09-02T03:00:00Z",
    calendar: week({ tue: [{ from: "22:00", to: "02:00" }] }),
    expect: (s) => expect(s).toEqual({ state: "open", closesAt: "02:00", closesNextDay: true }),
  },
  {
    label: "wed 01:00 Habana, tue 22:00->02:00 => open, closes today at 02:00",
    instant: "2026-09-02T05:00:00Z",
    calendar: week({ tue: [{ from: "22:00", to: "02:00" }] }),
    expect: (s) => expect(s).toEqual({ state: "open", closesAt: "02:00", closesNextDay: false }),
  },
];

/**
 * Criterio 2 literal: "con el reloj del proceso en otro huso (TZ=UTC), el
 * cálculo de abierto/cerrado coincide con la hora local de la tienda". Three
 * zones, at least: UTC, a store zone (America/Havana, exercised inside every
 * row's own `timezone` field) and a third, far one — measured by
 * sdd-architect to mutate safely in Node 24.13.1 (process.env.TZ affects
 * Date/Intl within the same process).
 */
const PROCESS_TZ_VALUES = ["UTC", "Pacific/Kiritimati", "America/Los_Angeles"];

describe("evaluateStoreHours() — criterio 2: same result regardless of the PROCESS clock's own TZ", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  for (const processTz of PROCESS_TZ_VALUES) {
    describe(`process.env.TZ = ${processTz}`, () => {
      it("matches every row of the AC2 table", () => {
        process.env.TZ = processTz;
        for (const row of AC2_TABLE) {
          const status = evaluateStoreHours({
            hours: row.calendar,
            timezone: HAVANA,
            now: new Date(row.instant),
          });
          row.expect(status);
        }
      });

      it("matches the two explicit midnight-crossing clock times (23:00 and 01:00)", () => {
        process.env.TZ = processTz;
        for (const row of CROSSING_TABLE) {
          const status = evaluateStoreHours({
            hours: row.calendar,
            timezone: HAVANA,
            now: new Date(row.instant),
          });
          row.expect(status);
        }
      });
    });
  }

  it("every row's result is byte-for-byte IDENTICAL across the three process TZ values", () => {
    const allRows = [...AC2_TABLE, ...CROSSING_TABLE];
    const resultsByTz = PROCESS_TZ_VALUES.map((tz) => {
      process.env.TZ = tz;
      return allRows.map((row) =>
        JSON.stringify(
          evaluateStoreHours({ hours: row.calendar, timezone: HAVANA, now: new Date(row.instant) }),
        ),
      );
    });
    expect(resultsByTz[1]).toEqual(resultsByTz[0]);
    expect(resultsByTz[2]).toEqual(resultsByTz[0]);
  });
});

describe("evaluateStoreHours() — unknown state (E8, E12)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("no hours at all", () => {
    expect(
      evaluateStoreHours({ hours: null, timezone: HAVANA, now: new Date("2026-09-02T14:00:00Z") }),
    ).toEqual({ state: "unknown" });
  });

  it("unreadable hours", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      evaluateStoreHours({
        hours: { garbage: true },
        timezone: HAVANA,
        now: new Date("2026-09-02T14:00:00Z"),
      }),
    ).toEqual({ state: "unknown" });
  });

  it("null timezone", () => {
    expect(
      evaluateStoreHours({
        hours: week({ mon: [{ from: "09:00", to: "18:00" }] }),
        timezone: null,
        now: new Date("2026-09-02T14:00:00Z"),
      }),
    ).toEqual({ state: "unknown" });
  });

  it("a timezone this runtime cannot interpret warns and returns unknown, never throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const status = evaluateStoreHours({
      hours: week({ mon: [{ from: "09:00", to: "18:00" }] }),
      timezone: "Nowhere/Nothing",
      now: new Date("2026-09-02T14:00:00Z"),
    });
    expect(status).toEqual({ state: "unknown" });
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("evaluateStoreHours() — closed with no next opening (caso límite 6: all seven days [])", () => {
  it("returns closed with next: null when the calendar never opens", () => {
    expect(
      evaluateStoreHours({
        hours: week(),
        timezone: HAVANA,
        now: new Date("2026-09-02T14:00:00Z"),
      }),
    ).toEqual({ state: "closed", next: null });
  });
});
