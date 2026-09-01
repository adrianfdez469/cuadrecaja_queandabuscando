/**
 * Order and checkout limits.
 *
 * Split from `constants/cart.ts` because these govern the server side of the
 * checkout (the code, the request body, the abuse guard, contact field
 * lengths) rather than the shape the client keeps in `localStorage`.
 */

/** Crockford base32, without I/L/O/U — they get confused when dictated aloud. */
export const ORDER_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** 10 chars * log2(32) = 50 bits of randomness. */
export const ORDER_CODE_LENGTH = 10;
/** How many times to retry generating `code` on a unique-constraint collision. */
export const ORDER_CODE_MAX_RETRIES = 5;

/** Hard cap on the request body of the two public order endpoints. */
export const ORDER_MAX_BODY_BYTES = 32 * 1024;

/** R30: creation is capped per store + normalized phone within this window. */
export const ORDER_RATE_LIMIT_MAX_PENDING = 5;
export const ORDER_RATE_LIMIT_WINDOW_MINUTES = 10;

export const CONTACT_NAME_MIN_LENGTH = 2;
export const CONTACT_NAME_MAX_LENGTH = 80;
export const CONTACT_PHONE_MIN_DIGITS = 8;
export const CONTACT_PHONE_MAX_DIGITS = 15;
export const CONTACT_EMAIL_MAX_LENGTH = 120;
export const DELIVERY_ADDRESS_MIN_LENGTH = 5;
export const DELIVERY_ADDRESS_MAX_LENGTH = 300;
export const ORDER_NOTES_MAX_LENGTH = 500;

/** The wa.me message keeps only this many lines before summarizing the rest. */
export const WHATSAPP_MESSAGE_MAX_LINES = 10;

// ---------------------------------------------------------------------------
// F-019 — renegotiation
// ---------------------------------------------------------------------------

/** architecture.md § Modelo de datos: the store's message to the customer. */
export const ORDER_PROPOSAL_MESSAGE_MAX_LENGTH = 500;

/**
 * Values of the `decision` form field on
 * `POST /[slug]/pedido/[code]/respuesta` (architecture.md DA4). Spanish, like
 * `?admin=sesion-requerida` in `src/proxy.ts` — this is what the customer's
 * own browser submits.
 */
export const ORDER_PROPOSAL_DECISION = {
  APPROVE: "aprobar",
  REJECT: "rechazar",
} as const;
export type OrderProposalDecision =
  (typeof ORDER_PROPOSAL_DECISION)[keyof typeof ORDER_PROPOSAL_DECISION];

/**
 * Values of the `?r=` redirect param the response route uses to tell the
 * page what just happened (architecture.md DA4 § "Un contrato, dos
 * representaciones"). An unrecognized or absent value paints nothing (A3).
 */
export const ORDER_RESPONSE_OUTCOME = {
  APPROVED: "aprobada",
  REJECTED: "rechazada",
  CONFLICT: "conflicto",
  EXPIRED: "vencida",
  UNAVAILABLE: "no-disponible",
  RATE_LIMITED: "demasiados-intentos",
} as const;
export type OrderResponseOutcome =
  (typeof ORDER_RESPONSE_OUTCOME)[keyof typeof ORDER_RESPONSE_OUTCOME];

/**
 * DA3: rejecting is a route the customer reaches with NO free-text field —
 * ADR 0024 defensa 6, "el comprador no aporta texto". `cancelReason` is this
 * fixed, server-owned string, not anything typed by a person.
 */
export const ORDER_REJECTED_BY_CUSTOMER_REASON = "El comprador rechazó el cambio propuesto.";

/** R6: literal text, exactly. Criterio 4 greps for this string. */
export const ORDER_EXPIRED_PROPOSAL_REASON = "La propuesta venció sin respuesta";

/** ADR 0024 defensa 7: hard cap on the response route's body. */
export const ORDER_RESPONSE_MAX_BODY_BYTES = 1024;

// ---------------------------------------------------------------------------
// F-031 — envío cotizado al gestionar
// ---------------------------------------------------------------------------

/**
 * R15/I7: motivo propio del vencimiento del pedido cuyo envío nadie cotizó,
 * distinto de `ORDER_EXPIRED_PROPOSAL_REASON` (esa es la propuesta vencida;
 * esta es el pedido que nunca llegó a tener propuesta). Literal, fijado en
 * la v6 de `docs/sync-contract.md`: no se reformula ni se le cambia una
 * tilde (decisión AP2 del humano).
 */
export const ORDER_UNQUOTED_DELIVERY_EXPIRED_REASON =
  "El pedido venció sin que la tienda cotizara el envío";

/**
 * E10/DA5: los tres destinos de `POST /api/internal/orders/status` que
 * exigen el envío ya cotizado. `CONFIRMED`, `CANCELLED` y
 * `REJECTED_BY_STORE` se siguen aceptando con el envío pendiente.
 */
export const ORDER_STATUSES_REQUIRING_QUOTED_DELIVERY = [
  "READY",
  "IN_TRANSIT",
  "DELIVERED",
] as const;
