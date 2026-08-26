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
