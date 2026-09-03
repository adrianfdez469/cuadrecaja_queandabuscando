import { prisma } from "@/lib/prisma";
import type { OrderStatus } from "@/generated/prisma/enums";
import { readAfterExpirySweeps } from "./expiry";
import { PULLED_ORDER_SELECT, toPulledOrder, type PulledOrder } from "./pulledOrder";

/**
 * F-033 architecture.md DA1/DA5: las DOS lecturas laterales. Deliberadamente
 * NO importa `./pull` — así R7 ("la lectura lateral NO marca `PENDING ->
 * PULLED`") se sostiene por construcción: la escritura masiva que marca los
 * pedidos como pulleados no está en el grafo de imports de este módulo, ni
 * por descuido. (Verificación del paso 5 del plan: este archivo no contiene
 * la palabra que nombra esa llamada de Prisma.)
 */

/** El cuerpo que las DOS lecturas laterales producen. `nextCursor` no está
 *  aquí a propósito: es de la respuesta HTTP y vale `null` siempre (R1,
 *  DA7 — lo pone la ruta, en un único sitio). */
export type LateralOrders = { orders: PulledOrder[]; nextAfter: string | null };

/**
 * `?status=<UN estado>&after=<id>&limit=<n>` (E1-E5, R5, R10, R11, R12).
 * Encaja en el índice `(businessId, status, id)` que ya existe (DA5): la
 * igualdad de `status`, la igualdad de `businessId` y el rango `id > after`,
 * con el propio orden del índice sirviendo el `ORDER BY` — sin `Sort`, sin
 * `Seq Scan`, sin migración.
 */
export async function readOrdersByStatus(input: {
  businessId: string;
  status: OrderStatus;
  after: bigint;
  limit: number;
}): Promise<LateralOrders> {
  const { businessId, status, after, limit } = input;

  const rows = await readAfterExpirySweeps(
    businessId,
    prisma.order.findMany({
      where: { businessId, status, id: { gt: after } },
      orderBy: { id: "asc" },
      take: limit,
      select: PULLED_ORDER_SELECT,
    }),
  );

  const orders = rows.map(toPulledOrder);
  const last = rows.at(-1);
  return {
    orders,
    // R11: la misma convención que `nextCursor` — solo no nulo cuando la
    // página vino LLENA, porque una página a medias ya prueba que no queda
    // nada detrás.
    nextAfter: rows.length === limit && last ? last.id.toString() : null,
  };
}

/**
 * `?ids=<a>,<b>` (E6-E9, R3, R4, R9). No usa el índice `(businessId, status,
 * id)` — sin filtro por `status` no aplica, `status` es la columna del medio
 * — y no lo necesita: se resuelve por la clave primaria con el tope de 100
 * (validado en `internalOrdersQuery.ts`) como cota dura, independiente del
 * tamaño de la tabla (architecture.md DA5).
 */
export async function readOrdersByIds(input: {
  businessId: string;
  ids: bigint[];
}): Promise<LateralOrders> {
  const { businessId, ids } = input;
  // E9: un id repetido se sirve una sola vez. El tope de 100 ya se contó
  // sobre lo que el POS envió (E12), así que deduplicar aquí es solo una
  // propiedad de la consulta, no una segunda comprobación del tope.
  const dedupedIds = Array.from(new Set(ids));

  const rows = await readAfterExpirySweeps(
    businessId,
    prisma.order.findMany({
      where: { businessId, id: { in: dedupedIds } },
      orderBy: { id: "asc" }, // E5
      select: PULLED_ORDER_SELECT,
    }),
  );

  return { orders: rows.map(toPulledOrder), nextAfter: null };
}
