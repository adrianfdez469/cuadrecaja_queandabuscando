import type { CSSProperties } from "react";
import {
  BRAND_CONTRAST_SHORTCUTS,
  BRAND_PREVIEW_PRODUCTS,
  RADIUS_DEFAULT_LABEL,
  RADIUS_LABEL_BY_VALUE,
} from "@/constants/branding";
import { themeCustomProperties, type ThemeTokens } from "@/features/theming/storeTheme";

/**
 * design.md § 12a (iv) / § 12b: a live (or saved) mockup of a branch's
 * catalogue — the ONE public screen where all five tokens show at once
 * (VE21). No directive: it has no state of its own, whether the caller is
 * the client isla (typing) or the server (the blocked screen, or the first
 * response's HTML). R40: this is the ONLY place in the panel that wears a
 * brand's colours — the rest of `/admin` never does.
 */
export function StorefrontPreview({
  tokens,
  storeName,
  branchCount,
  heading = "Vista previa de tu tienda",
  footnote,
}: {
  tokens: ThemeTokens;
  storeName: string;
  branchCount: number;
  /** `null` to omit the `<h3>` entirely — the blocked screen (§ 12b) already
   *  has its own heading above this same mockup. */
  heading?: string | null;
  /** Overrides the alcance line below the mockup (§ 12b's "Así ven hoy..."). */
  footnote?: string;
}) {
  const style = themeCustomProperties(tokens) as unknown as CSSProperties;
  const radiusLabel = tokens.radius ? RADIUS_LABEL_BY_VALUE[tokens.radius] : RADIUS_DEFAULT_LABEL;
  const contrastLabel = contrastToLabel(tokens.brandContrast);

  return (
    <div>
      {heading && <h3 className="text-sm font-semibold">{heading}</h3>}
      <div style={style} className="border-border mt-2 max-w-88 overflow-hidden rounded-lg border">
        <div className="bg-brand text-brand-contrast flex items-center justify-between px-3 py-2 text-sm font-medium">
          <span>{storeName}</span>
          <span>Carrito</span>
        </div>
        <div className="bg-surface grid grid-cols-2 gap-2 p-2">
          {BRAND_PREVIEW_PRODUCTS.map((name, index) => (
            <div key={name} className="border-border overflow-hidden rounded-md border">
              {index === 0 && (
                <span className="bg-accent text-accent-contrast block px-2 py-0.5 text-xs font-medium">
                  Destacado
                </span>
              )}
              <div className="bg-surface-muted flex aspect-square items-center justify-center">
                <span className="text-fg-muted text-xs">Ejemplo</span>
              </div>
              <div className="space-y-1 p-2">
                <p className="line-clamp-1 text-xs font-medium">{name}</p>
                <p className="text-brand text-sm font-semibold">$1.00</p>
              </div>
            </div>
          ))}
        </div>
        <div className="p-2">
          <span className="bg-brand text-brand-contrast flex min-h-12 items-center justify-center rounded-md text-sm font-medium">
            Agregar al carrito
          </span>
        </div>
      </div>
      <div className="text-fg-muted mt-2 space-y-1 text-xs">
        <p>
          Color principal {tokens.brand ?? "—"} · Texto sobre el principal: {contrastLabel} ·
          Esquinas {radiusLabel.toLowerCase()}
        </p>
        <p>Fíjate en que el texto del botón se lea bien.</p>
        {footnote ? (
          <p>{footnote}</p>
        ) : (
          <>
            {branchCount > 1 && (
              <p>
                Así se ve el catálogo de cada sucursal. La página que lista tus {branchCount}{" "}
                sucursales usa los mismos colores.
              </p>
            )}
            {branchCount === 0 && <p>Todavía no hay ninguna sucursal publicada donde verlo.</p>}
          </>
        )}
        <p>
          Así se ve con el modo oscuro de este dispositivo. Tus clientes con modo claro ven los
          mismos colores sobre fondo claro.
        </p>
      </div>
    </div>
  );
}

function contrastToLabel(value: string | undefined): string {
  if (!value) return "—";
  if (value === BRAND_CONTRAST_SHORTCUTS.CLARO) return "claro";
  if (value === BRAND_CONTRAST_SHORTCUTS.OSCURO) return "oscuro";
  return value;
}
