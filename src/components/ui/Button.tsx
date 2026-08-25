import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-brand-contrast hover:opacity-90",
  secondary: "bg-surface-muted text-fg border border-border hover:bg-surface",
  ghost: "text-fg hover:bg-surface-muted",
};

const SIZES: Record<Size, string> = {
  // 44px minimum touch target on the two sizes used on phones.
  sm: "min-h-9 px-3 text-sm",
  md: "min-h-11 px-4 text-base",
  lg: "min-h-12 px-6 text-lg",
};

/**
 * Server component by default — no "use client". A button that only submits a
 * form or navigates does not need to ship JavaScript, and on the connections
 * this app targets that is not a micro-optimisation.
 */
export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[--radius-md] font-medium",
        "focus-visible:outline-brand transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
