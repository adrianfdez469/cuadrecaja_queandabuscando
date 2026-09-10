import {
  PLATFORM_ROLLOUT_REASON_CODE,
  PRICES_UNAVAILABLE_REASON_CODE,
  STORE_DISABLED_REASONS,
  isStoreDisabledReasonCode,
  type StoreDisabledReasonCode,
} from "@/constants/storeClosure";

/**
 * Resolves the one sentence a closed store's page shows for "why" (design.md
 * § 8, three sub-cases of HD15). Pure — safe to import from a server page,
 * from `StoreClosedNotice`, or from the checkout island that needs to show
 * the SAME sentence for a 409 `STORE_CLOSED` (no second implementation to
 * drift from the first).
 */
export function resolveStoreClosureHeadline(input: {
  disabledReasonCode: string | null;
  disabledAt: Date | string | null;
}): string {
  const code = input.disabledReasonCode;

  if (code && code in STORE_DISABLED_REASONS) {
    return STORE_DISABLED_REASONS[code as StoreDisabledReasonCode] ?? "";
  }
  if (code === PLATFORM_ROLLOUT_REASON_CODE) {
    return "Esta tienda todavía no está tomando pedidos por internet.";
  }
  // F-040 (architecture.md AD8, design.md § Textos, DP1): the store is NOT
  // closed — `disabledAt` may well be null — so this branch has to come
  // BEFORE the `disabledAt` fallback below, or a store with no `disabledAt`
  // of its own would fall through to the neutral platform phrase instead.
  if (code === PRICES_UNAVAILABLE_REASON_CODE) {
    return "Esta tienda no puede mostrar sus precios ahora mismo, así que no está tomando pedidos.";
  }
  if (input.disabledAt) {
    // The POS closed it (publishToStore: false) without a reason of its own.
    return "Esta tienda no está tomando pedidos por ahora.";
  }
  // SUSPENDED with neither a reason nor a disabledAt: nothing in this
  // feature's own flows produces this today, but a future platform-level
  // suspension would land here — deliberately neutral (DP10).
  return "Esta tienda no está disponible en este momento.";
}

const WHATSAPP_MESSAGE = (storeName: string) =>
  `Hola ${storeName}, vi su tienda online. ¿Cuándo vuelven a tomar pedidos?`;

/**
 * F-040 (design.md DP3, decidido por el humano el 2026-09-10): el ÚNICO
 * canal por el que el comerciante puede enterarse de que su tienda está
 * muda, con el panel fuera (SP1). Cambia solo en esta rama — el mensaje de
 * una tienda cerrada de verdad (`WHATSAPP_MESSAGE`) no se toca.
 */
const WHATSAPP_MESSAGE_PRICES_UNAVAILABLE = (storeName: string) =>
  `Hola ${storeName}, vi su tienda online pero no me aparecen los precios. ¿Me los pueden decir?`;

/** `null` when the store published neither a WhatsApp nor a phone number. */
export function buildStoreClosureWhatsappUrl(input: {
  storeName: string;
  whatsapp: string | null;
  phone: string | null;
  /** F-040: selects the prescribed message. `undefined`/any other code keeps
   *  today's closed-store message untouched. */
  disabledReasonCode?: string | null;
}): string | null {
  const number = input.whatsapp ?? input.phone;
  if (!number) return null;
  const digits = number.replace(/\D/g, "");
  if (!digits) return null;
  const message =
    input.disabledReasonCode === PRICES_UNAVAILABLE_REASON_CODE
      ? WHATSAPP_MESSAGE_PRICES_UNAVAILABLE(input.storeName)
      : WHATSAPP_MESSAGE(input.storeName);
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/**
 * F-040 (design.md § Textos): the last line `StoreClosedNotice` shows below
 * the WhatsApp button and the address. Cierta palabra por palabra — la
 * invalidación de R10 hace exactamente eso, sin que el comprador tenga que
 * recargar a mano.
 */
export function resolveStoreClosureClosingLine(disabledReasonCode: string | null): string {
  if (disabledReasonCode === PRICES_UNAVAILABLE_REASON_CODE) {
    return "Esta página se actualiza sola en cuanto la tienda vuelva a mostrar precios.";
  }
  return "Esta página se actualiza sola cuando la tienda vuelva a abrir.";
}

export type StoreClosureAttribution = "admin" | "pos" | "never_opened" | "platform";

/**
 * Who closed the store (HD15, "quién cerró", design.md § 9). Distinct from
 * `resolveStoreClosureHeadline`, which is what the SHOPPER reads — this one
 * is for the admin's own hub and listing, and needs a different phrase per
 * case ("La cerraste tú...", "La cerró Cuadre de Caja...").
 */
export function classifyStoreClosure(input: {
  disabledReasonCode: string | null;
  disabledAt: Date | string | null;
}): StoreClosureAttribution {
  if (input.disabledReasonCode === PLATFORM_ROLLOUT_REASON_CODE) return "never_opened";
  if (input.disabledReasonCode && isStoreDisabledReasonCode(input.disabledReasonCode)) {
    return "admin";
  }
  if (input.disabledAt) return "pos";
  return "platform";
}
