import { z } from "zod";
import {
  CONTACT_EMAIL_MAX_LENGTH,
  CONTACT_NAME_MAX_LENGTH,
  CONTACT_PHONE_MAX_DIGITS,
  CONTACT_PHONE_MIN_DIGITS,
} from "@/constants/orders";
import { normalizeName, normalizePhone } from "@/features/orders/contact";
import { OTP_CODE_LENGTH } from "@/constants/account";
import type { OAuthProvider } from "./types";

/**
 * Server only — importing this from a client island would drag Zod into a
 * bundle that has to stay small (architecture.md § Componentes, same reason
 * `src/features/orders/schemas.ts` gives). `SignInCard` and `ProfileForm`
 * never validate; they only paint the `issues` a 400 sends back.
 */

/**
 * R15: the SAME limits and rules as the order's contact — an empty string
 * means "clear this field" (persisted as `null`); it is the only value this
 * schema treats specially, because a profile can be incomplete but never
 * hold something the checkout would go on to reject.
 */
const optionalName = z
  .string()
  .transform((value) => normalizeName(value))
  .refine((value) => value === "" || value.length >= 2, "Name is too short")
  .refine((value) => value.length <= CONTACT_NAME_MAX_LENGTH, "Name is too long");

const optionalPhone = z
  .string()
  .transform((value) => (value.trim() === "" ? "" : normalizePhone(value)))
  .refine((value) => {
    if (value === "") return true;
    const digits = value.startsWith("+") ? value.slice(1) : value;
    return (
      /^\d+$/.test(digits) &&
      digits.length >= CONTACT_PHONE_MIN_DIGITS &&
      digits.length <= CONTACT_PHONE_MAX_DIGITS
    );
  }, `Phone must have between ${CONTACT_PHONE_MIN_DIGITS} and ${CONTACT_PHONE_MAX_DIGITS} digits`);

const optionalEmail = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length <= CONTACT_EMAIL_MAX_LENGTH, "Email is too long")
  .refine((value) => value === "" || z.string().email().safeParse(value).success, "Invalid email");

/** `PUT /api/account/profile` (R15, R20). No `id`, no `supabaseUserId` — by construction. */
export const accountProfileSchema = z.object({
  name: optionalName,
  phone: optionalPhone,
  email: optionalEmail,
});

export type AccountProfileInput = z.infer<typeof accountProfileSchema>;

/** `POST /api/account/otp` (E1). */
export const sendOtpRequestSchema = z.object({
  email: z.string().trim().min(1).email(),
});

/** `POST /api/account/otp/verify` (E1, E21, E22). */
export const verifyOtpRequestSchema = z.object({
  email: z.string().trim().min(1).email(),
  token: z.string().trim().length(OTP_CODE_LENGTH).regex(/^\d+$/, "Must be digits only"),
});

const oauthProviderSchema = z.enum([
  "google",
  "facebook",
  "apple",
]) satisfies z.ZodType<OAuthProvider>;

/** `POST /api/account/oauth` (E2, E23). `next` is re-validated server-side by `safeNextPath`. */
export const startOAuthRequestSchema = z.object({
  provider: oauthProviderSchema,
  next: z.string().optional(),
});
