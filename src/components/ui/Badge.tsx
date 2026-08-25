import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Tone = "positive" | "warning" | "muted" | "danger";

const TONES: Record<Tone, string> = {
  positive: "bg-positive/12 text-positive",
  warning: "bg-warning/15 text-warning",
  muted: "bg-surface-muted text-fg-muted",
  danger: "bg-danger/12 text-danger",
};

export function Badge({
  tone = "muted",
  className,
  ...props
}: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[--radius-sm] px-2 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
