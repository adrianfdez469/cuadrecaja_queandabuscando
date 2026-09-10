import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { findZone, listMunicipalities } from "../catalog";
import { resolveZoneTariff, type TariffRow } from "../precedence";
import type { OfferableZone } from "../coverage";

/**
 * F-042 (architecture.md § AD3, § Contratos 2) — la mitad de datos: la
 * ÚNICA consulta que lee el tarifario de una sucursal, y la resolución pura
 * (`resolveZoneTariff`) aplicada a los 168 municipios del índice. Ningún
 * otro módulo de este feature consulta la base para la cobertura — ni el
 * checkout, ni el mapa, ni `createOrder` (que reutiliza esta misma función,
 * architecture.md § Flujo C).
 */

export type ZoneCoverageReader = Pick<PrismaClient, "store">;

/**
 * `null` cuando la sucursal no es `ZONE_BASED` con domicilio activado — el
 * llamador no necesita ninguna otra lectura para saberlo (R1, E20). Un
 * array vacío es DISTINTO de `null`: la tienda SÍ es `ZONE_BASED` pero su
 * tarifario no hace resoluble ningún municipio (casos límite 1 y 2).
 *
 * UNA consulta: el modo de envío de la sucursal y sus filas de tarifario,
 * anidadas — nunca 168 consultas por municipio (R2).
 */
export async function loadStoreZoneCoverage(
  db: ZoneCoverageReader,
  storeId: string,
): Promise<readonly OfferableZone[] | null> {
  const store = await db.store.findUnique({
    where: { id: storeId },
    select: {
      deliveryEnabled: true,
      deliveryFeeMode: true,
      zoneTariffs: { select: { zoneCode: true, rule: true, deliveryFee: true } },
    },
  });
  if (!store) return null;
  if (!store.deliveryEnabled || store.deliveryFeeMode !== "ZONE_BASED") return null;

  // Se indexan por zoneCode UNA vez, antes del bucle: `resolveZoneTariff`
  // recibe como mucho DOS filas por llamada (la del municipio y la de su
  // provincia), nunca las 184 (architecture.md § Flujo A).
  const rowsByCode = new Map<string, TariffRow>(
    store.zoneTariffs.map((row) => [
      row.zoneCode,
      { zoneCode: row.zoneCode, rule: row.rule, deliveryFee: row.deliveryFee },
    ]),
  );

  const offerable: OfferableZone[] = [];
  for (const zone of listMunicipalities()) {
    // R1(2): una zona retirada se lee, no se ofrece (R4 de F-041).
    if (zone.retiredAt !== null) continue;

    const rows: TariffRow[] = [];
    const ownRow = rowsByCode.get(zone.code);
    if (ownRow) rows.push(ownRow);
    if (zone.provinceCode) {
      const provinceRow = rowsByCode.get(zone.provinceCode);
      if (provinceRow) rows.push(provinceRow);
    }

    const resolution = resolveZoneTariff(
      { code: zone.code, level: zone.level, provinceCode: zone.provinceCode },
      rows,
    );
    // R1(3): `served: true` implica siempre un `deliveryFee` que no es
    // `null` (solo una fila FEE con importe decide a favor) — pero se
    // comprueba contra `null`, nunca contra un falsy (R10): "0.00" es
    // envío gratis y es un valor legítimo.
    if (!resolution.served || resolution.deliveryFee === null) continue;

    const province = findZone(zone.provinceCode!);
    offerable.push({
      code: zone.code,
      name: zone.name,
      provinceCode: zone.provinceCode!,
      provinceName: province?.name ?? zone.provinceCode!,
      deliveryFee: resolution.deliveryFee,
    });
  }

  return offerable;
}

/**
 * Envoltorio sin `db` inyectable, para quien no tiene uno a mano: AGENTS.md
 * § Prohibiciones prohíbe que un `.tsx` bajo `src/app/` importe Prisma
 * directamente, así que `src/app/[slug]/checkout/page.tsx` (architecture.md
 * § Flujo A) llama a esto en vez de a `loadStoreZoneCoverage` con el
 * `prisma` global en la mano. `loadStoreZoneCoverage` sigue siendo la
 * función inyectable que prueba `coverage.db.test.ts`.
 */
export async function loadStoreZoneCoverageForRender(
  storeId: string,
): Promise<readonly OfferableZone[] | null> {
  return loadStoreZoneCoverage(prisma, storeId);
}
