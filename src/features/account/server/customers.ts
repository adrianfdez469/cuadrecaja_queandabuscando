import { prisma } from "@/lib/prisma";
import { CONTACT_EMAIL_MAX_LENGTH, CONTACT_NAME_MAX_LENGTH } from "@/constants/orders";
import { normalizeName } from "@/features/orders/contact";
import { isUniqueViolation } from "@/features/orders/server/prismaErrors";
import type { CustomerUser } from "@/lib/auth/customerSession";
import type { AccountProfile } from "../types";

/**
 * `Customer`, and ONLY `Customer` — the one place under `src/features/account/`
 * that touches Prisma (AGENTS.md § Arquitectura: a feature's own server/
 * directory is the only layer that may).
 */

const PROFILE_SELECT = { name: true, phone: true, email: true } as const;

/** R9: what a first-time email must NOT keep — nothing past the checkout's own bound. */
function seedEmail(email: string | null): string | null {
  if (!email) return null;
  const trimmed = email.trim();
  if (!trimmed || trimmed.length > CONTACT_EMAIL_MAX_LENGTH) return null;
  return trimmed;
}

/** R9: `null` when the provider's name does not even reach the checkout's minimum. */
function seedName(fullName: string | null): string | null {
  if (!fullName) return null;
  const normalized = normalizeName(fullName);
  if (normalized.length < 2 || normalized.length > CONTACT_NAME_MAX_LENGTH) return null;
  return normalized;
}

/**
 * R12, E5-E8: idempotent by `supabaseUserId`, one round-trip in both normal
 * paths (first login and every login after). `upsert` compiles to a native
 * `INSERT … ON CONFLICT` on a single-column unique `where` with no nested
 * writes — no `$transaction`, which is what the pooler's transaction mode
 * would deadlock against (ficha `pooler-transaccion-deadlock`).
 *
 * `update: {}` is what makes R10 true: logging in again with a different
 * `full_name` never touches the row. And the `where` is `supabaseUserId`
 * ONLY — never `email` (R8, E7): an old row with the same email and a null
 * `supabaseUserId` is invisible to this `where` and is left alone; a new
 * row is created instead.
 */
export async function ensureCustomerForUser(user: CustomerUser): Promise<AccountProfile> {
  const seed = {
    supabaseUserId: user.id,
    email: seedEmail(user.email),
    name: seedName(user.fullName),
    phone: null, // R9: never from the provider.
  };

  try {
    return await prisma.customer.upsert({
      where: { supabaseUserId: user.id },
      create: seed,
      update: {},
      select: PROFILE_SELECT,
    });
  } catch (error) {
    if (!isUniqueViolation(error, "supabaseUserId")) throw error;

    // E8: lost the race. Re-read the winning row rather than propagate the
    // collision — the caller (and the shopper) never sees a 5xx for this.
    const won = await prisma.customer.findUnique({
      where: { supabaseUserId: user.id },
      select: PROFILE_SELECT,
    });
    if (won) return won;
    throw error;
  }
}

/** Used only to link an order (architecture.md § DA2) — never authorizes anything by itself. */
export async function findCustomerIdByUserId(supabaseUserId: string): Promise<string | null> {
  const row = await prisma.customer.findUnique({
    where: { supabaseUserId },
    select: { id: true },
  });
  return row?.id ?? null;
}

/** `GET /api/account/profile`, and `/cuenta`'s server read. */
export async function getProfileByUserId(supabaseUserId: string): Promise<AccountProfile | null> {
  return prisma.customer.findUnique({
    where: { supabaseUserId },
    select: PROFILE_SELECT,
  });
}

/**
 * `PUT /api/account/profile`. Filters by `supabaseUserId`, NEVER by `id`
 * (R20, E11): even if a request body smuggled an `id`, there is no path by
 * which it reaches this `where`.
 */
export async function updateProfileByUserId(
  supabaseUserId: string,
  profile: { name: string; phone: string; email: string },
): Promise<AccountProfile> {
  return prisma.customer.update({
    where: { supabaseUserId },
    data: {
      name: profile.name === "" ? null : profile.name,
      phone: profile.phone === "" ? null : profile.phone,
      email: profile.email === "" ? null : profile.email,
    },
    select: PROFILE_SELECT,
  });
}
