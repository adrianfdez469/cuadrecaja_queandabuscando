"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import type { AdminPromotionRow } from "../types";

type Outcome = { kind: "idle" } | { kind: "busy" } | { kind: "forbidden" } | { kind: "failed" };

/**
 * design.md § 5: activar/desactivar es un PATCH inmediato sin confirmación
 * (reversible de un toque); borrar pide confirmación en línea. "La única
 * isla discutible del feature" (architecture.md § Coste de cliente) — un
 * `<form method="post">` por fila haría lo mismo con cero JS, pero perdería
 * la confirmación en línea sin recargar.
 *
 * `PUT`/`PATCH` replace the whole promotion (architecture.md § Endpoints),
 * so toggling `active` sends the row back with only that one field flipped
 * — never a partial `{ active: ... }` body, which `.strict()` would reject.
 */
export function PromotionActions({
  storeId,
  promotion,
}: {
  storeId: string;
  promotion: AdminPromotionRow;
}) {
  const router = useRouter();
  const { id: promotionId, active } = promotion;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  async function toggleActive() {
    setOutcome({ kind: "busy" });
    try {
      const response = await fetch(`/api/admin/stores/${storeId}/promotions/${promotionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: promotion.name,
          type: promotion.type,
          scope: promotion.scope,
          value: promotion.value,
          startsAt: promotion.startsAt,
          endsAt: promotion.endsAt,
          active: !active,
          conditions: promotion.conditions,
        }),
      });
      if (response.ok) {
        setOutcome({ kind: "idle" });
        router.refresh();
        return;
      }
      setOutcome(response.status === 403 ? { kind: "forbidden" } : { kind: "failed" });
    } catch {
      setOutcome({ kind: "failed" });
    }
  }

  async function confirmDelete() {
    setOutcome({ kind: "busy" });
    try {
      const response = await fetch(`/api/admin/stores/${storeId}/promotions/${promotionId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setOutcome({ kind: "idle" });
        router.refresh();
        return;
      }
      setOutcome(response.status === 403 ? { kind: "forbidden" } : { kind: "failed" });
    } catch {
      setOutcome({ kind: "failed" });
    }
  }

  const busy = outcome.kind === "busy";

  return (
    <div className="flex items-center gap-3 text-sm">
      <a
        href={`/admin/tiendas/${storeId}/promociones/${promotionId}`}
        className="text-brand hover:underline"
      >
        Editar
      </a>
      <button
        type="button"
        disabled={busy}
        onClick={toggleActive}
        className="text-brand hover:underline"
      >
        {active ? "Desactivar" : "Activar"}
      </button>
      {confirmingDelete ? (
        <span className="flex items-center gap-2">
          ¿Borrar esta promoción?
          <button
            type="button"
            disabled={busy}
            onClick={confirmDelete}
            className="text-danger font-medium"
          >
            Sí, borrar
          </button>
          <button type="button" onClick={() => setConfirmingDelete(false)}>
            No
          </button>
        </span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirmingDelete(true)}
          className="text-danger hover:underline"
        >
          Borrar
        </button>
      )}
      {outcome.kind === "forbidden" && (
        <Alert tone="danger">Ya no tienes permiso sobre esta promoción.</Alert>
      )}
      {outcome.kind === "failed" && <Alert tone="danger">No se pudo completar la acción.</Alert>}
    </div>
  );
}
