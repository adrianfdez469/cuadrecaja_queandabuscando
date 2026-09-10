import { foldForSearch } from "@/lib/text";

/**
 * F-042 (architecture.md § AD3, § Contratos 2) — la cobertura de una
 * sucursal, PURA: sin catálogo (`@/features/zones/catalog`), sin Prisma, sin
 * React. La importan `src/features/zones/server/coverage.ts` (que la
 * construye) y el island del checkout (que la filtra y la pinta) — los
 * nombres SALEN de aquí, nunca del índice, en el árbol de cliente (D5,
 * E25/C15).
 */

export type OfferableZone = {
  /** Siempre un MUNICIPIO (D3, R3). Es lo único que viaja e identifica. */
  code: string;
  /** El nombre del índice, VERBATIM (R20). La desambiguación de R7 es
   *  presentación y se compone en la pantalla, nunca aquí. */
  name: string;
  provinceCode: string;
  /** Para desambiguar en la lista (R7) y para el paso de provincia (R5). */
  provinceName: string;
  /** Cadena de dos decimales, ya resuelta por `resolveZoneTariff`. `"0.00"`
   *  es envío gratis y es un valor legítimo (R10). Nunca `number`. */
  deliveryFee: string;
};

/** R5 se decide con esto y con nada más: uno, no hay paso; dos o más, lo
 *  hay. Ordenadas por nombre con la colación española (design.md § 1). */
export function distinctProvinces(
  zones: readonly OfferableZone[],
): readonly { code: string; name: string }[] {
  const byCode = new Map<string, string>();
  for (const zone of zones) {
    if (!byCode.has(zone.provinceCode)) byCode.set(zone.provinceCode, zone.provinceName);
  }
  return [...byCode.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** `null` cuando `code` no está en la cobertura de esta tienda — nunca
 *  consulta el índice completo (R1, R2): el `code` tiene que ser uno de los
 *  ofrecibles de ESTA sucursal, no cualquier municipio del país. */
export function findZoneInCoverage(
  zones: readonly OfferableZone[],
  code: string,
): OfferableZone | null {
  return zones.find((zone) => zone.code === code) ?? null;
}

/** R6: `foldedQuery` ya plegado por `foldForSearch` (sin tildes, en
 *  minúsculas) — el llamador lo pliega UNA vez por pulsación, no una vez
 *  por zona. Un `foldedQuery` vacío no descarta nada (la lista completa). */
export function matchesZoneQuery(zone: OfferableZone, foldedQuery: string): boolean {
  if (foldedQuery === "") return true;
  return foldForSearch(zone.name).includes(foldedQuery);
}
