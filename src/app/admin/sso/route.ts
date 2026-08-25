import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAdminSession } from "@/lib/auth/adminSession";
import { verifySsoToken } from "@/lib/auth/ssoToken";

export const dynamic = "force-dynamic";

/**
 * Exchange a one-time SSO token from cuadrecaja for a local admin session.
 *
 * The admin's cuadrecaja password never reaches this system. What arrives is a
 * short-lived signed assertion of who they are and which stores they may
 * manage; the `jti` is consumed so the link cannot be replayed from a browser
 * history or a shared URL.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return deny("missing_token");

  const secret = process.env.SSO_JWT_SECRET;
  if (!secret || secret.length < 32) {
    console.error("[admin/sso] SSO_JWT_SECRET is not configured");
    return deny("unavailable");
  }

  const verified = await verifySsoToken(token, secret);
  if (!verified.ok) return deny(verified.reason);

  const { jti, sub, name, email, businessId, storeIds } = verified.payload;

  // Single use. The unique constraint on `jti` is what enforces it: a second
  // exchange loses the race and is rejected, with no read-then-write window.
  try {
    await prisma.ssoTokenUse.create({
      data: { jti, expiresAt: new Date(verified.payload.exp * 1000) },
    });
  } catch {
    return deny("already_used");
  }

  const business = await prisma.business.findUnique({
    where: { externalId: businessId },
    select: { id: true },
  });
  if (!business) return deny("unknown_business");

  const stores = await prisma.store.findMany({
    where: { externalId: { in: storeIds }, businessId: business.id },
    select: { id: true },
  });

  const adminUser = await prisma.adminUser.upsert({
    where: { externalId: sub },
    create: { externalId: sub, businessId: business.id, name, email, lastLoginAt: new Date() },
    update: { businessId: business.id, name, email, lastLoginAt: new Date() },
    select: { id: true },
  });

  // Access is re-derived from the token on every login rather than accumulated,
  // so revoking a store in the POS takes effect on the admin's next sign-in.
  await prisma.adminStoreAccess.deleteMany({ where: { adminUserId: adminUser.id } });
  if (stores.length > 0) {
    await prisma.adminStoreAccess.createMany({
      data: stores.map((store) => ({ adminUserId: adminUser.id, storeId: store.id })),
      skipDuplicates: true,
    });
  }

  await createAdminSession({
    adminUserId: adminUser.id,
    externalId: sub,
    name,
    email,
    businessId: business.id,
    storeIds: stores.map((store) => store.id),
  });

  return NextResponse.redirect(new URL("/admin", request.url));
}

function deny(reason: string) {
  return NextResponse.json({ error: "SSO_REJECTED", reason }, { status: 401 });
}
