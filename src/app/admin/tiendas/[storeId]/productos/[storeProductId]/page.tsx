import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/adminSession";
import { authorizeStore } from "@/features/admin/authorization";
import { getProductForEdit } from "@/features/admin/server/products";
import { ProductForm } from "@/features/admin/components/ProductForm";
import { AVAILABILITY_LABEL } from "@/lib/availability";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";

export const dynamic = "force-dynamic";

export default async function ProductEditorPage({
  params,
}: PageProps<"/admin/tiendas/[storeId]/productos/[storeProductId]">) {
  const { storeId, storeProductId } = await params;

  const session = await getAdminSession();
  const authorized = authorizeStore(session, storeId);
  if (!authorized.ok) notFound();

  const lookup = await getProductForEdit(authorized.storeId, storeProductId);
  if (!lookup.ok) notFound();
  const { row: product } = lookup;

  return (
    <Container className="py-8">
      <Link
        href={`/admin/tiendas/${storeId}/productos`}
        className="text-fg-muted text-sm hover:underline"
      >
        ← Productos
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">{product.localName}</h1>

      <Card className="mt-6 p-6">
        <h2 className="text-lg font-semibold">Datos de Cuadre de Caja</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-fg-muted">Precio</dt>
            <dd>
              {product.syncedPrice} {product.syncedPriceCurrency}
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">Disponibilidad</dt>
            <dd>{AVAILABILITY_LABEL[product.availability]}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Categoría</dt>
            <dd>{product.categoryName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Última sincronización</dt>
            <dd>{new Date(product.syncedAt).toLocaleString("es-CU")}</dd>
          </div>
        </dl>
        <Alert tone="muted" className="mt-4">
          Esto se edita en Cuadre de Caja. Aquí lo ves para saber contra qué estás trabajando: si el
          precio o el stock están mal, corrígelos allí y se actualizan solos.
        </Alert>
        {product.deletedAt && (
          <Alert tone="danger" className="mt-3">
            Cuadre de Caja borró este producto. No se puede editar. Si vuelve a aparecer, lo que le
            pusiste sigue aquí.
          </Alert>
        )}
      </Card>

      <Card className="mt-4 p-6">
        <h2 className="text-lg font-semibold">Lo que ves en tu tienda</h2>
        <div className="mt-4">
          <ProductForm storeId={storeId} product={product} />
        </div>
      </Card>
    </Container>
  );
}
