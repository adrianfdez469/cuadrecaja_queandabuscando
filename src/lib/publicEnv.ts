/**
 * F-042 (§ Desviaciones de impl.md) — extraído de `src/lib/env.ts`, sin
 * ninguna dependencia de Zod. Antes de este feature nada de lo que importaba
 * `publicEnv` corría en un árbol de cliente medido por el presupuesto de
 * JavaScript; `ZoneMapPanel.tsx` es el primero (necesita leer el par de
 * variables del proveedor de teselas, AD9), y medirlo destapó que
 * `src/lib/env.ts` metía `zod` (~63 KB gzip) en cualquier bundle de cliente
 * que tocara `publicEnv`, aunque solo usara esta mitad — Turbopack no
 * eliminaba el `serverSchema` de Zod ni `serverEnv()` como código muerto
 * solo porque el importador no los usara. Este módulo es la mitad que
 * SIEMPRE fue segura de leer en el navegador; `src/lib/env.ts` se queda con
 * `serverEnv()`, que es la única mitad que necesita Zod.
 */

/** Public config. Safe to read in the browser. */
export const publicEnv = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  /** F-042 (AD9, D2, R18): el proveedor alternativo de teselas del mapa de
   *  zonas. `null` cuando la variable no está — `resolveTileLayer`
   *  (`src/features/zones/tiles.ts`) decide qué hacer con eso, nunca este
   *  módulo. `NEXT_PUBLIC_*` se inlinea en el build: cambiar de proveedor
   *  exige un despliegue nuevo, no solo reiniciar (docs/despliegue.md). */
  mapTileUrlTemplate: process.env.NEXT_PUBLIC_MAP_TILE_URL_TEMPLATE ?? null,
  mapTileAttribution: process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION ?? null,
} as const;
