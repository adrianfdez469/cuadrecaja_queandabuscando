/** Join class names, dropping falsy values. Deliberately tiny — no clsx dependency. */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
