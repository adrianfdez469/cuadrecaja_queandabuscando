import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/adminSession";
import { authorizeStore } from "@/features/admin/authorization";
import { requireManagedStore } from "@/features/admin/server/stores";
import { summarizeStoreProducts } from "@/features/admin/server/products";
import { listPromotions } from "@/features/admin/server/promotions";
import { promotionStatus } from "@/features/admin/promotionLabel";
import { StorePublicSwitch } from "@/features/admin/components/StorePublicSwitch";
import { STORE_STATUS_LABEL, STORE_STATUS_TONE } from "@/features/admin/storeStatus";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";

export const dynamic = "force-dynamic";

// HD10: only DRAFT still points back at Cuadre de Caja — SUSPENDED is now
// resolved from the panel's own switch (Card 0 below), so this card no
// longer tells that half of the old story (design.md § 2, "ojo con el
// cambio de este ciclo").
const NON_PUBLISHED_NOTE: Record<"DRAFT", string> = {
  DRAFT: "Tu tienda todavía no es visible para tus clientes. Publícala desde Cuadre de Caja.",
};

export default async function StoreHubPage({ params }: PageProps<"/admin/tiendas/[storeId]">) {
  const { storeId } = await params;
  const session = await getAdminSession();
  const authorized = authorizeStore(session, storeId);
  // The layout already redirects an unauthenticated visitor; an admin
  // authenticated for OTHER stores sees this as a plain 404 (R7, criterio 6):
  // it never reveals whether the store exists.
  if (!authorized.ok) notFound();

  const store = await requireManagedStore(authorized.storeId);
  const [products, promotions] = await Promise.all([
    summarizeStoreProducts(authorized.storeId),
    listPromotions(authorized.storeId),
  ]);
  const now = new Date();
  const vigentCount = promotions.filter((p) => promotionStatus(p, now) === "vigente").length;
  const scheduledCount = promotions.filter((p) => promotionStatus(p, now) === "programada").length;

  return (
    <Container className="py-8">
      <Link href="/admin" className="text-fg-muted text-sm hover:underline">
        ← Tus tiendas
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">{store.name}</h1>
      {store.status === "PUBLISHED" && (
        <a
          href={`/${store.canonicalSlug}`}
          target="_blank"
          rel="noreferrer"
          className="text-fg-muted mt-1 block text-sm hover:underline"
        >
          queandabuscando.com/{store.canonicalSlug}
        </a>
      )}

      <Card className="mt-6 p-6">
        <StorePublicSwitch
          storeId={store.id}
          storeName={store.name}
          status={store.status}
          disabledReasonCode={store.disabledReasonCode}
          disabledMessage={store.disabledMessage}
          disabledAt={store.disabledAt}
          whatsapp={store.whatsapp}
          phone={store.phone}
          address={store.address}
        />
      </Card>

      <Card className="mt-4 p-6">
        <h2 className="text-lg font-semibold">Datos de Cuadre de Caja</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Field label="Nombre" value={store.name} />
          <Field label="Dirección" value={store.address} />
          <Field label="Ciudad" value={store.city} />
          <Field label="Provincia" value={store.province} />
          <div>
            <dt className="text-fg-muted">Estado</dt>
            <dd className="mt-0.5">
              <Badge tone={STORE_STATUS_TONE[store.status]}>
                {STORE_STATUS_LABEL[store.status]}
              </Badge>
            </dd>
          </div>
        </dl>
        <Alert tone="muted" className="mt-4">
          <p>Esto se edita en Cuadre de Caja.</p>
          <p>
            Aquí lo ves para saber qué está publicado: si algo está mal, corrígelo allí y se
            actualiza solo.
          </p>
        </Alert>
        {store.status === "DRAFT" && (
          <Alert tone="warning" className="mt-3">
            {NON_PUBLISHED_NOTE.DRAFT}
          </Alert>
        )}
      </Card>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Link href={`/admin/tiendas/${store.id}/productos`}>
          <Card className="p-6 transition-shadow hover:shadow-lg">
            <h2 className="text-lg font-semibold">Productos</h2>
            <p className="text-fg-muted mt-1 text-sm">
              {products.total === 0
                ? "Todavía no hay productos. Los crea Cuadre de Caja al sincronizar."
                : `${products.total} productos · ${products.hidden} ocultos · ${products.withoutImage} sin imagen`}
            </p>
          </Card>
        </Link>

        <Link href={`/admin/tiendas/${store.id}/promociones`}>
          <Card className="p-6 transition-shadow hover:shadow-lg">
            <h2 className="text-lg font-semibold">Promociones</h2>
            <p className="text-fg-muted mt-1 text-sm">
              {promotions.length === 0
                ? "Ninguna todavía."
                : `${vigentCount} vigentes · ${scheduledCount} programada${scheduledCount === 1 ? "" : "s"}`}
            </p>
          </Card>
        </Link>
      </div>

      <Card className="mt-4 p-6">
        <h2 className="text-lg font-semibold">Colores y contacto</h2>
        <Alert tone="muted" className="mt-3">
          <p>En camino.</p>
          <p>
            Los colores de tu tienda y el texto de contacto se van a editar aquí. Todavía no:
            primero llega el cambio que le da a tu marca una sola dirección para todas tus
            sucursales.
          </p>
        </Alert>
      </Card>
    </Container>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-fg-muted">{label}</dt>
      <dd className={value ? "mt-0.5" : "text-fg-muted mt-0.5"}>{value ?? "—"}</dd>
    </div>
  );
}
