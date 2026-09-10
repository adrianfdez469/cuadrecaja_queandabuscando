import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-042 (architecture.md § AD1(e), § Contratos 4) — `GET
 * /api/zones/geometry/{slug}`. Los tres módulos de dominio que el propio
 * `architecture.md` dice que esta ruta compone se mockean; cero lógica de
 * negocio propia que probar aquí, así que lo que se prueba es la
 * COMPOSICIÓN: resolución de slug, `no-store`, cobertura vacía como `200`
 * (nunca `404`), y una zona ofrecible sin fichero de geometría anotada en
 * `missing` en vez de descartada en silencio (caso límite 16).
 */

const resolvePublicSlug = vi.fn();
const loadStoreZoneCoverage = vi.fn();
const geometryVersion = vi.fn();
const readZoneGeometryRaw = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

vi.mock("@/features/storefront/server/resolve", () => ({
  resolvePublicSlug: (...args: unknown[]) => resolvePublicSlug(...args),
}));

vi.mock("@/features/zones/server/coverage", () => ({
  loadStoreZoneCoverage: (...args: unknown[]) => loadStoreZoneCoverage(...args),
}));

vi.mock("@/features/zones/server/geometry", () => ({
  geometryVersion: (...args: unknown[]) => geometryVersion(...args),
  readZoneGeometryRaw: (...args: unknown[]) => readZoneGeometryRaw(...args),
}));

const { GET, dynamic } = await import("./route");

function get(slug: string) {
  return GET(new Request(`http://localhost/api/zones/geometry/${slug}`), {
    params: Promise.resolve({ slug }),
  });
}

const ZONE_23_01 = {
  code: "23.01",
  name: "Playa",
  provinceCode: "23",
  provinceName: "La Habana",
  deliveryFee: "300.00",
};
const ZONE_23_11 = {
  code: "23.11",
  name: "Marianao",
  provinceCode: "23",
  provinceName: "La Habana",
  deliveryFee: "300.00",
};

beforeEach(() => {
  resolvePublicSlug.mockReset();
  loadStoreZoneCoverage.mockReset();
  geometryVersion.mockReset().mockReturnValue("1.0.0");
  readZoneGeometryRaw.mockReset();
});

describe("GET /api/zones/geometry/[slug] — force-dynamic, no lógica de negocio propia", () => {
  it("export const dynamic es el literal 'force-dynamic' (ficha revalidate-no-literal.md)", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("un slug que no resuelve a ninguna tienda responde 404 STORE_NOT_FOUND, con no-store", async () => {
    resolvePublicSlug.mockResolvedValue(null);
    const response = await get("no-existe");
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ error: "STORE_NOT_FOUND" });
    expect(loadStoreZoneCoverage).not.toHaveBeenCalled();
  });

  it("una resolución 'selector' (marca con varias sucursales, ninguna elegida) es el MISMO 404 — un pedido siempre lo sirve una sola sucursal", async () => {
    resolvePublicSlug.mockResolvedValue({ kind: "selector" });
    const response = await get("una-marca");
    expect(response.status).toBe(404);
    expect(loadStoreZoneCoverage).not.toHaveBeenCalled();
  });

  it("cobertura null (la tienda no es ZONE_BASED) es 200 con features: [] — NUNCA 404: la tienda existe, solo no tiene mapa que enseñar", async () => {
    resolvePublicSlug.mockResolvedValue({ kind: "branch", storeId: "store-1" });
    loadStoreZoneCoverage.mockResolvedValue(null);
    const response = await get("tienda-flat-rate");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/geo+json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ type: "FeatureCollection", geometryVersion: "1.0.0", features: [] });
  });

  it("cobertura vacía ([], ZONE_BASED pero sin tarifario resoluble) también es 200 con features: []", async () => {
    resolvePublicSlug.mockResolvedValue({ kind: "branch", storeId: "store-1" });
    loadStoreZoneCoverage.mockResolvedValue([]);
    const response = await get("tienda-sin-tarifario");
    const body = await response.json();
    expect(body.features).toEqual([]);
  });

  it("la cobertura exacta de la tienda entra completa: CUATRO zonas piden CUATRO ficheros, ni uno más", async () => {
    const coverage = [
      ZONE_23_01,
      ZONE_23_11,
      { ...ZONE_23_01, code: "23.02", name: "Bauta" },
      { ...ZONE_23_01, code: "23.03", name: "Caimito" },
    ];
    resolvePublicSlug.mockResolvedValue({ kind: "branch", storeId: "store-1" });
    loadStoreZoneCoverage.mockResolvedValue(coverage);
    readZoneGeometryRaw.mockImplementation(
      (code: string) =>
        `{"type":"Feature","properties":{"code":"${code}"},"geometry":{"type":"MultiPolygon","coordinates":[]}}`,
    );

    const response = await get("tienda-cuatro-zonas");
    const body = await response.json();

    expect(body.features).toHaveLength(4);
    expect(
      body.features.map((f: { properties: { code: string } }) => f.properties.code).sort(),
    ).toEqual(["23.01", "23.02", "23.03", "23.11"].sort());
    expect(readZoneGeometryRaw).toHaveBeenCalledTimes(4);
    expect(body.missing).toBeUndefined();
  });

  it("una zona ofrecible SIN fichero de geometría no se descarta en silencio: entra en 'missing', las demás se sirven, y avisa con console.warn (nunca console.error)", async () => {
    resolvePublicSlug.mockResolvedValue({ kind: "branch", storeId: "store-1" });
    loadStoreZoneCoverage.mockResolvedValue([ZONE_23_01, ZONE_23_11]);
    readZoneGeometryRaw.mockImplementation((code: string) =>
      code === "23.11"
        ? null
        : `{"type":"Feature","properties":{"code":"${code}"},"geometry":{"type":"MultiPolygon","coordinates":[]}}`,
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await get("tienda-desalineada");
    const body = await response.json();

    expect(body.features).toHaveLength(1);
    expect(body.features[0].properties.code).toBe("23.01");
    expect(body.missing).toEqual(["23.11"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/^\[zones\]/);
    expect(error).not.toHaveBeenCalled();

    warn.mockRestore();
    error.mockRestore();
  });

  it("el cuerpo se compone concatenando las cadenas de geometría verbatim — nunca re-serializando un objeto ya parseado (§ Contratos 4)", async () => {
    resolvePublicSlug.mockResolvedValue({ kind: "branch", storeId: "store-1" });
    loadStoreZoneCoverage.mockResolvedValue([ZONE_23_01]);
    // Espacios y orden de claves DELIBERADAMENTE distintos de lo que un
    // `JSON.stringify` produciría — si la ruta reserializara, esta forma
    // exacta desaparecería del cuerpo.
    const raw =
      '{"type": "Feature",  "properties":{"code":"23.01"},"geometry":{"type":"MultiPolygon","coordinates":[[[1,2]]]}}';
    readZoneGeometryRaw.mockReturnValue(raw);

    const response = await get("tienda-una-zona");
    const text = await response.text();
    expect(text).toContain(raw);
  });
});
