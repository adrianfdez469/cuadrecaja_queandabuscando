"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { RadioCard } from "@/components/ui/RadioCard";
import type { GroupCandidate, GroupStoresRow } from "../types";

/**
 * Agrupar dos tiendas bajo una marca (HS8, DP5): elegir, leer qué va a
 * cambiar y confirmar en línea — dos pasos y la confirmación de la casa,
 * como pidió el humano. `"use client"`: estado (candidata elegida,
 * confirmando, enviando, error, resultado) y un `fetch` (architecture.md §
 * Coste de cliente).
 *
 * `primaryBrandSlug`/`primaryBranchSlug` llegan YA calculados por el
 * servidor con `previewSlug()` (`stores.ts::previewGrouping`) — esta isla no
 * deriva ningún slug por su cuenta, así que no puede prometer una URL
 * distinta de la que el `POST` termina creando.
 */

type Phase =
  | { kind: "choosing" }
  | { kind: "confirming" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "done"; result: GroupStoresRow };

const ERROR_MESSAGES: Record<string, string> = {
  DIFFERENT_BUSINESS:
    "Esa tienda es de otro negocio. Solo puedes agrupar tiendas del mismo negocio, porque comparten precios y existencias.",
  ALREADY_IN_BRAND:
    "Esa tienda ya está en esta marca. Actualiza la página para ver tus sucursales.",
  FORBIDDEN:
    "Ya no tienes permiso sobre una de las dos tiendas. Vuelve a entrar desde Cuadre de Caja.",
  INVALID_BODY:
    "No pudimos agrupar con la tienda que elegiste. Actualiza la página y vuelve a intentarlo.",
  NETWORK: "No pudimos agrupar ahora y no cambió nada. Intenta de nuevo en un momento.",
};

export function GroupStoresForm({
  primaryStoreId,
  primaryName,
  primaryBrandSlug,
  primaryBranchSlug,
  primaryBranchAlreadyExists,
  candidates,
}: {
  primaryStoreId: string;
  primaryName: string;
  primaryBrandSlug: string;
  primaryBranchSlug: string;
  /** `true` when `primaryBranchSlug` already answers 200 today (a live
   *  alias, criterio 3, or a slug left by a previous grouping) — the
   *  preview must say so instead of claiming it "todavía no existe". */
  primaryBranchAlreadyExists: boolean;
  candidates: GroupCandidate[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "choosing" });
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? null;
  const submitting = phase.kind === "submitting";

  // Focus the result heading ONCE, exactly when the phase TRANSITIONS into
  // "done" — not an inline `ref={(el) => el?.focus()}` callback, which React
  // re-invokes (and would steal focus back) on every re-render of this
  // branch, not only on mount.
  useEffect(() => {
    if (phase.kind === "done") resultHeadingRef.current?.focus();
  }, [phase.kind]);

  async function confirm() {
    if (!selected) return;
    setPhase({ kind: "submitting" });
    try {
      const response = await fetch(`/api/admin/stores/${primaryStoreId}/branches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ joiningStoreId: selected.id }),
      });
      if (response.ok) {
        const result = (await response.json()) as GroupStoresRow;
        setPhase({ kind: "done", result });
        return;
      }
      if (response.status === 401) {
        router.push("/sesion-cerrada");
        return;
      }
      if (response.status === 403) {
        setPhase({ kind: "error", message: ERROR_MESSAGES.FORBIDDEN });
        return;
      }
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      const message =
        (data?.error && ERROR_MESSAGES[data.error]) ??
        (response.status === 400 ? ERROR_MESSAGES.INVALID_BODY : ERROR_MESSAGES.NETWORK);
      setPhase({ kind: "error", message });
    } catch {
      setPhase({ kind: "error", message: ERROR_MESSAGES.NETWORK });
    }
  }

  if (phase.kind === "done") {
    return (
      <div>
        <Alert tone="positive">
          <h2
            ref={resultHeadingRef}
            tabIndex={-1}
            className="text-lg font-semibold focus:outline-none"
          >
            Listo: {primaryName} tiene {phase.result.branches.length} sucursales
          </h2>
          <p className="mt-2">
            queandabuscando.com/{phase.result.brandSlug} ahora muestra la lista de las dos.
          </p>
          <ul className="mt-3 space-y-1">
            {phase.result.branches.map((branch) => (
              <li key={branch.storeId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="break-all">queandabuscando.com{branch.url}</span>
                <a
                  href={branch.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Ver la tienda en una pestaña nueva"
                  className="font-medium hover:underline"
                >
                  Ver ↗
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm">Los códigos QR que ya imprimiste siguen funcionando.</p>
          <div className="mt-4 flex gap-4 text-sm">
            <a href={`/admin/tiendas/${primaryStoreId}`} className="font-medium hover:underline">
              Volver a {primaryName}
            </a>
            <a
              href={`/${phase.result.brandSlug}/sucursales`}
              target="_blank"
              rel="noreferrer"
              className="font-medium hover:underline"
            >
              Ver la lista de sucursales ↗
            </a>
          </div>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <noscript>
        <Alert tone="muted">
          Para agrupar dos tiendas necesitas activar JavaScript. Es una acción que no se puede
          deshacer y preferimos que veas antes qué cambia.
        </Alert>
      </noscript>

      {phase.kind === "error" && (
        <Alert tone="danger" className="mb-4" id="group-stores-error" title="No pudimos agrupar">
          {phase.message}
        </Alert>
      )}

      <fieldset disabled={submitting}>
        <legend className="font-medium">¿Qué tienda quieres agrupar?</legend>
        <div className="mt-2 space-y-2">
          {candidates.map((candidate) => (
            <RadioCard
              key={candidate.id}
              name="joiningStoreId"
              label={candidate.name}
              description={`${candidate.city ?? "—"} · queandabuscando.com/${candidate.canonicalSlug}`}
              checked={selectedId === candidate.id}
              onChange={() => {
                setSelectedId(candidate.id);
                setPhase({ kind: "confirming" });
              }}
            />
          ))}
        </div>
      </fieldset>

      {selected && (
        <div aria-live="polite" className="mt-4">
          <h3 className="text-sm font-semibold">Qué va a cambiar</h3>
          <div className="mt-2 space-y-3 text-sm">
            <div className="border-border rounded-md border p-3">
              <p className="font-medium break-all">queandabuscando.com/{primaryBrandSlug}</p>
              <p className="text-fg-muted mt-1">Ahora: El catálogo de {primaryName}</p>
              <p className="mt-1">Después: La lista de tus sucursales</p>
            </div>
            <div className="border-border rounded-md border p-3">
              <p className="font-medium break-all">queandabuscando.com/{primaryBranchSlug}</p>
              <p className="text-fg-muted mt-1">
                Ahora:{" "}
                {primaryBranchAlreadyExists
                  ? `El catálogo de ${primaryName} (esta dirección ya existe)`
                  : "Todavía no existe"}
              </p>
              <p className="mt-1">
                Después: El catálogo de {primaryName}
                {primaryBranchAlreadyExists ? " — sin cambios" : ""}
              </p>
            </div>
            <div className="border-border rounded-md border p-3">
              <p className="font-medium break-all">queandabuscando.com/{selected.canonicalSlug}</p>
              <p className="text-fg-muted mt-1">Ahora: El catálogo de {selected.name}</p>
              <p className="mt-1">Después: El catálogo de {selected.name} — sin cambios</p>
            </div>
          </div>

          <Alert tone="warning" className="mt-3">
            Los códigos QR que ya imprimiste siguen funcionando: ninguna dirección deja de responder
            y ninguna redirige. Pero el QR de {primaryName} va a llevar a la lista de sucursales, no
            directo a su catálogo. Su catálogo queda a un clic, en queandabuscando.com/
            {primaryBranchSlug}.
          </Alert>

          <p className="text-fg-muted mt-3 text-sm">
            ¿Prefieres que la dirección de tu marca sea queandabuscando.com/{selected.canonicalSlug}
            ? Entonces agrupa desde {selected.name}.
          </p>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Button onClick={confirm} disabled={submitting}>
              {submitting ? "Agrupando…" : "Sí, agrupar las dos tiendas"}
            </Button>
            <Button
              variant="ghost"
              disabled={submitting}
              onClick={() => {
                setSelectedId(null);
                setPhase({ kind: "choosing" });
              }}
            >
              No, dejarlo así
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
