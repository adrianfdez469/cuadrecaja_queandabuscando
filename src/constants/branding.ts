/**
 * F-011 tanda 3, § 12a (i)/(ii)/(iv) de design.md: six literal palettes for
 * the branding editor's chips, the two light/dark text shortcuts, and the
 * two example product names of the previzualización — all cadenas mágicas
 * that AGENTS.md sends here instead of living inline in a component.
 *
 * DP13 (aprobada): the six hexadecimals are a placeholder, not a design
 * system — the human already said these get replaced once a real one
 * exists. Replacing them later is an edit of THIS file; it never touches a
 * store's already-saved `themeTokens` (tokens are stored as a VALUE, never
 * as a reference to a palette).
 */

export type BrandPalette = {
  name: string;
  brand: string;
  brandContrast: string;
  accent: string;
  accentContrast: string;
};

export const BRAND_PALETTES: readonly BrandPalette[] = [
  {
    name: "Azul",
    brand: "#0f62fe",
    brandContrast: "#ffffff",
    accent: "#ff832b",
    accentContrast: "#161616",
  },
  {
    name: "Verde",
    brand: "#198038",
    brandContrast: "#ffffff",
    accent: "#f1c21b",
    accentContrast: "#161616",
  },
  {
    name: "Naranja",
    brand: "#d94f1a",
    brandContrast: "#ffffff",
    accent: "#1192e8",
    accentContrast: "#ffffff",
  },
  {
    name: "Vino",
    brand: "#8a1d3b",
    brandContrast: "#ffffff",
    accent: "#d2a106",
    accentContrast: "#161616",
  },
  {
    name: "Turquesa",
    brand: "#007d79",
    brandContrast: "#ffffff",
    accent: "#ff7eb6",
    accentContrast: "#161616",
  },
  {
    name: "Grafito",
    brand: "#3d3d3d",
    brandContrast: "#ffffff",
    accent: "#4589ff",
    accentContrast: "#161616",
  },
];

/** design.md § 12a (ii): nine times out of ten, the answer for a
 *  "texto sobre color" field is one of these two. */
export const BRAND_CONTRAST_SHORTCUTS = {
  CLARO: "#ffffff",
  OSCURO: "#161616",
} as const;

/** design.md § 12a (iv): fixed example names for `StorefrontPreview`'s two
 *  demo products — never real products of the store being edited, so the
 *  screen stays at architecture.md's two queries. */
export const BRAND_PREVIEW_PRODUCTS = ["Café molido 250 g", "Arroz 1 kg"] as const;

/** design.md § 12a (iii): the four `RadioCard` of "Esquinas". `undefined`
 *  (no `value` sent) is "Las de siempre" — the radius key is simply absent
 *  from the saved tokens, not a fifth enum member. */
export const RADIUS_OPTIONS: readonly { value: "sharp" | "soft" | "round"; label: string }[] = [
  { value: "sharp", label: "Rectas" },
  { value: "soft", label: "Suaves" },
  { value: "round", label: "Muy redondeadas" },
];

export const RADIUS_DEFAULT_LABEL = "Las de siempre";
export const RADIUS_DEFAULT_HELP = "Las esquinas que trae queandabuscando.";

export const RADIUS_LABEL_BY_VALUE: Record<"sharp" | "soft" | "round", string> = {
  sharp: "Rectas",
  soft: "Suaves",
  round: "Muy redondeadas",
};
