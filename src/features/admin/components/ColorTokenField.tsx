import { Field } from "@/components/ui/Field";
import { BRAND_CONTRAST_SHORTCUTS } from "@/constants/branding";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * design.md § 12a (ii) — the piece from the ciclo 1 design that never
 * caducó, now a criterion (E43): a text field WITH `name` (the value that
 * gets saved, so an existing `oklch(...)` round-trips untouched) plus an
 * `<input type="color">` WITHOUT `name` that only writes INTO the text
 * field — never the other way, and never submitted itself (a `#rrggbb`
 * selector cannot represent `oklch(...)`, and sending it would silently
 * turn a real store's colour into `#000000`).
 *
 * Controlled by `BrandingForm` — no state of its own, no directive.
 */
export function ColorTokenField({
  id,
  name,
  label,
  help,
  value,
  onChange,
  error,
  showShortcuts,
  disabled,
}: {
  id: string;
  name: string;
  label: string;
  help?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  showShortcuts?: boolean;
  disabled?: boolean;
}) {
  const pickerValue = HEX_COLOR.test(value) ? value : "#000000";

  return (
    <Field id={id} label={label} help={help} error={error}>
      {(controlProps) => (
        <div>
          <div className="flex items-center gap-2">
            <input
              {...controlProps}
              name={name}
              type="text"
              maxLength={64}
              autoComplete="off"
              disabled={disabled}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="border-border min-h-11 w-full flex-1 rounded-md border px-3 text-sm"
            />
            <input
              type="color"
              aria-label={`Elegir el ${label.toLowerCase()}`}
              disabled={disabled}
              value={pickerValue}
              onChange={(e) => onChange(e.target.value)}
              className="border-border h-11 w-14 shrink-0 rounded-md border"
            />
          </div>
          {!HEX_COLOR.test(value) && value !== "" && (
            <p className="text-fg-muted mt-1 text-xs">
              El selector solo entiende colores en formato #rrggbb. Tu color se guarda tal como está
              escrito.
            </p>
          )}
          {showShortcuts && (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(BRAND_CONTRAST_SHORTCUTS.CLARO)}
                className="border-border min-h-11 rounded-md border px-3 text-sm"
              >
                Claro
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(BRAND_CONTRAST_SHORTCUTS.OSCURO)}
                className="border-border min-h-11 rounded-md border px-3 text-sm"
              >
                Oscuro
              </button>
            </div>
          )}
        </div>
      )}
    </Field>
  );
}
