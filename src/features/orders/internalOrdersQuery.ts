import { z } from "zod";
import { OrderStatus } from "@/generated/prisma/enums";
import { serializableIssues, type SerializableIssue } from "@/lib/httpJson";
import {
  ORDER_ID_MAX,
  ORDER_LATERAL_IDS_MAX,
  ORDER_PULL_LIMIT_DEFAULT,
  ORDER_PULL_LIMIT_MAX,
  ORDER_PULL_LIMIT_MIN,
  ORDER_QUERY_ISSUE,
} from "@/constants/orders";

/**
 * F-033 architecture.md DA3: THE module that interprets `GET
 * /api/internal/orders`'s querystring vocabulary — presencia primero, luego
 * modo, luego el Zod de ese modo. Pure: no Prisma, no Request. Precedente de
 * colocación: `features/catalog/catalogFilters.ts` (F-027), el módulo que
 * ese feature created to be the one place that reads a path's querystring.
 */

export type InternalOrdersQuery =
  | { mode: "pull"; since: bigint; limit: number }
  | { mode: "status"; status: OrderStatus; after: bigint; limit: number }
  | { mode: "ids"; ids: bigint[] };

export type InternalOrdersQueryResult =
  { ok: true; query: InternalOrdersQuery } | { ok: false; issues: SerializableIssue[] };

const limitSchema = z.coerce
  .number()
  .int()
  .min(ORDER_PULL_LIMIT_MIN)
  .max(ORDER_PULL_LIMIT_MAX)
  .default(ORDER_PULL_LIMIT_DEFAULT);

// modo pull — idéntico al de hoy (R12): mismo objeto, solo los literales de
// `limit` pasan a constantes (DA4). `since` SIN tope (AP2, decidido): el
// pull incremental está fuera de alcance de F-033.
const pullSchema = z.object({
  since: z.coerce.bigint().nonnegative().default(0n),
  limit: limitSchema,
});

// modo status
const statusSchema = z.object({
  status: z.enum(OrderStatus), // los 9, exactos y sensibles a mayúsculas (R5)
  after: z.coerce.bigint().nonnegative().max(ORDER_ID_MAX).default(0n),
  limit: limitSchema, // R12: el MISMO rango, no uno nuevo
});

// modo ids
const idsSchema = z.object({
  ids: z
    .string()
    .regex(/^\d+(,\d+)*$/) // "" , "abc", "1,,2", "1.5", "-1", " 1" -> 400
    .transform((raw) => raw.split(",").map((part) => BigInt(part)))
    .refine((ids) => ids.length <= ORDER_LATERAL_IDS_MAX, ORDER_QUERY_ISSUE.IDS_LIMIT_EXCEEDED)
    .refine((ids) => ids.every((id) => id >= 1n && id <= ORDER_ID_MAX)),
});

/** `path: []`: el problema es la query entera, no un campo — la misma forma
 *  que produce un `refine` a nivel de objeto en Zod y la que ya usa
 *  `readJsonBody` (`src/lib/httpJson.ts`) para un cuerpo que no cumple como
 *  un todo. */
function combinationIssue(message: string): SerializableIssue {
  return { path: [], message };
}

/**
 * Pura y testeable sin `Request`: recibe los `searchParams` y devuelve o el
 * modo ya validado, o los issues tal y como viajan en el 400.
 *
 * Orden de evaluación, fijo (DA3):
 *   1. Presencia (R6) — `params.has(...)`, sin mirar ningún valor. Las
 *      cuatro combinaciones se evalúan TODAS y se emiten TODAS las
 *      violadas, en este orden. Si hay alguna, se devuelve sin ejecutar
 *      ningún `safeParse`.
 *   2. Modo, por presencia: has(status) -> "status"; has(ids) -> "ids";
 *      si no, "pull".
 *   3. `safeParse` del schema de ESE modo, y solo de ese.
 */
export function parseInternalOrdersQuery(params: URLSearchParams): InternalOrdersQueryResult {
  const hasSince = params.has("since");
  const hasStatus = params.has("status");
  const hasIds = params.has("ids");
  const hasAfter = params.has("after");
  const hasLimit = params.has("limit");

  const issues: SerializableIssue[] = [];
  if (hasSince && (hasStatus || hasIds)) {
    issues.push(combinationIssue(ORDER_QUERY_ISSUE.SINCE_WITH_LATERAL_READ));
  }
  if (hasStatus && hasIds) {
    issues.push(combinationIssue(ORDER_QUERY_ISSUE.STATUS_WITH_IDS));
  }
  if (hasAfter && !hasStatus) {
    issues.push(combinationIssue(ORDER_QUERY_ISSUE.AFTER_WITHOUT_STATUS));
  }
  if (hasLimit && hasIds) {
    issues.push(combinationIssue(ORDER_QUERY_ISSUE.LIMIT_WITH_IDS));
  }
  if (issues.length > 0) return { ok: false, issues };

  // AP1, decidido: los tres parámetros laterales se leen con
  // `getAll(...).join(",")`; since/limit siguen con `get()`, como hoy.
  if (hasStatus) {
    const parsed = statusSchema.safeParse({
      status: params.getAll("status").join(","),
      after: params.getAll("after").join(","),
      limit: params.get("limit") ?? undefined,
    });
    if (!parsed.success) return { ok: false, issues: serializableIssues(parsed.error) };
    return {
      ok: true,
      query: {
        mode: "status",
        status: parsed.data.status,
        after: parsed.data.after,
        limit: parsed.data.limit,
      },
    };
  }

  if (hasIds) {
    const parsed = idsSchema.safeParse({ ids: params.getAll("ids").join(",") });
    if (!parsed.success) return { ok: false, issues: serializableIssues(parsed.error) };
    return { ok: true, query: { mode: "ids", ids: parsed.data.ids } };
  }

  const parsed = pullSchema.safeParse({
    since: params.get("since") ?? undefined,
    limit: params.get("limit") ?? undefined,
  });
  if (!parsed.success) return { ok: false, issues: serializableIssues(parsed.error) };
  return { ok: true, query: { mode: "pull", since: parsed.data.since, limit: parsed.data.limit } };
}
