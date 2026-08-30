import { NEXT_PATH_MAX_LENGTH } from "@/constants/account";

/**
 * R7/E27: without this, `/auth/callback` (and the "sign in" links) would be
 * an open redirector holding a freshly-set session cookie. Pure, no Zod, so
 * both the callback route and the client islands can call it identically
 * (architecture.md § `safeNextPath`).
 */
export const DEFAULT_NEXT = "/cuenta";

/**
 * Returns `raw` only when it is a same-site relative path: starts with `/`,
 * does not start with `//` or `/\` (protocol-relative / backslash tricks),
 * has no `..` segment, no backslash, no control characters, and stays under
 * `NEXT_PATH_MAX_LENGTH`. Anything else — `https://otro.com`, `//otro.com`,
 * `/../x`, `javascript:...` (fails the leading-`/` check outright) — falls
 * back to `DEFAULT_NEXT`.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_NEXT;
  if (raw.length >= NEXT_PATH_MAX_LENGTH) return DEFAULT_NEXT;
  if (/[\x00-\x1f]/.test(raw)) return DEFAULT_NEXT;
  if (!raw.startsWith("/")) return DEFAULT_NEXT;
  if (raw.startsWith("//")) return DEFAULT_NEXT;
  if (raw.startsWith("/\\")) return DEFAULT_NEXT;
  if (raw.includes("..")) return DEFAULT_NEXT;
  if (raw.includes("\\")) return DEFAULT_NEXT;

  return raw;
}
