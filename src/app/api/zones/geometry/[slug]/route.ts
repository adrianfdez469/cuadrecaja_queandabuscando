import { prisma } from "@/lib/prisma";
import { resolvePublicSlug } from "@/features/storefront/server/resolve";
import { loadStoreZoneCoverage } from "@/features/zones/server/coverage";
import { geometryVersion, readZoneGeometryRaw } from "@/features/zones/server/geometry";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * `GET /api/zones/geometry/{slug}` — F-042 (architecture.md § AD1(e),
 * § Contratos 4). Resuelve el slug, calcula la cobertura de esa sucursal
 * con la MISMA función que la página del checkout (`loadStoreZoneCoverage`,
 * una consulta), y CONCATENA las cadenas de sus ficheros de geometría — cero
 * lógica de negocio, cero `JSON.parse` de un byte de coordenadas.
 *
 * `no-store`: la cobertura es dinámica (el tarifario cambia), y un
 * `s-maxage` corto dejaría el mapa enseñando durante un minuto una zona que
 * la lista —que sí es fresca— ya no ofrece.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/zones/geometry/[slug]">,
) {
  const { slug } = await params;
  const resolution = await resolvePublicSlug(slug);

  if (!resolution || resolution.kind === "selector") {
    return new Response(JSON.stringify({ error: "STORE_NOT_FOUND" }), {
      status: 404,
      headers: { ...NO_STORE, "content-type": "application/json" },
    });
  }

  // `?? []`: una tienda que no es ZONE_BASED con domicilio no tiene
  // cobertura que enseñar, y el mapa nunca debería haberla pedido — pero si
  // lo hace, cero zonas es una respuesta honesta, no un error (architecture
  // § Contratos 4: "cero zonas es 200 con features: []").
  const coverage = (await loadStoreZoneCoverage(prisma, resolution.storeId)) ?? [];

  const featureStrings: string[] = [];
  const missing: string[] = [];
  for (const zone of coverage) {
    const raw = readZoneGeometryRaw(zone.code);
    if (raw === null) {
      // Caso límite 16: una zona ofrecible sin fichero de geometría no se
      // descarta en silencio — se anota y se sirven las demás.
      missing.push(zone.code);
      console.warn(`[zones] geometría faltante para una zona ofrecible: ${zone.code}`);
      continue;
    }
    featureStrings.push(raw);
  }

  // `properties` solo trae `code` (los ficheros ya lo garantizan); el
  // cuerpo se construye concatenando cadenas, NUNCA re-serializando un
  // objeto ya parseado (§ Contratos 4, § Escalabilidad 5).
  const body =
    `{"type":"FeatureCollection","geometryVersion":${JSON.stringify(geometryVersion())},` +
    `"features":[${featureStrings.join(",")}]` +
    (missing.length > 0 ? `,"missing":${JSON.stringify(missing)}` : "") +
    "}";

  return new Response(body, {
    status: 200,
    headers: { ...NO_STORE, "content-type": "application/geo+json" },
  });
}
