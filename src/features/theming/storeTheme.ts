import { z } from "zod";

/**
 * Per-store branding.
 *
 * A store may override a small, fixed set of tokens. The set is deliberately
 * small: letting a business set arbitrary CSS would put unvalidated text into a
 * <style> tag, and would let one store make itself unreadable.
 *
 * Values are validated as CSS colours before they are ever serialised.
 */

const CSS_COLOR = /^(#[0-9a-fA-F]{3,8}|(rgb|hsl|oklch|lab|lch)a?\([0-9a-zA-Z .,%/-]+\)|[a-zA-Z]+)$/;

const colorToken = z.string().trim().min(1).max(64).regex(CSS_COLOR, "Not a CSS color");

export const themeTokensSchema = z
  .object({
    brand: colorToken.optional(),
    brandContrast: colorToken.optional(),
    accent: colorToken.optional(),
    accentContrast: colorToken.optional(),
    radius: z.enum(["sharp", "soft", "round"]).optional(),
  })
  .strict();

export type ThemeTokens = z.infer<typeof themeTokensSchema>;

const RADIUS_SCALE = {
  sharp: { sm: "0.125rem", md: "0.25rem", lg: "0.375rem" },
  soft: { sm: "0.375rem", md: "0.625rem", lg: "1rem" },
  round: { sm: "0.75rem", md: "1.25rem", lg: "2rem" },
} as const;

const CUSTOM_PROPERTY: Record<keyof Omit<ThemeTokens, "radius">, string> = {
  brand: "--color-brand",
  brandContrast: "--color-brand-contrast",
  accent: "--color-accent",
  accentContrast: "--color-accent-contrast",
};

/**
 * Render a store's overrides as a scoped CSS rule.
 *
 * Returns an empty string when there is nothing to override, so the caller can
 * skip the <style> tag entirely rather than shipping an empty one on every page.
 */
export function renderStoreTheme(slug: string, raw: unknown): string {
  const parsed = themeTokensSchema.safeParse(raw ?? {});
  if (!parsed.success) return "";

  const tokens = parsed.data;
  const declarations: string[] = [];

  for (const [key, property] of Object.entries(CUSTOM_PROPERTY)) {
    const value = tokens[key as keyof typeof CUSTOM_PROPERTY];
    if (value) declarations.push(`${property}:${value}`);
  }

  if (tokens.radius) {
    const scale = RADIUS_SCALE[tokens.radius];
    declarations.push(
      `--radius-sm:${scale.sm}`,
      `--radius-md:${scale.md}`,
      `--radius-lg:${scale.lg}`,
    );
  }

  if (declarations.length === 0) return "";

  // The slug is already constrained to [a-z0-9-] by lib/slug, but escape here
  // too — this string goes straight into a <style> tag.
  const safeSlug = slug.replace(/[^a-z0-9-]/g, "");
  return `[data-store="${safeSlug}"]{${declarations.join(";")}}`;
}
