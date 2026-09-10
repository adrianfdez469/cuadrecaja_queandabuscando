import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * F-042 (architecture.md § AD1(e), § Contratos 4) — el lector del artefacto
 * de geometría. Lee `manifest.json` una vez, sirve cada `<code>.json` COMO
 * CADENA, memoiza y NUNCA parsea la geometría: servir una cobertura es
 * concatenar cadenas, sin tocar ni un byte de coordenadas (el coste de la
 * ruta pública es exactamente el de los bytes que devuelve).
 */

const GEOMETRY_DIR = join(process.cwd(), "src/features/zones/geometry");

export type ZoneGeometryManifest = {
  version: string;
  generatedAt: string;
  indexVersion: string;
  projection: string;
  snapInterval: number;
  simplify: { method: string; interval: number; topological: boolean };
  precision: number;
  tool: string;
  zones: Record<string, { sha256: string; bytes: number; rings: number; vertices: number }>;
  sha256: string;
};

let manifestCache: ZoneGeometryManifest | null = null;

function readManifest(): ZoneGeometryManifest {
  if (!manifestCache) {
    const raw = readFileSync(join(GEOMETRY_DIR, "manifest.json"), "utf8");
    manifestCache = JSON.parse(raw) as ZoneGeometryManifest;
  }
  return manifestCache;
}

/** El `geometryVersion` que la ruta pública publica (architecture.md
 *  § Contratos 4) — se mueve por separado de `ZONE_INDEX_VERSION` (R16). */
export function geometryVersion(): string {
  return readManifest().version;
}

/** Los códigos con fichero de geometría — para que la ruta pueda distinguir
 *  "esta zona no tiene polígono" (caso límite 16) sin leer el disco por
 *  cada una. */
export function hasZoneGeometry(code: string): boolean {
  return code in readManifest().zones;
}

const fileCache = new Map<string, string>();

/** `null` cuando `code` no está en el manifiesto — el llamador (la ruta)
 *  decide qué hacer (caso límite 16: se anota en `missing`, nunca se
 *  descarta en silencio). El fichero es un `Feature` completo, servido tal
 *  cual: NUNCA `JSON.parse`. */
export function readZoneGeometryRaw(code: string): string | null {
  if (!hasZoneGeometry(code)) return null;
  const cached = fileCache.get(code);
  if (cached !== undefined) return cached;
  const raw = readFileSync(join(GEOMETRY_DIR, `${code}.json`), "utf8");
  fileCache.set(code, raw);
  return raw;
}
