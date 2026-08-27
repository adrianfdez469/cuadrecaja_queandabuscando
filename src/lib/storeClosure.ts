import {
  PLATFORM_ROLLOUT_REASON_CODE,
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

/** `null` when the store published neither a WhatsApp nor a phone number. */
export function buildStoreClosureWhatsappUrl(input: {
  storeName: string;
  whatsapp: string | null;
  phone: string | null;
}): string | null {
  const number = input.whatsapp ?? input.phone;
  if (!number) return null;
  const digits = number.replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(WHATSAPP_MESSAGE(input.storeName))}`;
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
