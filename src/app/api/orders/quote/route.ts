import { NextResponse } from "next/server";
import { quoteRequestSchema } from "@/features/orders/schemas";
import { quoteBySlug, toQuoteResponse } from "@/features/orders/server/quote";
import { NO_STORE, readJsonBody, zodIssuesToInvalidBody } from "../_lib/body";

export const dynamic = "force-dynamic";

/**
 * The single source of price the cart and the checkout both read (§
 * architecture.md decisión 2). 200 while the store exists AND is published —
 * a line that cannot be sold travels inside `lines` with `orderable: false`
 * (`toQuoteResponse`); a store that exists but is closed (HD10-HD15) is a
 * 409 `STORE_CLOSED`, not folded into a line.
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = quoteRequestSchema.safeParse(body.json);
  if (!parsed.success) return zodIssuesToInvalidBody(parsed.error);

  try {
    const result = await quoteBySlug(parsed.data.storeSlug, parsed.data.items);
    switch (result.kind) {
      case "not_found":
        return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404, headers: NO_STORE });
      case "closed":
        return NextResponse.json(
          {
            error: "STORE_CLOSED",
            reasonCode: result.reasonCode,
            message: result.message,
            disabledAt: result.disabledAt,
          },
          { status: 409, headers: NO_STORE },
        );
      case "ok":
        return NextResponse.json(toQuoteResponse(result.quote), { headers: NO_STORE });
    }
  } catch (error) {
    console.error("[orders/quote] failed", error);
    return NextResponse.json({ error: "QUOTE_FAILED" }, { status: 500, headers: NO_STORE });
  }
}
