/**
 * Numbers and keys `src/lib/timezone.ts` and `src/lib/openingHours.ts` would
 * otherwise repeat as magic literals (AGENTS.md § Prohibiciones). R13: the
 * default lives here once and a test cross-checks it against
 * `prisma/schema.prisma` and the `store_timezone` migration so the three
 * cannot drift apart.
 */

/**
 * F-022 R1/R13: `Store.timezone`'s column default, and the value the sync's
 * create path (`src/features/sync/server/handlers/store.ts`) validates
 * against `PUBLISHED` when a brand-new row has not written its own zone yet.
 * A canonical IANA identifier — never a fixed offset.
 */
export const DEFAULT_STORE_TIMEZONE = "America/Havana";

/** `Store.timezone` is `TEXT`; the panel's future editor (F-011) caps it here. */
export const STORE_TIMEZONE_MAX_LENGTH = 64;

/**
 * F-022 § Datos y contrato: the only `openingHours.version` this feature
 * understands. A stored value with a different (or missing) version is
 * rejected by the writer and ignored — never evaluated — by the reader.
 */
export const OPENING_HOURS_VERSION = 1;

/**
 * The seven required keys of `openingHours.days`, in week order. This is the
 * ONE place that order is decided (architecture.md § Contratos internos,
 * punto 4): `readWeeklySchedule` builds its array from this constant, never
 * from the insertion order of the `Json` column's keys, which can start on
 * any day the POS happened to write first.
 */
export const OPENING_HOURS_DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** § Datos y contrato: 0-4 windows per day. */
export const OPENING_HOURS_MAX_WINDOWS_PER_DAY = 4;

/** § Datos y contrato: the serialized JSON size cap, in characters (ASCII, so bytes too). */
export const OPENING_HOURS_MAX_CHARS = 2048;

/** The literal `to` may carry to mean "until the end of the day". Never printed as a clock time (R10). */
export const END_OF_DAY = "24:00";
