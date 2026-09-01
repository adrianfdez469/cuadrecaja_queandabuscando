import { Badge } from "@/components/ui/Badge";
import type { OrderCancelledBy, OrderStatus } from "@/generated/prisma/enums";

/**
 * `OrderStatus` → label in Spanish + tone + a one-line explanation
 * (design.md pantalla 4). Server component, no directive: the confirmation
 * page has zero client modules of its own (DP2), and this never needs one.
 *
 * F-019: the switch grew three cases (`AWAITING_CUSTOMER`, `IN_TRANSIT`,
 * `REJECTED_BY_STORE`) and stays exhaustive WITHOUT a `default` — that is the
 * guardrail (spec.md I1): letting the enum grow without this component
 * failing to typecheck would ship a status the page cannot describe. Two of
 * the nine cases branch again inside their own `case`, on inputs the switch
 * itself does not vary on: `AWAITING_CUSTOMER` on whether the deadline
 * already passed, and `CANCELLED` on who closed it (R9).
 */

type Tone = "positive" | "warning" | "muted" | "danger";

type Described = { label: string; tone: Tone; explanation: string };

function describe(
  status: OrderStatus,
  hasDelivery: boolean,
  cancelledBy: OrderCancelledBy | null,
  proposalExpired: boolean,
  deliveryFeePending: boolean,
): Described {
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
    case "AWAITING_CUSTOMER":
      if (proposalExpired) {
        return {
          label: "Sin respuesta a tiempo",
          tone: "danger",
          explanation:
            "El plazo para responder se acabó. La tienda va a cancelar el pedido; si todavía lo quieres, escríbele.",
        };
      }
      return {
        label: "Esperando tu respuesta",
        tone: "warning",
        explanation: deliveryFeePending
          ? "La tienda ya puso el costo del envío. Apruébalo o recházalo aquí abajo."
          : "La tienda propuso un cambio en tu pedido. Apruébalo o recházalo aquí abajo.",
      };
    case "CONFIRMED":
      return {
        label: "Confirmado",
        tone: "positive",
        explanation: "La tienda confirmó tu pedido.",
      };
    case "READY":
      // F-019 criterio 9: this line used to say "Va en camino.", which is
      // exactly what IN_TRANSIT means now. Two different statuses can no
      // longer say the same thing.
      return hasDelivery
        ? {
            label: "Listo para enviar",
            tone: "positive",
            explanation: "La tienda lo tiene listo para salir.",
          }
        : {
            label: "Listo para recoger",
            tone: "positive",
            explanation: "Puedes pasar a recogerlo.",
          };
    case "IN_TRANSIT":
      return hasDelivery
        ? {
            label: "En camino",
            tone: "positive",
            explanation: "Tu pedido va hacia la dirección que dejaste. Ten el teléfono a mano.",
          }
        : {
            label: "La tienda lo puso en camino",
            tone: "warning",
            explanation:
              "Tu pedido era para recogerlo en la tienda, así que escríbeles antes de ir: puede que te lo estén llevando.",
          };
    case "DELIVERED":
      return { label: "Entregado", tone: "muted", explanation: "Gracias por tu compra." };
    case "CANCELLED":
      switch (cancelledBy) {
        case "CUSTOMER":
          return {
            label: "Cancelado por ti",
            tone: "muted",
            explanation:
              "Rechazaste el cambio que propuso la tienda, así que el pedido se canceló. Puedes hacer otro cuando quieras.",
          };
        case "EXPIRY":
          // F-031 I7: a customer whose order expired with the delivery fee
          // still unquoted never saw a proposal to answer — telling them one
          // "vencía sin respuesta" would describe an event they never had.
          return deliveryFeePending
            ? {
                label: "Cancelado: se venció el plazo",
                tone: "danger",
                explanation:
                  "La tienda no llegó a confirmar el costo del envío y el plazo del pedido se acabó. No se te cobró nada; si todavía lo quieres, escríbele.",
              }
            : {
                label: "Cancelado: no respondiste a tiempo",
                tone: "danger",
                explanation:
                  "La propuesta de la tienda venció sin respuesta y el pedido se canceló. Si todavía lo quieres, escríbele a la tienda.",
              };
        case "STORE":
          return {
            label: "Cancelado por la tienda",
            tone: "danger",
            explanation: "La tienda canceló este pedido. Si no sabes por qué, contáctala.",
          };
        default:
          // Rows cancelled before this feature: the column is nullable and
          // this is the F-010 text, unchanged (PP4 — not a word moves).
          return {
            label: "Cancelado",
            tone: "danger",
            explanation: "La tienda canceló este pedido. Si no sabes por qué, contáctala.",
          };
      }
    case "REJECTED_BY_STORE":
      return {
        label: "Rechazado por la tienda",
        tone: "danger",
        explanation:
          "La tienda no pudo atender este pedido. No se te cobró nada. Si quieres saber por qué, escríbele.",
      };
  }
}

export function OrderStatusBadge({
  status,
  hasDelivery,
  cancelledBy = null,
  proposalExpired = false,
  deliveryFeePending = false,
}: {
  status: OrderStatus;
  hasDelivery: boolean;
  /** R9: which of the three terminal outcomes closed a CANCELLED order. */
  cancelledBy?: OrderCancelledBy | null;
  /** Only meaningful for `AWAITING_CUSTOMER` (E12). */
  proposalExpired?: boolean;
  /** F-031 I7: the order's own "sin cotizar" boolean — bifurcates
   *  `AWAITING_CUSTOMER`'s explanation and `CANCELLED`/`EXPIRY`'s label so
   *  neither ever tells a customer about a proposal they never saw. */
  deliveryFeePending?: boolean;
}) {
  const { label, tone, explanation } = describe(
    status,
    hasDelivery,
    cancelledBy,
    proposalExpired,
    deliveryFeePending,
  );
  return (
    <div>
      <Badge tone={tone}>{label}</Badge>
      <p className="text-fg-muted mt-1 text-sm">{explanation}</p>
    </div>
  );
}
