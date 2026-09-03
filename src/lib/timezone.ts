import { z } from "zod";
import { STORE_TIMEZONE_MAX_LENGTH } from "@/constants/storeHours";

/**
 * F-022 R1. `Store.timezone` is a canonical IANA identifier, never a fixed
 * offset — Cuba shifts twice a year, so a fixed offset like `-04:00` would
 * be wrong for half of it. Pure, no Prisma, no React (AGENTS.md § Arquitectura).
 *
 * Measured against this runtime (Node 24.13.1, ICU 78.2):
 * `Intl.DateTimeFormat` ACCEPTS `+05:00`, `+0500`, `Cuba`, `EST5EDT`, `UTC`,
 * `GMT`, `Etc/GMT+5` and `america/havana` (resolving some to `America/Havana`
 * and others to a fixed offset), and only throws on garbage like
 * `Nope/Nada`. So "does not throw" is NOT R1 — the check that does the work
 * is step 2 below.
 */
const IANA_SHAPE = /^[A-Za-z][A-Za-z_]*(?:\/[A-Za-z0-9_+-]+){1,2}$/;

/** The zones this runtime knows, frozen once at module load. Measured: 418
 *  entries, includes `America/Havana` (caso límite 1). */
export const SUPPORTED_TIME_ZONES: ReadonlySet<string> = new Set(
  Intl.supportedValuesOf("timeZone"),
);

/**
 * R1 in its three steps, in this order, and NOTHING is normalized first:
 *   1. shape — eliminates `-04:00`, `+0500` and the empty string;
 *   2. membership in `SUPPORTED_TIME_ZONES`, CASE-SENSITIVE — eliminates
 *      `Cuba`, `EST5EDT`, `UTC`, `GMT`, `Etc/GMT+5` and `america/havana`;
 *   3. usability — `new Intl.DateTimeFormat` must not throw, which turns a
 *      trimmed-down ICU into a `false` instead of an exception mid-`UPDATE`.
 *
 * NO `toLowerCase()` and NO `trim()` before the membership check: normalizing
 * the casing would turn `america/havana` into an accepted value, which is
 * exactly what R1 forbids. An IANA identifier has one canonical spelling and
 * that is the one that gets stored; anything else is corrected at the source.
 *
 * This IS the `PUBLISHED` gate (R12) — there is no second name for the same
 * check, and it is the identifier `src/lib/boundaries.test.ts` greps for.
 */
export function isCanonicalTimeZone(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length > STORE_TIMEZONE_MAX_LENGTH) return false;
  if (!IANA_SHAPE.test(value)) return false;
  if (!SUPPORTED_TIME_ZONES.has(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** For F-011's future editor (AC9) and any panel body that carries a zone. */
export const canonicalTimeZoneSchema: z.ZodType<string> = z
  .string()
  .refine(isCanonicalTimeZone, { message: "not a canonical IANA time zone" });
