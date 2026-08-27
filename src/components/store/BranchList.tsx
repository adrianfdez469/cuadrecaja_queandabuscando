import { classifyStoreClosure } from "@/lib/storeClosure";
import type { BranchRef } from "@/features/storefront/server/resolve";
import { BranchCard } from "./BranchCard";

/**
 * The `<ul>` of sucursales — the selector's body (criterio 2) and the
 * "switch" screen's list (`/[slug]/sucursales`, criterio 6), the SAME
 * component in both (architecture.md § El selector de sucursal, design.md §
 * Componentes de UI). Server component, cero consultas propias: every
 * `BranchRef` arrives already resolved.
 *
 * `data-branch-picker` is the marker criterio 1 checks for its ABSENCE on a
 * single-branch brand — trivially true there only because this component
 * never renders at all, which is the point (I7).
 */

type Group = 0 | 1 | 2;

function groupOf(branch: BranchRef): Group {
  if (branch.status === "PUBLISHED") return 0;
  return classifyStoreClosure(branch) === "platform" ? 2 : 1;
}

/** DP3: open branches first, then closed, then platform-suspended;
 *  alphabetical within each group. The resolver's query already orders by
 *  name, and `Array#sort` is stable (ES2019+), so a sort by group alone
 *  keeps that order inside each group without a second comparison key. */
function sortBranches(branches: BranchRef[]): BranchRef[] {
  return [...branches].sort((a, b) => groupOf(a) - groupOf(b));
}

export function BranchList({
  branches,
  variant,
  currentStoreId,
}: {
  branches: BranchRef[];
  variant: "selector" | "switch";
  currentStoreId?: string;
}) {
  const sorted = sortBranches(branches);

  return (
    <ul data-branch-picker className="mt-6 space-y-3">
      {sorted.map((branch) => (
        <BranchCard
          key={branch.storeId}
          branch={branch}
          current={variant === "switch" && branch.storeId === currentStoreId}
        />
      ))}
    </ul>
  );
}
