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
  /** F-031 R1/R19: `null` = the delivery fee is not quoted yet. Never a
   *  plain `"$0.00"` standing in for "sin cotizar" (E13, R1). */
  deliveryFee: Money | null;
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

  // F-031 R1/E13: "por confirmar" here is lowercase — mid-sentence after a
  // colon, unlike the capitalized "Por confirmar" of the on-screen cells
  // (design.md § 4).
  const deliveryFeePending = input.deliveryFee === null;
  const deliveryLine =
    input.fulfillment === "DELIVERY"
      ? [`Envío: ${input.deliveryFee === null ? "por confirmar" : formatMoney(input.deliveryFee)}`]
      : [];
  const totalLine = deliveryFeePending
    ? `Total parcial: ${formatMoney(input.total)} más el envío por confirmar`
    : `Total: ${formatMoney(input.total)}`;

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
    totalLine,
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

// ---------------------------------------------------------------------------
// F-019 — the two renegotiation links. Both pure, both server-only.
// ---------------------------------------------------------------------------

export type ProposalWhatsappReason = "NO_PHONE_DIGITS";

export type ProposalWhatsappResult = {
  url: string | null;
  /** R13: set only when `url` is `null`, so the caller can persist WHY. */
  reason: ProposalWhatsappReason | null;
};

/**
 * The store → customer link E1/E24 return: it is what the ENCARGADO clicks
 * to send (R12 — nobody here sends anything automatically). Built from the
 * customer's phone on the persisted order, never from a form the store
 * fills out by hand.
 *
 * Deliberately generic copy, not "hay una propuesta": E1 needs it right
 * after proposing, but E24 needs the SAME builder for an `ONSITE` order that
 * never had a proposal at all — the pull returns it for every order (I3),
 * not only ones with a live proposal. What both need is just a link the
 * customer can open; the order's own page is what says what changed.
 *
 * R13: an unusable phone does not fail the proposal — it returns `null` with
 * a reason, and the clock still runs (R6 closes it regardless).
 */
export function buildProposalWhatsappUrl(input: {
  customerPhone: string;
  storeName: string;
  code: string;
  orderUrl: string;
}): ProposalWhatsappResult {
  const digits = onlyDigits(input.customerPhone);
  if (!digits) return { url: null, reason: "NO_PHONE_DIGITS" };

  const message = [
    `Hola, aquí está el enlace a tu pedido en ${input.storeName}.`,
    `Código: ${formatOrderCode(input.code)}`,
    input.orderUrl,
  ].join("\n");

  return { url: `https://wa.me/${digits}?text=${encodeURIComponent(message)}`, reason: null };
}

/**
 * The short customer → store link ("Escribirle a la tienda", design.md § "El
 * wa.me corto hacia la tienda"). Deliberately carries no amount: the totals
 * are in discussion while a proposal is live, and putting either version in
 * the message would lock one in.
 */
export function buildCustomerContactUrl(input: {
  storeWhatsappNumber: string | null;
  storeName: string;
  code: string;
}): string | null {
  if (!input.storeWhatsappNumber) return null;
  const digits = onlyDigits(input.storeWhatsappNumber);
  if (!digits) return null;

  const message = `Hola ${input.storeName}, es sobre mi pedido ${formatOrderCode(input.code)}.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
