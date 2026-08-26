import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "danger" | "warning" | "positive" | "muted";

const TONE_CLASSES: Record<Tone, string> = {
  danger: "bg-danger/12 text-danger border-danger/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  positive: "bg-positive/12 text-positive border-positive/30",
  muted: "bg-surface-muted text-fg-muted border-border",
};

/**
 * `danger`/`warning` interrupt (`role="alert"`); `positive`/`muted` inform
 * without interrupting (`role="status"`) — the same distinction design.md
 * draws between the 409/429/500 banners and the carrito's "cannot continue"
 * notice.
 */
const TONE_ROLE: Record<Tone, "alert" | "status"> = {
  danger: "alert",
  warning: "alert",
  positive: "status",
  muted: "status",
};

export function Alert({
  tone = "muted",
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={TONE_ROLE[tone]}
      className={cn("rounded-md border p-4 text-sm", TONE_CLASSES[tone], className)}
    >
      {title && <p className="font-medium">{title}</p>}
      <div className={title ? "mt-1" : undefined}>{children}</div>
    </div>
  );
}
