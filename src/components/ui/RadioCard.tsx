import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * A real `<input type="radio">` inside a clickable card, not a hand-rolled
 * `div role="radio"`: arrow-key navigation and screen reader semantics come
 * from the browser instead of being reimplemented. Meant to sit inside a
 * `<fieldset><legend>` (design.md § Accesibilidad).
 */
export function RadioCard({
  label,
  description,
  className,
  ...props
}: ComponentProps<"input"> & { label: string; description?: string }) {
  return (
    <label
      className={cn(
        "border-border has-[:checked]:border-brand has-[:checked]:bg-brand/8 flex min-h-14 cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors",
        className,
      )}
    >
      <input type="radio" className="h-5 w-5 shrink-0" {...props} />
      <span>
        <span className="text-fg block font-medium">{label}</span>
        {description && <span className="text-fg-muted block text-sm">{description}</span>}
      </span>
    </label>
  );
}
