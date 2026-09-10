import {
  ZONE_MAP_DEFAULT_ATTRIBUTION,
  ZONE_MAP_DEFAULT_TILE_URL_TEMPLATE,
} from "@/constants/zones";

/**
 * F-042 (architecture.md § AD9, § Contratos 7) — la regla del PAR: las dos
 * variables de entorno o ninguna. Pura, para que sus tres combinaciones se
 * prueben sin `publicEnv` ni sin levantar nada.
 *
 * Esto SOLO decide el crédito del proveedor de teselas. La línea fija de
 * los límites municipales (AP1, `ZONE_BOUNDARIES_ATTRIBUTION`) no depende
 * de ninguna variable y no es "la regla del par" — la pinta siempre el
 * componente del mapa, además de lo que esta función devuelve.
 */

export type TileLayerConfig = { urlTemplate: string; attribution: string };

/** R18/D2 — el par completo, o se sirven las teselas de OSM CON el crédito
 *  de OSM: nunca las de un tercero bajo el crédito de otro. */
export function resolveTileLayer(env: {
  mapTileUrlTemplate: string | null;
  mapTileAttribution: string | null;
}): TileLayerConfig {
  if (env.mapTileUrlTemplate && env.mapTileAttribution) {
    return { urlTemplate: env.mapTileUrlTemplate, attribution: env.mapTileAttribution };
  }
  return {
    urlTemplate: ZONE_MAP_DEFAULT_TILE_URL_TEMPLATE,
    attribution: ZONE_MAP_DEFAULT_ATTRIBUTION,
  };
}
