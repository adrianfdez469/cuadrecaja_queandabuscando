/**
 * Structural guard for Prisma's unique-constraint violation (P2002).
 *
 * Deliberately does NOT import `PrismaClientKnownRequestError` from the
 * generated namespace (architecture.md § Componentes): duck-typing the two
 * fields that matter keeps `createOrder.ts` decoupled from exactly which
 * class Prisma throws, and there is no `any` anywhere in the check.
 */

type PrismaErrorLike = {
  code: string;
  meta?: {
    target?: unknown;
    // Prisma 7 + a driver adapter (`@prisma/adapter-pg`, the connector this
    // repo runs on both locally and in production) does NOT populate the
    // classic `meta.target` for a P2002 at all — the offending column list
    // is nested here instead, verified against a real unique-constraint
    // collision (F-012, ficha `prisma7-p2002-sin-meta-target-driver-adapter`).
    driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } };
  };
};

function isPrismaErrorLike(error: unknown): error is PrismaErrorLike {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  );
}

/**
 * True when `error` is a P2002 unique-constraint violation on `target`
 * (a column name, e.g. "code" or "idempotencyKey"). Postgres's connector
 * reports `meta.target` as an array of field names; some connectors report a
 * single string instead. Either way the match is exact — a substring match
 * against a raw constraint name (e.g. "Order_code_key") would be too easy to
 * get wrong in both directions.
 */
export function isUniqueViolation(error: unknown, target: string): boolean {
  if (!isPrismaErrorLike(error) || error.code !== "P2002") return false;

  const metaTarget = error.meta?.target;
  if (typeof metaTarget === "string") return metaTarget === target;
  if (Array.isArray(metaTarget)) return metaTarget.includes(target);

  // No top-level `meta.target` at all: the driver-adapter shape (see the
  // comment on `PrismaErrorLike`). Postgres quotes each identifier itself
  // (`"supabaseUserId"`), hence the `replace` before comparing.
  const fields = error.meta?.driverAdapterError?.cause?.constraint?.fields;
  if (Array.isArray(fields)) {
    return fields.some((field) => typeof field === "string" && field.replace(/"/g, "") === target);
  }

  return false;
}
