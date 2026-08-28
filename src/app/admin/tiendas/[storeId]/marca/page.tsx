import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/adminSession";
import { authorizeStore, authorizeBrandCoverage } from "@/features/admin/authorization";
import { loadBrandingTarget } from "@/features/admin/server/branding";
import { BrandingForm } from "@/features/admin/components/BrandingForm";
import { BrandCoverageNotice } from "@/features/admin/components/BrandCoverageNotice";
import { ThemeSwatches } from "@/features/admin/components/ThemeSwatches";
import { StorefrontPreview } from "@/features/admin/components/StorefrontPreview";
import { parseThemeTokens } from "@/features/theming/storeTheme";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";

export const dynamic = "force-dynamic";

function headerPhrase(brandName: string, renderableCount: number): string {
  if (renderableCount === 1) {
    return `Estos colores son de ${brandName}, tu marca. Como tienes una sola sucursal, son los de tu tienda.`;
  }
  if (renderableCount === 0) {
    return `Estos colores son de ${brandName}, tu marca. Todavía ninguna de tus sucursales es visible para tus clientes: elígelos ahora y ya van a estar cuando publiques.`;
  }
  return `Estos colores son de ${brandName}, tu marca: los usan tus ${renderableCount} sucursales y la página que las lista. No se pueden poner distintos en una sucursal y en otra.`;
}

export default async function BrandingPage({
  params,
}: PageProps<"/admin/tiendas/[storeId]/marca">) {
  const { storeId } = await params;
  const session = await getAdminSession();
  const authorized = authorizeStore(session, storeId);
  // Same 404 as the rest of the panel (R7): an admin authenticated for
  // other stores never learns whether this one exists.
  if (!authorized.ok) notFound();

  const target = await loadBrandingTarget(authorized.storeId);
  // The tienda disappeared between login and this request — same case
  // `requireManagedStore` already covers for the hub.
  if (!target) notFound();

  const tokens = parseThemeTokens(target.themeTokens);
  const renderableCount = target.branches.length;

  const coverage = authorizeBrandCoverage(authorized.session, {
    storefrontId: target.storefrontId,
    branches: target.branches,
  });

  return (
    <Container className="py-8">
      <Link href={`/admin/tiendas/${storeId}`} className="text-fg-muted text-sm hover:underline">
        ← {target.storeName}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">Colores de tu marca</h1>
      <p className="text-fg-muted mt-2 max-w-2xl text-sm">
        {headerPhrase(target.brandName, renderableCount)}
      </p>

      <Card className="mt-6 p-6">
        {coverage.ok ? (
          <BrandingForm
            storeId={storeId}
            storeName={target.storeName}
            initialTokens={tokens}
            branchCount={renderableCount}
          />
        ) : (
          <div>
            <BrandCoverageNotice
              brandName={target.brandName}
              totalBranches={renderableCount}
              coveredBranches={renderableCount - coverage.missing.length}
              missing={coverage.missing}
            />
            <div className="mt-4 border-t pt-4">
              <h3 className="text-sm font-semibold">Los colores que tiene tu marca ahora</h3>
              <div className="mt-2">
                <ThemeSwatches tokens={tokens} />
              </div>
              <div className="mt-4">
                <StorefrontPreview
                  tokens={tokens}
                  storeName={target.storeName}
                  branchCount={renderableCount}
                  heading={null}
                  footnote="Así ven hoy tus clientes el catálogo de esta sucursal."
                />
              </div>
            </div>
          </div>
        )}
      </Card>
    </Container>
  );
}
