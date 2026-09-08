/**
 * F-039 (architecture.md AD4): the server half of the reveal/hide mechanism.
 * Text, pure, no React and no Prisma — this module never enters the client
 * bundle, only `dangerouslySetInnerHTML` in `src/app/[slug]/layout.tsx`.
 *
 * Two exports:
 * - `renderReferenceCurrencyCss(codes)`: N+1 `:not()` rules, one per OFFERED
 *   currency (`selectableCurrencies`, DH5) plus the sentinel rule. `:not()`
 *   instead of "hide all, reveal the chosen one with `display: revert`" so
 *   the designer keeps full control of the visible element's `display`
 *   (architecture.md § "Por qué `:not()` y no `revert`").
 * - `REFERENCE_CURRENCY_BOOT_SCRIPT`: the inline script that runs as the
 *   FIRST CHILD of the store's `div`, before the first product card exists,
 *   so the N-equivalents-to-one collapse never happens after paint (EX1 of
 *   design.md § El destello).
 */

import {
  EQUIVALENT_CURRENCY_ATTR,
  REFERENCE_CURRENCY_ATTR,
  REFERENCE_CURRENCY_NONE,
} from "@/constants/currency";

/**
 * N+1 rules (AD4): one per OFFERED currency (`selectableCurrencies`, DH5),
 * plus the sentinel. Empty string when `codes` is empty — C9 requires that
 * not even the `<style>` tag appears, and an empty string is what lets the
 * caller decide not to render it at all rather than render an empty one.
 *
 * `:not()` never puts a `display` declaration on the VISIBLE element, only
 * on the hidden ones — that is what leaves the designer free to choose
 * `flex`/`grid`/`inline`/whatever the visible equivalent needs
 * (architecture.md § Restricciones para el diseñador, punto 3).
 */
export function renderReferenceCurrencyCss(codes: readonly string[]): string {
  if (codes.length === 0) return "";

  const rules = codes.map(
    (code) =>
      `[${REFERENCE_CURRENCY_ATTR}="${code}"] [${EQUIVALENT_CURRENCY_ATTR}]:not([${EQUIVALENT_CURRENCY_ATTR}="${code}"]){display:none}`,
  );
  rules.push(
    `[${REFERENCE_CURRENCY_ATTR}="${REFERENCE_CURRENCY_NONE}"] [${EQUIVALENT_CURRENCY_ATTR}]{display:none}`,
  );
  return rules.join("");
}

/**
 * The boot script of AD4. A LITERAL constant, no interpolation: the four
 * strings it reads/writes ("data-ref-choices", "data-ref-default",
 * "qab.reference-currency.v1", "data-ref-currency", "none") are hand-copied
 * from `src/constants/currency.ts` (AD9) rather than built from those
 * exports — a template literal here would still produce this exact text,
 * but the point of "constante literal" is that per-store DATA never flows
 * into this string (it travels in attributes React escapes instead, so this
 * script has no injection surface). If any of those five literals ever
 * changes in `src/constants/currency.ts`, this string has to change by hand
 * too, and `referenceCurrencyStore.test.tsx` (which executes this exact
 * script in jsdom) is what catches a drift.
 *
 * The five branches (architecture.md AD4, table): empty/garbage/private
 * storage -> `data-ref-default`; a stored, offered code -> itself; "none" ->
 * "none"; a stored code this store does NOT offer -> "none" (E17/DH5). Never
 * removes anything from storage (R17: a preference this store cannot honour
 * survives, it is not erased).
 *
 * Measured 373 bytes (UTF-8) — architecture.md AD4 says 377 for the
 * illustrative snippet it prints; that snippet is pretty-printed for
 * reading, not the literal below, and the two numbers were never meant to
 * be diffed byte for byte. Reported here rather than adjusted in
 * architecture.md, which is not this agent's file to edit.
 */
export const REFERENCE_CURRENCY_BOOT_SCRIPT =
  '(function(){var d=document,r=d.documentElement,e=d.currentScript.parentElement,c=(e.getAttribute("data-ref-choices")||"").split(" "),v;try{v=localStorage.getItem("qab.reference-currency.v1")}catch(_){}if(v!=="none"&&!/^[A-Z]{3}$/.test(v||""))v=e.getAttribute("data-ref-default");else if(v!=="none"&&c.indexOf(v)<0)v="none";r.setAttribute("data-ref-currency",v||"none")})();';
