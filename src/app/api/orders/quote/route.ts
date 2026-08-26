import { NextResponse } from "next/server";
import { quoteRequestSchema } from "@/features/orders/schemas";
import { quoteBySlug, toQuoteResponse } from "@/features/orders/server/quote";
import { NO_STORE, readJsonBody, zodIssuesToInvalidBody } from "../_lib/body";

export const dynamic = "force-dynamic";

/**
 * The single source of price the cart and the checkout both read (§
 * architecture.md decisión 2). Always 200 while the store exists — a line
 * that cannot be sold travels inside `lines` with `orderable: false`, never
 * as a request-level error (`toQuoteResponse`).
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = quoteRequestSchema.safeParse(body.json);
  if (!parsed.success) return zodIssuesToInvalidBody(parsed.error);

  try {
    const quote = await quoteBySlug(parsed.data.storeSlug, parsed.data.items);
    if (!quote) {
      return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json(toQuoteResponse(quote), { headers: NO_STORE });
  } catch (error) {
    console.error("[orders/quote] failed", error);
    return NextResponse.json({ error: "QUOTE_FAILED" }, { status: 500, headers: NO_STORE });
  }
}
