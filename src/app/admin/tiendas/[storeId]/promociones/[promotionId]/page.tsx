import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/adminSession";
import { authorizeStore } from "@/features/admin/authorization";
import { requireManagedStore } from "@/features/admin/server/stores";
import { getPromotion } from "@/features/admin/server/promotions";
import { listStoreCategories } from "@/features/admin/server/products";
import { PromotionForm } from "@/features/admin/components/PromotionForm";
import { Container } from "@/components/ui/Container";

export const dynamic = "force-dynamic";

export default async function EditPromotionPage({
  params,
}: PageProps<"/admin/tiendas/[storeId]/promociones/[promotionId]">) {
  const { storeId, promotionId } = await params;
  const session = await getAdminSession();
  const authorized = authorizeStore(session, storeId);
  if (!authorized.ok) notFound();

  const store = await requireManagedStore(authorized.storeId);
  const lookup = await getPromotion(authorized.storeId, promotionId);
  if (!lookup.ok) notFound();
  const categories = await listStoreCategories(authorized.storeId);

  return (
    <Container className="max-w-2xl py-8">
      <Link
        href={`/admin/tiendas/${storeId}/promociones`}
        className="text-fg-muted text-sm hover:underline"
      >
        ← Promociones
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">Editar promoción</h1>
      <div className="mt-6">
        <PromotionForm
          storeId={storeId}
          baseCurrencyCode={store.baseCurrencyCode}
          categories={categories}
          promotion={lookup.row}
        />
      </div>
    </Container>
  );
}
