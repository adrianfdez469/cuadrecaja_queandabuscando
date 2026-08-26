import type { Metadata } from "next";
import { requireStore } from "@/features/catalog/server/queries";
import { Container } from "@/components/ui/Container";
import { CartView } from "@/features/cart/components/CartView";
import { StoreClosedNotice } from "@/components/store/StoreClosedNotice";

/**
 * Dynamic on purpose (R19, I8): the page re-prices against the server on
 * every visit through `POST /api/orders/quote`, so it can never be `●`.
 * Must be a literal — `revalidate-no-literal` — and it also has to be
 * `revalidate = 0`, or Next would try to cache a shell around a client
 * island that fetches fresh data anyway.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = { robots: { index: false } };

export default async function CartPage({ params }: PageProps<"/[slug]/carrito">) {
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
      <CartView storeId={store.id} storeSlug={store.slug} />
    </Container>
  );
}
