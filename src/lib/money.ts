/**
 * Money handling.
 *
 * Amounts are stored as Decimal(14,2) in Postgres and arrive as decimal.js
 * instances. This module never imports Prisma: it accepts anything with a
 * sane `toString()`, which keeps it pure and trivially testable.
 *
 * Arithmetic goes through BigInt minor units. Doing it in `number` is how you
 * end up with 0.1 + 0.2 in someone's cart total.
 *
 * Currency conversion follows cuadrecaja's convention: CUP is the universal
 * anchor and `rate` means "CUP per 1 unit of this currency". CUP itself never
 * has a stored rate.
 */

export const ANCHOR_CURRENCY = "CUP";

/** Anything Decimal-like. Prisma's Decimal satisfies this structurally. */
export type MoneyInput = string | number | { toString(): string };

export type Money = {
  /** Exact decimal string, always with 2 fraction digits. */
  readonly amount: string;
  readonly currency: string;
};

/** "CUP per 1 unit", keyed by currency code. CUP is implicitly 1. */
export type RateTable = Readonly<Record<string, MoneyInput>>;

const MINOR_UNITS = 2n;
const SCALE = 100n;

export class MoneyError extends Error {}

function parseToMinor(value: MoneyInput, scale: bigint = SCALE): bigint {
  const raw = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new MoneyError(`Not a numeric amount: ${raw}`);
  }
  const negative = raw.startsWith("-");
  const [intPart, fracPart = ""] = (negative ? raw.slice(1) : raw).split(".");

  const digits = String(scale).length - 1;
  // Round half-up on the first dropped digit rather than truncating, so a rate
  // conversion never quietly loses a cent in the shopper's favour or ours.
  const kept = fracPart.slice(0, digits).padEnd(digits, "0");
  const nextDigit = fracPart.charAt(digits);
  let minor = BigInt(intPart + (kept || ""));
  if (nextDigit && Number(nextDigit) >= 5) minor += 1n;
  return negative ? -minor : minor;
}

function minorToString(minor: bigint, digits = Number(MINOR_UNITS)): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const s = abs.toString().padStart(digits + 1, "0");
  const int = s.slice(0, s.length - digits);
  const frac = s.slice(s.length - digits);
  return `${negative ? "-" : ""}${int}${digits > 0 ? `.${frac}` : ""}`;
}

export function money(amount: MoneyInput, currency: string): Money {
  if (!currency) throw new MoneyError("Currency is required");
  return { amount: minorToString(parseToMinor(amount)), currency };
}

export function isZero(m: Money): boolean {
  return parseToMinor(m.amount) === 0n;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return {
    amount: minorToString(parseToMinor(a.amount) + parseToMinor(b.amount)),
    currency: a.currency,
  };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return {
    amount: minorToString(parseToMinor(a.amount) - parseToMinor(b.amount)),
    currency: a.currency,
  };
}

/**
 * `m` reduced by `percent` percent (R27), floored at 0 — a promotion never
 * produces a negative price. `percent` is a plain decimal string ("20" for
 * 20%), not a fraction.
 */
export function percentageOff(m: Money, percent: MoneyInput): Money {
  const pct = parseToMinor(percent, 100n); // "20" -> 2000 at scale 100 -> /100 below
  const minor = parseToMinor(m.amount);
  const discount = divideRoundHalfUp(minor * pct, 10_000n); // percent scale (100) * money scale (100)
  const result = minor - discount;
  return { amount: minorToString(result < 0n ? 0n : result), currency: m.currency };
}

/** -1 / 0 / 1, same currency required — used to break ties deterministically (R26). */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  const diff = parseToMinor(a.amount) - parseToMinor(b.amount);
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
}

/** Multiply by a quantity, which may itself be fractional (sold by weight). */
export function multiply(m: Money, quantity: MoneyInput): Money {
  // Quantities carry 3 decimals in the schema, so scale by 1000 and divide back.
  const qty = parseToMinor(quantity, 1000n);
  const product = parseToMinor(m.amount) * qty;
  const rounded = divideRoundHalfUp(product, 1000n);
  return { amount: minorToString(rounded), currency: m.currency };
}

export function sum(items: readonly Money[], currency: string): Money {
  return items.reduce((acc, item) => add(acc, item), money(0, currency));
}

function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const remainder = n % d;
  const rounded = remainder * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/**
 * Convert between currencies through the CUP anchor.
 * Throws rather than guessing when a rate is missing — a silently wrong price
 * is worse than a visible failure.
 */
export function convert(value: Money, toCurrency: string, rates: RateTable): Money {
  if (value.currency === toCurrency) return value;

  const rateOf = (code: string): bigint => {
    if (code === ANCHOR_CURRENCY) return 1_000_000n; // 1.000000
    const raw = rates[code];
    if (raw === undefined) {
      throw new MoneyError(`No exchange rate for ${code}`);
    }
    const scaled = parseToMinor(raw, 1_000_000n);
    if (scaled <= 0n) throw new MoneyError(`Non-positive rate for ${code}`);
    return scaled;
  };

  const fromRate = rateOf(value.currency);
  const toRate = rateOf(toCurrency);

  // amount -> anchor -> target, in one division to avoid double rounding.
  const minor = parseToMinor(value.amount);
  const converted = divideRoundHalfUp(minor * fromRate, toRate);
  return { amount: minorToString(converted), currency: toCurrency };
}

export type FormatMoneyOptions = { locale?: string; symbol?: string };

/**
 * F-027 (design.md RD4, architecture.md § El importe entero de la UI): the
 * ONE place that builds the `Intl.NumberFormat` for a shown amount and its
 * fallback branch, so `formatMoney` and `formatWholeMoney` can never
 * disagree on the symbol for the same currency — that is the whole point of
 * sharing this helper instead of writing a second formatter next to it.
 */
function formatWithIntl(
  value: Money,
  digits: { minimumFractionDigits: number; maximumFractionDigits?: number },
  options: FormatMoneyOptions,
): string {
  const { locale = "es-CU", symbol } = options;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: value.currency,
      ...digits,
    }).format(Number(value.amount));
  } catch {
    const formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits.minimumFractionDigits,
      maximumFractionDigits: digits.maximumFractionDigits ?? digits.minimumFractionDigits,
    }).format(Number(value.amount));
    return `${symbol ?? value.currency} ${formatted}`;
  }
}

/**
 * Format for display. Defaults to es-CU; falls back to a plain
 * "<symbol> <amount>" if the runtime lacks the currency in Intl.
 */
export function formatMoney(value: Money, options: FormatMoneyOptions = {}): string {
  return formatWithIntl(value, { minimumFractionDigits: 2 }, options);
}

/**
 * F-027 (RD4): the same amount with NO fraction digits — "$350", never
 * "$350.00" — for values that are integers by construction (a URL's
 * `precio_min`/`precio_max`, a price bracket's cut point). Shares
 * `formatWithIntl` with `formatMoney`, which is what makes the symbol
 * structurally unable to discrepar between a chip and a card. Never rounds
 * anything in practice: every caller already passes an integer amount.
 */
export function formatWholeMoney(value: Money, options: FormatMoneyOptions = {}): string {
  return formatWithIntl(value, { minimumFractionDigits: 0, maximumFractionDigits: 0 }, options);
}
