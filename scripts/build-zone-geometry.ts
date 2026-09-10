/**
 * F-042 — el generador del artefacto de geometría (architecture.md § AD1,
 * § Flujo E). Pasos 2 y 3 del plan firmado: descarga por relación de OSM
 * DISTINTA (183, no 184 — la Isla de la Juventud sale una vez), convierte,
 * simplifica TOPOLÓGICAMENTE en una sola operación sobre todo el conjunto de
 * municipios, redondea a 4 decimales, y corre las DOS comprobaciones
 * DESPUÉS del redondeo. Si cualquiera de las dos falla, este guion NO
 * escribe nada.
 *
 * Uso (uno de los dos tramos largos del feature — minutos, no segundos — y
 * se corre UNA vez):
 *
 *   npx tsx scripts/build-zone-geometry.ts     # vía `npm run geometry:zones`
 *
 * ---------------------------------------------------------------------
 * DESVIACIÓN documentada de architecture.md § AD1(d) / § Flujo E para la
 * COMPROBACIÓN 1 (ver .agent/specs/F-042/impl.md § Desviaciones, IP1 para
 * el humano). El diseño firmado la describe como "-dissolve2 por
 * provinceCode, -erase en las dos direcciones [contra el polígono de
 * PRIMER NIVEL de OSM]". Ejecutado contra datos reales, ese polígono de
 * primer nivel NO es comparable: las relaciones admin_level=4 de Cuba en
 * OSM incluyen aguas territoriales que las de admin_level=6 (los
 * municipios) NO incluyen — medido aquí mismo al construir este guion:
 *
 *   - La Habana (relación 1854615): ~1956 km² el polígono de provincia,
 *     frente a ~734 km² sumando sus 15 municipios (oficial: ~728 km²).
 *   - Pinar del Río (relación 1854617): ~25 890 km² el polígono de
 *     provincia, frente a ~8920 km² sumando sus 11 municipios (oficial:
 *     ~8821-8984 km²).
 *
 * Comparar contra el polígono de provincia haría fallar la comprobación 1
 * en TODAS las provincias costeras — que son las 16, porque Cuba no tiene
 * ninguna interior — sin que eso diga nada sobre si los municipios
 * encajan entre sí. Bajar la exigencia para que "pase" no es una opción
 * (AGENTS.md, el propio plan); en su lugar, las dos comprobaciones se
 * implementan sin depender del polígono de provincia, verificando
 * exactamente lo que R15 pide — que el comprador nunca toque un punto que
 * caiga en cero zonas o en dos:
 *
 *   (1) SOLAPES por provincia: el área de `-dissolve2 provinceCode` sobre
 *       los municipios YA simplificados tiene que coincidir con la suma de
 *       sus áreas individuales. Un solape entre dos municipios de la misma
 *       provincia hace que el área disuelta sea MENOR que la suma, y eso es
 *       lo que esta comprobación detecta.
 *   (2) COBERTURA punto a punto: una rejilla determinista sobre el bbox de
 *       cada provincia (para solapes, en cualquier punto: cero puntos en
 *       dos o más zonas) MÁS dos sondas a cada lado del punto medio de cada
 *       segmento de frontera compartido entre dos municipios vecinos (para
 *       huecos, justo donde R15 dice que vive el fallo: cero sondas sin
 *       ninguna zona).
 *
 * Las 16 relaciones de primer nivel se siguen descargando (183 relaciones
 * en total, tal como fija el paso 2) y su área se dejó anotada en la
 * procedencia como dato informativo — no deciden nada de lo de arriba.
 *
 * SEGUNDA desviación, del mismo AD1(d): el `snap-interval` de importación
 * no es `0.00001` (~1 m) como escribió la arquitectura, sino `0.0015`
 * (~166 m). Descubierto por la propia comprobación 2, que es exactamente
 * para lo que existe: con 1 m de snap aparecía un hueco real de más de
 * 100 m entre Bolivia (29.03) y Primero de Enero (29.04) — dos relaciones
 * de OSM que, en esa frontera concreta, no comparten ni una vía y sus
 * vértices más cercanos quedan a 30-60 m uno de otro. Subir el snap a
 * 0.0005° cerró ESE hueco y destapó uno nuevo entre 33.06 y 33.07; subirlo
 * a 0.0015° cerró los dos y dejó las 227 021 sondas de rejilla y las
 * 22 964 sondas de frontera en cero. La comprobación 1 no se movió de su
 * banda (0.095 %-0.098 % en las cinco corridas), así que no hay indicio de
 * que ese snap esté fusionando de más un estrecho o una isla real. Tal
 * como pide el propio riesgo 3 de architecture.md: se subió el snap antes
 * que bajar la exigencia de la comprobación, y las dos convergieron.
 * ---------------------------------------------------------------------
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
// @ts-expect-error — mapshaper ships no types; the API used here is
// documented in its own source (applyCommands, see README/CHANGELOG).
import mapshaper from "mapshaper";
// @ts-expect-error — osmtogeojson ships no types either.
import osmtogeojson from "osmtogeojson";
import mapshaperPkg from "mapshaper/package.json" with { type: "json" };
import osmtogeojsonPkg from "osmtogeojson/package.json" with { type: "json" };
import zoneIndexArtifact from "../src/features/zones/zone-index.json" with { type: "json" };

type ZoneLevel = "FIRST_LEVEL" | "MUNICIPALITY";
type ZoneEntry = {
  code: string;
  name: string;
  level: ZoneLevel;
  provinceCode: string | null;
  osmRelationId: string;
  osmName: string;
  retiredAt: string | null;
};

type Ring = [number, number][];
type PolygonCoords = Ring[]; // [outer, ...holes]
type Geometry =
  | { type: "Polygon"; coordinates: PolygonCoords }
  | { type: "MultiPolygon"; coordinates: PolygonCoords[] };
type ZoneFeature = {
  type: "Feature";
  properties: { code: string; provinceCode: string | null };
  geometry: Geometry;
};
type ZoneFeatureCollection = { type: "FeatureCollection"; features: ZoneFeature[] };

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, "src/features/zones/geometry");
const PROVENANCE_PATH = join(REPO_ROOT, "src/features/zones/geometry.provenance.md");

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "queandabuscando-zone-geometry/1.0 (+scripts/build-zone-geometry.ts)";
const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [3_000, 8_000, 20_000];
const OVERPASS_TIMEOUT_S = 180;

// R16/AD1(d): the two losses, paired and applied in the SAME pipeline.
// ≈166 m, NOT the ≈1 m the architecture estimated — measured empirically
// (see the header comment): comprobación 2 found real gaps of 30-150 m
// between specific pairs of neighbouring relations that never share a way
// in OSM, and this is the smallest value at which both checks converge.
const SNAP_INTERVAL_DEG = 0.0015;
const SIMPLIFY_INTERVAL_M = 100; // Visvalingam-weighted, keep-shapes.
const OUTPUT_PRECISION_DEG = 0.0001; // ≈11 m at this latitude.

const GEOMETRY_VERSION = "1.0.0";
const TOOL = `mapshaper@${mapshaperPkg.version}`;

// Comprobación 1: relative area tolerance for the dissolve-vs-sum check.
// Generous enough to absorb 4-decimal rounding noise on hundreds of
// vertices, tight enough that a real overlap (which is never smaller than
// a sliver visible on a map) trips it.
const DISSOLVE_AREA_RELATIVE_TOLERANCE = 0.001; // 0.1 %

// Comprobación 2: grid step over each province's bbox, in degrees.
const GRID_STEP_DEG = 0.01; // ≈1.1 km — coarse on purpose: this hunts
// OVERLAPS (any two zones claiming the same point), which show up as a
// visible area, not a hairline.
// Perpendicular offset for the boundary probes, in degrees (~15 m).
const BOUNDARY_PROBE_OFFSET_DEG = 0.00015;

function log(message: string): void {
  console.log(`[geometry] ${message}`);
}

// --------------------------------------------------------------- Overpass --

async function fetchOverpassBatch(ids: number[]): Promise<unknown> {
  const query = `[out:json][timeout:${OVERPASS_TIMEOUT_S}];relation(id:${ids.join(",")});out geom;`;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const params = new URLSearchParams({ data: query });
      const response = await fetch(OVERPASS_URL, {
        method: "POST",
        body: params,
        headers: { "User-Agent": USER_AGENT },
      });
      if (!response.ok) {
        throw new Error(`Overpass respondió ${response.status} ${response.statusText}`);
      }
      const text = await response.text();
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      log(`intento ${attempt}/${MAX_ATTEMPTS} falló para [${ids.join(",")}]: ${message}`);
      if (attempt < MAX_ATTEMPTS) {
        const wait = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
        await delay(wait);
      }
    }
  }
  throw new Error(
    `Overpass no respondió tras ${MAX_ATTEMPTS} intentos para las relaciones [${ids.join(",")}]: ${String(lastError)}`,
  );
}

type OverpassOsmFeature = {
  id: string;
  properties: { type: string; id: number; tags?: Record<string, string> };
  geometry: { type: string; coordinates: unknown };
};

/** One HTTP round-trip per batch, converted immediately — each relation's
 *  own members carry full inline geometry (`out geom;`), so a batch never
 *  needs another batch's data to resolve. */
async function fetchAndConvert(
  ids: number[],
): Promise<{ features: OverpassOsmFeature[]; timestampOsmBase: string | null }> {
  const json = (await fetchOverpassBatch(ids)) as {
    osm3s?: { timestamp_osm_base?: string };
  };
  const geojson = osmtogeojson(json) as { features: OverpassOsmFeature[] };
  const relations = geojson.features.filter(
    (f) => typeof f.id === "string" && f.id.startsWith("relation/"),
  );
  return { features: relations, timestampOsmBase: json.osm3s?.timestamp_osm_base ?? null };
}

// ------------------------------------------------------------- geometría --

function toMultiPolygon(geometry: { type: string; coordinates: unknown }): Geometry {
  if (geometry.type === "MultiPolygon") {
    return { type: "MultiPolygon", coordinates: geometry.coordinates as PolygonCoords[] };
  }
  if (geometry.type === "Polygon") {
    return { type: "MultiPolygon", coordinates: [geometry.coordinates as PolygonCoords] };
  }
  throw new Error(`geometría inesperada para una relación de zona: ${geometry.type}`);
}

function ringArea(ring: Ring): number {
  const latMean = ring.reduce((sum, c) => sum + c[1], 0) / ring.length;
  const k = Math.cos((latMean * Math.PI) / 180);
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    area += x1 * k * y2 - x2 * k * y1;
  }
  // deg² → km², at this latitude (111.32 km / degree).
  return (Math.abs(area) / 2) * (111.32 * 111.32);
}

function polygonArea(coords: PolygonCoords): number {
  let area = ringArea(coords[0]);
  for (let i = 1; i < coords.length; i += 1) area -= ringArea(coords[i]);
  return area;
}

function featureArea(geometry: Geometry): number {
  if (geometry.type === "Polygon") return polygonArea(geometry.coordinates);
  return geometry.coordinates.reduce((sum, poly) => sum + polygonArea(poly), 0);
}

function pointInRing(point: [number, number], ring: Ring): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygonCoords(point: [number, number], coords: PolygonCoords): boolean {
  if (!pointInRing(point, coords[0])) return false;
  for (let i = 1; i < coords.length; i += 1) if (pointInRing(point, coords[i])) return false;
  return true;
}

function pointInFeature(point: [number, number], geometry: Geometry): boolean {
  if (geometry.type === "Polygon") return pointInPolygonCoords(point, geometry.coordinates);
  return geometry.coordinates.some((poly) => pointInPolygonCoords(point, poly));
}

function bboxOf(geometry: Geometry): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const rings: Ring[] =
    geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

function unionBbox(boxes: [number, number, number, number][]): [number, number, number, number] {
  return boxes.reduce(
    (acc, [minX, minY, maxX, maxY]) => [
      Math.min(acc[0], minX),
      Math.min(acc[1], minY),
      Math.max(acc[2], maxX),
      Math.max(acc[3], maxY),
    ],
    [Infinity, Infinity, -Infinity, -Infinity] as [number, number, number, number],
  );
}

function allRingsOf(geometry: Geometry): Ring[] {
  return geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
}

function pointKey(p: [number, number]): string {
  return `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
}

/** Boundary probes for a PAIR of neighbouring zones: every consecutive pair
 *  of vertices along A's own ring where BOTH vertices also belong to B is a
 *  shared-arc segment (post-simplification, shared arcs are byte-identical
 *  coordinates by construction — that is the whole point of AD1(a)). The
 *  segment's midpoint, offset a few metres perpendicular on both sides, is
 *  exactly the point R15 warns about: right where the comprador's tap could
 *  fall in zero zones or in two. */
function boundaryProbesBetween(a: ZoneFeature, b: ZoneFeature): [number, number][] {
  const bPoints = new Set(allRingsOf(b.geometry).flat().map(pointKey));
  const probes: [number, number][] = [];
  for (const ring of allRingsOf(a.geometry)) {
    for (let i = 0; i < ring.length - 1; i += 1) {
      const p1 = ring[i];
      const p2 = ring[i + 1];
      if (!bPoints.has(pointKey(p1)) || !bPoints.has(pointKey(p2))) continue;
      const midX = (p1[0] + p2[0]) / 2;
      const midY = (p1[1] + p2[1]) / 2;
      const dx = p2[0] - p1[0];
      const dy = p2[1] - p1[1];
      const length = Math.hypot(dx, dy);
      if (length === 0) continue;
      const perpX = -dy / length;
      const perpY = dx / length;
      probes.push([
        midX + perpX * BOUNDARY_PROBE_OFFSET_DEG,
        midY + perpY * BOUNDARY_PROBE_OFFSET_DEG,
      ]);
      probes.push([
        midX - perpX * BOUNDARY_PROBE_OFFSET_DEG,
        midY - perpY * BOUNDARY_PROBE_OFFSET_DEG,
      ]);
    }
  }
  return probes;
}

// ------------------------------------------------------------ mapshaper --

async function applyCommandsAsync(
  cmd: string,
  input: Record<string, unknown>,
): Promise<Record<string, Buffer>> {
  return new Promise((resolve, reject) => {
    mapshaper.applyCommands(cmd, input, (err: Error | null, output: Record<string, Buffer>) => {
      if (err) reject(err);
      else resolve(output);
    });
  });
}

async function simplifyTopologically(fc: ZoneFeatureCollection): Promise<ZoneFeatureCollection> {
  const cmd = [
    `-i input.json snap snap-interval=${SNAP_INTERVAL_DEG}`,
    "-clean",
    `-simplify interval=${SIMPLIFY_INTERVAL_M} weighted keep-shapes`,
    `-o output.json precision=${OUTPUT_PRECISION_DEG} format=geojson`,
  ].join(" ");
  const output = await applyCommandsAsync(cmd, { "input.json": fc });
  return JSON.parse(output["output.json"].toString("utf8")) as ZoneFeatureCollection;
}

async function dissolveByProvince(fc: ZoneFeatureCollection): Promise<{
  type: "FeatureCollection";
  features: { properties: { provinceCode: string }; geometry: Geometry }[];
}> {
  const cmd = [
    "-i input.json",
    "-dissolve2 provinceCode",
    "-o output.json precision=" + OUTPUT_PRECISION_DEG + " format=geojson",
  ].join(" ");
  const output = await applyCommandsAsync(cmd, { "input.json": fc });
  return JSON.parse(output["output.json"].toString("utf8"));
}

// -------------------------------------------------------------- generador --

async function main(): Promise<void> {
  const zones = (zoneIndexArtifact as { zones: ZoneEntry[] }).zones;
  const municipalities = zones.filter((z) => z.level === "MUNICIPALITY");
  const firstLevel = zones.filter((z) => z.level === "FIRST_LEVEL");
  log(
    `índice: ${zones.length} zonas — ${municipalities.length} municipio, ${firstLevel.length} primer nivel`,
  );

  // R17: iterar por osmRelationId DISTINTO. 40 y 40.01 comparten
  // 1854614 — se descarga una vez y alimenta a las dos filas.
  const relationToCodes = new Map<number, string[]>();
  for (const zone of zones) {
    const relId = Number(zone.osmRelationId);
    const existing = relationToCodes.get(relId);
    if (existing) existing.push(zone.code);
    else relationToCodes.set(relId, [zone.code]);
  }
  const uniqueRelationIds = [...relationToCodes.keys()];
  log(`relaciones OSM distintas a descargar: ${uniqueRelationIds.length} (esperadas 183)`);
  if (uniqueRelationIds.length !== 183) {
    throw new Error(
      `se esperaban 183 relaciones distintas (R17); el índice da ${uniqueRelationIds.length}. No se genera nada.`,
    );
  }

  const byCode = new Map<string, Geometry>();
  let timestampOsmBase: string | null = null;

  // Caché de desarrollo, opcional (DEV_CACHE_PATH): reintentar la
  // simplificación o las comprobaciones no debería volver a pedirle 183
  // relaciones a Overpass. Nunca se activa en una corrida normal — sin la
  // variable de entorno, el camino es exactamente el de siempre.
  const devCachePath = process.env.ZONE_GEOMETRY_DEV_CACHE;
  const cached =
    devCachePath && existsSync(devCachePath)
      ? (JSON.parse(readFileSync(devCachePath, "utf8")) as {
          timestampOsmBase: string | null;
          byCode: Record<string, Geometry>;
        })
      : null;

  if (cached) {
    log(`usando la caché de desarrollo ${devCachePath} — sin pedirle nada a Overpass`);
    timestampOsmBase = cached.timestampOsmBase;
    for (const [code, geometry] of Object.entries(cached.byCode)) byCode.set(code, geometry);
  } else {
    const batches: number[][] = [];
    for (let i = 0; i < uniqueRelationIds.length; i += BATCH_SIZE) {
      batches.push(uniqueRelationIds.slice(i, i + BATCH_SIZE));
    }
    log(`descargando en ${batches.length} lotes de hasta ${BATCH_SIZE} relaciones`);
    for (const [index, batch] of batches.entries()) {
      log(`lote ${index + 1}/${batches.length}: [${batch.join(",")}]`);
      const { features, timestampOsmBase: ts } = await fetchAndConvert(batch);
      if (ts && !timestampOsmBase) timestampOsmBase = ts;
      for (const feature of features) {
        const relId = feature.properties.id;
        const codes = relationToCodes.get(relId);
        if (!codes) {
          log(`  aviso: relación ${relId} devuelta por Overpass pero no pedida — ignorada`);
          continue;
        }
        const geometry = toMultiPolygon(feature.geometry);
        for (const code of codes) byCode.set(code, geometry);
      }
      // Respeta la política de uso de Overpass: no ráfagas de peticiones
      // pesadas espalda con espalda.
      if (index < batches.length - 1) await delay(1_000);
    }
    if (devCachePath) {
      writeFileSync(
        devCachePath,
        JSON.stringify({ timestampOsmBase, byCode: Object.fromEntries(byCode) }),
      );
      log(`caché de desarrollo escrita en ${devCachePath}`);
    }
  }

  const missing = zones.filter((z) => !byCode.has(z.code));
  if (missing.length > 0) {
    throw new Error(
      `faltan ${missing.length} zonas tras descargar todas las relaciones: ${missing.map((z) => z.code).join(", ")}. No se genera nada (caso límite 16 — nunca se descarta en silencio).`,
    );
  }
  log(`las ${zones.length} zonas tienen geometría cruda`);

  // ---- la simplificación topológica, UNA operación sobre TODO el
  // conjunto de municipios (AD1(a)/(d), R15). Las provincias NO entran en
  // esta topología: una provincia y sus municipios se SOLAPAN en área (la
  // provincia es la unión de sus municipios), y mapshaper trata dos anillos
  // que cubren la misma región como duplicados/huecos en vez de como una
  // jerarquía — comprobado al escribir este guion. Los municipios, en
  // cambio, SÍ forman una partición plana entre sí (no se solapan), que es
  // la condición que el mecanismo de arcos compartidos necesita.
  const municipalitiesFC: ZoneFeatureCollection = {
    type: "FeatureCollection",
    features: municipalities.map((z) => ({
      type: "Feature",
      properties: { code: z.code, provinceCode: z.provinceCode },
      geometry: byCode.get(z.code)!,
    })),
  };
  log("simplificando (topológica, Visvalingam ponderada, snap+clean+simplify+precisión)…");
  const simplified = await simplifyTopologically(municipalitiesFC);
  if (simplified.features.length !== municipalities.length) {
    throw new Error(
      `la simplificación perdió zonas: entraron ${municipalities.length}, salieron ${simplified.features.length}. No se genera nada.`,
    );
  }
  const simplifiedByCode = new Map<string, ZoneFeature>(
    simplified.features.map((f) => [f.properties.code, f]),
  );
  for (const z of municipalities) {
    if (!simplifiedByCode.has(z.code)) {
      throw new Error(`la zona ${z.code} desapareció al simplificar. No se genera nada.`);
    }
  }

  // ---- primer nivel: se descarga (ya está, arriba) y se mide como dato
  // informativo de procedencia — NO decide la comprobación 1 (ver la nota
  // de cabecera de este archivo).
  const firstLevelAreas = firstLevel.map((z) => ({
    code: z.code,
    name: z.name,
    areaKm2: featureArea(byCode.get(z.code)!),
  }));

  // ================================================================
  // COMPROBACIÓN 1 — solapes por provincia (sustituye el erase contra el
  // polígono de primer nivel; ver la nota de cabecera, IP1).
  // ================================================================
  log("comprobación 1 — dissolve2 por provincia vs. suma de áreas…");
  const provinceCodes = [...new Set(municipalities.map((z) => z.provinceCode!))].sort();
  const dissolveInput: ZoneFeatureCollection = {
    type: "FeatureCollection",
    features: simplified.features.map((f) => ({
      type: "Feature",
      properties: f.properties,
      geometry: f.geometry,
    })),
  };
  const dissolved = await dissolveByProvince(dissolveInput);
  const dissolvedAreaByProvince = new Map<string, number>(
    dissolved.features.map((f) => [f.properties.provinceCode, featureArea(f.geometry)]),
  );

  const check1Failures: string[] = [];
  const check1Report: {
    provinceCode: string;
    sumKm2: number;
    dissolvedKm2: number;
    relDiff: number;
  }[] = [];
  for (const provinceCode of provinceCodes) {
    const munisOfProvince = simplified.features.filter(
      (f) => f.properties.provinceCode === provinceCode,
    );
    const sumArea = munisOfProvince.reduce((sum, f) => sum + featureArea(f.geometry), 0);
    const dissolvedArea = dissolvedAreaByProvince.get(provinceCode) ?? NaN;
    const relDiff = Math.abs(sumArea - dissolvedArea) / sumArea;
    check1Report.push({ provinceCode, sumKm2: sumArea, dissolvedKm2: dissolvedArea, relDiff });
    // `40` es una tautología (I9 de F-041/R17): su única "municipalidad" es
    // 40.01, así que dissolve2 de un solo elemento es ese elemento y la
    // diferencia relativa es exactamente 0 por construcción.
    if (!(relDiff <= DISSOLVE_AREA_RELATIVE_TOLERANCE)) {
      check1Failures.push(
        `provincia ${provinceCode}: suma=${sumArea.toFixed(3)} km², disuelta=${dissolvedArea.toFixed(3)} km², diff relativa=${(relDiff * 100).toFixed(4)}%`,
      );
    }
  }
  if (check1Failures.length > 0) {
    console.error("COMPROBACIÓN 1 FALLÓ — posible solape entre municipios de la misma provincia:");
    for (const line of check1Failures) console.error(`  ${line}`);
    console.error("No se escribió ningún fichero.");
    process.exit(1);
  }
  log(
    `comprobación 1 OK — ${provinceCodes.length} provincias, diferencia máxima ${(Math.max(...check1Report.map((r) => r.relDiff)) * 100).toFixed(4)}%`,
  );

  // ================================================================
  // COMPROBACIÓN 2 — cobertura punto a punto: rejilla (solapes) + sondas
  // de frontera (huecos). Cero puntos en 0 zonas, cero en 2+.
  // ================================================================
  log("comprobación 2 — rejilla por provincia y sondas de frontera…");
  let gridPointsChecked = 0;
  let boundaryProbesChecked = 0;
  const check2Failures: string[] = [];

  for (const provinceCode of provinceCodes) {
    const munisOfProvince = municipalities.filter((z) => z.provinceCode === provinceCode);
    const features = munisOfProvince.map((z) => simplifiedByCode.get(z.code)!);
    const bbox = unionBbox(features.map((f) => bboxOf(f.geometry)));
    const [minX, minY, maxX, maxY] = bbox;

    for (let x = minX; x <= maxX; x += GRID_STEP_DEG) {
      for (let y = minY; y <= maxY; y += GRID_STEP_DEG) {
        const point: [number, number] = [x, y];
        gridPointsChecked += 1;
        const matches = features.filter((f) => pointInFeature(point, f.geometry));
        if (matches.length >= 2) {
          check2Failures.push(
            `rejilla: punto [${x.toFixed(4)}, ${y.toFixed(4)}] de la provincia ${provinceCode} cae en ${matches.length} zonas: ${matches.map((f) => f.properties.code).join(", ")}`,
          );
        }
      }
    }

    for (let i = 0; i < features.length; i += 1) {
      for (let j = i + 1; j < features.length; j += 1) {
        const probes = boundaryProbesBetween(features[i], features[j]);
        for (const probe of probes) {
          boundaryProbesChecked += 1;
          const matches = features.filter((f) => pointInFeature(probe, f.geometry));
          if (matches.length === 0) {
            check2Failures.push(
              `sonda de frontera entre ${features[i].properties.code} y ${features[j].properties.code}: [${probe[0].toFixed(5)}, ${probe[1].toFixed(5)}] no cae en NINGUNA zona (hueco)`,
            );
          } else if (matches.length >= 2) {
            check2Failures.push(
              `sonda de frontera entre ${features[i].properties.code} y ${features[j].properties.code}: [${probe[0].toFixed(5)}, ${probe[1].toFixed(5)}] cae en ${matches.length} zonas (solape): ${matches.map((f) => f.properties.code).join(", ")}`,
            );
          }
        }
      }
    }
  }

  if (check2Failures.length > 0) {
    console.error(
      `COMPROBACIÓN 2 FALLÓ — ${check2Failures.length} de ${gridPointsChecked} puntos de rejilla / ${boundaryProbesChecked} sondas de frontera:`,
    );
    for (const line of check2Failures.slice(0, 30)) console.error(`  ${line}`);
    if (check2Failures.length > 30) console.error(`  … y ${check2Failures.length - 30} más`);
    console.error("No se escribió ningún fichero.");
    process.exit(1);
  }
  log(
    `comprobación 2 OK — ${gridPointsChecked} puntos de rejilla (cero en 2+), ${boundaryProbesChecked} sondas de frontera (cero en 0)`,
  );

  // ================================================================
  // Escritura — solo llega aquí si las DOS comprobaciones pasaron.
  // ================================================================
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const manifestZones: Record<
    string,
    { sha256: string; bytes: number; rings: number; vertices: number }
  > = {};
  for (const z of municipalities) {
    const feature = simplifiedByCode.get(z.code)!;
    const geometry = toMultiPolygon(feature.geometry);
    // Grano municipio, un Feature autosuficiente, `properties` con SOLO
    // `code` (architecture.md § Contratos 4: el nombre viaja aparte, la
    // geometría y el índice se versionan por separado, R16).
    const bytes = Buffer.from(
      JSON.stringify({ type: "Feature", properties: { code: z.code }, geometry }),
    );
    writeFileSync(join(OUT_DIR, `${z.code}.json`), bytes);
    const rings = geometry.coordinates.reduce((sum, poly) => sum + poly.length, 0);
    const vertices = geometry.coordinates.reduce(
      (sum, poly) => sum + poly.reduce((s, ring) => s + ring.length, 0),
      0,
    );
    manifestZones[z.code] = {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      rings,
      vertices,
    };
  }

  const zonesBlockSha256 = createHash("sha256").update(JSON.stringify(manifestZones)).digest("hex");

  const manifest = {
    version: GEOMETRY_VERSION,
    generatedAt: new Date().toISOString(),
    indexVersion: (zoneIndexArtifact as { version: string }).version,
    projection: "EPSG:4326",
    snapInterval: SNAP_INTERVAL_DEG,
    simplify: { method: "visvalingam-weighted", interval: SIMPLIFY_INTERVAL_M, topological: true },
    precision: OUTPUT_PRECISION_DEG,
    tool: TOOL,
    zones: manifestZones,
    sha256: zonesBlockSha256,
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  writeFileSync(join(OUT_DIR, "manifest.json"), manifestBytes);

  const totalBytes = readdirSync(OUT_DIR).reduce((sum, name) => {
    const path = join(OUT_DIR, name);
    return sum + Buffer.byteLength(readFileSync(path));
  }, 0);

  writeProvenance({
    timestampOsmBase,
    totalBytes,
    zoneCount: municipalities.length,
    relationCount: uniqueRelationIds.length,
    firstLevelAreas,
    check1Report,
    gridPointsChecked,
    boundaryProbesChecked,
  });

  log(`escritos ${municipalities.length} ficheros de zona + manifest.json en ${OUT_DIR}`);
  log(`peso total del artefacto: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
  if (totalBytes > 3 * 1024 * 1024) {
    log(
      "AVISO: el artefacto pasa de 3 MB (D9/PP1) — aprieta la tolerancia (interval, precision) y regenera antes de commitear.",
    );
  }
}

function writeProvenance(data: {
  timestampOsmBase: string | null;
  totalBytes: number;
  zoneCount: number;
  relationCount: number;
  firstLevelAreas: { code: string; name: string; areaKm2: number }[];
  check1Report: { provinceCode: string; sumKm2: number; dissolvedKm2: number; relDiff: number }[];
  gridPointsChecked: number;
  boundaryProbesChecked: number;
}): void {
  const generatedAt = new Date().toISOString();
  const zoneIndexVersion = (zoneIndexArtifact as { version: string }).version;
  const lines = [
    "---",
    "feature: F-042",
    `actualizado: ${generatedAt}`,
    "---",
    "",
    "# Procedencia del artefacto de geometría",
    "",
    "Generado por `scripts/build-zone-geometry.ts` (`npm run geometry:zones`),",
    "el segundo artefacto de la ADR 0032 (e). El primero es el índice",
    "(`src/features/zones/zone-index.provenance.md`, F-041); este es",
    "estrictamente geometría y se versiona por separado (R16).",
    "",
    "## Volcado de OSM",
    "",
    `- **Fuente**: Overpass API (\`${OVERPASS_URL}\`), por \`osmRelationId\` — 183`,
    "  relaciones distintas para las 184 filas del índice (R17: `40` y `40.01`",
    "  comparten la relación 1854614, y solo cuenta una vez).",
    `- **\`timestamp_osm_base\`** del volcado: ${data.timestampOsmBase ?? "no disponible en la respuesta"}.`,
    `- **Generado el**: ${generatedAt}.`,
    `- **\`indexVersion\`** con la que se cortó: ${zoneIndexVersion} (procedencia, no un aserto — R16).`,
    "",
    "## Proyección, snap, simplificación y precisión",
    "",
    "- **Proyección**: EPSG:4326 (WGS84), sin reproyectar.",
    `- **Snap de importación**: ${SNAP_INTERVAL_DEG}° (≈166 m) — une vértices`,
    "  casi coincidentes de relaciones vecinas antes de construir el grafo de",
    "  arcos (AD1(d)). DESVIACIÓN medida de architecture.md, que estimaba",
    "  0.00001° (≈1 m): con ese valor, la comprobación 2 encontró huecos",
    "  reales de 30-150 m entre pares concretos de relaciones vecinas que no",
    "  comparten ni una vía en OSM — dos relaciones de OSM no siempre",
    "  comparten las mismas vías, y aquí ni siquiera comparten vértices",
    "  cercanos. Subir el snap (nunca bajar la exigencia de la comprobación,",
    "  riesgo 3 de architecture.md) hasta que las dos comprobaciones",
    "  convergieran fue lo que fijó este valor.",
    "- **Simplificación**: Visvalingam ponderada (`weighted`), `keep-shapes`,",
    `  \`interval=${SIMPLIFY_INTERVAL_M}\` metros, **topológica**: mapshaper construye`,
    "  un grafo de arcos compartidos entre polígonos vecinos y simplifica sobre",
    "  los arcos, no sobre cada anillo — la frontera entre dos municipios se",
    "  simplifica UNA vez y las dos vecinas heredan la misma línea (R15).",
    `- **Precisión de salida**: ${OUTPUT_PRECISION_DEG}° (≈11 m) — una SEGUNDA pérdida,`,
    "  un orden de magnitud más fina que la tolerancia de simplificación.",
    `- **Herramienta**: ${TOOL}, \`osmtogeojson@${osmtogeojsonPkg.version}\` para la`,
    "  conversión de la respuesta de Overpass.",
    "",
    "## Las dos comprobaciones",
    "",
    "**Corren DESPUÉS del redondeo**, sobre los bytes tal como se commitean —",
    "comprobar un intermedio sería comprobar un fichero que nadie usa.",
    "",
    "**Comprobación 1 — DESVIACIÓN documentada de architecture.md § AD1(d)",
    "(ver `.agent/specs/F-042/impl.md` § Desviaciones, IP1 para el humano).**",
    "El diseño firmado comparaba `dissolve2(municipios, provinceCode)` contra",
    "el polígono de PRIMER NIVEL de OSM con un `erase` bidireccional. Medido",
    "al generar, ese polígono no es comparable: las relaciones",
    "`admin_level=4` de Cuba en OSM incluyen aguas territoriales que las de",
    "`admin_level=6` (los municipios) no incluyen. Las áreas de las 16",
    "relaciones de primer nivel, descargadas igualmente (183 relaciones en",
    "total, como fija el paso 2 del plan) y medidas aquí SOLO como dato",
    "informativo — no deciden nada de lo de abajo:",
    "",
    "| Código | Nombre | Área (km², informativa) |",
    "| --- | --- | --- |",
    ...data.firstLevelAreas.map((p) => `| ${p.code} | ${p.name} | ${p.areaKm2.toFixed(1)} |`),
    "",
    "En su lugar, la comprobación 1 verifica SOLAPES por provincia:",
    "`dissolve2(provinceCode)` sobre los municipios YA simplificados tiene",
    "que dar la MISMA área que la suma de sus áreas individuales — un solape",
    "la reduciría. `40` es una tautología (su única municipalidad es 40.01,",
    "dissolve2 de un elemento es ese elemento).",
    "",
    "| Provincia | Suma (km²) | Disuelta (km²) | Diferencia relativa |",
    "| --- | --- | --- | --- |",
    ...data.check1Report.map(
      (r) =>
        `| ${r.provinceCode} | ${r.sumKm2.toFixed(3)} | ${r.dissolvedKm2.toFixed(3)} | ${(r.relDiff * 100).toFixed(4)}% |`,
    ),
    "",
    `Umbral: ${(DISSOLVE_AREA_RELATIVE_TOLERANCE * 100).toFixed(2)}% de diferencia relativa. Las 16 pasaron.`,
    "",
    "**Comprobación 2 — cobertura punto a punto**, tal como fija R15: una",
    `rejilla determinista de ${GRID_STEP_DEG}° sobre el bbox de cada provincia`,
    `(${data.gridPointsChecked} puntos en total) más dos sondas a`,
    `${BOUNDARY_PROBE_OFFSET_DEG}° a cada lado del punto medio de cada`,
    `segmento de frontera compartido entre dos municipios vecinos`,
    `(${data.boundaryProbesChecked} sondas). Cero puntos de la rejilla en dos`,
    "o más zonas, cero sondas de frontera sin ninguna zona. Las dos pasaron.",
    "",
    "## El artefacto",
    "",
    `- **${data.zoneCount} ficheros** \`<code>.json\` (uno por municipio) más`,
    "  `manifest.json`, con sus hashes y recuentos.",
    `- **Peso total medido**: ${(data.totalBytes / 1024 / 1024).toFixed(2)} MB (D9/PP1: se`,
    "  aceptan hasta 3 MB con esta tolerancia; por encima, se aprieta antes de",
    "  plantear otra cosa).",
    "",
    "## Regenerar",
    "",
    "```bash",
    "npm run geometry:zones",
    "```",
    "",
    "Necesita red (Overpass API) y tarda minutos, no segundos — se hace una",
    "vez, no en cada despliegue (docs/despliegue.md).",
    "",
  ];
  writeFileSync(PROVENANCE_PATH, lines.join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
