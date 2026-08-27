import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/adminSession";
import { authorizeStore } from "@/features/admin/authorization";
import { requireManagedStore } from "@/features/admin/server/stores";
import { listStoreCategories } from "@/features/admin/server/products";
import { PromotionForm } from "@/features/admin/components/PromotionForm";
import { Container } from "@/components/ui/Container";

export const dynamic = "force-dynamic";

export default async function NewPromotionPage({
  params,
  searchParams,
}: PageProps<"/admin/tiendas/[storeId]/promociones/nueva">) {
  const { storeId } = await params;
  const query = await searchParams;
  const session = await getAdminSession();
  const authorized = authorizeStore(session, storeId);
  if (!authorized.ok) notFound();

  const store = await requireManagedStore(authorized.storeId);
  const categories = await listStoreCategories(authorized.storeId);
  const productos = typeof query.productos === "string" ? query.productos.split(",") : [];

  return (
    <Container className="max-w-2xl py-8">
      <Link
        href={`/admin/tiendas/${storeId}/promociones`}
        className="text-fg-muted text-sm hover:underline"
      >
        ← Promociones
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">Nueva promoción</h1>
      <div className="mt-6">
        <PromotionForm
          storeId={storeId}
          baseCurrencyCode={store.baseCurrencyCode}
          categories={categories}
          initialProductIds={productos}
        />
      </div>
    </Container>
  );
}
