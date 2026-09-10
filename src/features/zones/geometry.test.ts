import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listMunicipalities } from "./catalog";
import { geometryVersion, hasZoneGeometry, readZoneGeometryRaw } from "./server/geometry";

/**
 * F-042 (architecture.md § Componentes, fila `geometry.test.ts`; § Contratos
 * 4 y 6) — caso límite 16: "una zona ofrecible sin polígono no se puede
 * tocar en el mapa, y un polígono sin zona ofrecible no debería llegar al
 * navegador. La generación tiene que fallar a la vista en los dos casos,
 * nunca descartar en silencio." Esto ejecuta esa comprobación contra el
 * artefacto REAL commiteado (168 ficheros + manifiesto), no contra un
 * fixture: es la garantía que hace que `route.ts` nunca tenga que decidir
 * en producción qué hacer con un desalineamiento — el manifiesto y el
 * índice ya cuadran antes de que la ruta exista.
 */

const GEOMETRY_DIR = join(process.cwd(), "src/features/zones/geometry");

type Manifest = {
  version: string;
  zones: Record<string, { sha256: string; bytes: number; rings: number; vertices: number }>;
};

const manifest = JSON.parse(readFileSync(join(GEOMETRY_DIR, "manifest.json"), "utf8")) as Manifest;

describe("el artefacto de geometría committeado — caso límite 16, R16, R17", () => {
  it("el manifiesto tiene EXACTAMENTE los 168 códigos de municipio del índice — ni más ni menos", () => {
    const indexCodes = listMunicipalities()
      .map((zone) => zone.code)
      .sort();
    const manifestCodes = Object.keys(manifest.zones).sort();
    expect(manifestCodes).toEqual(indexCodes);
    expect(manifestCodes).toHaveLength(168);
  });

  it("la Isla de la Juventud (40.01) tiene SU PROPIO fichero, aunque comparta osmRelationId con la provincia 40 — R17: la que existe para el mapa es la del municipio", () => {
    expect(hasZoneGeometry("40.01")).toBe(true);
    expect(hasZoneGeometry("40")).toBe(false); // 40 es de primer nivel: nunca elegible (R3), nunca en el manifiesto
  });

  it("cada hash del manifiesto CUADRA con el contenido real del fichero en disco", () => {
    for (const [code, entry] of Object.entries(manifest.zones)) {
      const raw = readFileSync(join(GEOMETRY_DIR, `${code}.json`), "utf8");
      const hash = createHash("sha256").update(raw).digest("hex");
      expect(hash).toBe(entry.sha256);
    }
  });

  it("cada fichero es un Feature GeoJSON con properties = { code } y nada más, y geometría de polígono", () => {
    for (const code of Object.keys(manifest.zones)) {
      const raw = readFileSync(join(GEOMETRY_DIR, `${code}.json`), "utf8");
      const feature = JSON.parse(raw) as {
        type: string;
        properties: Record<string, unknown>;
        geometry: { type: string };
      };
      expect(feature.type).toBe("Feature");
      expect(feature.properties).toEqual({ code });
      expect(["Polygon", "MultiPolygon"]).toContain(feature.geometry.type);
    }
  });

  it("el directorio no tiene ficheros huérfanos: un .json por entrada del manifiesto más el propio manifest.json", () => {
    const files = readdirSync(GEOMETRY_DIR).filter((name) => name.endsWith(".json"));
    expect(files).toHaveLength(Object.keys(manifest.zones).length + 1);
  });

  it("readZoneGeometryRaw() sirve la CADENA verbatim del fichero — nunca la re-serializa", () => {
    const raw = readFileSync(join(GEOMETRY_DIR, "23.01.json"), "utf8");
    expect(readZoneGeometryRaw("23.01")).toBe(raw);
  });

  it("hasZoneGeometry()/readZoneGeometryRaw() son false/null para un code que no está en el manifiesto, sin lanzar", () => {
    expect(hasZoneGeometry("99.99")).toBe(false);
    expect(readZoneGeometryRaw("99.99")).toBeNull();
  });

  it("geometryVersion() es la versión del MANIFIESTO — se mueve por separado de ZONE_INDEX_VERSION (R16)", () => {
    expect(geometryVersion()).toBe(manifest.version);
  });
});
