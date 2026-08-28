import { Alert } from "@/components/ui/Alert";

/**
 * design.md § 12b (E40b, R45, HS12): what the screen shows when the admin
 * does not administer EVERY renderable branch of the brand. Server
 * component, ZERO client JavaScript — there is nothing here to activate.
 *
 * `missing` never carries a `storeId` (HS12 condition b): `authorizeBrandCoverage`
 * itself only ever returns name and city, so this component structurally
 * cannot build a link or a form toward a branch its own session does not
 * cover, even if someone tried to pass one in later.
 */
export function BrandCoverageNotice({
  brandName,
  totalBranches,
  coveredBranches,
  missing,
}: {
  brandName: string;
  totalBranches: number;
  coveredBranches: number;
  missing: readonly { name: string; city: string | null }[];
}) {
  return (
    <div>
      <Alert tone="warning">
        <p>
          Para cambiar los colores necesitas administrar las {totalBranches} sucursales de{" "}
          {brandName}.
        </p>
        <p className="mt-1">
          Los colores son de la marca, no de una sucursal: si los cambias, cambian en todas. Hoy
          administras {coveredBranches} de {totalBranches}.
        </p>
      </Alert>

      <h3 className="mt-4 text-sm font-semibold">Te faltan estas sucursales</h3>
      <ul className="mt-2 space-y-2">
        {missing.map((branch) => (
          <li key={branch.name} className="border-border rounded-md border p-3">
            <p className="font-medium">{branch.name}</p>
            {branch.city && <p className="text-fg-muted mt-0.5 text-sm">{branch.city}</p>}
          </li>
        ))}
      </ul>

      <p className="text-fg-muted mt-3 text-sm">
        Pide el acceso en Cuadre de Caja y vuelve aquí. Mientras tanto, los cambia quien administre
        las {totalBranches}.
      </p>
    </div>
  );
}
