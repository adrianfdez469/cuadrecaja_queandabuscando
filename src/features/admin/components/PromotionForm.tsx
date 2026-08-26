"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { RadioCard } from "@/components/ui/RadioCard";
import { PROMOTION_NAME_MAX_LENGTH } from "@/constants/promotions";
import type { AdminPromotionRow } from "../types";

type Scope = "PRODUCT" | "CATEGORY" | "ORDER";
type PromotionType = "PERCENTAGE" | "FIXED";

type FieldErrors = Partial<Record<string, string>>;

/**
 * Alta y edición (design.md § 6). Un `<form>`, cinco bloques. La misma
 * pantalla sirve para las dos: con `promotion` puesto, es una edición.
 */
export function PromotionForm({
  storeId,
  baseCurrencyCode,
  categories,
  initialProductIds,
  promotion,
}: {
  storeId: string;
  baseCurrencyCode: string;
  categories: { id: string; name: string }[];
  /** Selected from `?productos=id,id` on the listing (design.md § 6). */
  initialProductIds?: string[];
  promotion?: AdminPromotionRow;
}) {
  const router = useRouter();
  const conditions = (promotion?.conditions ?? {}) as Record<string, unknown>;

  const [name, setName] = useState(promotion?.name ?? "");
  const [type, setType] = useState<PromotionType>(promotion?.type ?? "PERCENTAGE");
  const [scope, setScope] = useState<Scope>(promotion?.scope ?? "PRODUCT");
  const [value, setValue] = useState(promotion?.value ?? "");
  const [productIds, setProductIds] = useState<string[]>(
    (conditions.storeProductIds as string[] | undefined) ?? initialProductIds ?? [],
  );
  const [categoryId, setCategoryId] = useState<string>(
    ((conditions.localCategoryIds as string[] | undefined) ?? [])[0] ?? categories[0]?.id ?? "",
  );
  const [minSubtotal, setMinSubtotal] = useState((conditions.minSubtotal as string | null) ?? "");
  const [startsAt, setStartsAt] = useState(
    promotion ? promotion.startsAt.slice(0, 16) : new Date().toISOString().slice(0, 16),
  );
  const [endsAt, setEndsAt] = useState(promotion?.endsAt?.slice(0, 16) ?? "");
  const [active, setActive] = useState(promotion?.active ?? true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [outcome, setOutcome] = useState<"idle" | "submitting" | "failed" | "forbidden">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setOutcome("submitting");
    setErrors({});

    const body = {
      name: name.trim() === "" ? null : name,
      type,
      scope,
      value,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      active,
      conditions:
        scope === "PRODUCT"
          ? { storeProductIds: productIds }
          : scope === "CATEGORY"
            ? { localCategoryIds: categoryId ? [categoryId] : [] }
            : { minSubtotal: minSubtotal.trim() === "" ? null : minSubtotal },
    };

    const url = promotion
      ? `/api/admin/stores/${storeId}/promotions/${promotion.id}`
      : `/api/admin/stores/${storeId}/promotions`;

    try {
      const response = await fetch(url, {
        method: promotion ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        router.push(`/admin/tiendas/${storeId}/promociones`);
        router.refresh();
        return;
      }
      if (response.status === 400) {
        const data = (await response.json()) as { issues?: { path: unknown[]; message: string }[] };
        const next: FieldErrors = {};
        for (const issue of data.issues ?? []) {
          const key = String(issue.path[0] ?? "form");
          next[key] = issue.message;
        }
        setErrors(next);
        setOutcome("idle");
        return;
      }
      setOutcome(response.status === 403 ? "forbidden" : "failed");
    } catch {
      setOutcome("failed");
    }
  }

  const submitting = outcome === "submitting";

  return (
    <form onSubmit={submit}>
      {outcome === "forbidden" && (
        <Alert tone="danger" className="mb-4">
          Ya no tienes permiso sobre esta tienda.
        </Alert>
      )}
      {outcome === "failed" && (
        <Alert tone="danger" className="mb-4">
          No se pudo guardar. Intenta de nuevo.
        </Alert>
      )}

      <fieldset disabled={submitting} className="space-y-6">
        <Field
          id="promoName"
          label="Nombre para ti"
          help="Solo lo ves tú; tus clientes no."
          error={errors.name}
        >
          {(controlProps) => (
            <input
              {...controlProps}
              maxLength={PROMOTION_NAME_MAX_LENGTH}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border-border w-full rounded-md border px-3 py-2 text-sm"
            />
          )}
        </Field>

        <fieldset>
          <legend className="font-medium">Tipo de descuento</legend>
          <div className="mt-2 space-y-2">
            <RadioCard
              name="type"
              label="Porcentaje"
              description="Baja un % del precio."
              checked={type === "PERCENTAGE"}
              onChange={() => setType("PERCENTAGE")}
            />
            <RadioCard
              name="type"
              label="Monto fijo"
              description="Baja una cantidad fija."
              checked={type === "FIXED"}
              onChange={() => setType("FIXED")}
            />
          </div>
        </fieldset>

        <Field
          id="promoValue"
          label="Cuánto"
          help={
            type === "PERCENTAGE"
              ? "Entre 0 y 100. Ej.: 20 para un 20 % de descuento."
              : `El monto se entiende en ${baseCurrencyCode}, la moneda base de tu negocio.`
          }
          error={errors.value}
        >
          {(controlProps) => (
            <input
              {...controlProps}
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="border-border w-full max-w-40 rounded-md border px-3 py-2 text-sm"
            />
          )}
        </Field>

        <fieldset>
          <legend className="font-medium">¿A qué se le aplica?</legend>
          <div className="mt-2 space-y-2">
            <RadioCard
              name="scope"
              label="Productos elegidos"
              description={`${productIds.length} elegidos.`}
              checked={scope === "PRODUCT"}
              onChange={() => setScope("PRODUCT")}
            />
            <RadioCard
              name="scope"
              label="Una categoría"
              checked={scope === "CATEGORY"}
              onChange={() => setScope("CATEGORY")}
            />
            <RadioCard
              name="scope"
              label="Todo el pedido"
              checked={scope === "ORDER"}
              onChange={() => setScope("ORDER")}
            />
          </div>

          {scope === "PRODUCT" && (
            <div className="mt-2">
              {productIds.length === 0 ? (
                <p className="text-fg-muted text-sm">Todavía no elegiste ningún producto.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {productIds.map((id) => (
                    <li key={id} className="flex items-center justify-between gap-2">
                      <span className="text-fg-muted truncate">{id}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setProductIds((ids) => ids.filter((existing) => existing !== id))
                        }
                        className="text-danger shrink-0 underline"
                      >
                        Quitar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <a
                href={`/admin/tiendas/${storeId}/productos`}
                className="text-brand mt-1 inline-block hover:underline"
              >
                Elegir otros productos
              </a>
            </div>
          )}

          {scope === "CATEGORY" && (
            <div className="mt-2">
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="border-border rounded-md border px-3 py-2 text-sm"
              >
                {categories.length === 0 && <option value="">No hay categorías</option>}
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <p className="text-fg-muted mt-1 text-xs">
                Se aplica a todos los productos de esa categoría, también a los que lleguen después.
              </p>
            </div>
          )}

          {scope === "ORDER" && (
            <div className="mt-2">
              <Field
                id="minSubtotal"
                label="Mínimo de compra (opcional)"
                error={errors["conditions"]}
              >
                {(controlProps) => (
                  <input
                    {...controlProps}
                    inputMode="decimal"
                    value={minSubtotal}
                    onChange={(e) => setMinSubtotal(e.target.value)}
                    className="border-border w-full max-w-40 rounded-md border px-3 py-2 text-sm"
                  />
                )}
              </Field>
              <p className="text-fg-muted mt-1 text-xs">
                Si lo dejas vacío, se aplica a cualquier pedido.
              </p>
            </div>
          )}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="startsAt" label="Empieza" error={errors.startsAt}>
            {(controlProps) => (
              <input
                {...controlProps}
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="border-border w-full rounded-md border px-3 py-2 text-sm"
              />
            )}
          </Field>
          <Field id="endsAt" label="Termina (opcional)" error={errors.endsAt}>
            {(controlProps) => (
              <input
                {...controlProps}
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="border-border w-full rounded-md border px-3 py-2 text-sm"
              />
            )}
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Activar ahora
        </label>

        <p className="text-fg-muted text-sm">
          Los cambios se ven en tu tienda enseguida. Cuando una promoción empieza o termina por su
          fecha, puede tardar hasta una hora en reflejarse.
        </p>

        <Button type="submit" disabled={submitting}>
          {submitting ? "Guardando…" : promotion ? "Guardar cambios" : "Crear promoción"}
        </Button>
      </fieldset>

      <noscript>
        <Alert tone="warning" className="mt-4">
          Para crear o editar promociones necesitas activar JavaScript.
        </Alert>
      </noscript>
    </form>
  );
}
