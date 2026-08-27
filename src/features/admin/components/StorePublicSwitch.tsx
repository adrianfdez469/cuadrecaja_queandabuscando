"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { RadioCard } from "@/components/ui/RadioCard";
import { StoreClosedNotice } from "@/components/store/StoreClosedNotice";
import { STORE_DISABLED_REASONS, STORE_DISABLED_REASON_CODES } from "@/constants/storeClosure";
import { classifyStoreClosure } from "@/lib/storeClosure";
import type { AdminStoreRow } from "../types";

type Status = "PUBLISHED" | "SUSPENDED" | "DRAFT";

type SwitchOutcome =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "forbidden" }
  | { kind: "failed" }
  | { kind: "missing_message" };

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const formatted = new Date(iso).toLocaleString("es-CU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  // es-CU renders "p. m." with its own trailing period — strip it so the
  // sentence around this value ends in exactly one, not two.
  return formatted.replace(/\.$/, "");
}

/**
 * HD10-HD15: the panel's on/off switch. First card of the hub — it is the
 * action with the most consequences, so it is never buried under read-only
 * data (design.md § 9). `"use client"` because there is no previewing the
 * shopper's exact notice, and no immediate feedback, without state.
 */
export function StorePublicSwitch({
  storeId,
  storeName,
  status: initialStatus,
  disabledReasonCode: initialReasonCode,
  disabledMessage: initialMessage,
  disabledAt: initialDisabledAt,
  whatsapp,
  phone,
  address,
}: {
  storeId: string;
  storeName: string;
  status: Status;
  disabledReasonCode: string | null;
  disabledMessage: string | null;
  disabledAt: string | null;
  whatsapp: string | null;
  phone: string | null;
  address: string | null;
}) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [disabledReasonCode, setDisabledReasonCode] = useState(initialReasonCode);
  const [disabledMessage, setDisabledMessage] = useState(initialMessage);
  const [disabledAt, setDisabledAt] = useState(initialDisabledAt);
  const [outcome, setOutcome] = useState<SwitchOutcome>({ kind: "idle" });
  const [closing, setClosing] = useState(false);
  const [reasonCode, setReasonCode] = useState<string>(STORE_DISABLED_REASON_CODES[0]);
  const [message, setMessage] = useState("");

  const submitting = outcome.kind === "submitting";

  async function send(
    body: { enabled: true } | { enabled: false; reasonCode: string; message: string | null },
  ) {
    setOutcome({ kind: "submitting" });
    try {
      const response = await fetch(`/api/admin/stores/${storeId}/status`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        const value = (await response.json()) as AdminStoreRow;
        setStatus(value.status);
        setDisabledReasonCode(value.disabledReasonCode);
        setDisabledMessage(value.disabledMessage);
        setDisabledAt(value.disabledAt);
        setClosing(false);
        setOutcome({ kind: "idle" });
        return;
      }
      if (response.status === 400) {
        const data = (await response.json()) as { issues?: { path: unknown[] }[] };
        const onMessage = data.issues?.some((issue) => issue.path[0] === "message");
        setOutcome(onMessage ? { kind: "missing_message" } : { kind: "failed" });
        return;
      }
      if (response.status === 403) {
        setOutcome({ kind: "forbidden" });
        return;
      }
      setOutcome({ kind: "failed" });
    } catch {
      setOutcome({ kind: "failed" });
    }
  }

  if (status === "DRAFT") {
    return (
      <Alert tone="muted">
        Esta tienda todavía no está publicada. Se publica desde Cuadre de Caja; después vas a poder
        abrirla y cerrarla desde aquí.
      </Alert>
    );
  }

  const attribution = classifyStoreClosure({ disabledReasonCode, disabledAt });

  if (status === "PUBLISHED" && !closing) {
    return (
      <div>
        <h2 className="text-lg font-semibold">Tu tienda al público</h2>
        <Badge tone="positive" className="mt-2">
          Abierta
        </Badge>
        <p className="mt-2 text-sm">Tus clientes pueden ver el catálogo y hacer pedidos.</p>
        <div className="mt-3 flex gap-3">
          <Button variant="secondary" disabled={submitting} onClick={() => setClosing(true)}>
            Cerrar la tienda al público
          </Button>
        </div>
      </div>
    );
  }

  if (status === "SUSPENDED" && !closing) {
    return (
      <div>
        <h2 className="text-lg font-semibold">Tu tienda al público</h2>
        <Badge tone="warning" className="mt-2">
          Cerrada
        </Badge>
        <Alert tone="warning" className="mt-2">
          <p>
            {attribution === "admin" && `La cerraste tú el ${formatDate(disabledAt)}.`}
            {attribution === "pos" && `La cerró Cuadre de Caja el ${formatDate(disabledAt)}.`}
            {attribution === "never_opened" && "Nunca la abriste al público."}
            {attribution === "platform" && "Esta tienda está suspendida por queandabuscando."}
          </p>
          {attribution === "pos" && (
            <p className="mt-1">
              Si no fuiste tú, alguien la desactivó en Cuadre de Caja. Puedes volver a abrirla desde
              aquí; manda la última acción, venga de donde venga.
            </p>
          )}
        </Alert>

        <div className="mt-3 max-w-md">
          <StoreClosedNotice
            storeName={storeName}
            disabledReasonCode={disabledReasonCode}
            disabledMessage={disabledMessage}
            disabledAt={disabledAt ? new Date(disabledAt) : null}
            whatsapp={whatsapp}
            phone={phone}
            address={address}
          />
        </div>
        <p className="text-fg-muted mt-2 text-sm">
          Así se ve el aviso. La cabecera con los colores de tu tienda no se muestra aquí.
        </p>

        <div className="mt-3 flex gap-3">
          {attribution !== "platform" && (
            <Button disabled={submitting} onClick={() => send({ enabled: true })}>
              {submitting ? "Abriendo…" : "Abrir la tienda al público"}
            </Button>
          )}
          {attribution !== "platform" && (
            <Button variant="secondary" disabled={submitting} onClick={() => setClosing(true)}>
              Cambiar el motivo
            </Button>
          )}
        </div>
        {attribution === "platform" && (
          <p className="text-fg-muted mt-2 text-sm">
            Esto no se resuelve desde aquí: escribe a soporte.
          </p>
        )}
        {outcome.kind === "forbidden" && (
          <Alert tone="danger" className="mt-3">
            Ya no tienes permiso para abrir o cerrar esta tienda.
          </Alert>
        )}
        {outcome.kind === "failed" && (
          <Alert tone="danger" className="mt-3">
            No pudimos guardar el cambio. Intenta de nuevo.
          </Alert>
        )}
      </div>
    );
  }

  // Closing form: shared by "cerrar por primera vez" and "cambiar el motivo".
  const previewMessage = message.trim() === "" ? null : message;
  return (
    <div>
      <h2 className="text-lg font-semibold">Tu tienda al público</h2>

      <fieldset disabled={submitting} className="mt-3 space-y-4">
        <fieldset>
          <legend className="font-medium">¿Por qué la cierras?</legend>
          <div className="mt-2 space-y-2">
            {STORE_DISABLED_REASON_CODES.map((code) => (
              <RadioCard
                key={code}
                name="reasonCode"
                label={STORE_DISABLED_REASONS[code] ?? "Otro motivo"}
                description={STORE_DISABLED_REASONS[code] ?? "Escribe el mensaje abajo."}
                checked={reasonCode === code}
                onChange={() => setReasonCode(code)}
              />
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="storeClosureMessage" className="text-fg mb-1 block text-sm font-medium">
            Mensaje para tus clientes {reasonCode === "OTRO" ? "" : "(opcional)"}
          </label>
          <textarea
            id="storeClosureMessage"
            maxLength={140}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="border-border w-full rounded-md border px-3 py-2 text-sm"
          />
          {outcome.kind === "missing_message" && (
            <p className="text-danger mt-1 text-xs">
              Escribe el mensaje que van a leer tus clientes.
            </p>
          )}
        </div>

        <div className="max-w-md">
          <p className="text-fg-muted mb-1 text-xs">Así se ve el aviso:</p>
          <StoreClosedNotice
            storeName={storeName}
            disabledReasonCode={reasonCode}
            disabledMessage={previewMessage}
            disabledAt={new Date()}
            whatsapp={whatsapp}
            phone={phone}
            address={address}
          />
        </div>

        <ul className="text-fg-muted list-disc space-y-1 pl-5 text-sm">
          <li>Tus clientes van a ver el mensaje que elijas, no tu catálogo.</li>
          <li>Nadie va a poder hacer pedidos nuevos.</li>
          <li>
            Los pedidos que ya te hicieron no se cancelan, y los sigues recibiendo en Cuadre de
            Caja.
          </li>
          <li>Puedes volver a abrirla en cualquier momento desde aquí.</li>
        </ul>

        <div className="flex gap-3">
          <Button
            variant="secondary"
            onClick={() => send({ enabled: false, reasonCode, message: previewMessage })}
          >
            {submitting ? "Cerrando…" : "Sí, cerrar la tienda"}
          </Button>
          <Button variant="ghost" onClick={() => setClosing(false)}>
            No cerrar
          </Button>
        </div>
      </fieldset>
    </div>
  );
}
