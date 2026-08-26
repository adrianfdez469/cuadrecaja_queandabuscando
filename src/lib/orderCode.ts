import { ORDER_CODE_ALPHABET, ORDER_CODE_LENGTH } from "@/constants/orders";

/**
 * `Order.code` — the only credential of a public page that shows a person's
 * name, phone and address (R17). Ten Crockford base32 characters, generated
 * with cryptographic randomness, with no sequence and no derivation from the
 * row id.
 *
 * Pure: no `node:crypto` import, so this runs identically on the edge and in
 * tests. `getRandomValues` is a parameter so tests can inject a deterministic
 * source instead of stubbing a global.
 */

const CODE_PATTERN = new RegExp(`^[${ORDER_CODE_ALPHABET}]{${ORDER_CODE_LENGTH}}$`);

type RandomValuesSource = (buffer: Uint8Array) => Uint8Array;

function defaultRandomValues(buffer: Uint8Array): Uint8Array {
  return globalThis.crypto.getRandomValues(buffer);
}

/**
 * `byte % 32` is unbiased here because 256 is an exact multiple of 32
 * (the alphabet length) — every byte value maps to exactly 8 codepoints.
 */
export function generateOrderCode(
  getRandomValues: RandomValuesSource = defaultRandomValues,
): string {
  const bytes = getRandomValues(new Uint8Array(ORDER_CODE_LENGTH));
  let code = "";
  for (let i = 0; i < ORDER_CODE_LENGTH; i += 1) {
    code += ORDER_CODE_ALPHABET[bytes[i] % ORDER_CODE_ALPHABET.length];
  }
  return code;
}

/**
 * Upper-cases and strips spaces/hyphens, so a code dictated over the phone
 * and typed by hand still matches what was stored (no separator, uppercase).
 */
export function normalizeOrderCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, "");
}

/** Grouped `XXXXX-XXXXX`, for display only — never what is stored or sent. */
export function formatOrderCode(code: string): string {
  const normalized = normalizeOrderCode(code);
  if (normalized.length !== ORDER_CODE_LENGTH) return normalized;
  return `${normalized.slice(0, 5)}-${normalized.slice(5)}`;
}

/** True when a (normalized) string could be a code — used to validate input. */
export function isOrderCode(input: string): boolean {
  return CODE_PATTERN.test(normalizeOrderCode(input));
}
