import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * SsoTokenUse only exists to make a token single-use. Once a row is past the
 * token's own expiry, replaying it would fail on expiry anyway, so the row has
 * no further purpose and the table would otherwise grow forever.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { count } = await prisma.ssoTokenUse.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });

  return NextResponse.json({ purged: count });
}
