import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BranchList } from "./BranchList";
import type { BranchRef } from "@/features/storefront/server/resolve";

function branch(overrides: Partial<BranchRef>): BranchRef {
  return {
    storeId: "store-1",
    canonicalSlug: "una-tienda" as BranchRef["canonicalSlug"],
    name: "Una Tienda",
    city: "La Habana",
    address: "Calle 1",
    status: "PUBLISHED",
    disabledReasonCode: null,
    disabledMessage: null,
    disabledAt: null,
    ...overrides,
  };
}

describe("BranchList — orden (DP3)", () => {
  it("puts open branches first, then closed (admin/pos), then platform-suspended — a STABLE sort by group, on input the resolver already delivers alphabetically (architecture.md § DP3: no second query, no re-sort within a group)", () => {
    // Deliberately interleaved across groups (as the resolver's global
    // `orderBy: { name: "asc" }` would produce for these five names) so the
    // test actually exercises cross-group reordering, not just an
    // already-grouped input.
    const branches: BranchRef[] = [
      branch({ storeId: "s-open-a", name: "Alfa abierta", status: "PUBLISHED" }),
      branch({
        storeId: "s-closed-b",
        name: "Beta cerrada",
        status: "SUSPENDED",
        disabledReasonCode: "VACACIONES",
      }),
      branch({ storeId: "s-open-c", name: "Charlie abierta", status: "PUBLISHED" }),
      branch({
        storeId: "s-closed-d",
        name: "Delta cerrada",
        status: "SUSPENDED",
        disabledReasonCode: "VACACIONES",
      }),
      // classifyStoreClosure()'s "platform" fallback is a SUSPENDED branch
      // with NEITHER a reasonCode NOR a disabledAt — a genuine platform-level
      // suspension, distinct from "cerrada ahora" (admin/POS-closed).
      branch({
        storeId: "s-platform",
        name: "Echo suspendida",
        status: "SUSPENDED",
        disabledReasonCode: null,
        disabledAt: null,
      }),
    ];

    render(<BranchList branches={branches} variant="selector" />);

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "Alfa abierta",
      "Charlie abierta",
      "Beta cerrada",
      "Delta cerrada",
      "Echo suspendida",
    ]);
  });

  it("emits data-branch-picker on its container", () => {
    render(<BranchList branches={[branch({})]} variant="selector" />);
    expect(document.querySelector("[data-branch-picker]")).not.toBeNull();
  });
});

describe("BranchList — variant switch (/[slug]/sucursales, criterio 6)", () => {
  it("the current branch is not a link and carries aria-current + 'Estás aquí'", () => {
    const branches: BranchRef[] = [
      branch({ storeId: "current", name: "Sucursal actual" }),
      branch({ storeId: "other", name: "Otra sucursal" }),
    ];

    render(<BranchList branches={branches} variant="switch" currentStoreId="current" />);

    const currentItem = screen.getByText("Sucursal actual").closest("li");
    expect(currentItem?.getAttribute("aria-current")).toBe("page");
    expect(currentItem?.querySelector("a")).toBeNull();
    expect(screen.getByText("Estás aquí")).toBeInTheDocument();

    const otherItem = screen.getByText("Otra sucursal").closest("li");
    expect(otherItem?.querySelector("a")).not.toBeNull();
  });
});
