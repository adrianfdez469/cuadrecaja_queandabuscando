import { Badge } from "@/components/ui/Badge";
import type { OrderStatus } from "@/generated/prisma/enums";

/**
 * `OrderStatus` → label in Spanish + tone + a one-line explanation
 * (design.md pantalla 4). Server component, no directive: the confirmation
 * page has zero client modules of its own (DP2), and this never needs one.
 */

type Tone = "positive" | "warning" | "muted" | "danger";

function describe(
  status: OrderStatus,
  hasDelivery: boolean,
): { label: string; tone: Tone; explanation: string } {
  switch (status) {
    case "PENDING":
      return {
        label: "Pendiente de confirmación",
        tone: "positive",
        explanation: "La tienda todavía no lo revisó.",
      };
    case "PULLED":
      return {
        label: "Recibido por la tienda",
        tone: "positive",
        explanation: "La tienda ya lo tiene en su sistema.",
      };
    case "CONFIRMED":
      return {
        label: "Confirmado",
        tone: "positive",
        explanation: "La tienda confirmó tu pedido.",
      };
    case "READY":
      return hasDelivery
        ? { label: "Listo para enviar", tone: "positive", explanation: "Va en camino." }
        : {
            label: "Listo para recoger",
            tone: "positive",
            explanation: "Puedes pasar a recogerlo.",
          };
    case "DELIVERED":
      return { label: "Entregado", tone: "muted", explanation: "Gracias por tu compra." };
    case "CANCELLED":
      return {
        label: "Cancelado",
        tone: "danger",
        explanation: "La tienda canceló este pedido. Si no sabes por qué, contáctala.",
      };
  }
}

export function OrderStatusBadge({
  status,
  hasDelivery,
}: {
  status: OrderStatus;
  hasDelivery: boolean;
}) {
  const { label, tone, explanation } = describe(status, hasDelivery);
  return (
    <div>
      <Badge tone={tone}>{label}</Badge>
      <p className="text-fg-muted mt-1 text-sm">{explanation}</p>
    </div>
  );
}
