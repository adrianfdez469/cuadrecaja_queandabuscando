import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("border-border bg-surface shadow-card rounded-lg border", className)}
      {...props}
    />
  );
}
