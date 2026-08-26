import { formatMoney, type Money } from "@/lib/money";
import { formatOrderCode } from "@/lib/orderCode";
import { WHATSAPP_MESSAGE_MAX_LINES } from "@/constants/orders";

/**
 * Builds the `wa.me` link for the order confirmation page (E18). Pure: no
 * Prisma, no fetch — it only formats what it is given, which is what makes it
 * safe to call from a server component.
 *
 * Server-only. Only `checkoutMode = WHATSAPP` calls this from the page; the
 * link is an atajo opcional (DP1), never a required step.
 */

export type WhatsappOrderLine = {
  quantity: string;
  name: string;
  lineTotal: Money;
};

export type WhatsappOrderInput = {
  storeName: string;
  /** `Store.whatsapp ?? Store.phone`. No number, no link. */
  whatsappNumber: string | null;
  code: string;
  lines: WhatsappOrderLine[];
  subtotal: Money;
  deliveryFee: Money;
  total: Money;
  fulfillment: "PICKUP" | "DELIVERY";
  deliveryAddress: string | null;
  contactName: string;
  contactPhone: string;
  /** Absolute URL of `/[slug]/pedido/[code]`. */
  orderUrl: string;
};

/** Digits only, no `+` — that is the format wa.me expects in its path. */
function onlyDigits(input: string): string {
  return input.replace(/\D/g, "");
}

function buildMessage(input: WhatsappOrderInput): string {
  const visibleLines = input.lines.slice(0, WHATSAPP_MESSAGE_MAX_LINES);
  const hiddenCount = input.lines.length - visibleLines.length;

  const lineTexts = visibleLines.map(
    (line) => `${line.quantity} x ${line.name} — ${formatMoney(line.lineTotal)}`,
  );
  if (hiddenCount > 0) {
    lineTexts.push(`… y ${hiddenCount} productos más (están en el enlace).`);
  }

  const deliveryLine =
    input.fulfillment === "DELIVERY" ? [`Envío: ${formatMoney(input.deliveryFee)}`] : [];

  const entrega =
    input.fulfillment === "DELIVERY"
      ? `Envío a ${input.deliveryAddress ?? ""}`
      : "Recoger en la tienda";

  return [
    `Hola ${input.storeName}, acabo de hacer un pedido en su tienda.`,
    "",
    `Código: ${formatOrderCode(input.code)}`,
    "",
    ...lineTexts,
    "",
    `Subtotal: ${formatMoney(input.subtotal)}`,
    ...deliveryLine,
    `Total: ${formatMoney(input.total)}`,
    "",
    `Entrega: ${entrega}`,
    `A nombre de: ${input.contactName} (${input.contactPhone})`,
    "",
    `Ver el pedido: ${input.orderUrl}`,
  ].join("\n");
}

/** `null` when the store has no WhatsApp/phone number published (E18). */
export function buildWhatsappUrl(input: WhatsappOrderInput): string | null {
  if (!input.whatsappNumber) return null;
  const digits = onlyDigits(input.whatsappNumber);
  if (!digits) return null;

  const message = buildMessage(input);
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
