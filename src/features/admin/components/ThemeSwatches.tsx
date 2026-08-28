import { RADIUS_DEFAULT_LABEL, RADIUS_LABEL_BY_VALUE } from "@/constants/branding";
import type { ThemeTokens } from "@/features/theming/storeTheme";

const SWATCH_LABEL: Record<keyof Omit<ThemeTokens, "radius">, string> = {
  brand: "Color principal",
  brandContrast: "Texto sobre el principal",
  accent: "Color de acento",
  accentContrast: "Texto sobre el acento",
};

/**
 * design.md § 11 / § 12b: the four saved-value swatches (one per set color
 * token) plus "Esquinas · {etiqueta}". Server component, no directive — used
 * by the hub's entry card AND the coverage-blocked screen, never with a
 * `storeId` in scope (this component never needs one).
 */
export function ThemeSwatches({ tokens }: { tokens: ThemeTokens }) {
  const colorKeys = (Object.keys(SWATCH_LABEL) as (keyof typeof SWATCH_LABEL)[]).filter(
    (key) => tokens[key],
  );
  const radiusLabel = tokens.radius ? RADIUS_LABEL_BY_VALUE[tokens.radius] : RADIUS_DEFAULT_LABEL;

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      {colorKeys.map((key) => (
        <span key={key} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="border-border h-5 w-5 shrink-0 rounded-sm border"
            style={{ backgroundColor: tokens[key] }}
          />
          <span className="text-xs">
            {SWATCH_LABEL[key]}: {tokens[key]}
          </span>
        </span>
      ))}
      <span className="text-xs">Esquinas · {radiusLabel}</span>
    </div>
  );
}
