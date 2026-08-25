import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { serverEnv } from "@/lib/env";

/**
 * Admin session — the ONLY place admin identity is read or written.
 *
 * Admins authenticate with their cuadrecaja credentials, but this app never
 * sees them: cuadrecaja mints a short-lived, single-use SSO token and this app
 * exchanges it for its own session cookie. No password hash is ever replicated.
 */

export const ADMIN_COOKIE = "qab-admin-session";
const SESSION_HOURS = 12;

export type AdminSession = {
  adminUserId: string;
  externalId: string;
  name: string;
  email?: string;
  businessId: string;
  /** Store ids this admin may manage, as signed by cuadrecaja. */
  storeIds: string[];
};

function secret(): Uint8Array {
  return new TextEncoder().encode(serverEnv().ADMIN_SESSION_SECRET);
}

export async function createAdminSession(session: AdminSession): Promise<void> {
  const token = await new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret());

  const store = await cookies();
  store.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 60 * 60,
  });
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      adminUserId: String(payload.adminUserId),
      externalId: String(payload.externalId),
      name: String(payload.name),
      email: payload.email ? String(payload.email) : undefined,
      businessId: String(payload.businessId),
      storeIds: Array.isArray(payload.storeIds) ? payload.storeIds.map(String) : [],
    };
  } catch {
    // Expired or tampered. Treat exactly like "not signed in".
    return null;
  }
}

export async function destroyAdminSession(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
}

/** Authorisation check for any store-scoped admin action. */
export function canManageStore(session: AdminSession | null, storeId: string): boolean {
  return Boolean(session?.storeIds.includes(storeId));
}
