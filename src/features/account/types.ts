/**
 * Flat, `"use client"`-safe shapes only — no Zod, no Prisma (architecture.md
 * § Rutas nuevas). What crosses into the browser is exactly these three
 * strings-or-null and one boolean, never `id`, `supabaseUserId` or a date —
 * same rule as F-010 R22.
 */
export type AccountProfile = {
  name: string | null;
  phone: string | null;
  email: string | null;
};

export type AccountState = {
  signedIn: boolean;
  profile: AccountProfile | null;
};

/** The four ways this app lets a shopper start a session (R2: all give the same account). */
export type OAuthProvider = "google" | "facebook" | "apple";
