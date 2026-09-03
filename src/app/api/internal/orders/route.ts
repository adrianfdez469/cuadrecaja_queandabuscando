import { NextResponse } from "next/server";
import { withInternalAuth } from "../_lib/guard";
import { parseInternalOrdersQuery } from "@/features/orders/internalOrdersQuery";
import { pullOrders } from "@/features/orders/server/pull";
import { readOrdersByIds, readOrdersByStatus } from "@/features/orders/server/lateralRead";

export const dynamic = "force-dynamic";

/**
 * The POS pulls new orders. Nothing here ever calls out to cuadrecaja.
 *
 * F-033 (v8): three modes, dispatched by `parseInternalOrdersQuery` (DA3).
 * `?since=`/`?limit=` (or neither) is the pull incremental of always, same
 * body as v7 (criterio 13). `?status=` and `?ids=` are the two lateral
 * reads (architecture.md DA7): they never move the cursor, so
 * `nextCursor: null` is set HERE, once, for both — neither lateral function
 * can "remember" to emit one.
 */
export const GET = withInternalAuth(async (request, caller) => {
  const parsed = parseInternalOrdersQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: "INVALID_QUERY", issues: parsed.issues }, { status: 400 });
  }

  try {
    const query = parsed.query;
    if (query.mode === "pull") {
      // EXACTAMENTE tres argumentos: route.test.ts lo afirma y no se edita.
      return NextResponse.json(await pullOrders(caller.businessId, query.since, query.limit));
    }

    const lateral =
      query.mode === "status"
        ? await readOrdersByStatus({
            businessId: caller.businessId,
            status: query.status,
            after: query.after,
            limit: query.limit,
          })
        : await readOrdersByIds({ businessId: caller.businessId, ids: query.ids });

    // R1: la lectura lateral no lleva cursor. Un solo sitio, los dos modos.
    return NextResponse.json({
      orders: lateral.orders,
      nextCursor: null,
      nextAfter: lateral.nextAfter,
    });
  } catch (error) {
    console.error("[internal/orders] pull failed", error);
    return NextResponse.json({ error: "PULL_FAILED" }, { status: 500 });
  }
});
