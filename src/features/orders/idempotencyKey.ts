/**
 * UUID v4 for the checkout's idempotency key (R26). `crypto.randomUUID()`
 * only exists in a secure context; the fallback composes one from
 * `crypto.getRandomValues` because an absent key silently turns off
 * duplicate protection (R28) rather than throwing — that trade-off belongs
 * to the caller, not to a crash here.
 *
 * Client-safe: no Zod, no Prisma. Server code never needs this — it only
 * ever compares the key the client sends, never generates one.
 */
export function generateUuidV4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }

  // Version 4, variant 10xx per RFC 4122.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}
