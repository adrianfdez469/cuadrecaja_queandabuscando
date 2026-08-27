import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { PublicSlug } from "@/lib/publicSlug";

/**
 * The hub's «Tu marca» card (design.md § 4, DP2/HS12). Server component,
 * zero client JavaScript — grouping itself lives on its own screen
 * (`GroupStoresForm`), never here.
 *
 * `branches` already carries `managedHref` computed by the PAGE from
 * `listManagedStores` (session-scoped, unaffected by this feature) — this
 * component never receives a bare `storeId` for a sibling it does not
 * manage, so it structurally cannot build a link to one (HS12 condition c).
 */

export type BrandCardBranch = {
  canonicalSlug: PublicSlug;
  name: string;
  status: "PUBLISHED" | "SUSPENDED";
  isCurrent: boolean;
  /** `null` when this admin does not manage this branch (DP2). */
  managedHref: string | null;
};

function statusBadge(status: "PUBLISHED" | "SUSPENDED"): {
  label: string;
  tone: "positive" | "warning";
} {
  return status === "PUBLISHED"
    ? { label: "Abierta", tone: "positive" }
    : { label: "Cerrada ahora", tone: "warning" };
}

export function StoreBrandCard({
  brandName,
  brandSlug,
  branches,
  hasCandidates,
  primaryStoreId,
}: {
  brandName: string;
  brandSlug: PublicSlug;
  branches: BrandCardBranch[];
  hasCandidates: boolean;
  primaryStoreId: string;
}) {
  const multi = branches.length > 1;

  return (
    <div>
      <h2 className="text-lg font-semibold">Tu marca</h2>
      <p className="mt-2 font-medium">{brandName}</p>
      <a
        href={`/${brandSlug}`}
        target="_blank"
        rel="noreferrer"
        aria-label="Ver la tienda en una pestaña nueva"
        className="text-brand block text-sm break-all hover:underline"
      >
        queandabuscando.com/{brandSlug}
      </a>

      <p className="text-fg-muted mt-2 text-sm">
        {multi
          ? `Esa dirección muestra la lista de tus ${branches.length} sucursales.`
          : "Esta es tu única sucursal, así que esa dirección lleva directo a tu catálogo."}
      </p>

      {multi && (
        <>
          <h3 className="mt-4 text-sm font-semibold">Sucursales de esta marca</h3>
          <ul className="mt-2 space-y-2">
            {branches.map((branch) => {
              const badge = statusBadge(branch.status);
              return (
                <li key={branch.canonicalSlug} className="border-border rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{branch.name}</span>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                    {branch.isCurrent && <Badge tone="muted">Esta tienda</Badge>}
                  </div>
                  <a
                    href={`/${branch.canonicalSlug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-fg-muted mt-1 block text-sm break-all hover:underline"
                  >
                    queandabuscando.com/{branch.canonicalSlug}
                  </a>
                  <div className="mt-2 flex flex-wrap gap-3 text-sm">
                    {branch.managedHref && !branch.isCurrent && (
                      <Link
                        href={branch.managedHref}
                        className="text-brand font-medium hover:underline"
                      >
                        Abrir en el panel
                      </Link>
                    )}
                    <a
                      href={`/${branch.canonicalSlug}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Ver la tienda en una pestaña nueva"
                      className="text-brand font-medium hover:underline"
                    >
                      Ver ↗
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="mt-4">
        {hasCandidates ? (
          <Link href={`/admin/tiendas/${primaryStoreId}/agrupar`}>
            <Button variant="secondary">Agrupar otra tienda en esta marca</Button>
          </Link>
        ) : (
          <Alert tone="muted">
            Cuando publiques otro local desde Cuadre de Caja vas a poder agruparlo aquí.
          </Alert>
        )}
      </div>
    </div>
  );
}
