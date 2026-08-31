import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStore } from "@/features/catalog/server/queries";
import { requireResolution } from "@/features/storefront/server/resolve";
import { branchTrailStore, checkoutTrail } from "@/features/storefront/trail";
import { Container } from "@/components/ui/Container";
import { CheckoutForm } from "@/features/cart/components/CheckoutForm";
import { StoreClosedNotice } from "@/components/store/StoreClosedNotice";
import { StoreTrail } from "@/components/store/StoreTrail";

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

  return (
    <Container className="pt-4 pb-8">
      <StoreTrail trail={trail} />
      <CheckoutForm storeId={store.id} storeSlug={store.canonicalSlug} />
    </Container>
  );
}
