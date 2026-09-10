"use client";

import { useId, useMemo, useState } from "react";
import { Field } from "@/components/ui/Field";
import { formatMoney, money } from "@/lib/money";
import { distinctProvinces, findZoneInCoverage, type OfferableZone } from "../coverage";
import { ZoneCombobox } from "./ZoneCombobox";
import { ZoneMapPanel } from "./ZoneMapPanel";

/**
 * F-042 (architecture.md § AD5, design.md § «Inventario de pantallas y
 * estados») — el bloque entero: provincia condicional (R5), campo de
 * municipio, línea del importe, entrada al mapa. Recibe las zonas YA
 * resueltas por el servidor (D5) y no pide nada a la red por su cuenta —
 * la única petición de este bloque es la que dispara `ZoneMapPanel` al
 * abrir el mapa.
 */
export function ZonePicker({
  zones,
  currencyCode,
  storeSlug,
  value,
  onChange,
  error,
}: {
  zones: readonly OfferableZone[];
  currencyCode: string;
  storeSlug: string;
  value: string | null;
  onChange: (code: string | null) => void;
  error?: string;
}) {
  const municipalityFieldId = useId();
  const provinceFieldId = useId();
  const [provinceCode, setProvinceCode] = useState<string | null>(null);

  const provinces = useMemo(() => distinctProvinces(zones), [zones]);
  const hasProvinceStep = provinces.length > 1;
  const scopedZones = useMemo(
    () => (provinceCode ? zones.filter((z) => z.provinceCode === provinceCode) : zones),
    [zones, provinceCode],
  );
  const selectedZone = value ? findZoneInCoverage(zones, value) : null;

  // D11/PP3: una tienda con un solo municipio lo trae elegido y declarado,
  // sin campo de búsqueda.
  if (zones.length === 1) {
    const zone = zones[0];
    return (
      <p className="text-fg text-sm">
        Esta tienda solo entrega en {zone.name} ·{" "}
        {zone.deliveryFee === "0.00"
          ? "Envío gratis"
          : formatMoney(money(zone.deliveryFee, currencyCode))}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <noscript>
        <p className="text-fg-muted text-sm">
          Para elegir el municipio y ver el costo del envío hace falta JavaScript.
        </p>
      </noscript>

      {hasProvinceStep && (
        <Field id={provinceFieldId} label="Provincia">
          {(props) => (
            <select
              {...props}
              value={provinceCode ?? ""}
              onChange={(event) => setProvinceCode(event.target.value || null)}
              className="border-border min-h-11 w-full rounded-md border px-3"
            >
              <option value="">Todas las provincias</option>
              {provinces.map((province) => (
                <option key={province.code} value={province.code}>
                  {province.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      <Field
        id={municipalityFieldId}
        label="Municipio a donde enviamos"
        help="Escribe las primeras letras o ábrelo para verlos todos."
        error={error}
      >
        {(props) => (
          <ZoneCombobox
            id={props.id}
            zones={scopedZones}
            showProvince={hasProvinceStep}
            value={selectedZone}
            currencyCode={currencyCode}
            error={error}
            describedBy={props["aria-describedby"]}
            onSelect={(zone) => onChange(zone.code)}
          />
        )}
      </Field>

      {selectedZone && (
        <p className="text-fg text-sm">
          Envío a {selectedZone.name} ·{" "}
          {selectedZone.deliveryFee === "0.00"
            ? "Envío gratis"
            : `+ ${formatMoney(money(selectedZone.deliveryFee, currencyCode))}`}
        </p>
      )}

      <ZoneMapPanel
        storeSlug={storeSlug}
        zones={zones}
        currencyCode={currencyCode}
        selectedCode={value}
        onConfirm={(code) => onChange(code)}
      />
    </div>
  );
}
