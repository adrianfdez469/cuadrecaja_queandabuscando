"use client";

import { useRef, useState } from "react";
import { formatMoney, money } from "@/lib/money";
import { foldForSearch } from "@/lib/text";
import { matchesZoneQuery, type OfferableZone } from "../coverage";

/**
 * F-042 (architecture.md § AD5, design.md § 1) — el combobox accesible. No
 * hay `<select>` nativo posible aquí (R6: su escritura predictiva respeta
 * las tildes) ni `<input list>` (su filtro es del navegador y lo que sale
 * es texto libre, no un código — R4). Pide nada a la red: filtra sobre las
 * zonas que ya llegaron en el HTML (E3, C5).
 */

function amountLabel(zone: OfferableZone, currencyCode: string): string {
  if (zone.deliveryFee === "0.00") return "Envío gratis";
  return `+ ${formatMoney(money(zone.deliveryFee, currencyCode))}`;
}

export function ZoneCombobox({
  id,
  zones,
  showProvince,
  value,
  onSelect,
  currencyCode,
  error,
  describedBy,
}: {
  id: string;
  /** Ya acotadas por el paso de provincia, si lo hay (R3, D3). */
  zones: readonly OfferableZone[];
  /** R7: hay más de una provincia en la cobertura completa de la tienda —
   *  cada opción gana una segunda línea con su provincia. */
  showProvince: boolean;
  value: OfferableZone | null;
  onSelect: (zone: OfferableZone) => void;
  currencyCode: string;
  error?: string;
  describedBy?: string;
}) {
  const listboxId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const foldedQuery = foldForSearch(query.trim());
  const filtered = zones.filter((zone) => matchesZoneQuery(zone, foldedQuery));

  const displayText = open ? query : (value?.name ?? query);

  function commit(zone: OfferableZone) {
    onSelect(zone);
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
  }

  function handleBlur() {
    // R4: el texto NUNCA es el valor. Al perder el foco, vuelve al nombre
    // del municipio elegido, o se vacía.
    setOpen(false);
    setQuery("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(0);
        return;
      }
      setActiveIndex((i) => (i + 1) % Math.max(filtered.length, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(0);
        return;
      }
      setActiveIndex((i) => (i - 1 + Math.max(filtered.length, 1)) % Math.max(filtered.length, 1));
    } else if (event.key === "Enter") {
      if (open && filtered[activeIndex]) {
        event.preventDefault();
        commit(filtered[activeIndex]);
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setQuery("");
      }
    } else if (event.key === "Home" && open) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End" && open) {
      event.preventDefault();
      setActiveIndex(Math.max(filtered.length - 1, 0));
    }
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && filtered[activeIndex] ? `${listboxId}-${filtered[activeIndex].code}` : undefined
        }
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        placeholder="Escribe tu municipio"
        value={displayText}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="border-border min-h-11 w-full rounded-md border px-3"
        autoComplete="off"
      />
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Municipios a los que llega esta tienda"
          className="border-border bg-surface absolute z-10 mt-1 max-h-[17.5rem] w-full overflow-y-auto overscroll-contain rounded-md border shadow-lg sm:max-h-96"
        >
          {filtered.length === 0 ? (
            <li className="text-fg-muted p-3 text-sm">
              Ningún municipio de esta tienda coincide con «{query}».
            </li>
          ) : (
            filtered.map((zone, index) => (
              <li
                key={zone.code}
                id={`${listboxId}-${zone.code}`}
                role="option"
                aria-selected={value?.code === zone.code}
                // onMouseDown, not onClick: fires BEFORE the input's onBlur,
                // so blur does not close the list before the click commits.
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(zone);
                }}
                className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-2 ${
                  index === activeIndex ? "bg-brand/8" : ""
                }`}
              >
                <span className="text-fg">
                  {zone.name}
                  {showProvince && (
                    <span className="text-fg-muted block text-sm">{zone.provinceName}</span>
                  )}
                </span>
                <span className="text-fg-muted shrink-0 text-sm whitespace-nowrap">
                  {amountLabel(zone, currencyCode)}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
