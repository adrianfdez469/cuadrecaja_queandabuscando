"use client";

import { useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { RadioCard } from "@/components/ui/RadioCard";
import { ADMIN_PRODUCT_DESCRIPTION_MAX_LENGTH } from "@/constants/admin";
import { ImageUploader } from "./ImageUploader";
import type { AdminProductRow } from "../types";

type FieldErrors = Partial<Record<"description" | "priceOverride", string>>;

type SubmitOutcome =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "saved"; value: AdminProductRow }
  | { kind: "invalid_body"; issues: { path: (string | number)[]; message: string }[] }
  | { kind: "forbidden" }
  | { kind: "product_deleted" }
  | { kind: "failed" }
  | { kind: "network_error" };

const FIELD_ERROR: Record<string, string> = {
  description: "La descripción no puede pasar de 1000 caracteres.",
  priceOverride: "Escribe un importe de 0 o más, con hasta dos decimales.",
};

/**
 * Card "Lo que ves en tu tienda" + "Imágenes" (E15, E16, E19). `"use client"`
 * because it has state and a `fetch` submit (HD7) — the isla the criteria
 * curl the same route as.
 */
export function ProductForm({ storeId, product }: { storeId: string; product: AdminProductRow }) {
  const [description, setDescription] = useState(product.description ?? "");
  const [visible, setVisible] = useState(product.visible);
  const [featured, setFeatured] = useState(product.featured);
  const [hasOverride, setHasOverride] = useState(product.priceOverride !== null);
  const [priceOverride, setPriceOverride] = useState(product.priceOverride ?? "");
  const [imageUrls, setImageUrls] = useState(product.imageUrls);
  const [outcome, setOutcome] = useState<SubmitOutcome>({ kind: "idle" });
  const summaryRef = useRef<HTMLDivElement>(null);

  const disabled = Boolean(product.deletedAt) || outcome.kind === "submitting";
  const fieldErrors: FieldErrors =
    outcome.kind === "invalid_body"
      ? Object.fromEntries(
          outcome.issues.map((issue) => [
            issue.path[0],
            FIELD_ERROR[String(issue.path[0])] ?? "Revisa este dato.",
          ]),
        )
      : {};

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setOutcome({ kind: "submitting" });

    const body = {
      description: description.trim() === "" ? null : description,
      imageUrls,
      priceOverride: hasOverride ? priceOverride : null,
      visible,
      featured,
    };

    try {
      const response = await fetch(`/api/admin/stores/${storeId}/products/${product.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const value = (await response.json()) as AdminProductRow;
        setOutcome({ kind: "saved", value });
        return;
      }

      if (response.status === 400) {
        const data = (await response.json()) as {
          issues: { path: (string | number)[]; message: string }[];
        };
        setOutcome({ kind: "invalid_body", issues: data.issues });
      } else if (response.status === 403) {
        setOutcome({ kind: "forbidden" });
      } else if (response.status === 409) {
        setOutcome({ kind: "product_deleted" });
      } else {
        setOutcome({ kind: "failed" });
      }
    } catch {
      setOutcome({ kind: "network_error" });
    }

    requestAnimationFrame(() => summaryRef.current?.focus());
  }

  return (
    <form onSubmit={handleSubmit}>
      {outcome.kind === "invalid_body" && (
        <div ref={summaryRef} role="alert" tabIndex={-1} className="mb-4">
          <Alert tone="danger">No se guardó nada. Revisa los datos marcados abajo.</Alert>
        </div>
      )}
      {outcome.kind === "forbidden" && (
        <Alert tone="danger" className="mb-4">
          Ya no tienes permiso para editar este producto.
        </Alert>
      )}
      {outcome.kind === "product_deleted" && (
        <Alert tone="danger" className="mb-4">
          Cuadre de Caja borró este producto. No se puede editar.
        </Alert>
      )}
      {(outcome.kind === "failed" || outcome.kind === "network_error") && (
        <Alert tone="danger" className="mb-4">
          No pudimos guardar los cambios. Intenta de nuevo.
        </Alert>
      )}
      {outcome.kind === "saved" && (
        <Alert tone="positive" className="mb-4">
          Guardado.{" "}
          {outcome.value.visible
            ? `Tu cliente ve ${outcome.value.priceOverride ?? outcome.value.syncedPrice}.`
            : "Tu cliente no lo ve: está oculto."}
        </Alert>
      )}

      <fieldset disabled={disabled} className="space-y-6">
        <fieldset>
          <legend className="font-medium">¿Se ve en tu tienda?</legend>
          <div className="mt-2 space-y-2">
            <RadioCard
              name="visible"
              label="Se ve"
              description="Aparece en el catálogo y se puede pedir."
              checked={visible}
              onChange={() => setVisible(true)}
            />
            <RadioCard
              name="visible"
              label="Está oculto"
              description="No aparece, no se puede abrir su página y no se puede pedir."
              checked={!visible}
              onChange={() => setVisible(false)}
            />
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={featured}
            onChange={(e) => setFeatured(e.target.checked)}
          />
          Destacar este producto
        </label>

        <Field
          id="description"
          label="Descripción"
          help="Si lo dejas vacío se muestra la descripción del catálogo general."
          error={fieldErrors.description}
        >
          {(controlProps) => (
            <textarea
              {...controlProps}
              rows={4}
              maxLength={ADMIN_PRODUCT_DESCRIPTION_MAX_LENGTH}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="border-border w-full rounded-md border px-3 py-2 text-sm"
            />
          )}
        </Field>

        <fieldset>
          <legend className="font-medium">Precio en tu tienda</legend>
          <p className="text-fg-muted mt-1 text-sm">
            Cuadre de Caja manda {product.syncedPrice} {product.syncedPriceCurrency}.
          </p>
          <div className="mt-2 space-y-2">
            <RadioCard
              name="priceMode"
              label="Usar el precio de Cuadre de Caja"
              description="Se actualiza solo cada vez que lo cambies en el POS."
              checked={!hasOverride}
              onChange={() => setHasOverride(false)}
            />
            <RadioCard
              name="priceMode"
              label="Poner un precio propio"
              description="Cuadre de Caja deja de mandar en el precio online de este producto."
              checked={hasOverride}
              onChange={() => setHasOverride(true)}
            />
          </div>
          {hasOverride && (
            <div className="mt-2">
              <Field
                id="priceOverride"
                label="Precio propio"
                help={`Se guarda en ${product.syncedPriceCurrency}, la moneda que Cuadre de Caja manda hoy para este producto.`}
                error={fieldErrors.priceOverride}
              >
                {(controlProps) => (
                  <input
                    {...controlProps}
                    inputMode="decimal"
                    value={priceOverride}
                    onChange={(e) => setPriceOverride(e.target.value)}
                    className="border-border w-full max-w-40 rounded-md border px-3 py-2 text-sm"
                  />
                )}
              </Field>
            </div>
          )}
        </fieldset>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={disabled}>
            {outcome.kind === "submitting" ? "Guardando…" : "Guardar cambios"}
          </Button>
          {outcome.kind === "submitting" && (
            <span aria-busy="true" className="text-fg-muted text-sm">
              Guardando…
            </span>
          )}
        </div>
      </fieldset>

      <noscript>
        <Alert tone="warning" className="mt-4">
          Para editar este producto necesitas activar JavaScript. Lo que está publicado se ve más
          arriba.
        </Alert>
      </noscript>

      <div className="mt-8 border-t pt-6">
        <ImageUploader
          storeId={storeId}
          storeProductId={product.id}
          imageUrls={imageUrls}
          onChange={setImageUrls}
          disabled={Boolean(product.deletedAt)}
        />
      </div>
    </form>
  );
}
