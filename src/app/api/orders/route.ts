import { NextResponse } from "next/server";
import { createOrderRequestSchema } from "@/features/orders/schemas";
import { createOrder, type CreateOrderResult } from "@/features/orders/server/createOrder";
import { NO_STORE, readJsonBody, zodIssuesToInvalidBody } from "./_lib/body";

export const dynamic = "force-dynamic";

/**
 * The only public write in the system (docs/adr/0016). No session, no
 * cookie read (R24, criterio 4) — the request is self-sufficient. All the
 * decisions live in `createOrder.ts`; this route only maps its result to
 * HTTP, which is the layering AGENTS.md fixes for `src/app/`.
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = createOrderRequestSchema.safeParse(body.json);
  if (!parsed.success) return zodIssuesToInvalidBody(parsed.error);

  try {
    const result = await createOrder(parsed.data);
    return toResponse(result);
  } catch (error) {
    console.error("[orders] create failed", error);
    return NextResponse.json({ error: "ORDER_CREATE_FAILED" }, { status: 500, headers: NO_STORE });
  }
}

function toResponse(result: CreateOrderResult): NextResponse {
  switch (result.kind) {
    case "created":
      return NextResponse.json(
        { code: result.code, orderUrl: result.orderUrl, whatsappUrl: result.whatsappUrl },
        { status: 201, headers: NO_STORE },
      );
    case "idempotent":
      return NextResponse.json(
        {
          code: result.code,
          orderUrl: result.orderUrl,
          whatsappUrl: result.whatsappUrl,
          idempotent: true as const,
        },
        { status: 200, headers: NO_STORE },
      );
    case "empty_cart":
      return NextResponse.json({ error: "EMPTY_CART" }, { status: 400, headers: NO_STORE });
    case "store_not_found":
      return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404, headers: NO_STORE });
    case "items_unavailable":
      return NextResponse.json(
        { error: "ITEMS_UNAVAILABLE", lines: result.lines },
        { status: 409, headers: NO_STORE },
      );
    case "price_changed":
      return NextResponse.json(
        { error: "PRICE_CHANGED", lines: result.lines, total: result.total },
        { status: 409, headers: NO_STORE },
      );
    case "too_many_orders":
      return NextResponse.json(
        { error: "TOO_MANY_ORDERS", retryAfterSeconds: result.retryAfterSeconds },
        {
          status: 429,
          headers: { ...NO_STORE, "Retry-After": String(result.retryAfterSeconds) },
        },
      );
    case "failed":
      return NextResponse.json(
        { error: "ORDER_CREATE_FAILED" },
        { status: 500, headers: NO_STORE },
      );
  }
}
