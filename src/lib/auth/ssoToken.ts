import { jwtVerify } from "jose";
import { z } from "zod";

/**
 * One-time SSO token minted by cuadrecaja.
 *
 * Short TTL, single use enforced by recording the `jti`. This is the only
 * inbound trust relationship for admin identity, so the payload is validated
 * strictly rather than spread into a session.
 */

export const ssoPayloadSchema = z.object({
  jti: z.string().min(8),
  sub: z.string().min(1), // cuadrecaja Usuario id
  name: z.string().min(1),
  email: z.email().optional(),
  businessId: z.string().min(1), // cuadrecaja Negocio id
  storeIds: z.array(z.string().min(1)).default([]),
  exp: z.number(),
});

export type SsoPayload = z.infer<typeof ssoPayloadSchema>;

export type SsoVerification =
  { ok: true; payload: SsoPayload } | { ok: false; reason: "invalid" | "expired" | "malformed" };

export async function verifySsoToken(
  token: string,
  sharedSecret: string,
): Promise<SsoVerification> {
  let claims: Record<string, unknown>;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(sharedSecret), {
      // 30s of clock tolerance: the two deployments are separate machines and a
      // 60-second token is unforgiving of even small drift.
      clockTolerance: 30,
    });
    claims = payload as Record<string, unknown>;
  } catch (error) {
    const code = (error as { code?: string }).code;
    return { ok: false, reason: code === "ERR_JWT_EXPIRED" ? "expired" : "invalid" };
  }

  const parsed = ssoPayloadSchema.safeParse(claims);
  if (!parsed.success) return { ok: false, reason: "malformed" };

  return { ok: true, payload: parsed.data };
}
