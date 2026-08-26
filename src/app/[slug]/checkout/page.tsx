import type { Metadata } from "next";
import { requireStore } from "@/features/catalog/server/queries";
import { Container } from "@/components/ui/Container";
import { CheckoutForm } from "@/features/cart/components/CheckoutForm";
import { StoreClosedNotice } from "@/components/store/StoreClosedNotice";

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
  const store = await requireStore(slug);

  if (store.status !== "PUBLISHED") {
    return (
      <Container className="py-8">
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
    <Container className="py-8">
      <CheckoutForm storeId={store.id} storeSlug={store.slug} />
    </Container>
  );
}
