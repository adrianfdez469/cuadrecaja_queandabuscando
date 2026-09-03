import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ORDER_EXPIRED_PROPOSAL_REASON,
  ORDER_UNQUOTED_DELIVERY_EXPIRED_REASON,
} from "@/constants/orders";

/**
 * El barrido del vencimiento (architecture.md DA5, § "El reloj").
 *
 * ONE `UPDATE` condition on `(status, expiresAt)`, optionally narrowed to a
 * `businessId`. Deliberately returns the un-awaited `PrismaPromise` instead
 * of `await`ing it here: `pull.ts` needs to hand this to
 * `prisma.$transaction([…])` in ARRAY form — never the interactive
 * callback, ficha `pooler-transaccion-deadlock` — so the barrido and the
 * `findMany` that follows run in the SAME round-trip and the POS never
 * receives a row this call is, in that same instant, cancelling out from
 * under it.
 *
 * Idempotent by construction (R14): `status = 'AWAITING_CUSTOMER'` is part
 * of the condition, and the barrido itself removes rows from that set — a
 * second run affects 0 rows because nothing left matches, not because
 * anything keeps count of whether it already ran.
 */
export function expireProposalsQuery(businessId?: string) {
  const scope = businessId ? Prisma.sql`AND "businessId" = ${businessId}` : Prisma.empty;

  return prisma.$executeRaw(Prisma.sql`
    UPDATE "Order"
       SET status              = 'CANCELLED'::"OrderStatus",
           "cancelledBy"       = 'EXPIRY'::"OrderCancelledBy",
           "proposalOutcome"   = 'EXPIRED'::"ProposalOutcome",
           "proposalDecidedAt" = now(),
           "cancelReason"      = ${ORDER_EXPIRED_PROPOSAL_REASON},
           "updatedAt"         = now()
     WHERE status = 'AWAITING_CUSTOMER'::"OrderStatus"
       AND "expiresAt" < now()
       ${scope}
  `);
}

/**
 * El reloj del pedido cuyo envío nadie cotizó (F-031 DA4, architecture.md).
 *
 * Vive junto a `expireProposalsQuery` a propósito: los dos barridos
 * comparten cuatro invariantes que solo se auditan leyéndolos juntos —una
 * sola sentencia, sin `$transaction` interactivo (R16, ficha
 * `pooler-transaccion-deadlock`), la `PrismaPromise` devuelta sin `await`
 * para que `pull.ts` la entregue en la forma de array que ya usa
 * (`pull.ts:104-106`), e idempotencia por construcción— y sobre todo porque
 * R15 se demuestra comparando sus dos `WHERE`: el de arriba escribe SOLO
 * sobre `AWAITING_CUSTOMER`; este lo EXCLUYE por lista blanca
 * (`status IN ('PENDING','PULLED','CONFIRMED')`, nunca un `!=`), así que un
 * estado que se añada mañana al enum no se cuela en el barrido por
 * descuido. Los dos `WHERE` son disjuntos por `status`, así que compartir
 * transacción con el `findMany` no crea orden significativo entre ellos.
 *
 * Cuenta desde `createdAt` (SP1), no desde `expiresAt`: un pedido en
 * `AWAITING_CUSTOMER` nunca lo toca este barrido, tenga la propuesta que
 * tenga — tiene su propio reloj, el de arriba.
 *
 * Sí alcanza a `CONFIRMED` (decisión del humano, plan.md § Preguntas antes
 * de aprobar: "el pedido CONFIRMED sin cotizar también vence"): el `409` de
 * `setOrderStatus` le impide avanzar, así que sin este barrido quedaría
 * vivo para siempre.
 *
 * Idempotente por construcción (R16): `status` está en la condición y el
 * propio barrido saca de la lista blanca a las filas que toca (pasan a
 * `CANCELLED`), así que una segunda pasada afecta 0 filas porque no queda
 * nada que cumpla el `WHERE`, no porque alguien lleve la cuenta.
 *
 * No toca `proposalOutcome` ni `proposalDecidedAt` — a diferencia del
 * barrido de arriba —, porque un pedido que este barrido alcanza nunca tuvo
 * propuesta viva ni resuelta: aprobar deja `deliveryFee` no nulo (sale del
 * barrido), y rechazar o vencer una propuesta deja `CANCELLED` (sale de la
 * lista blanca).
 */
export function expireUnquotedDeliveryOrdersQuery(businessId?: string) {
  const scope = businessId ? Prisma.sql`AND o."businessId" = ${businessId}` : Prisma.empty;

  return prisma.$executeRaw(Prisma.sql`
    UPDATE "Order" o
       SET status         = 'CANCELLED'::"OrderStatus",
           "cancelledBy"  = 'EXPIRY'::"OrderCancelledBy",
           "cancelReason" = ${ORDER_UNQUOTED_DELIVERY_EXPIRED_REASON},
           "updatedAt"    = now()
      FROM "Store" s
     WHERE o."storeId" = s.id
       AND o."deliveryFee" IS NULL
       AND o.status IN ('PENDING', 'PULLED', 'CONFIRMED')
       AND o."createdAt" < now() - make_interval(hours => s."orderExpiryHours")
       ${scope}
  `);
}

/**
 * F-033 DA2: toda lectura de pedidos del POS —el pull incremental y las dos
 * lecturas laterales— barre primero y lee después, en la MISMA
 * `$transaction([...])` en forma de array (nunca el callback interactivo,
 * ficha `pooler-transaccion-deadlock`). `read` llega SIN `await`: una
 * promesa ya resuelta no es una `PrismaPromise` y no se puede transaccionar
 * — el compilador lo rechaza, que es justo el punto. Ir primero es lo que
 * deja que `read` vea su propia escritura: el POS nunca recibe un
 * `AWAITING_CUSTOMER` que esta misma llamada acaba de vencer (R8).
 */
export async function readAfterExpirySweeps<T>(
  businessId: string,
  read: Prisma.PrismaPromise<T>,
): Promise<T> {
  const [, , rows] = await prisma.$transaction([
    expireProposalsQuery(businessId),
    expireUnquotedDeliveryOrdersQuery(businessId),
    read,
  ]);
  return rows;
}
