import { describe, expect, it } from "vitest";
import {
  ZONE_MAP_DEFAULT_ATTRIBUTION,
  ZONE_MAP_DEFAULT_TILE_URL_TEMPLATE,
} from "@/constants/zones";
import { resolveTileLayer } from "./tiles";

/**
 * F-042 (architecture.md § AD9, § Contratos 7) — R18/D2: el PAR completo o
 * ninguna. Las TRES combinaciones posibles, pura, sin `publicEnv` y sin
 * levantar nada.
 */
describe("resolveTileLayer() — R18/D2, la regla del par", () => {
  it("con el par completo, usa las dos variables del proveedor alternativo", () => {
    const config = resolveTileLayer({
      mapTileUrlTemplate: "https://tiles.ejemplo.cu/{z}/{x}/{y}.png",
      mapTileAttribution: "© Ejemplo Cuba",
    });
    expect(config).toEqual({
      urlTemplate: "https://tiles.ejemplo.cu/{z}/{x}/{y}.png",
      attribution: "© Ejemplo Cuba",
    });
  });

  it("con NINGUNA de las dos, cae a OSM con el crédito de OSM", () => {
    const config = resolveTileLayer({ mapTileUrlTemplate: null, mapTileAttribution: null });
    expect(config).toEqual({
      urlTemplate: ZONE_MAP_DEFAULT_TILE_URL_TEMPLATE,
      attribution: ZONE_MAP_DEFAULT_ATTRIBUTION,
    });
  });

  it("con SOLO la plantilla de URL puesta, cae a OSM con el crédito de OSM — nunca sirve la URL de un tercero con nada distinto de su propio crédito completo", () => {
    const config = resolveTileLayer({
      mapTileUrlTemplate: "https://tiles.ejemplo.cu/{z}/{x}/{y}.png",
      mapTileAttribution: null,
    });
    expect(config).toEqual({
      urlTemplate: ZONE_MAP_DEFAULT_TILE_URL_TEMPLATE,
      attribution: ZONE_MAP_DEFAULT_ATTRIBUTION,
    });
  });

  it("con SOLO la atribución puesta, cae a OSM igual — el par es atómico, una mitad sola no activa nada", () => {
    const config = resolveTileLayer({
      mapTileUrlTemplate: null,
      mapTileAttribution: "© Ejemplo Cuba",
    });
    expect(config).toEqual({
      urlTemplate: ZONE_MAP_DEFAULT_TILE_URL_TEMPLATE,
      attribution: ZONE_MAP_DEFAULT_ATTRIBUTION,
    });
  });

  it("una cadena vacía cuenta como 'no puesta' — el par exige AMBAS con contenido real", () => {
    const config = resolveTileLayer({ mapTileUrlTemplate: "", mapTileAttribution: "" });
    expect(config).toEqual({
      urlTemplate: ZONE_MAP_DEFAULT_TILE_URL_TEMPLATE,
      attribution: ZONE_MAP_DEFAULT_ATTRIBUTION,
    });
  });
});
