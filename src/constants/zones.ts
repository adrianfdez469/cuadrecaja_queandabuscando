/**
 * F-042 — constantes de zonas de envío: las teselas por defecto (AD9), el
 * tope de longitud del código en el cuerpo de `POST /api/orders`
 * (architecture.md § Contratos 3), y los números de maquetación que
 * design.md fija para el selector y el mapa (AGENTS.md § Prohibiciones:
 * nada de magic numbers sueltos en los componentes).
 */

// --- Teselas (AD9, D2, R18) -------------------------------------------------

/** Con NINGUNA de las dos variables de entorno puestas, o con solo una, se
 *  sirve esto — nunca las teselas de un tercero bajo el crédito de otro. */
export const ZONE_MAP_DEFAULT_TILE_URL_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const ZONE_MAP_DEFAULT_ATTRIBUTION = "© colaboradores de OpenStreetMap";

/** AP1 — SIEMPRE visible, además del crédito de teselas de arriba (el de la
 *  variable, o el de OSM): los polígonos son derivados de OSM y por ODbL
 *  exigen crédito con independencia de quién sirva las teselas. No depende
 *  de ninguna variable de entorno; no la decide `resolveTileLayer` (no es
 *  "la regla del par") — la pinta el componente del mapa, siempre. */
export const ZONE_BOUNDARIES_ATTRIBUTION =
  "Límites municipales © colaboradores de OpenStreetMap (ODbL)";

// --- El cuerpo de POST /api/orders (architecture.md § Contratos 3) --------

/** Ningún código del índice pasa de 5 caracteres ("40.01"); con margen. */
export const ZONE_CODE_MAX_LENGTH = 16;

// --- Maquetación (design.md § 1, § 3, § Estructura por breakpoint) --------

export const ZONE_LIST_MAX_HEIGHT_MOBILE_REM = 17.5;
export const ZONE_LIST_MAX_HEIGHT_DESKTOP_REM = 24;

export const ZONE_MAP_PANEL_HEIGHT_TABLET_REM = 24;
export const ZONE_MAP_PANEL_HEIGHT_DESKTOP_REM = 28;

/** design.md § 3: a partir de aquí, "Sigue cargando…" con la salida a la
 *  lista. */
export const ZONE_MAP_SLOW_LOAD_MS = 3_000;

/** El breakpoint donde el mapa pasa de hoja a pantalla completa a panel en
 *  línea (design.md § Estructura por breakpoint) — el mismo `sm:`/`md:` que
 *  el resto del checkout usa para su rejilla de dos columnas. */
export const ZONE_MAP_SHEET_BREAKPOINT_PX = 768;
