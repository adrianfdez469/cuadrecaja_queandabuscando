import { prisma } from "@/lib/prisma";
import {
  BUSINESS_DELETE_NOT_SUPPORTED,
  BUSINESS_DISPLAY_CURRENCIES_INVALID,
} from "@/constants/sync";
import { dedupeDisplayCurrencies, findInvalidDisplayCurrency } from "../../displayCurrencies";
import type { BusinessPayload } from "../../schemas";
import type { RenderableBranchLookup } from "../businessBranches";
import { outcomeOf, STALE, SyncEventFailure, type HandlerOutcome } from "./types";

/**
 * F-038: `displayCurrencies` — what the merchant wants the storefront to
 * show. R5's four checks, in this exact order:
 *
 *   1. operation === "DELETE"      -> BUSINESS_DELETE_NOT_SUPPORTED
 *   2. a member fails R3           -> BUSINESS_DISPLAY_CURRENCIES_INVALID
 *   3. stale-write guard (>=)      -> STALE
 *   4. write the deduped list + the mark
 *
 * Steps 1 and 2 are PURE and run BEFORE any round-trip (R5): a malformed
 * event never costs one. This is the OPPOSITE order of `handleCategory`,
 * where the guard runs before the DELETE branch — there, DELETE is a
 * legitimate operation the guard decides whether to apply; here, DELETE is
 * not an operation of this entity at all, it is malformed input of the same
 * family as a junk code (E6, E7): a format error cannot depend on a
 * timestamp.
 *
 * Steps 3+4 collapse into ONE `updateMany`: the `>=` guard is the `WHERE`,
 * and `count === 0` means STALE. This is the SAME semantics as the guard of
 * STORE/CATEGORY/PRODUCT — reject-and-STALE, never the ORDER form of
 * EXCHANGE_RATE (F-036, docs/adr/0030-la-tasa-vigente-la-decide-la-lectura.md)
 * — just expressed in one statement instead of two, because there is nothing
 * else to read from the row: `resolveCaller` already read this `Business`
 * row by `syncTokenHash` in THIS same request to authenticate the batch, so
 * the row always exists and `count === 0` can only mean "stale". No
 * `$transaction`: the pooler runs in transaction mode and the global client
 * cannot enter a transactional block (AGENTS.md § Cosas que muerden).
 *
 * Never touches `Currency` or `ExchangeRate` (R9): a code the merchant
 * declares before its `CURRENCY` arrives is a normal, transient state, not
 * an error. Never touches `name`/`baseCurrencyCode`/`active`/`syncTokenHash`
 * (R10) — those stay `handleStore`'s. Writes against `businessId`, the
 * caller's internal uuid, never the `businessId` field the payload itself
 * carries (R11).
 *
 * F-039 (R18/R19, architecture.md AD7): the fourth and last parameter, in
 * the same position `handleCurrency`/`handleExchangeRate` already carry it
 * (`handlers/misc.ts`). Called ONLY on the branch that wrote — a `stale`
 * write, a `DELETE`, or an invalid member throws/returns before it, so
 * nothing not just-written is ever invalidated (R18). Its result feeds
 * `outcomeOf`, shared with those same two handlers (AD8) — an empty
 * renderable set (a business with no branch, or every branch still
 * `DRAFT`) collapses to `PROCESSED` pelado, exactly like before.
 */
export async function handleBusiness(
  payload: BusinessPayload,
  operation: "CREATE" | "UPDATE" | "DELETE",
  businessId: string,
  renderableBranches: RenderableBranchLookup,
): Promise<HandlerOutcome> {
  // 1. R5(1) — puro, cero round-trips. Before the guard on purpose (E6): a
  //    DELETE is not an operation of this entity in ANY instant.
  if (operation === "DELETE") {
    console.warn("[sync] BUSINESS event rejected: DELETE is not an operation of this entity", {
      businessId,
    });
    throw new SyncEventFailure(BUSINESS_DELETE_NOT_SUPPORTED);
  }

  // 2. R5(2)/R3 — puro, cero round-trips. A FORMAT error cannot depend on a
  //    timestamp (E7).
  const invalid = findInvalidDisplayCurrency(payload.displayCurrencies);
  if (invalid !== null) {
    console.warn("[sync] BUSINESS event rejected: malformed displayCurrencies member", {
      businessId,
      member: invalid,
    });
    throw new SyncEventFailure(BUSINESS_DISPLAY_CURRENCIES_INVALID);
  }

  // 3 + 4. R5(3)+R5(4) in ONE statement.
  const payloadUpdatedAt = new Date(payload.updatedAt);
  const written = await prisma.business.updateMany({
    where: {
      id: businessId,
      OR: [
        { displayCurrenciesSourceUpdatedAt: null },
        { displayCurrenciesSourceUpdatedAt: { lt: payloadUpdatedAt } },
      ],
    },
    data: {
      displayCurrencies: { set: dedupeDisplayCurrencies(payload.displayCurrencies) },
      displayCurrenciesSourceUpdatedAt: payloadUpdatedAt,
    },
  });

  // R18: se invalida lo que se ESCRIBIÓ. Un `stale` vuelve aquí sin haber
  // llamado nunca a la clausura -> cero consultas y cero invalidación, igual
  // que el `return SKIPPED` del CUP de handleExchangeRate
  // (handlers/misc.ts:197-198). Los dos `throw` de arriba salen antes todavía.
  return written.count === 0 ? STALE : outcomeOf(await renderableBranches(businessId));
}
