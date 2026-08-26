import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/adminSession";
import { authorizeStore } from "@/features/admin/authorization";
import { requireManagedStore } from "@/features/admin/server/stores";
import { listPromotions } from "@/features/admin/server/promotions";
import { listStoreCategories } from "@/features/admin/server/products";
import {
  derivedPromotionLabel,
  promotionStatus,
  PROMOTION_STATUS_LABEL,
  PROMOTION_STATUS_TONE,
} from "@/features/admin/promotionLabel";
import { PromotionActions } from "@/features/admin/components/PromotionActions";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";

export const dynamic = "force-dynamic";

export default async function PromotionsPage({
  params,
}: PageProps<"/admin/tiendas/[storeId]/promociones">) {
  const { storeId } = await params;
  const session = await getAdminSession();
  const authorized = authorizeStore(session, storeId);
  if (!authorized.ok) notFound();

  const store = await requireManagedStore(authorized.storeId);
  const [promotions, categories] = await Promise.all([
    listPromotions(authorized.storeId),
    listStoreCategories(authorized.storeId),
  ]);
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const now = new Date();

  return (
    <Container className="py-8">
      <Link href={`/admin/tiendas/${storeId}`} className="text-fg-muted text-sm hover:underline">
        ← Tienda
      </Link>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Promociones</h1>
        <Link href={`/admin/tiendas/${storeId}/promociones/nueva`}>
          <Button>Nueva promoción</Button>
        </Link>
      </div>

      {promotions.length > 0 && (
        <p className="text-fg-muted mt-3 text-sm">
          Si dos promociones caen sobre el mismo producto, se aplica solo la que deje el precio más
          bajo. Nunca se suman.
        </p>
      )}

      {promotions.length === 0 ? (
        <Alert tone="muted" className="mt-6">
          <p>Todavía no tienes promociones.</p>
          <p>
            Una promoción baja el precio de unos productos, de una categoría o de todo el pedido,
            durante el tiempo que tú digas.
          </p>
        </Alert>
      ) : (
        <ul className="mt-6 space-y-3">
          {promotions.map((promo) => {
            const status = promotionStatus(promo, now);
            const label =
              promo.name ?? derivedPromotionLabel(promo, store.baseCurrencyCode, categoryNames);
            const derived = derivedPromotionLabel(promo, store.baseCurrencyCode, categoryNames);
            return (
              <li key={promo.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{label}</p>
                      {promo.name && <p className="text-fg-muted text-sm">{derived}</p>}
                    </div>
                    <Badge tone={PROMOTION_STATUS_TONE[status]}>
                      {PROMOTION_STATUS_LABEL[status]}
                    </Badge>
                  </div>
                  <div className="mt-3">
                    <PromotionActions storeId={storeId} promotion={promo} />
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}
