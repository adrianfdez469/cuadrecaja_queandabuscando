"use client";

import { useState } from "react";
import { REFERENCE_CURRENCY_NONE } from "@/constants/currency";
import {
  REFERENCE_CURRENCY_NOT_HYDRATED,
  useReferenceCurrencyPreference,
} from "@/features/currency/referenceCurrencyStore";

/**
 * F-039 (design.md § El selector, § Componentes de UI; architecture.md AD4,
 * AD9). The ONLY `"use client"` piece of this feature (design.md § Coste de
 * cliente): it has state (the preference), an event (`change`) and reads
 * `localStorage`, so it is not `"use client"` without state or events, and
 * it never renders catalogue (AGENTS.md § Prohibiciones).
 *
 * R13: nothing of this renders in the served HTML before hydration — the
 * wrapper below is a fixed 160×44 px hole either way (design.md § Qué se ve
 * antes de hidratar), so the sub-barra never moves when the real `<select>`
 * fills it in (EX2).
 *
 * The caller (`src/app/[slug]/layout.tsx`) only mounts this when
 * `selectableCurrencies` is non-empty — `offeredCurrencies` is never `[]`
 * in practice, so "Solo <base>" always has at least one real alternative
 * next to it.
 */
export function ReferenceCurrencySelect({
  baseCurrency,
  offeredCurrencies,
}: {
  baseCurrency: string;
  offeredCurrencies: readonly string[];
}) {
  const [preference, setPreference] = useReferenceCurrencyPreference(offeredCurrencies);
  // D7: a single sr-only sentence, empty until the shopper actually chooses
  // — never pre-filled on mount, or a screen reader would announce it on
  // load without anyone having done anything (§ Accesibilidad).
  const [announcement, setAnnouncement] = useState("");

  if (preference === REFERENCE_CURRENCY_NOT_HYDRATED) {
    return <div aria-hidden className="h-11 w-40" />;
  }

  return (
    <div className="h-11 w-40">
      <label htmlFor="reference-currency-select" className="sr-only">
        Moneda de referencia
      </label>
      <select
        id="reference-currency-select"
        className="border-border bg-surface text-fg focus-visible:outline-brand-contrast h-11 w-40 rounded-md border px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
        value={preference}
        onChange={(event) => {
          const next = event.target.value;
          setPreference(next);
          // D7: the two only possible choices from DH5, both with visible
          // effect — there is no "chose something with no effect" state to
          // announce.
          setAnnouncement(
            next === REFERENCE_CURRENCY_NONE
              ? `Ahora solo en ${baseCurrency}.`
              : `Ahora también en ${next}.`,
          );
        }}
      >
        {/* D5: "Solo <base>" first — the explicit "only the base currency"
            choice SP1(a) asked for, findable without scrolling the list. */}
        <option value={REFERENCE_CURRENCY_NONE}>Solo {baseCurrency}</option>
        {offeredCurrencies.map((code) => (
          <option key={code} value={code}>
            También en {code}
          </option>
        ))}
      </select>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
