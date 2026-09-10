import { PRICES_UNAVAILABLE_REASON_CODE } from "@/constants/storeClosure";
import { tryResolvePrice } from "@/lib/pricing";
import type { RateTable } from "@/lib/money";
import type { CatalogProduct } from "./server/queries";

/**
 * F-040 (architecture.md AD1, AD2, AD4; spec.md R1-R3, R8). Pure: no Prisma,
 * no React, no `zod` — the precedent is `storeCategories.ts`. A store is
 * "unpriced" when it HAS products and NONE of them resolves a price through
 * `tryResolvePrice`, the exact same call `ProductCard` and the filtered
 * catalogue already make (R1): this module does not define a second
 * predicate of "no price", it reuses the one that already exists.
 */

export type UnpricedCatalogContext = {
  /** R1: SIEMPRE `Business.baseCurrencyCode`; nunca una moneda de display
   *  de F-039 — la condición es sobre lo que se cobra, no sobre lo que se
   *  enseña de más. */
  targetCurrency: string;
  rates: RateTable;
};

/**
 * R1-R3. Puro y con corte en el primer producto que resuelve precio
 * (architecture.md AD4 — `Array.prototype.some` corta ahí, así que el caso
 * normal paga como mucho una llamada de más a `resolvePrice`).
 */
export function isCatalogUnpriced(
  catalog: readonly CatalogProduct[],
  context: UnpricedCatalogContext,
): boolean {
  if (catalog.length === 0) return false; // R3: una tienda vacía no está muda.
  return !catalog.some(
    (product) =>
      tryResolvePrice(product, {
        targetCurrency: context.targetCurrency,
        rates: context.rates,
        baseCurrency: context.targetCurrency,
        promotions: product.promotions,
      }) !== null,
  );
}

/**
 * R8: las tres props que `StoreClosedNotice` necesita para el aviso de
 * tienda muda, en un solo sitio — `disabledMessage`/`disabledAt` van SIEMPRE
 * en `null`, para que el aviso nunca se disfrace del texto libre de un
 * cierre del comerciante que aquí no existe (R4: nada se escribe, nada se
 * lee de una fila para este caso).
 */
export const UNPRICED_CATALOG_CLOSURE = {
  disabledReasonCode: PRICES_UNAVAILABLE_REASON_CODE,
  disabledMessage: null,
  disabledAt: null,
} as const;
