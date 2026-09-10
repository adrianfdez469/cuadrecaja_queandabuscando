import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStore } from "@/features/catalog/server/queries";
import { requireResolution } from "@/features/storefront/server/resolve";
import { branchTrailStore, checkoutTrail } from "@/features/storefront/trail";
import { Container } from "@/components/ui/Container";
import { CheckoutForm } from "@/features/cart/components/CheckoutForm";
import { StoreClosedNotice } from "@/components/store/StoreClosedNotice";
import { StoreTrail } from "@/components/store/StoreTrail";
import { loadStoreForOrder } from "@/features/orders/server/quote";
import { loadStoreZoneCoverageForRender } from "@/features/zones/server/coverage";
import { isDeliveryOffered, type DeliveryConfig } from "@/features/orders/deliveryOffer";

/**
 * Dynamic on purpose (R19): the checkout re-prices against the server on
 * every visit (delivery options and totals both come from `quote`, never
 * from a cached shell). Literal, not imported — revalidate-no-literal.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = { robots: { index: false } };

export default async function CheckoutPage({ params }: PageProps<"/[slug]/checkout">) {
  const { slug } = await params;
  const resolution = await requireResolution(slug);
  if (resolution.kind === "selector") notFound(); // etapa 2, unreachable in this stage
  const store = await requireStore(resolution);
  const trail = checkoutTrail(branchTrailStore(resolution, store));

  if (store.status !== "PUBLISHED") {
    return (
      <Container className="pt-4 pb-8">
        <StoreTrail trail={trail} />
        <StoreClosedNotice
          storeName={store.name}
          disabledReasonCode={store.disabledReasonCode}
          disabledMessage={store.disabledMessage}
          disabledAt={store.disabledAt}
          whatsapp={store.whatsapp}
          phone={store.phone}
          address={store.address}
          extraNote="Si tenías productos en el carrito, siguen guardados en este teléfono: cuando la tienda vuelva a abrir los vas a encontrar ahí."
        />
      </Container>
    );
  }

  // F-042 (architecture.md § AD3, D5, D12) — FRESCO, nunca del `StoreSummary`
  // cacheado de `requireStore` (esa alternativa se descartó explícitamente:
  // una entrada cacheada de antes del despliegue devolvería los campos
  // nuevos como `undefined`, y una tienda ZONE_BASED apagaría su domicilio
  // durante una hora sin que nada falle). `loadStoreForOrder` es el mismo
  // lector, sin caché, que ya usan la cotización y `createOrder`.
  const orderStore = await loadStoreForOrder(store.canonicalSlug);
  const deliveryConfig: DeliveryConfig = orderStore
    ? {
        deliveryEnabled: orderStore.deliveryEnabled,
        deliveryFeeMode: orderStore.deliveryFeeMode,
        deliveryFee: orderStore.deliveryFee,
      }
    : { deliveryEnabled: false, deliveryFeeMode: "FLAT_RATE", deliveryFee: null };

  // La MISMA función que el island y `createOrder.ts` usan (AD3): una
  // consulta, solo cuando el modo es ZONE_BASED — para cualquier otro modo
  // no se consulta el tarifario en absoluto.
  const zoneCoverage =
    deliveryConfig.deliveryFeeMode === "ZONE_BASED"
      ? await loadStoreZoneCoverageForRender(store.id)
      : null;
  const hasResolvableZone = (zoneCoverage?.length ?? 0) > 0;
  const deliveryOffered = isDeliveryOffered(deliveryConfig, { hasResolvableZone });

  return (
    <Container className="pt-4 pb-8">
      <StoreTrail trail={trail} />
      <CheckoutForm
        storeId={store.id}
        storeSlug={store.canonicalSlug}
        deliveryOffered={deliveryOffered}
        deliveryFeeMode={deliveryConfig.deliveryFeeMode}
        deliveryFlatFee={deliveryConfig.deliveryFee}
        zoneCoverage={zoneCoverage}
      />
    </Container>
  );
}
