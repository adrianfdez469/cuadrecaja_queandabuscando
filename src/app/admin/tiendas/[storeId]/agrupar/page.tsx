import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/adminSession";
import { authorizeStore } from "@/features/admin/authorization";
import {
  listGroupCandidates,
  previewGrouping,
  requireManagedStore,
} from "@/features/admin/server/stores";
import { GroupStoresForm } from "@/features/admin/components/GroupStoresForm";
import { Alert } from "@/components/ui/Alert";
import { Container } from "@/components/ui/Container";

export const dynamic = "force-dynamic";

/**
 * HS8, DP5: agrupar otra tienda bajo la marca de `storeId`. Ruta propia, no
 * un bloque del hub (design.md § 5): es irreversible, merece una URL para
 * volver y para compartir, y el 404 de tienda ajena la protege igual que al
 * resto del panel (R7).
 */
export default async function GroupStoresPage({
  params,
}: PageProps<"/admin/tiendas/[storeId]/agrupar">) {
  const { storeId } = await params;
  const session = await getAdminSession();
  const authorized = authorizeStore(session, storeId);
  if (!authorized.ok) notFound();

  const store = await requireManagedStore(authorized.storeId);
  const [candidates, preview] = await Promise.all([
    listGroupCandidates(authorized.session, authorized.storeId),
    previewGrouping(authorized.storeId),
  ]);
  if (!preview) notFound();

  return (
    <Container className="py-8">
      <Link href={`/admin/tiendas/${store.id}`} className="text-fg-muted text-sm hover:underline">
        ← {store.name}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">Agrupar otra tienda en tu marca</h1>
      <p className="text-fg-muted mt-2 max-w-2xl">
        Las tiendas agrupadas comparten una sola dirección: tus clientes entran por la marca y
        eligen la sucursal. Cada sucursal conserva su propio catálogo, sus precios y su propia
        dirección.
      </p>

      <Alert tone="warning" className="mt-4" title="Esto no se puede deshacer.">
        No hay forma de separar dos tiendas agrupadas desde el panel. Lee lo que va a cambiar antes
        de confirmar.
      </Alert>

      {candidates.length === 0 ? (
        <Alert tone="muted" className="mt-4">
          <p className="font-medium">No tienes otra tienda para agrupar.</p>
          <p className="mt-1">
            Solo se pueden agrupar tiendas del mismo negocio que administres tú. Publica el otro
            local desde Cuadre de Caja y vuelve aquí.
          </p>
        </Alert>
      ) : (
        <GroupStoresForm
          primaryStoreId={store.id}
          primaryName={store.name}
          primaryBrandSlug={preview.primaryBrandSlug}
          primaryBranchSlug={preview.primaryBranchSlug}
          primaryBranchAlreadyExists={preview.primaryBranchAlreadyExists}
          candidates={candidates}
        />
      )}
    </Container>
  );
}
