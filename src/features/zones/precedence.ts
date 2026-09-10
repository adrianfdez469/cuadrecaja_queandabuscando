import type { ZoneLevel, ZoneTariffRule } from "@/generated/prisma/enums";
import { toDecimalString, type MoneyInput } from "@/lib/money";

/**
 * The precedence rule (F-041 R26-R28): municipality → its province → not
 * served. Pure — no catalog, no Prisma, no React — so F-042's client
 * selector can import it too (architecture.md § Contratos 3).
 */

/** What the resolution needs to know about the zone being consulted:
 *  DECLARED, never deduced from the code's shape (R3). In the vector it
 *  travels in the fixture; in production the index (`catalog.ts`) supplies
 *  it, never a query. */
export type ZoneRef = { code: string; level: ZoneLevel; provinceCode: string | null };

/** A tariff row, in the payload's shape (the amount as a number) or the
 *  base's (a Decimal) — `MoneyInput` accepts both without the caller
 *  converting anything. */
export type TariffRow = {
  zoneCode: string;
  rule: ZoneTariffRule;
  deliveryFee?: MoneyInput | null;
};

export type PathVerdict =
  "FEE" | "FEE_WITHOUT_AMOUNT" | "FEE_NEGATIVE" | "NOT_SERVED" | "INHERIT" | "ABSENT";

/** One escalón CONSULTED. One that was never consulted does not appear (R28). */
export type PathStep = { code: string; level: ZoneLevel; verdict: PathVerdict; decides: boolean };

export type ZoneTariffResolution = {
  served: boolean;
  /** Two-decimal string produced by `toDecimalString` — never a floating
   *  point number, never `String(300)`. */
  deliveryFee: string | null;
  /** The `code` of the row that decided, or `null` when NOTHING decided —
   *  the distinction between "there is a row that says I don't serve" and
   *  "there is nothing at any level" (R28, E13). */
  decidedBy: string | null;
  path: readonly PathStep[];
};

/** R27(1): a `FEE` row with no amount (`null`/`undefined`) does not decide. */
function verdictOf(row: TariffRow | undefined): { verdict: PathVerdict; decides: boolean } {
  if (row === undefined) return { verdict: "ABSENT", decides: false };
  switch (row.rule) {
    case "NOT_SERVED":
      return { verdict: "NOT_SERVED", decides: true };
    case "INHERIT":
      return { verdict: "INHERIT", decides: false };
    case "FEE": {
      if (row.deliveryFee === null || row.deliveryFee === undefined) {
        // R27(1): FEE with no amount is not free shipping — it does not
        // decide, and falls up to the escalón above.
        return { verdict: "FEE_WITHOUT_AMOUNT", decides: false };
      }
      // R27(3): a negative amount is rejected at the schema AND, here, does
      // not decide — so the two implementations agree even on the corrupt
      // case the schema should never have let through. Checked on the
      // normalized string (one integer read), never a floating comparison.
      const normalized = toDecimalString(row.deliveryFee);
      if (normalized.startsWith("-")) {
        return { verdict: "FEE_NEGATIVE", decides: false };
      }
      return { verdict: "FEE", decides: true };
    }
    default: {
      const exhaustive: never = row.rule;
      throw new Error(`resolveZoneTariff: unhandled rule ${String(exhaustive)}`);
    }
  }
}

export function resolveZoneTariff(zone: ZoneRef, rows: readonly TariffRow[]): ZoneTariffResolution {
  const byCode = new Map(rows.map((row) => [row.zoneCode, row]));
  const path: PathStep[] = [];

  function consult(code: string, level: ZoneLevel): { verdict: PathVerdict; decides: boolean } {
    const outcome = verdictOf(byCode.get(code));
    path.push({ code, level, verdict: outcome.verdict, decides: outcome.decides });
    return outcome;
  }

  const own = consult(zone.code, zone.level);
  if (own.decides) {
    const row = byCode.get(zone.code)!;
    return {
      served: own.verdict !== "NOT_SERVED",
      deliveryFee: own.verdict === "FEE" ? toDecimalString(row.deliveryFee!) : null,
      decidedBy: zone.code,
      path,
    };
  }

  // R26: FIRST_LEVEL has exactly ONE escalón — it never looks at
  // `provinceCode`, even if the payload happened to carry one (V10, the
  // Isla de la Juventud pattern in reverse).
  if (zone.level === "FIRST_LEVEL" || zone.provinceCode === null) {
    return { served: false, deliveryFee: null, decidedBy: null, path };
  }

  const province = consult(zone.provinceCode, "FIRST_LEVEL");
  if (province.decides) {
    const row = byCode.get(zone.provinceCode)!;
    return {
      served: province.verdict !== "NOT_SERVED",
      deliveryFee: province.verdict === "FEE" ? toDecimalString(row.deliveryFee!) : null,
      decidedBy: zone.provinceCode,
      path,
    };
  }

  return { served: false, deliveryFee: null, decidedBy: null, path };
}
