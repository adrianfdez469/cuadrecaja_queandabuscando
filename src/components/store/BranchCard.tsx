import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { classifyStoreClosure, resolveStoreClosureHeadline } from "@/lib/storeClosure";
import type { BranchRef } from "@/features/storefront/server/resolve";

/**
 * One branch, in `BranchList` (design.md § 1, § 3). Server component — no
 * state, no events, and it renders the vitrina (AGENTS.md: never `"use
 * client"` here).
 *
 * `current` is the `/[slug]/sucursales` "switch" variant's own branch: not a
 * link (there is nowhere to send someone already there), `Badge` `Estás
 * aquí`, `aria-current="page"`.
 */

type Tone = "positive" | "warning" | "danger" | "muted";

function statusBadge(branch: BranchRef): { label: string; tone: Tone } {
  if (branch.status === "PUBLISHED") return { label: "Abierta", tone: "positive" };
  const attribution = classifyStoreClosure(branch);
  return attribution === "platform"
    ? { label: "Suspendida", tone: "danger" }
    : { label: "Cerrada ahora", tone: "warning" };
}

function affordance(branch: BranchRef): string {
  return branch.status === "PUBLISHED" ? "Ver el catálogo" : "Ver por qué está cerrada";
}

export function BranchCard({ branch, current = false }: { branch: BranchRef; current?: boolean }) {
  const { label, tone } = current
    ? { label: "Estás aquí", tone: "muted" as Tone }
    : statusBadge(branch);
  const location = [branch.city, branch.address].filter(Boolean).join(" · ");
  const reason =
    branch.status !== "PUBLISHED"
      ? resolveStoreClosureHeadline({
          disabledReasonCode: branch.disabledReasonCode,
          disabledAt: branch.disabledAt,
        })
      : null;

  const body = (
    <Card className="min-h-20 p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 truncate text-lg font-semibold">{branch.name}</h2>
        <Badge tone={tone} className="shrink-0">
          {label}
        </Badge>
      </div>
      {location && <p className="text-fg-muted mt-1 truncate text-sm">{location}</p>}
      {reason && <p className="text-fg-muted mt-1 text-sm">{reason}</p>}
      {!current && (
        <p className="text-brand mt-2 text-sm font-medium">
          {affordance(branch)} <span aria-hidden>→</span>
        </p>
      )}
    </Card>
  );

  if (current) {
    return (
      <li aria-current="page">
        <div>{body}</div>
      </li>
    );
  }

  return (
    <li>
      <Link href={`/${branch.canonicalSlug}`} className="block">
        {body}
      </Link>
    </li>
  );
}
