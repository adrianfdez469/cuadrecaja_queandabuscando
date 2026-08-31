import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronSecret } from "../_lib/guard";

export const dynamic = "force-dynamic";

/**
 * SsoTokenUse only exists to make a token single-use. Once a row is past the
 * token's own expiry, replaying it would fail on expiry anyway, so the row has
 * no further purpose and the table would otherwise grow forever.
 *
 * F-019: the guard used to be inline here; it is now `_lib/guard.ts`, shared
 * with `crons/expire-proposals` — this is the route the pattern was copied
 * from, so it is the one that lost its own copy.
 */
export async function GET(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  const { count } = await prisma.ssoTokenUse.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });

  return NextResponse.json({ purged: count });
}
