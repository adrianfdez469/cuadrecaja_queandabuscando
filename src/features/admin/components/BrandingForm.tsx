"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { RadioCard } from "@/components/ui/RadioCard";
import {
  BRAND_PALETTES,
  RADIUS_DEFAULT_HELP,
  RADIUS_DEFAULT_LABEL,
  RADIUS_OPTIONS,
} from "@/constants/branding";
import type { ThemeTokens } from "@/features/theming/storeTheme";
import { ColorTokenField } from "./ColorTokenField";
import { StorefrontPreview } from "./StorefrontPreview";

type Radius = "sharp" | "soft" | "round";

type Issue = { path: (string | number)[]; message: string };

type Outcome =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "saved"; value: { themeTokens: ThemeTokens; branchCount: number } }
  | { kind: "invalid_body"; issues: Issue[] }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "failed" }
  | { kind: "network_error" };

const FIELD_MESSAGE: Record<string, string> = {
  brand: "Eso no es un color que el navegador entienda. Prueba con #0f62fe.",
  brandContrast: "Eso no es un color que el navegador entienda. Prueba con #0f62fe.",
  accent: "Eso no es un color que el navegador entienda. Prueba con #0f62fe.",
  accentContrast: "Eso no es un color que el navegador entienda. Prueba con #0f62fe.",
  radius: "Elige una de las cuatro opciones.",
};

const KNOWN_KEYS = new Set(["brand", "brandContrast", "accent", "accentContrast", "radius"]);

/**
 * design.md § 12a — the isla: chips, the four colours, the four radius
 * `RadioCard`s, the live mockup, `fetch`, per-field errors, the inline
 * "quitar" confirmation, `<noscript>`. `"use client"` (HD7): state (five
 * values + submit phase) and events (`onSubmit`, the chips, the colour
 * pickers) — and the mockup has to react to every keystroke, which is the
 * whole reason this screen has an isla at all.
 */
export function BrandingForm({
  storeId,
  storeName,
  initialTokens,
  branchCount,
}: {
  storeId: string;
  storeName: string;
  initialTokens: ThemeTokens;
  branchCount: number;
}) {
  const [brand, setBrand] = useState(initialTokens.brand ?? "");
  const [brandContrast, setBrandContrast] = useState(initialTokens.brandContrast ?? "");
  const [accent, setAccent] = useState(initialTokens.accent ?? "");
  const [accentContrast, setAccentContrast] = useState(initialTokens.accentContrast ?? "");
  const [radius, setRadius] = useState<Radius | undefined>(initialTokens.radius);
  const [removing, setRemoving] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const summaryRef = useRef<HTMLDivElement>(null);

  const submitting = outcome.kind === "submitting";
  const locked = submitting || outcome.kind === "forbidden" || outcome.kind === "not_found";

  const currentTokens: ThemeTokens = {
    ...(brand && { brand }),
    ...(brandContrast && { brandContrast }),
    ...(accent && { accent }),
    ...(accentContrast && { accentContrast }),
    ...(radius && { radius }),
  };

  const dirty =
    JSON.stringify(currentTokens) !==
    JSON.stringify({
      ...(initialTokens.brand && { brand: initialTokens.brand }),
      ...(initialTokens.brandContrast && { brandContrast: initialTokens.brandContrast }),
      ...(initialTokens.accent && { accent: initialTokens.accent }),
      ...(initialTokens.accentContrast && { accentContrast: initialTokens.accentContrast }),
      ...(initialTokens.radius && { radius: initialTokens.radius }),
    });

  const fieldErrors: Record<string, string> =
    outcome.kind === "invalid_body"
      ? Object.fromEntries(
          outcome.issues
            .filter((issue) => KNOWN_KEYS.has(String(issue.path[0])))
            .map((issue) => [
              issue.path[0],
              FIELD_MESSAGE[String(issue.path[0])] ?? "Revisa este dato.",
            ]),
        )
      : {};

  const unknownKeyIssue =
    outcome.kind === "invalid_body"
      ? outcome.issues.find(
          (issue) => issue.path.length > 0 && !KNOWN_KEYS.has(String(issue.path[0])),
        )
      : undefined;
  const rootIssue =
    outcome.kind === "invalid_body"
      ? outcome.issues.find((issue) => issue.path.length === 0)
      : undefined;

  async function submit(body: ThemeTokens) {
    setOutcome({ kind: "submitting" });
    try {
      const response = await fetch(`/api/admin/stores/${storeId}/branding`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const value = (await response.json()) as {
          themeTokens: ThemeTokens;
          branchCount: number;
        };
        setOutcome({ kind: "saved", value });
        setBrand(value.themeTokens.brand ?? "");
        setBrandContrast(value.themeTokens.brandContrast ?? "");
        setAccent(value.themeTokens.accent ?? "");
        setAccentContrast(value.themeTokens.accentContrast ?? "");
        setRadius(value.themeTokens.radius);
        return;
      }

      if (response.status === 400) {
        const data = (await response.json()) as { issues: Issue[] };
        setOutcome({ kind: "invalid_body", issues: data.issues });
        requestAnimationFrame(() => summaryRef.current?.focus());
        return;
      }
      if (response.status === 401) {
        setOutcome({ kind: "unauthorized" });
        return;
      }
      if (response.status === 403) {
        setOutcome({ kind: "forbidden" });
        return;
      }
      if (response.status === 404) {
        setOutcome({ kind: "not_found" });
        return;
      }
      setOutcome({ kind: "failed" });
    } catch {
      setOutcome({ kind: "network_error" });
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    void submit(currentTokens);
  }

  function applyPalette(palette: (typeof BRAND_PALETTES)[number]) {
    setBrand(palette.brand);
    setBrandContrast(palette.brandContrast);
    setAccent(palette.accent);
    setAccentContrast(palette.accentContrast);
  }

  return (
    <form onSubmit={handleSubmit}>
      {outcome.kind === "invalid_body" && (
        <div ref={summaryRef} tabIndex={-1} className="mb-4">
          <Alert tone="danger">
            <p className="font-medium">
              No se guardó nada. Revisa {outcome.issues.length} dato
              {outcome.issues.length === 1 ? "" : "s"}.
            </p>
            {rootIssue && (
              <p className="mt-1">
                No pudimos leer lo que mandaste. Recarga la página y vuelve a intentar.
              </p>
            )}
            {unknownKeyIssue && (
              <p className="mt-1">
                Hay un dato que el panel no reconoce («{String(unknownKeyIssue.path[0])}»). Recarga
                la página y vuelve a intentar.
              </p>
            )}
          </Alert>
        </div>
      )}
      {outcome.kind === "unauthorized" && (
        <Alert tone="danger" className="mb-4">
          <p>Tu sesión se cerró.</p>
          <p className="mt-1">
            Vuelve a entrar desde Cuadre de Caja y guarda otra vez. No perdimos lo que escribiste.{" "}
            <Link href="/sesion-cerrada" className="font-medium hover:underline">
              Volver a entrar
            </Link>
          </p>
        </Alert>
      )}
      {outcome.kind === "forbidden" && (
        <Alert tone="danger" className="mb-4">
          <p>Ya no puedes cambiar los colores de esta marca.</p>
          <p className="mt-1">
            Puede que le hayan agregado una sucursal que tú no administras. Recarga la página.
          </p>
        </Alert>
      )}
      {outcome.kind === "not_found" && (
        <Alert tone="danger" className="mb-4">
          <p>Esta tienda ya no existe.</p>
          <Link href="/admin" className="font-medium hover:underline">
            Volver a tus tiendas
          </Link>
        </Alert>
      )}
      {outcome.kind === "failed" && (
        <Alert tone="danger" className="mb-4">
          No pudimos guardar. No se cambió nada. Vuelve a intentar en un momento.
        </Alert>
      )}
      {outcome.kind === "network_error" && (
        <Alert tone="danger" className="mb-4">
          Parece que se cortó la conexión. Revisa tu internet y vuelve a intentar.
        </Alert>
      )}
      {outcome.kind === "saved" && (
        <Alert tone="positive" className="mb-4">
          <p>Colores guardados.</p>
          <p className="mt-1">
            {outcome.value.branchCount > 1
              ? `Tus clientes ya los ven en tus ${outcome.value.branchCount} sucursales y en la página que las lista.`
              : outcome.value.branchCount === 0
                ? "Se van a ver en cuanto publiques tu primera sucursal desde Cuadre de Caja."
                : "Tus clientes ya los ven en tu tienda."}
          </p>
        </Alert>
      )}

      <fieldset disabled={locked} className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <fieldset>
            <legend className="font-medium">Paletas</legend>
            <p className="text-fg-muted mt-1 text-sm">Empieza por una paleta y ajusta después.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {BRAND_PALETTES.map((palette) => (
                <button
                  key={palette.name}
                  type="button"
                  onClick={() => applyPalette(palette)}
                  className="border-border flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm"
                >
                  <span className="flex -space-x-1">
                    <span
                      aria-hidden="true"
                      className="border-border h-4 w-4 rounded-full border"
                      style={{ backgroundColor: palette.brand }}
                    />
                    <span
                      aria-hidden="true"
                      className="border-border h-4 w-4 rounded-full border"
                      style={{ backgroundColor: palette.accent }}
                    />
                  </span>
                  {palette.name}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <ColorTokenField
              id="brand"
              name="brand"
              label="Color principal"
              help="Un color CSS: #0f62fe, oklch(0.62 0.17 145) o un nombre como teal."
              value={brand}
              onChange={setBrand}
              error={fieldErrors.brand}
            />
            <ColorTokenField
              id="brandContrast"
              name="brandContrast"
              label="Texto sobre el color principal"
              value={brandContrast}
              onChange={setBrandContrast}
              error={fieldErrors.brandContrast}
              showShortcuts
            />
            <ColorTokenField
              id="accent"
              name="accent"
              label="Color de acento"
              help="Es el color de la etiqueta «Destacado» de tus productos."
              value={accent}
              onChange={setAccent}
              error={fieldErrors.accent}
            />
            <ColorTokenField
              id="accentContrast"
              name="accentContrast"
              label="Texto sobre el color de acento"
              value={accentContrast}
              onChange={setAccentContrast}
              error={fieldErrors.accentContrast}
              showShortcuts
            />
          </div>

          <fieldset>
            <legend className="font-medium">Esquinas</legend>
            <div className="mt-2 space-y-2">
              {RADIUS_OPTIONS.map((option) => (
                <RadioCard
                  key={option.value}
                  name="radius"
                  label={option.label}
                  checked={radius === option.value}
                  onChange={() => setRadius(option.value)}
                />
              ))}
              <RadioCard
                name="radius"
                label={RADIUS_DEFAULT_LABEL}
                description={RADIUS_DEFAULT_HELP}
                checked={!radius}
                onChange={() => setRadius(undefined)}
              />
            </div>
          </fieldset>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button type="submit" disabled={locked}>
              {submitting ? "Guardando…" : "Guardar los colores"}
            </Button>
            {!removing ? (
              <Button
                type="button"
                variant="ghost"
                disabled={locked}
                onClick={() => setRemoving(true)}
              >
                Quitar los colores
              </Button>
            ) : (
              <div className="text-sm">
                <p>¿Quitar los colores y volver a la paleta por defecto?</p>
                <p className="text-fg-muted mt-1">
                  Tus {branchCount} sucursales vuelven al azul de queandabuscando.
                </p>
                <div className="mt-2 flex gap-3">
                  <Button
                    type="button"
                    onClick={() => {
                      setRemoving(false);
                      void submit({});
                    }}
                  >
                    Sí, quitar
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setRemoving(false)}>
                    No
                  </Button>
                </div>
              </div>
            )}
            {dirty && !submitting && <span className="text-fg-muted text-sm">Sin guardar.</span>}
          </div>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <StorefrontPreview
            tokens={currentTokens}
            storeName={storeName}
            branchCount={branchCount}
          />
        </div>
      </fieldset>

      <noscript>
        <Alert tone="warning" className="mt-4">
          Para cambiar los colores necesitas activar JavaScript. Los que tienes guardados se ven
          aquí arriba.
        </Alert>
      </noscript>
    </form>
  );
}
